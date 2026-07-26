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
#   8. Starts the capacity-gated indexer only when explicitly enabled
#   9. Polls health endpoints until everything is green (or fails after 4 min)
#  10. Writes deploy marker so the next deploy can diff against this one
#
# Designed to be safe to re-run: every step is idempotent.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/.env.production"
DEPLOY_SHA_FILE="$ROOT/.last_deploy_sha"
COMPOSE="docker compose -f $ROOT/docker/prod/docker-compose.yml --env-file $ENV_FILE"
source "$ROOT/scripts/lib/code-index-rollout.sh"

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

CODE_INDEX_ENABLED_VALUE=$(grep -E '^CODE_INDEX_ENABLED=' "$ENV_FILE" | cut -d= -f2- || true)
CODE_INDEX_ENABLED_VALUE=${CODE_INDEX_ENABLED_VALUE:-false}
case "$CODE_INDEX_ENABLED_VALUE" in
  true|false) ;;
  *)
    echo "✗ CODE_INDEX_ENABLED must be true or false" >&2
    exit 1
    ;;
esac

CODE_INDEXER_DEPLOYMENT_VALUE=$(grep -E '^CODE_INDEXER_DEPLOYMENT=' "$ENV_FILE" | cut -d= -f2- || true)
CODE_INDEXER_DEPLOYMENT_VALUE=${CODE_INDEXER_DEPLOYMENT_VALUE:-local}
CODE_INDEX_CONCURRENCY_VALUE=$(grep -E '^CODE_INDEX_CONCURRENCY=' "$ENV_FILE" | cut -d= -f2- || true)
CODE_INDEX_CONCURRENCY_VALUE=${CODE_INDEX_CONCURRENCY_VALUE:-1}
CODE_INDEX_JOBS_PER_MINUTE_VALUE=$(grep -E '^CODE_INDEX_JOBS_PER_MINUTE=' "$ENV_FILE" | cut -d= -f2- || true)
CODE_INDEX_JOBS_PER_MINUTE_VALUE=${CODE_INDEX_JOBS_PER_MINUTE_VALUE:-4}
CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE=$(grep -E '^CODE_INDEXER_EXTERNAL_HEALTH_URL=' "$ENV_FILE" | cut -d= -f2- || true)
CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE=${CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE:-}
EXTERNAL_INDEXER_READY_URL=""

if [[ "$CODE_INDEX_ENABLED_VALUE" == "true" ]]; then
  TOTAL_MEMORY_MB="$(code_index_total_memory_mb || true)"
  validate_code_index_rollout \
    "$CODE_INDEXER_DEPLOYMENT_VALUE" \
    "$CODE_INDEX_CONCURRENCY_VALUE" \
    "$CODE_INDEX_JOBS_PER_MINUTE_VALUE" \
    "$TOTAL_MEMORY_MB" \
    "$CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE" || {
      echo "✗ Code index production rollout gate failed. Indexing remains disabled." >&2
      exit 1
    }
  if [[ "$CODE_INDEXER_DEPLOYMENT_VALUE" == "external" ]]; then
    case "$CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE" in
      */ready) EXTERNAL_INDEXER_READY_URL="$CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE" ;;
      *) EXTERNAL_INDEXER_READY_URL="${CODE_INDEXER_EXTERNAL_HEALTH_URL_VALUE%/}/ready" ;;
    esac
    if ! curl -fsS --max-time 10 "$EXTERNAL_INDEXER_READY_URL" >/dev/null; then
      echo "✗ External indexer readiness check failed: $EXTERNAL_INDEXER_READY_URL" >&2
      exit 1
    fi
  fi
  echo "✓ Code indexing rollout gate passed ($CODE_INDEXER_DEPLOYMENT_VALUE, concurrency 1)."
else
  echo "✓ Code indexing disabled; production deploy will not start an indexer."
fi

# Set this in production once the Phase 0 infrastructure exists. It turns a
# missing backup target or alert route into a deploy-time failure rather than a
# silent future incident. It stays opt-in for existing non-production hosts.
HARDENING_REQUIRED=$(grep -E '^PRODUCTION_HARDENING_REQUIRED=' "$ENV_FILE" | cut -d= -f2- || true)
if [[ "$HARDENING_REQUIRED" == "true" ]]; then
  for key in SENTRY_DSN ALERT_WEBHOOK; do
    value=$(grep -E "^${key}=" "$ENV_FILE" | cut -d= -f2- || true)
    if [[ -z "$value" ]]; then
      echo "✗ ${key} is required when PRODUCTION_HARDENING_REQUIRED=true" >&2
      exit 1
    fi
  done
  if ! grep -qE '^RECORD_VIDEO=false$' "$ENV_FILE"; then
    echo "✗ RECORD_VIDEO=false is required when PRODUCTION_HARDENING_REQUIRED=true" >&2
    exit 1
  fi
  BACKUP_PROVIDER_VALUE=$(grep -E '^BACKUP_PROVIDER=' "$ENV_FILE" | cut -d= -f2- || true)
  BACKUP_BUCKET_VALUE=$(grep -E '^BACKUP_BUCKET=' "$ENV_FILE" | cut -d= -f2- || true)
  BACKUP_AZURE_CONTAINER_VALUE=$(grep -E '^BACKUP_AZURE_CONTAINER=' "$ENV_FILE" | cut -d= -f2- || true)
  if [[ -z "$BACKUP_PROVIDER_VALUE" ]]; then
    if [[ -n "$BACKUP_BUCKET_VALUE" && -z "$BACKUP_AZURE_CONTAINER_VALUE" ]]; then BACKUP_PROVIDER_VALUE=s3
    elif [[ -z "$BACKUP_BUCKET_VALUE" && -n "$BACKUP_AZURE_CONTAINER_VALUE" ]]; then BACKUP_PROVIDER_VALUE=azure
    else
      echo "✗ Set BACKUP_PROVIDER=s3 or azure (or configure exactly one backup target)" >&2
      exit 1
    fi
  fi
  case "$BACKUP_PROVIDER_VALUE" in
    s3)
      [[ -n "$BACKUP_BUCKET_VALUE" ]] || { echo "✗ BACKUP_BUCKET is required for S3 backups" >&2; exit 1; }
      BACKUP_CLI=aws
      ;;
    azure)
      [[ -n "$BACKUP_AZURE_CONTAINER_VALUE" ]] || { echo "✗ BACKUP_AZURE_CONTAINER is required for Azure Blob backups" >&2; exit 1; }
      BACKUP_AZURE_CONNECTION=$(grep -E '^BACKUP_AZURE_CONNECTION_STRING=' "$ENV_FILE" | cut -d= -f2- || true)
      [[ -n "$BACKUP_AZURE_CONNECTION" ]] || BACKUP_AZURE_CONNECTION=$(grep -E '^AZURE_STORAGE_CONNECTION_STRING=' "$ENV_FILE" | cut -d= -f2- || true)
      BACKUP_AZURE_ACCOUNT=$(grep -E '^BACKUP_AZURE_ACCOUNT=' "$ENV_FILE" | cut -d= -f2- || true)
      [[ -n "$BACKUP_AZURE_ACCOUNT" ]] || BACKUP_AZURE_ACCOUNT=$(grep -E '^AZURE_STORAGE_ACCOUNT=' "$ENV_FILE" | cut -d= -f2- || true)
      [[ -n "$BACKUP_AZURE_CONNECTION" || -n "$BACKUP_AZURE_ACCOUNT" ]] || { echo "✗ Azure backups require BACKUP_AZURE_CONNECTION_STRING or BACKUP_AZURE_ACCOUNT" >&2; exit 1; }
      BACKUP_CLI=az
      ;;
    *) echo "✗ BACKUP_PROVIDER must be s3 or azure" >&2; exit 1 ;;
  esac
  for command in "$BACKUP_CLI" crontab curl docker; do
    command -v "$command" >/dev/null 2>&1 || {
      echo "✗ ${command} must be installed when PRODUCTION_HARDENING_REQUIRED=true" >&2
      exit 1
    }
  done
fi

echo "✓ $ENV_FILE looks valid."

# ─── 2. Detect which services need rebuilding ─────────────────────────
BUILD_API=0
BUILD_WORKER=0
BUILD_WEB=0
BUILD_INDEXER=0
CURRENT_SHA=$(git -C "$ROOT" rev-parse HEAD)
SHORT_SHA="${CURRENT_SHA:0:12}"
# API/worker report this release to Sentry; the web build receives it through
# the compose build argument. It is a revision identifier, never a credential.
export GIT_SHA="$CURRENT_SHA"

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
  BUILD_INDEXER=1
else
  # Paths that force a rebuild of everything (root config, Docker infra, deploy scripts)
  FORCE_ALL_PATTERN="^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|docker/|Dockerfile|scripts/deploy)"

  if echo "$CHANGED_FILES" | grep -qE "$FORCE_ALL_PATTERN"; then
    echo ""
    echo "→ Root config or infrastructure changed — rebuilding ALL services."
    BUILD_API=1
    BUILD_WORKER=1
    BUILD_WEB=1
    BUILD_INDEXER=1
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
    if echo "$CHANGED_FILES" | grep -qE "^(apps/indexer/|packages/shared/|apps/api/prisma/)"; then
      BUILD_INDEXER=1
    fi
  fi

  if [[ $BUILD_API -eq 0 && $BUILD_WORKER -eq 0 && $BUILD_WEB -eq 0 && $BUILD_INDEXER -eq 0 ]]; then
    echo ""
    echo "→ No service images need rebuilding; continuing runtime reconciliation."
    echo "  This applies .env.production changes such as enabling or disabling indexing."
  fi
fi

SKIP_LIST=""
BUILD_LIST=""
[[ $BUILD_API -eq 1 ]]    && BUILD_LIST="$BUILD_LIST api"    || SKIP_LIST="$SKIP_LIST api"
[[ $BUILD_WORKER -eq 1 ]] && BUILD_LIST="$BUILD_LIST worker" || SKIP_LIST="$SKIP_LIST worker"
[[ $BUILD_WEB -eq 1 ]]    && BUILD_LIST="$BUILD_LIST web"    || SKIP_LIST="$SKIP_LIST web"
[[ $BUILD_INDEXER -eq 1 ]] && BUILD_LIST="$BUILD_LIST indexer" || SKIP_LIST="$SKIP_LIST indexer"

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

if [[ $BUILD_INDEXER -eq 1 ]]; then
  echo ""
  echo "→ Building indexer…"
  $COMPOSE --profile indexing build indexer
else
  echo ""
  echo "→ Skipping indexer (no changes)"
fi

# Keep an immutable local tag alongside :latest for an actual rollback target.
# Tag all four services, including unchanged ones, so one SHA represents the
# complete release set rather than only the service rebuilt this time.
for service in api worker web indexer; do
  docker image inspect "qa-platform/${service}:latest" >/dev/null
  docker tag "qa-platform/${service}:latest" "qa-platform/${service}:${SHORT_SHA}"
done
echo "✓ Images tagged with release ${SHORT_SHA}"

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

# ─── 7. Start core app services without local index jobs ──────────────
echo ""
echo "→ Starting api / worker / web…"
$COMPOSE up -d api worker web

# ─── 8. Start or verify the capacity-gated indexer ────────────────────
if [[ "$CODE_INDEX_ENABLED_VALUE" == "true" && "$CODE_INDEXER_DEPLOYMENT_VALUE" == "local" ]]; then
  echo "→ Starting local indexer (concurrency 1)…"
  $COMPOSE --profile indexing up -d indexer
else
  # A previously enabled local indexer must not survive a disabled/external
  # rollout and continue draining jobs unexpectedly.
  $COMPOSE --profile indexing rm -sf indexer >/dev/null 2>&1 || true
fi

# ─── 9. Health-check until green ──────────────────────────────────────
echo ""
echo "→ Waiting for services to report healthy (max 4 min)…"
DEADLINE=$(($(date +%s) + 240))
while true; do
  # WEB_HOST_PORT can be either a bare port ("80") or an IP:PORT binding
  # ("127.0.0.1:3000") when the web container sits behind a reverse proxy
  # like Caddy. Strip the IP prefix so curl gets a well-formed URL either
  # way — otherwise the port-only path produces e.g. localhost:127.0.0.1:3000.
  WEB_HOST_PORT_RAW=$(grep -E '^WEB_HOST_PORT=' "$ENV_FILE" | cut -d= -f2- || echo 80)
  WEB_HOST_PORT_RAW=${WEB_HOST_PORT_RAW:-80}
  WEB_PORT=${WEB_HOST_PORT_RAW##*:}   # "127.0.0.1:3000" → "3000"; "80" → "80"
  API=$(curl -fsS -o /dev/null -w '%{http_code}' http://localhost:3001/api/v1/health 2>/dev/null || echo 000)
  # Workers are deliberately not published on the host network. Read the
  # Docker health state instead, and require every scaled worker to be healthy.
  # This avoids exposing the worker control endpoint just for deployment checks.
  WORKER=200
  WORKER_IDS="$($COMPOSE ps -q worker)"
  if [[ -z "$WORKER_IDS" ]]; then
    WORKER=000
  else
    for worker_id in $WORKER_IDS; do
      worker_health="$(docker inspect --format '{{.State.Health.Status}}' "$worker_id" 2>/dev/null || echo unknown)"
      if [[ "$worker_health" != "healthy" ]]; then
        WORKER=000
        break
      fi
    done
  fi
  WEB=$(curl -fsS -o /dev/null -w '%{http_code}' "http://localhost:${WEB_PORT}/" 2>/dev/null || echo 000)
  INDEXER=200
  if [[ "$CODE_INDEX_ENABLED_VALUE" == "true" ]]; then
    if [[ "$CODE_INDEXER_DEPLOYMENT_VALUE" == "local" ]]; then
      INDEXER_ID="$($COMPOSE --profile indexing ps -q indexer)"
      if [[ -z "$INDEXER_ID" ]]; then
        INDEXER=000
      else
        INDEXER_HEALTH="$(docker inspect --format '{{.State.Health.Status}}' "$INDEXER_ID" 2>/dev/null || echo unknown)"
        [[ "$INDEXER_HEALTH" == "healthy" ]] || INDEXER=000
      fi
    else
      INDEXER=$(curl -fsS -o /dev/null -w '%{http_code}' --max-time 10 "$EXTERNAL_INDEXER_READY_URL" 2>/dev/null || echo 000)
    fi
  fi

  if [[ "$API" == "200" && "$WORKER" == "200" && "$WEB" == "200" && "$INDEXER" == "200" ]]; then
    echo "  ✓ api:$API  worker:$WORKER  web:$WEB  indexer:$INDEXER"
    break
  fi

  if [[ $(date +%s) -gt $DEADLINE ]]; then
    echo "✗ Timed out waiting for health (api:$API worker:$WORKER web:$WEB indexer:$INDEXER)" >&2
    echo ""
    echo "Recent logs:" >&2
    $COMPOSE logs --tail 30 api worker web
    if [[ "$CODE_INDEX_ENABLED_VALUE" == "true" && "$CODE_INDEXER_DEPLOYMENT_VALUE" == "local" ]]; then
      $COMPOSE --profile indexing logs --tail 30 indexer
    fi
    exit 1
  fi

  printf "  api:%s  worker:%s  web:%s  indexer:%s\r" "$API" "$WORKER" "$WEB" "$INDEXER"
  sleep 3
done

# Install host-level Phase 0 jobs under the deploy user. Keeping logs inside
# the checkout avoids requiring root access to /var/log on a fresh host.
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"
if ! command -v crontab >/dev/null 2>&1; then
  echo "✗ crontab is required for database backup and disk monitoring" >&2
  exit 1
fi
{
  crontab -l 2>/dev/null | grep -vE 'qa_platform/scripts/(backup-db|check-backup-freshness|disk-alert|docker-cleanup)\.sh' || true
  echo "0 2 * * * $ROOT/scripts/backup-db.sh >> $LOG_DIR/backup.log 2>&1"
  echo "15 * * * * $ROOT/scripts/check-backup-freshness.sh >> $LOG_DIR/backup-health.log 2>&1"
  echo "*/15 * * * * $ROOT/scripts/disk-alert.sh >> $LOG_DIR/disk.log 2>&1"
  echo "0 3 * * * $ROOT/scripts/docker-cleanup.sh >> $LOG_DIR/docker-cleanup.log 2>&1"
} | crontab -
echo "✓ Backup, backup-freshness, disk and Docker cleanup crons installed"

# ─── 10. Write deploy marker ─────────────────────────────────────────
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
if [[ "$CODE_INDEX_ENABLED_VALUE" == "true" ]]; then
  echo "  Indexer: $CODE_INDEXER_DEPLOYMENT_VALUE (concurrency 1, ${CODE_INDEX_JOBS_PER_MINUTE_VALUE}/min)"
else
  echo "  Indexer: disabled"
fi
echo ""
echo "Logs:    pnpm run prod:logs"
echo "Status:  pnpm run prod:status"
echo "Down:    pnpm run prod:down"
