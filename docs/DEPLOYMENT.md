# Production Deployment Guide

## Overview

The platform runs on a single AWS Lightsail Ubuntu 24.04 server (`52.208.145.187`, region `eu-west-1`).
Auto-deploy triggers on every push to `main` via GitHub Actions over SSH.

---

## Server Requirements

| Requirement | Version | Notes |
|---|---|---|
| OS | Ubuntu 24.04 LTS | AWS Lightsail |
| Docker | 29+ | + Compose plugin (`docker compose`) |
| Node.js | 20 LTS | Via NodeSource |
| pnpm | 10+ | Installed globally via npm |
| Git | 2.43+ | Pre-installed on Ubuntu |

### Minimum Server Specs
- **RAM:** 2 GB minimum with 4 GB swap (4 GB RAM recommended — worker runs Chromium)
- **Disk:** 20 GB free (Docker images are large due to Playwright/Chromium in worker)
- **CPU:** 2 vCPU
- **Swap:** 4 GB required on 2 GB RAM instances (builds OOM without it)

---

## First-Time Server Setup

If you ever need to provision a new server from scratch, run these commands in order:

```bash
# 1. System packages + Docker
sudo apt-get update -y
sudo apt-get install -y git curl apt-transport-https ca-certificates gnupg lsb-release

sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker ubuntu
sudo systemctl enable docker && sudo systemctl start docker

# 2. Node.js 20 + pnpm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
sudo npm install -g pnpm

# 3. SSH deploy key (for GitHub to pull the repo)
ssh-keygen -t ed25519 -C 'github-actions-deploy' -f ~/.ssh/deploy_key -N ''
cat ~/.ssh/deploy_key.pub   # → add this to GitHub repo Deploy Keys
cat ~/.ssh/deploy_key       # → add this as GitHub Actions secret SSH_PRIVATE_KEY
cat ~/.ssh/deploy_key.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

# Configure server to use deploy_key when pulling from GitHub
cat > ~/.ssh/config << 'EOF'
Host github.com
  HostName github.com
  User git
  IdentityFile ~/.ssh/deploy_key
  StrictHostKeyChecking no
EOF
chmod 600 ~/.ssh/config
ssh-keyscan github.com >> ~/.ssh/known_hosts

# 4. Swap (critical for 2 GB instances — Docker builds OOM without it)
sudo fallocate -l 4G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab

# 5. Clone repo
git clone git@github.com:RuanV/autoqa-ai.git ~/qa_platform

# 6. Create .env.production (see Environment Variables section below)
cp ~/qa_platform/.env.production.example ~/qa_platform/.env.production
nano ~/qa_platform/.env.production   # fill in real values
```

---

## Environment Variables

The entire stack reads from a single file: `~/qa_platform/.env.production`

Copy `.env.production.example` and fill in:

| Variable | Required | Description |
|---|---|---|
| `POSTGRES_PASSWORD` | Yes | Strong random password |
| `REDIS_PASSWORD` | Yes | Strong random password |
| `JWT_SECRET` | Yes | ≥32 random chars |
| `JWT_REFRESH_SECRET` | Yes | ≥32 random chars, different from above |
| `ANTHROPIC_API_KEY` | For AI features | `sk-ant-...` |
| `OPENAI_API_KEY` | For embeddings | `sk-...` |
| `WEB_URL` | Yes | `http://52.208.145.187` or your domain |
| `API_URL` | Yes | `http://52.208.145.187:3001` or your domain |

> The deploy script validates that no `CHANGE_ME` placeholders remain and that `JWT_SECRET` is ≥32 chars before proceeding.

Generate secure random values:
```bash
openssl rand -base64 48 | tr -d '/+=' | head -c 48
```

---

## Auto-Deploy (GitHub Actions)

**Trigger:** Every push to `main`  
**Workflow:** `.github/workflows/deploy.yml`

### Flow
```
Push to main
  → GitHub Actions runner (ubuntu-latest)
  → SSH into 52.208.145.187 as ubuntu
  → Ensure swap is active (creates 4 GB if missing)
  → git fetch origin main && git reset --hard origin/main
  → Install daily Docker cleanup cron (idempotent, runs 3 AM UTC)
  → Run pre-deploy cleanup (scripts/docker-cleanup.sh)
  → bash scripts/deploy-prod.sh
      1. Validate .env.production (no CHANGE_ME, JWT length)
      2. Detect changed services via git diff (see Selective Rebuild below)
      3. Pull postgres + redis base images
      4. Build ONLY changed services SEQUENTIALLY (parallel OOMs on 2 GB)
      5. Start postgres + redis, wait for healthy
      6. Run prisma migrate deploy (one-shot api container)
      7. Start api + worker + web
      8. Health-check all services (max 4 min)
      9. Write .last_deploy_sha marker
  → Run prisma db seed (idempotent)
  → docker image prune -f
```

### Required GitHub Secrets
Go to `https://github.com/RuanV/autoqa-ai/settings/secrets/actions`:

| Secret | Value |
|---|---|
| `SERVER_HOST` | `52.208.145.187` |
| `SSH_PRIVATE_KEY` | Contents of `~/.ssh/deploy_key` on the server |

### Required GitHub Deploy Key
Go to `https://github.com/RuanV/autoqa-ai/settings/keys`:
- Add the public key from `~/.ssh/deploy_key.pub` on the server
- Allow write access: No (read-only is enough to clone/pull)

### Selective Rebuild

The deploy script only rebuilds services whose source code actually changed, saving significant time (especially skipping the ~8 min worker/Chromium build).

**How it works:**
- After each successful deploy, the current git SHA is written to `.last_deploy_sha` on the server
- On the next deploy, `git diff --name-only <last_sha> HEAD` determines which files changed
- Changed paths are mapped to services:

| Path prefix | Triggers rebuild of |
|---|---|
| `apps/api/` | api |
| `apps/worker/` | worker |
| `apps/web/` | web |
| `packages/shared/` | api + worker + web |
| `apps/api/prisma/` | api + worker (both use Prisma) |
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` | ALL (dependency change) |
| `docker/`, `Dockerfile`, `scripts/deploy*` | ALL (infrastructure change) |

**Safety fallbacks** (always rebuild all):
- First deploy (no `.last_deploy_sha` marker)
- Previous deploy failed (marker only written on success)
- `git diff` fails for any reason
- No service-specific files matched (e.g. only docs changed)

---

## Docker Architecture

All services run via `docker/prod/docker-compose.yml`:

| Container | Image | Port | Notes |
|---|---|---|---|
| `qa-postgres-prod` | postgres:16-alpine | 5432 (internal) | Persistent volume |
| `qa-redis-prod` | redis:7-alpine | 6379 (internal) | Persistent volume, password-protected |
| `qa-api-prod` | qa-platform/api:latest | 3001, 3002 | REST API + WebSocket |
| `qa-worker-prod` | qa-platform/worker:latest | 3003 | BullMQ worker + Playwright/Chromium |
| `qa-web-prod` | qa-platform/web:latest | 80→3000 | nginx serving React bundle |

### Dockerfile Strategy

**Critical:** API and Worker use **single-stage** Dockerfiles. Multi-stage builds break pnpm's symlinked virtual store — `COPY --from=build` flattens the symlinks, causing Prisma CLI and other bin stubs to go missing at runtime.

- **API** (`apps/api/Dockerfile`): `node:20-alpine` + `openssl` (required by Prisma schema engine on musl/Alpine). Single-stage build retaining full pnpm virtual store. Uses `pnpm exec prisma` for migrations.
- **Worker** (`apps/worker/Dockerfile`): `node:20-bookworm-slim` (Debian — OpenSSL included, needed for Playwright). Single-stage build. Includes Playwright Chromium install.
- **Web** (`apps/web/Dockerfile`): Multi-stage is fine here — `node:20-alpine` build stage → `nginx:alpine` runner. Only the static `dist/` bundle is copied; no runtime pnpm needed.

### Key Gotchas Discovered

| Issue | Root Cause | Fix |
|---|---|---|
| `prisma: not found` at runtime | Multi-stage `COPY --from` broke pnpm symlinks | Single-stage Dockerfile for api/worker |
| `Error: Could not parse schema engine response` | Missing OpenSSL on Alpine | `RUN apk add --no-cache openssl` in api Dockerfile |
| `npx prisma` downloads Prisma v7 (breaking) | npx fetches latest if local isn't found | Always use `pnpm exec prisma` instead of `npx` |
| OOM during Docker builds | Parallel builds on 2 GB RAM server | Sequential builds in deploy script + 4 GB swap |
| `OAuth2Strategy requires a clientID` | Empty string `""` bypasses `??` nullish check | Use `\|\|` instead of `??` for optional OAuth config |
| API marked unhealthy during startup | Default health check too aggressive | `start_period: 60s`, `retries: 10`, `interval: 10s` |
| Web blocked by unhealthy API | `depends_on: service_healthy` cascades failure | Changed to `service_started` for web |

---

## Automatic Docker Cleanup

A cron job runs daily at **3:00 AM UTC** to prevent Docker disk buildup. It is installed/updated automatically on every deploy.

**Script:** `scripts/docker-cleanup.sh`

**What it does:**
1. Removes stopped one-shot containers (migration/seed runners)
2. Removes dangling images (untagged intermediate layers)
3. Removes unused images older than 72 hours
4. Trims BuildKit cache to 3 GB (keeps recent layers for fast rebuilds)

**What it preserves:**
- Running containers and their images (the `:latest` tags in use)
- Named volumes (postgres_data, redis_data, artifacts_data)
- Build cache up to 3 GB (so the next deploy still gets layer cache hits)

**Logs:** `/var/log/docker-cleanup.log` on the server

```bash
# Check the cron is installed
crontab -l | grep docker-cleanup

# Check cleanup logs
tail -50 /var/log/docker-cleanup.log

# Run manually
bash ~/qa_platform/scripts/docker-cleanup.sh
```

The cleanup also runs as a pre-step in every deploy (before building new images) to ensure there's always enough disk space for the build.

---

## Useful Commands on the Server

```bash
# SSH in
ssh -i ~/.ssh/LightsailDefaultKey-eu-west-1.pem ubuntu@52.208.145.187
# or if ~/.ssh/config is set up:
ssh qaserver

# Check container status
docker compose -f ~/qa_platform/docker/prod/docker-compose.yml \
  --env-file ~/qa_platform/.env.production ps

# Tail live logs
docker compose -f ~/qa_platform/docker/prod/docker-compose.yml \
  --env-file ~/qa_platform/.env.production logs -f api worker web

# Manually re-run deploy
cd ~/qa_platform && bash scripts/deploy-prod.sh

# Run seed manually
docker compose -f ~/qa_platform/docker/prod/docker-compose.yml \
  --env-file ~/qa_platform/.env.production \
  run --rm --no-deps api sh -c "pnpm exec prisma db seed"

# Stop everything
docker compose -f ~/qa_platform/docker/prod/docker-compose.yml \
  --env-file ~/qa_platform/.env.production down

# Check health endpoints
curl http://localhost:3001/api/v1/health
curl http://localhost:3003/health
curl http://localhost:80/
```

---

## Default Seed Accounts

After first deploy, these accounts exist (password: `Demo123!`):

| Email | Role |
|---|---|
| `ruanv@openvantage.co.za` | Platform Admin |
| `ruan15viljoen@gmail.com` | Demo Org Admin (owns Demo Organisation) |

> Change passwords immediately in production via the app settings page.

---

## Troubleshooting

### Server OOM / Docker build killed
```bash
# Check memory + swap
free -h
swapon --show

# If no swap, create one
sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### Disk full / builds fail
```bash
df -h
docker system df
docker image prune -a -f        # remove ALL unused images
docker builder prune -f          # clear build cache
docker volume prune -f           # remove orphan volumes (careful — not data volumes)
```

### Container marked unhealthy but app is responding
```bash
docker inspect qa-api-prod --format='{{json .State.Health}}'
# If stuck from previous crash, restart the container:
docker restart qa-api-prod
```

### Prisma migration drift
If `prisma migrate deploy` fails with "table already exists" or "column not found":
```bash
# Check which migrations have been applied
docker compose -f docker/prod/docker-compose.yml --env-file .env.production \
  run --rm --no-deps api sh -c "pnpm exec prisma migrate status"
```
If the schema.prisma has models that no migration covers, create a manual migration SQL file in `apps/api/prisma/migrations/` with the correct DDL. Table names use `@@map("snake_case")` — check the schema for the actual DB table names.

