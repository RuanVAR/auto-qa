# QA Automation Platform — Setup

## Quick Start (Docker)
```bash
cp .env.example .env
# Add ANTHROPIC_API_KEY or OPENAI_API_KEY to .env
docker compose up -d
docker compose exec api pnpm prisma:deploy
open http://localhost:3000
```

## Local Dev
```bash
pnpm install
docker compose up postgres redis -d
cp .env.example .env
pnpm db:migrate
pnpm dev
```

## Services
| Service | URL |
|---|---|
| Web UI | http://localhost:3000 |
| API | http://localhost:3001 |
| Swagger | http://localhost:3001/docs |
