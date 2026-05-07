#!/usr/bin/env bash
# Production deploy orchestrator.
#
# What it does (in order):
#   1. Validates .env.production exists + critical secrets are not placeholders
#   2. Detects which services changed since the last successful deploy
#   3. Pulls latest postgres/redis images
#   4. Builds ONLY changed services SEQUENTIALLY (parallel builds OOM on 2 GB RAM)
#   5. Brings up postgres + redis first (and waits for healthy)
#   6. Runs `prisma migrate deploy` against the prod DB (idempotent)
#   7. Brings up api, worker, web
#   8. Polls health endpoints until everything is green (or fails after 4 min)
#   9. Writes deploy marker so the next deploy can diff against this one
#
# Designed to be safe to re-run: every step is idempotent.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"
DEPLOY_SHA_FILE="$ROOT/.last_deploy_sha"
COMPOSE="docker compose -f $ROOT/docker/prod/docker-compose.yml --env-file $ENV_FILE"

# Enable BuildKit for efficient layer caching between builds.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# ─── 1. Pre-flight: env file must exist, secrets must be set ──────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found." >&2
  echo "  Copy .env.production.example to .env.production and fill in real values." >&2
  exit 1
fi

if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo "✗ $ENV_FILE still contains CHANGE_ME placeholders. Refusing to deploy." >&2
  grep -n "CHANGE_ME" "$ENV_FILE" >&2
  exit 1
fi

JWT=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
if [[ ${#JWT} -lt 32 ]]; then
  echo "✗ JWT_SECRET in $ENV_FILE is shorter than 32 chars. Refusing to deploy." >&2
  exit 1
fi

echo "✓ $ENV_FILE looks valid."

# ─── 2. Detect which services need rebuilding ─────────────────────────
BUILD_API=0
BUILD_WORKER=0
BUILD_WEB=0
CURRENT_SHA=$(git -C "$ROOT" rev-parse HEAD)

if [[ -f "$DEPLOY_SHA_FILE" ]]; then
  LAST_SHA=$(cat "$DEPLOY_SHA_FILE")
  if git -C "$ROOT" cat-file -t "$LAST_SHA" &>/dev/null; then
    CHANGED_FILES=$(git -C "$ROOT" diff --name-only "$LAST_SHA" "$CURRENT_SHA" 2>/dev/null || echo "DIFF_FAILED")
  else
    CHANGED_FILES="DIFF_FAILED"
  fi
else
  LAST_SHA="(none)"
  CHANGED_FILES="DIFF_FAILED"
fi

if [[ "$CHANGED_FILES" == "DIFF_FAILED" ]]; then
  echo ""
  echo "→ No previous deploy marker or diff failed — rebuilding ALL services."
  BUILD_API=1
  BUILD_WORKER=1
  BUILD_WEB=1
else
  # Paths that force a rebuild of everything (root config, Docker infra, deploy scripts)
  FORCE_ALL_PATTERN="^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|docker/|Dockerfile|scripts/deploy)"

  if echo "$CHANGED_FILES" | grep -qE "$FORCE_ALL_PATTERN"; then
    echo ""
    echo "→ Root config or infrastructure changed — rebuilding ALL services."
    BUILD_API=1
    BUILD_WORKER=1
    BUILD_WEB=1
  else
    echo ""
    echo "→ Changed files since last deploy ($LAST_SHA):"
    echo "$CHANGED_FILES" | sed 's/^/    /'

    if echo "$CHANGED_FILES" | grep -qE "^(apps/api/|packages/shared/)"; then
      BUILD_API=1
    fi
    if echo "$CHANGED_FILES" | grep -qE "^(apps/worker/|packages/shared/|apps/api/prisma/)"; then
      BUILD_WORKER=1
    fi
    if echo "$CHANGED_FILES" | grep -qE "^(apps/web/|packages/shared/)"; then
      BUILD_WEB=1
    fi
  fi

  if [[ $BUILD_API -eq 0 && $BUILD_WORKER -eq 0 && $BUILD_WEB -eq 0 ]]; then
    echo ""
    echo "→ No service files changed (only docs/config/scripts). Skipping all builds."
    echo "$CURRENT_SHA" > "$DEPLOY_SHA_FILE"
    echo "✓ Deploy marker updated ($CURRENT_SHA)"
    echo ""
    echo "✓ Nothing to rebuild — deploy complete (no-op)."
    exit 0
  fi
fi

SKIP_LIST=""
BUILD_LIST=""
[[ $BUILD_API -eq 1 ]]    && BUILD_LIST="$BUILD_LIST api"    || SKIP_LIST="$SKIP_LIST api"
[[ $BUILD_WORKER -eq 1 ]] && BUILD_LIST="$BUILD_LIST worker" || SKIP_LIST="$SKIP_LIST worker"
[[ $BUILD_WEB -eq 1 ]]    && BUILD_LIST="$BUILD_LIST web"    || SKIP_LIST="$SKIP_LIST web"

echo ""
echo "  Services to rebuild:${BUILD_LIST}"
[[ -n "$SKIP_LIST" ]] && echo "  Skipping:${SKIP_LIST}"

# ─── 3. Pull base images ──────────────────────────────────────────────
echo ""
echo "→ Pulling postgres + redis…"
$COMPOSE pull postgres redis

# ─── 4. Build changed services (sequentially to avoid OOM) ────────────
if [[ $BUILD_API -eq 1 ]]; then
  echo ""
  echo "→ Building api…"
  $COMPOSE build api
else
  echo ""
  echo "→ Skipping api (no changes)"
fi

if [[ $BUILD_WORKER -eq 1 ]]; then
  echo ""
  echo "→ Building worker…"
  $COMPOSE build worker
else
  echo ""
  echo "→ Skipping worker (no changes)"
fi

if [[ $BUILD_WEB -eq 1 ]]; then
  echo ""
  echo "→ Building web…"
  $COMPOSE build web
else
  echo ""
  echo "→ Skipping web (no changes)"
fi

# ─── 5. Bring up infra, wait for healthy ──────────────────────────────
echo ""
echo "→ Starting postgres + redis…"
$COMPOSE up -d postgres redis

echo "→ Waiting for postgres to be ready…"
until docker exec qa-postgres-prod pg_isready -U "$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)" > /dev/null 2>&1; do
  sleep 2
done
echo "  ✓ postgres healthy"

# ─── 6. Run DB migrations against the live DB ─────────────────────────
echo ""
echo "→ Applying Prisma migrations…"
$COMPOSE run --rm --no-deps api sh -c "pnpm exec prisma migrate deploy"

# ─── 7. Start app services ────────────────────────────────────────────
echo ""
echo "→ Starting api / worker / web…"
$COMPOSE up -d api worker web

# ─── 8. Health-check until green ──────────────────────────────────────
echo ""
echo "→ Waiting for services to report healthy (max 4 min)…"
DEADLINE=$(($(date +%s) + 240))
while true; do
  WEB_PORT=$(grep -E '^WEB_HOST_PORT=' "$ENV_FILE" | cut -d= -f2- || echo 80)
  WEB_PORT=${WEB_PORT:-80}
  API=$(curl -fsS -o /dev/null -w '%{http_code}' http://localhost:3001/api/v1/health 2>/dev/null || echo 000)
  WORKER=$(curl -fsS -o /dev/null -w '%{http_code}' http://localhost:3003/health 2>/dev/null || echo 000)
  WEB=$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/" 2>/dev/null || echo 000)

  if [[ "$API" == "200" && "$WORKER" == "200" && "$WEB" == "200" ]]; then
    echo "  ✓ api:$API  worker:$WORKER  web:$WEB"
    break
  fi

  if [[ $(date +%s) -gt $DEADLINE ]]; then
    echo "✗ Timed out waiting for health (api:$API worker:$WORKER web:$WEB)" >&2
    echo ""
    echo "Recent logs:" >&2
    $COMPOSE logs --tail 30 api worker web
    exit 1
  fi

  printf "  api:%s  worker:%s  web:%s\r" "$API" "$WORKER" "$WEB"
  sleep 3
done

# ─── 9. Write deploy marker ──────────────────────────────────────────
echo "$CURRENT_SHA" > "$DEPLOY_SHA_FILE"
echo ""
echo "✓ Deploy marker written ($CURRENT_SHA)"

echo ""
echo "✓ Production deploy complete."
echo ""
echo "  Web:     http://localhost:${WEB_PORT}"
echo "  API:     http://localhost:3001/api/v1"
echo "  WS:      ws://localhost:3002"
echo "  Worker:  http://localhost:3003/health"
echo ""
echo "Logs:    pnpm run prod:logs"
echo "Status:  pnpm run prod:status"
echo "Down:    pnpm run prod:down"
