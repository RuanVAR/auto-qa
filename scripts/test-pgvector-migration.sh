#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POSTGRES_IMAGE="pgvector/pgvector:0.8.1-pg16@sha256:33198da2828a14c30348d2ccb4750833d5ed9a44c88d840a0e523d7417120337"
LEGACY_IMAGE="postgres:16-alpine"
SUFFIX="$$-${RANDOM}"
VOLUME="qa-pgvector-test-${SUFFIX}"
LEGACY_CONTAINER="qa-postgres-legacy-${SUFFIX}"
VECTOR_CONTAINER="qa-postgres-vector-${SUFFIX}"
PASSWORD="pgvector-test"
DUMP="$(mktemp -t qa-pgvector-restore.XXXXXX.dump)"

cleanup() {
  docker rm -f "${LEGACY_CONTAINER}" "${VECTOR_CONTAINER}" >/dev/null 2>&1 || true
  docker volume rm -f "${VOLUME}" >/dev/null 2>&1 || true
  rm -f "${DUMP}"
}
trap cleanup EXIT

wait_for_postgres() {
  local container="$1"
  for _ in $(seq 1 60); do
    if docker exec "${container}" pg_isready -U qa_user -d qa_platform >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "PostgreSQL did not become ready in ${container}" >&2
  return 1
}

docker volume create "${VOLUME}" >/dev/null

# Prove a PostgreSQL 16 data directory remains readable after switching images.
docker run -d --name "${LEGACY_CONTAINER}" \
  -e POSTGRES_USER=qa_user \
  -e POSTGRES_PASSWORD="${PASSWORD}" \
  -e POSTGRES_DB=qa_platform \
  -v "${VOLUME}:/var/lib/postgresql/data" \
  "${LEGACY_IMAGE}" >/dev/null
wait_for_postgres "${LEGACY_CONTAINER}"
docker exec "${LEGACY_CONTAINER}" psql -U qa_user -d qa_platform -v ON_ERROR_STOP=1 \
  -c "CREATE TABLE upgrade_probe (value TEXT NOT NULL);" \
  -c "INSERT INTO upgrade_probe VALUES ('preserved');" >/dev/null
docker exec "${LEGACY_CONTAINER}" pg_dump -U qa_user -d qa_platform -Fc \
  -f /tmp/upgrade.dump
docker cp "${LEGACY_CONTAINER}:/tmp/upgrade.dump" "${DUMP}" >/dev/null
docker rm -f "${LEGACY_CONTAINER}" >/dev/null

docker run -d --name "${VECTOR_CONTAINER}" \
  -e POSTGRES_USER=qa_user \
  -e POSTGRES_PASSWORD="${PASSWORD}" \
  -e POSTGRES_DB=qa_platform \
  -p 127.0.0.1::5432 \
  -v "${VOLUME}:/var/lib/postgresql/data" \
  "${POSTGRES_IMAGE}" >/dev/null
wait_for_postgres "${VECTOR_CONTAINER}"

PRESERVED="$(docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d qa_platform -tAc \
  "SELECT value FROM upgrade_probe;")"
test "${PRESERVED}" = "preserved"

docker exec "${VECTOR_CONTAINER}" createdb -U qa_user restore_test
docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d restore_test -v ON_ERROR_STOP=1 \
  -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null
docker cp "${DUMP}" "${VECTOR_CONTAINER}:/tmp/upgrade.dump" >/dev/null
docker exec "${VECTOR_CONTAINER}" pg_restore -U qa_user -d restore_test \
  --no-owner --no-acl /tmp/upgrade.dump
RESTORED="$(docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d restore_test -tAc \
  "SELECT value FROM upgrade_probe;")"
test "${RESTORED}" = "preserved"

docker exec "${VECTOR_CONTAINER}" createdb -U qa_user migration_test
PORT_LINE="$(docker port "${VECTOR_CONTAINER}" 5432/tcp)"
HOST_PORT="${PORT_LINE##*:}"
export DATABASE_URL="postgresql://qa_user:${PASSWORD}@127.0.0.1:${HOST_PORT}/migration_test"
SHADOW_DATABASE_URL="postgresql://qa_user:${PASSWORD}@127.0.0.1:${HOST_PORT}/schema_diff"

cd "${ROOT}"
pnpm --filter api exec prisma migrate deploy
docker exec "${VECTOR_CONTAINER}" createdb -U qa_user schema_diff

set +e
SCHEMA_DIFF="$(
  cd "${ROOT}/apps/api"
  pnpm exec prisma migrate diff \
    --from-migrations prisma/migrations \
    --to-schema-datamodel prisma/schema.prisma \
    --shadow-database-url "${SHADOW_DATABASE_URL}" \
    --exit-code 2>&1
)"
DIFF_STATUS=$?
set -e
if [ "${DIFF_STATUS}" -eq 1 ]; then
  printf '%s\n' "${SCHEMA_DIFF}" >&2
  exit 1
fi
if [ "${DIFF_STATUS}" -eq 2 ]; then
  UNEXPECTED_DIFF="$(printf '%s\n' "${SCHEMA_DIFF}" | grep -E '^(\\[-\\]|\\[\\+\\]|\\[\\*\\]|  \\[-\\]|  \\[\\+\\]|  - )' | grep -Ev \
    '^(\[-\] Removed enums|  - AuthoringMethod|\[\*\] Changed the `environments` table|  \[-\] Removed column `slowMoMs`|\[\*\] Changed the `test_definitions` table|  \[-\] Removed column `authoringMethod`|  \[-\] Removed column `recordedAt`|  \[-\] Removed column `recordedDurationSec`|\[\*\] Changed the `test_runs` table|  \[-\] Removed index on columns \\(excludedFromCanonical\\)|  \[-\] Removed index on columns \\(projectId, isPreview, createdAt\\))$' || true)"
  if [ -n "${UNEXPECTED_DIFF}" ]; then
    printf 'Unexpected Prisma migration drift:\n%s\n' "${SCHEMA_DIFF}" >&2
    exit 1
  fi
  echo "Prisma diff contains only the documented pre-existing recorder/index drift."
fi

VECTOR_VERSION="$(docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d migration_test -tAc \
  "SELECT extversion FROM pg_extension WHERE extname = 'vector';")"
test -n "${VECTOR_VERSION}"

DISTANCE="$(docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d migration_test -tAc \
  "SELECT '[1,2,3]'::vector <=> '[1,2,4]'::vector;")"
test -n "${DISTANCE}"

EMBEDDING_TYPE="$(docker exec "${VECTOR_CONTAINER}" psql -U qa_user -d migration_test -tAc \
  "SELECT format_type(a.atttypid, a.atttypmod)
   FROM pg_attribute a
   WHERE a.attrelid = 'code_chunks'::regclass
     AND a.attname = 'embedding'
     AND NOT a.attisdropped;")"
test "${EMBEDDING_TYPE}" = "vector"

printf 'pgvector migration smoke passed (vector %s, distance %s)\n' \
  "${VECTOR_VERSION}" "${DISTANCE}"
