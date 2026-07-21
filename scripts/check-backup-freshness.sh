#!/usr/bin/env bash
# Alerts when the newest off-host database backup is older than the RPO.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HERE}/../.env.production"
source "${HERE}/lib/load-dotenv.sh"
load_dotenv_file "${ENV_FILE}"

source "${HERE}/lib/backup-storage.sh"
backup_storage_init
MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
notify() {
  log "CRITICAL: $1"
  [ -n "${ALERT_WEBHOOK:-}" ] || return 0
  curl -fsS -X POST "${ALERT_WEBHOOK}" -H 'Content-Type: application/json' \
    -d "$(printf '{\"text\":\"[CRITICAL] %s\"}' "$1")" >/dev/null 2>&1 || true
}

KEY="$(backup_storage_list | grep -E '^qa-[0-9]{8}T[0-9]{6}Z\.dump$' | sort | tail -1 || true)"
if [ -z "${KEY}" ]; then
  notify "No database backups found in $(backup_storage_label)"
  exit 2
fi

STAMP="${KEY#qa-}"; STAMP="${STAMP%.dump}"
if date -u -d "${STAMP}" +%s >/dev/null 2>&1; then
  BACKUP_EPOCH="$(date -u -d "${STAMP}" +%s)"
else
  BACKUP_EPOCH="$(date -j -u -f '%Y%m%dT%H%M%SZ' "${STAMP}" +%s)"
fi
AGE_HOURS=$(( ($(date -u +%s) - BACKUP_EPOCH) / 3600 ))
if [ "${AGE_HOURS}" -gt "${MAX_AGE_HOURS}" ]; then
  notify "Newest database backup ${KEY} is ${AGE_HOURS}h old (maximum ${MAX_AGE_HOURS}h)"
  exit 2
fi

log "OK: newest backup ${KEY} is ${AGE_HOURS}h old"
