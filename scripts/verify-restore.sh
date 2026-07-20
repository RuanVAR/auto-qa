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
# shellcheck disable=SC1090
[ -f "${ENV_FILE}" ] && set -a && . "${ENV_FILE}" && set +a

: "${BACKUP_BUCKET:?BACKUP_BUCKET must be set}"
PREFIX="${BACKUP_PREFIX:-db}"
TEST_CONTAINER="qa-restore-verify-$$"
TEST_PASSWORD="verify-only-$$"

AWS_ARGS=()
[ -n "${AWS_ENDPOINT_URL:-}" ] && AWS_ARGS+=(--endpoint-url "${AWS_ENDPOINT_URL}")

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
  KEY="$(aws "${AWS_ARGS[@]}" s3 ls "s3://${BACKUP_BUCKET}/${PREFIX}/" \
        | awk '{print $4}' | grep -E '^qa-.*\.dump$' | sort | tail -1)"
fi
[ -n "${KEY}" ] || fail "no backups found in s3://${BACKUP_BUCKET}/${PREFIX}/"

log "verifying ${KEY}"
aws "${AWS_ARGS[@]}" s3 cp "s3://${BACKUP_BUCKET}/${PREFIX}/${KEY}" "${DUMP}" --only-show-errors
log "downloaded $(wc -c < "${DUMP}" | tr -d ' ') bytes"

# ── Restore into a disposable postgres ───────────────────────────────────────
log "starting throwaway postgres"
docker run -d --name "${TEST_CONTAINER}" \
  -e POSTGRES_PASSWORD="${TEST_PASSWORD}" \
  -e POSTGRES_USER=verify \
  -e POSTGRES_DB=verify \
  postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  docker exec "${TEST_CONTAINER}" pg_isready -U verify -d verify >/dev/null 2>&1 && break
  sleep 1
done
docker exec "${TEST_CONTAINER}" pg_isready -U verify -d verify >/dev/null 2>&1 \
  || fail "throwaway postgres never became ready"

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

[ "${FAILED}" -eq 0 ] || fail "restore produced missing or empty core tables"

log "RESTORE VERIFIED — ${KEY} is usable"
