#!/usr/bin/env bash
#
# Restore the most recent backup into a throwaway container and assert it is
# actually usable.
#
# A backup that has never been restored is not a backup — it is an untested
# assumption. This script is the difference between the two, and it is why
# item 0.1 is not considered done until this has been run at least once.
#
# Safe to run any time: it never touches the production database or volume, and
# it removes its own container on exit.
#
#   ./scripts/verify-restore.sh              # newest backup
#   ./scripts/verify-restore.sh qa-2026....dump   # a specific one
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HERE}/../.env.production"
source "${HERE}/lib/load-dotenv.sh"
load_dotenv_file "${ENV_FILE}"

source "${HERE}/lib/backup-storage.sh"
backup_storage_init
TEST_CONTAINER="qa-restore-verify-$$"
TEST_PASSWORD="verify-only-$$"
POSTGRES_IMAGE="pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337"

DUMP="$(mktemp -t qa-verify.XXXXXX.dump)"
cleanup() {
  docker rm -f "${TEST_CONTAINER}" >/dev/null 2>&1 || true
  rm -f "${DUMP}"
}
trap cleanup EXIT

log()  { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "FAIL: $*"; exit 1; }

# ── Fetch ────────────────────────────────────────────────────────────────────
if [ $# -ge 1 ]; then
  KEY="$1"
else
  KEY="$(backup_storage_list | grep -E '^qa-.*\.dump$' | sort | tail -1)"
fi
[ -n "${KEY}" ] || fail "no backups found in $(backup_storage_label)"

log "verifying ${KEY}"
backup_storage_download "${KEY}" "${DUMP}"
log "downloaded $(wc -c < "${DUMP}" | tr -d ' ') bytes"

# ── Restore into a disposable postgres ───────────────────────────────────────
log "starting throwaway postgres"
docker run -d --name "${TEST_CONTAINER}" \
  -e POSTGRES_PASSWORD="${TEST_PASSWORD}" \
  -e POSTGRES_USER=verify \
  -e POSTGRES_DB=verify \
  "${POSTGRES_IMAGE}" >/dev/null

for _ in $(seq 1 30); do
  docker exec "${TEST_CONTAINER}" pg_isready -U verify -d verify >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${TEST_CONTAINER}" pg_isready -U verify -d verify >/dev/null 2>&1 \
  || fail "throwaway postgres never became ready"
docker exec "${TEST_CONTAINER}" psql -U verify -d verify -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null

docker cp "${DUMP}" "${TEST_CONTAINER}:/tmp/verify.dump"

# --no-owner because the dump's role does not exist here. Warnings are expected
# and tolerated; what matters is whether the data lands.
log "restoring"
docker exec "${TEST_CONTAINER}" pg_restore \
  -U verify -d verify --no-owner --no-acl /tmp/verify.dump 2>/dev/null || true

# ── Assert the data is actually there ────────────────────────────────────────
# Table list is deliberately the spine of the product: if any of these is empty,
# the backup is not usable regardless of what pg_restore reported.
FAILED=0
for t in organisations users projects test_definitions test_runs; do
  n="$(docker exec "${TEST_CONTAINER}" psql -U verify -d verify -tAc \
        "SELECT count(*) FROM ${t};" 2>/dev/null || echo "ERR")"
  if [ "${n}" = "ERR" ]; then
    log "  ${t}: MISSING TABLE"; FAILED=1
  elif [ "${n}" -eq 0 ]; then
    log "  ${t}: 0 rows  <-- empty"; FAILED=1
  else
    log "  ${t}: ${n} rows"
  fi
done

TABLES="$(docker exec "${TEST_CONTAINER}" psql -U verify -d verify -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';")"
log "  ${TABLES} tables restored"

VECTOR_OK="$(docker exec "${TEST_CONTAINER}" psql -U verify -d verify -tAc \
  "SELECT '[1,2,3]'::vector;" 2>/dev/null || echo "ERR")"
if [ "${VECTOR_OK}" = "ERR" ]; then
  log "  pgvector: VECTOR QUERY FAILED"; FAILED=1
else
  log "  pgvector: ${VECTOR_OK}"
fi

[ "${FAILED}" -eq 0 ] || fail "restore produced missing or empty core tables"

log "RESTORE VERIFIED — ${KEY} is usable"
