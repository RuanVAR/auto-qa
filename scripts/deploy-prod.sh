#!/usr/bin/env bash
# Production deploy orchestrator.
#Test 
# What it does (in order):
#   1. Validates .env.production exists + critical secrets are not placeholders
#   2. Pulls latest postgres/redis images
#   3. Builds api/worker/web images from source
#   4. Brings up postgres + redis first (and waits for healthy)
#   5. Runs `prisma migrate deploy` against the prod DB (idempotent)
#   6. Brings up api, worker, web
#   7. Polls health endpoints until everything is green (or fails after 2 min)
#
# Designed to be safe to re-run: every step is idempotent.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"
COMPOSE="docker compose -f $ROOT/docker/prod/docker-compose.yml --env-file $ENV_FILE"

# Enable BuildKit so multi-stage cache and --cache-from work correctly.
export DOCKER_BUILDKIT=1
export COMPOSE_DOCKER_CLI_BUILD=1

# ─── 1. Pre-flight: env file must exist, secrets must be set ──────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "✗ $ENV_FILE not found." >&2
  echo "  Copy .env.production.example to .env.production and fill in real values." >&2
  exit 1
fi

# Block deploys if the user left CHANGE_ME placeholders in the env file —
# every one of those would be a security incident waiting to happen.
if grep -q "CHANGE_ME" "$ENV_FILE"; then
  echo "✗ $ENV_FILE still contains CHANGE_ME placeholders. Refusing to deploy." >&2
  grep -n "CHANGE_ME" "$ENV_FILE" >&2
  exit 1
fi

# Sanity-check the JWT secret length — short secrets are guessable.
JWT=$(grep -E '^JWT_SECRET=' "$ENV_FILE" | cut -d= -f2- || true)
if [[ ${#JWT} -lt 32 ]]; then
  echo "✗ JWT_SECRET in $ENV_FILE is shorter than 32 chars. Refusing to deploy." >&2
  exit 1
fi

echo "✓ $ENV_FILE looks valid."

# ─── 2. Pull base images ──────────────────────────────────────────────
echo ""
echo "→ Pulling postgres + redis…"
$COMPOSE pull postgres redis

# ─── 3. Build app images (sequentially to avoid OOM on small instances) ──
# BUILDKIT_INLINE_CACHE=1 embeds layer-cache metadata inside each produced
# image. On the next deploy, docker compose reads cache_from: in the compose
# file and reuses unchanged layers, so only modified layers are rebuilt.
echo ""
echo "→ Building api…"
$COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 api
echo "→ Building worker…"
$COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 worker
echo "→ Building web…"
$COMPOSE build --build-arg BUILDKIT_INLINE_CACHE=1 web

# ─── 4. Bring up infra, wait for healthy ──────────────────────────────
echo ""
echo "→ Starting postgres + redis…"
$COMPOSE up -d postgres redis

echo "→ Waiting for postgres to be ready…"
until docker exec qa-postgres-prod pg_isready -U "$(grep -E '^POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2-)" > /dev/null 2>&1; do
  sleep 2
done
echo "  ✓ postgres healthy"

# ─── 5. Run DB migrations against the live DB ─────────────────────────
echo ""
echo "→ Applying Prisma migrations…"
# Run migrate deploy via a one-shot container that uses the api image we
# just built. `migrate deploy` is the prod-safe variant — applies pending
# migrations, never resets the DB, never prompts.
$COMPOSE run --rm --no-deps api sh -c "npx prisma migrate deploy"

# ─── 6. Start app services ────────────────────────────────────────────
echo ""
echo "→ Starting api / worker / web…"
$COMPOSE up -d api worker web

# ─── 7. Health-check until green ──────────────────────────────────────
echo ""
echo "→ Waiting for services to report healthy (max 2 min)…"
DEADLINE=$(($(date +%s) + 120))
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
