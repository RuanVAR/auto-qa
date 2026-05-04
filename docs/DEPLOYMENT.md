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
- **RAM:** 2 GB (4 GB recommended — worker runs Chromium)
- **Disk:** 20 GB free (Docker images are large due to Playwright/Chromium in worker)
- **CPU:** 2 vCPU

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

# 4. Clone repo
git clone git@github.com:RuanV/autoqa-ai.git ~/qa_platform

# 5. Create .env.production (see Environment Variables section below)
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
  → git fetch origin main && git reset --hard origin/main
  → bash scripts/deploy-prod.sh
      1. Validate .env.production (no CHANGE_ME, JWT length)
      2. Pull postgres + redis base images
      3. Build api / worker / web Docker images
      4. Start postgres + redis, wait for healthy
      5. Run prisma migrate deploy (one-shot api container)
      6. Start api + worker + web
      7. Health-check all services (max 2 min)
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
- **API** (`apps/api/Dockerfile`): `node:20-alpine` + `openssl` (required for Prisma engine binaries on musl/Alpine). Runs from the build stage directly — full pnpm virtual store is retained so Prisma and all deps resolve correctly.
- **Worker** (`apps/worker/Dockerfile`): `node:20-bookworm-slim` (Debian — OpenSSL included). Includes Playwright Chromium install.
- **Web** (`apps/web/Dockerfile`): `node:20-alpine` build stage → `nginx:alpine` runner. Static bundle served by nginx with proxy rules for `/api/*` and `/socket.io/*`.

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

