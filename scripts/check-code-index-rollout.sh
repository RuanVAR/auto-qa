#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT}/.env.production"
COMPOSE=(docker compose -f "${ROOT}/docker/prod/docker-compose.yml" --env-file "${ENV_FILE}")

source "${ROOT}/scripts/lib/load-dotenv.sh"
load_dotenv_file "${ENV_FILE}"

: "${POSTGRES_USER:?POSTGRES_USER must be set}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"
: "${REDIS_PASSWORD:?REDIS_PASSWORD must be set}"

echo "Code index rollout observation"
echo "  enabled: ${CODE_INDEX_ENABLED:-false}"
echo "  deployment: ${CODE_INDEXER_DEPLOYMENT:-local}"
echo "  concurrency: ${CODE_INDEX_CONCURRENCY:-1}"
echo "  start ceiling: ${CODE_INDEX_JOBS_PER_MINUTE:-4}/min"

api_result="$(curl -fsS -o /dev/null -w 'status=%{http_code} latency=%{time_total}s' \
  http://127.0.0.1:3001/api/v1/health)"
echo "  api: ${api_result}"

redis_latency="$(
  { time docker exec qa-redis-prod redis-cli --no-auth-warning \
      -a "${REDIS_PASSWORD}" ping >/dev/null; } 2>&1 \
    | awk '/real/ { print $2; exit }'
)"
echo "  redis ping: ${redis_latency:-unavailable}"

echo "  recent test runs:"
docker exec qa-postgres-prod psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
  "SELECT status::text || '=' || count(*)
   FROM test_runs
   WHERE \"createdAt\" >= now() - interval '15 minutes'
   GROUP BY status
   ORDER BY status;" \
  | sed 's/^/    /'

echo "  branch indexes:"
docker exec qa-postgres-prod psql -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -tAc \
  "SELECT status::text || '=' || count(*)
   FROM repo_branch_indexes
   WHERE \"deletedAt\" IS NULL
   GROUP BY status
   ORDER BY status;" \
  | sed 's/^/    /'

if [[ "${CODE_INDEX_ENABLED:-false}" == "true" \
  && "${CODE_INDEXER_DEPLOYMENT:-local}" == "local" ]]; then
  indexer_id="$("${COMPOSE[@]}" --profile indexing ps -q indexer)"
  [[ -n "$indexer_id" ]] || {
    echo "Indexer container is not running" >&2
    exit 1
  }
  echo "  indexer resources:"
  docker stats --no-stream \
    --format '    memory={{.MemUsage}} cpu={{.CPUPerc}} pids={{.PIDs}}' \
    "$indexer_id"
  echo "  code-index queue:"
  "${COMPOSE[@]}" --profile indexing exec -T indexer node -e '
    const { Queue } = require("bullmq");
    const queue = new Queue("code-index", {
      connection: { url: process.env.REDIS_URL },
    });
    queue.getJobCounts("waiting", "active", "delayed", "failed", "completed")
      .then((counts) => console.log("    " + JSON.stringify(counts)))
      .finally(() => queue.close());
  '
elif [[ "${CODE_INDEX_ENABLED:-false}" == "true" ]]; then
  external_url="${CODE_INDEXER_EXTERNAL_HEALTH_URL:?external health URL required}"
  case "$external_url" in
    */ready) ;;
    *) external_url="${external_url%/}/ready" ;;
  esac
  external_result="$(curl -fsS -o /dev/null \
    -w 'status=%{http_code} latency=%{time_total}s' "$external_url")"
  echo "  external indexer: ${external_result}"
else
  echo "  indexer: disabled"
fi

echo "Rollout observation complete"
