#!/usr/bin/env bash
#
# Disk usage guard for the production host.
#
# Artifacts (videos, traces, screenshots) share a disk with Postgres. When that
# disk fills, Postgres cannot write WAL — so unbounded artifact growth does not
# merely lose artifacts, it corrupts the database. The retention sweep in the API
# bounds the growth; this is the backstop that says so out loud if it doesn't.
#
# Install:
#   */15 * * * * /home/ubuntu/qa_platform/scripts/disk-alert.sh >> /var/log/qa-disk.log 2>&1
#
# Optional environment:
#   DISK_WARN_PCT   default 75
#   DISK_PAGE_PCT   default 90
#   ALERT_WEBHOOK   Slack/Teams-compatible incoming webhook
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HERE}/../.env.production"
# shellcheck disable=SC1090
[ -f "${ENV_FILE}" ] && set -a && . "${ENV_FILE}" && set +a

WARN="${DISK_WARN_PCT:-75}"
PAGE="${DISK_PAGE_PCT:-90}"
MOUNT="${DISK_MOUNT:-/}"

USED="$(df -P "${MOUNT}" | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
AVAIL="$(df -Ph "${MOUNT}" | awk 'NR==2 {print $4}')"

log() { printf '%s  %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

notify() {
  local level="$1" msg="$2"
  log "${level}: ${msg}"
  [ -n "${ALERT_WEBHOOK:-}" ] || return 0
  curl -fsS -X POST "${ALERT_WEBHOOK}" \
    -H 'Content-Type: application/json' \
    -d "$(printf '{"text":"[%s] %s"}' "${level}" "${msg}")" >/dev/null 2>&1 || true
}

# Largest consumers, so the alert is actionable rather than just alarming.
top_offenders() {
  docker system df 2>/dev/null | sed -n '1,5p' || true
}

if [ "${USED}" -ge "${PAGE}" ]; then
  notify "CRITICAL" "Disk ${MOUNT} at ${USED}% (${AVAIL} free). Postgres WAL writes are at risk. $(top_offenders | tr '\n' ' ')"
  exit 2
elif [ "${USED}" -ge "${WARN}" ]; then
  notify "WARNING" "Disk ${MOUNT} at ${USED}% (${AVAIL} free). Check artifact retention."
  exit 1
fi

log "OK: disk ${MOUNT} at ${USED}% (${AVAIL} free)"
