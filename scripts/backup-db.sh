#!/usr/bin/env bash
#
# Nightly logical backup of the production database to S3-compatible storage.
#
# Until this existed there was no backup of any kind: production data lived in a
# single Docker volume on one host, so a disk failure, a bad migration, or one
# mistyped `docker volume prune` was total unrecoverable loss.
#
# Install on the prod host:
#   0 2 * * * /home/ubuntu/qa_platform/scripts/backup-db.sh >> /var/log/qa-backup.log 2>&1
#
# Required environment (read from .env.production if present):
#   BACKUP_BUCKET      S3 bucket name
#   POSTGRES_USER      database user
#   POSTGRES_DB        database name
# Optional:
#   POSTGRES_CONTAINER container name        (default: qa-postgres-prod)
#   BACKUP_PREFIX      key prefix in bucket  (default: db)
#   BACKUP_RETAIN_DAYS retention window      (default: 30)
#   AWS_ENDPOINT_URL   for MinIO / R2 / Spaces
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HERE}/../.env.production"
# shellcheck disable=SC1090
[ -f "${ENV_FILE}" ] && set -a && . "${ENV_FILE}" && set +a

: "${BACKUP_BUCKET:?BACKUP_BUCKET must be set}"
: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
CONTAINER="${POSTGRES_CONTAINER:-qa-postgres-prod}"
PREFIX="${BACKUP_PREFIX:-db}"
RETAIN_DAYS="${BACKUP_RETAIN_DAYS:-30}"

# A dump smaller than this is assumed truncated. An empty schema dumps at roughly
# 30–50 KB, so 100 KB is comfortably below a real backup and well above a failure.
MIN_BYTES="${BACKUP_MIN_BYTES:-100000}"

AWS_ARGS=()
[ -n "${AWS_ENDPOINT_URL:-}" ] && AWS_ARGS+=(--endpoint-url "${AWS_ENDPOINT_URL}")

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$(mktemp -t "qa-${STAMP}.XXXXXX.dump")"
trap 'rm -f "${OUT}"' EXIT

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "starting backup of ${POSTGRES_DB} from ${CONTAINER}"

# -Fc (custom format) rather than plain SQL: pg_restore can then do selective and
# parallel restores, which matters when you are recovering under pressure.
if ! docker exec "${CONTAINER}" pg_dump \
      -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" \
      -Fc --no-owner --no-acl > "${OUT}"; then
  log "FATAL: pg_dump failed"
  exit 1
fi

SIZE="$(wc -c < "${OUT}" | tr -d ' ')"
if [ "${SIZE}" -lt "${MIN_BYTES}" ]; then
  log "FATAL: dump is only ${SIZE} bytes (min ${MIN_BYTES}) — refusing to upload a truncated backup"
  exit 1
fi

KEY="s3://${BACKUP_BUCKET}/${PREFIX}/qa-${STAMP}.dump"
if ! aws "${AWS_ARGS[@]}" s3 cp "${OUT}" "${KEY}" --only-show-errors; then
  log "FATAL: upload to ${KEY} failed"
  exit 1
fi

log "uploaded ${KEY} (${SIZE} bytes)"

# Retention. Parsed from the key name rather than S3 timestamps so it stays
# correct if an object is ever re-uploaded or copied between buckets.
CUTOFF="$(date -u -d "${RETAIN_DAYS} days ago" +%Y%m%d 2>/dev/null \
       || date -u -v-"${RETAIN_DAYS}"d +%Y%m%d)"

aws "${AWS_ARGS[@]}" s3 ls "s3://${BACKUP_BUCKET}/${PREFIX}/" \
  | awk '{print $4}' \
  | while read -r key; do
      [ -z "${key}" ] && continue
      ts="${key#qa-}"; ts="${ts%%T*}"
      case "${ts}" in
        [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
        *) continue ;;
      esac
      if [ "${ts}" -lt "${CUTOFF}" ]; then
        aws "${AWS_ARGS[@]}" s3 rm "s3://${BACKUP_BUCKET}/${PREFIX}/${key}" --only-show-errors
        log "pruned ${key}"
      fi
    done

log "backup complete"
