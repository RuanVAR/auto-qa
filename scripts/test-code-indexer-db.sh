#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_IMAGE="pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337"
SUFFIX="$$-${RANDOM}"
CONTAINER="qa-indexer-db-test-${SUFFIX}"
REDIS_CONTAINER="qa-indexer-redis-test-${SUFFIX}"
PASSWORD="indexer-test"

cleanup() {
  docker rm -f "${CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "${CONTAINER}" \
  -e POSTGRES_USER=qa_user \
  -e POSTGRES_PASSWORD="${PASSWORD}" \
  -e POSTGRES_DB=qa_platform \
  -p 127.0.0.1::5432 \
  "${POSTGRES_IMAGE}" >/dev/null
docker run -d --name "${REDIS_CONTAINER}" \
  -p 127.0.0.1::6379 \
  redis:7-alpine >/dev/null

for _ in $(seq 1 60); do
  if docker exec "${CONTAINER}" pg_isready -U qa_user -d qa_platform >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec "${CONTAINER}" pg_isready -U qa_user -d qa_platform >/dev/null

PORT_LINE="$(docker port "${CONTAINER}" 5432/tcp)"
HOST_PORT="${PORT_LINE##*:}"
REDIS_PORT_LINE="$(docker port "${REDIS_CONTAINER}" 6379/tcp)"
REDIS_HOST_PORT="${REDIS_PORT_LINE##*:}"
export DATABASE_URL="postgresql://qa_user:${PASSWORD}@127.0.0.1:${HOST_PORT}/qa_platform"
export REDIS_URL="redis://127.0.0.1:${REDIS_HOST_PORT}"
export SECRETS_KEK="0000000000000000000000000000000000000000000000000000000000000011"
export SECRETS_KEK_KEY_ID="indexer-test-v1"
export CODE_INDEX_DB_TEST=1
export CODE_INDEX_QUEUE_TEST=1

cd "${ROOT}"
pnpm --filter api exec prisma migrate deploy
pnpm --filter api exec prisma generate
pnpm --filter indexer exec jest \
  --runInBand \
  --runTestsByPath \
  src/persistence/index-store.integration.spec.ts \
  src/queue/code-index.worker.integration.spec.ts
pnpm --filter api exec jest \
  --runInBand \
  --runTestsByPath \
  src/modules/codebase-indexing/code-index-refresh.integration.spec.ts \
  src/modules/codebase-indexing/codebase-retrieval.integration.spec.ts \
  src/modules/notifications/code-index-notifications.integration.spec.ts
