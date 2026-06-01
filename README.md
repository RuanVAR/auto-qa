# QA Automation Platform

Self-hosted, AI-powered QA automation platform. Authors test cases (manually
or via AI), runs them headlessly with Playwright, surfaces a live screencast
during execution, and tracks results across environments with phase-gated
sign-off and PDF reporting. Multi-tenant with org → project → module →
feature hierarchy and env-scoped RBAC, with tag-based filtering across
modules, features, and tests.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict) end-to-end |
| Backend framework | NestJS |
| ORM | Prisma |
| Database | PostgreSQL (with `pgvector` for embeddings) |
| Vector search | pgvector (default); Qdrant via `VECTOR_BACKEND=qdrant` |
| Job queue | BullMQ + Redis |
| Browser automation | Playwright (Chromium) |
| Real-time | Socket.io |
| AI abstraction | LangChain (provider-agnostic) |
| AI provider | Anthropic Claude (default); OpenAI / Azure / Ollama supported |
| Embeddings | OpenAI `text-embedding-3-small` (default); Ollama for local |
| Auth | JWT (access + refresh) + Passport.js; SSO via Google / Azure AD |
| Frontend | React 18 + Vite + Tailwind CSS + shadcn/ui |
| HTTP client | Axios |
| State | Zustand |
| Routing | React Router v6 |
| Charts | Recharts |
| PDF generation | Puppeteer |
| Screen recording | RecordRTC |
| Containerisation | Docker + Docker Compose |
| Package manager | pnpm (workspaces) |
| Node runtime | Node 20 |

---

## Repository layout

```
.
├── apps/
│   ├── api/        — NestJS REST API + WebSocket gateways
│   ├── worker/     — BullMQ worker + Playwright browser pool
│   └── web/        — React frontend (Vite)
├── packages/
│   └── shared/     — Shared types, constants, utilities
├── docker/
│   ├── dev/        — Hot-reload dev compose (bind mounts + watch mode)
│   └── prod/       — Production compose (multi-stage builds, single env_file)
├── scripts/
│   └── deploy-prod.sh — Production deploy orchestrator
├── docs/           — Architecture, specs, integrations (~30 files)
├── tests/          — Cross-app E2E (Playwright)
├── .env.production.example  — Template for prod secrets
├── docker-compose.yml       — Legacy; superseded by docker/{dev,prod}
└── pnpm-workspace.yaml
```

---

## Services

Five containers, all networked together by docker compose:

| Service | Image | Ports (host:container) | Role |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | 5432:5432 (dev only) | Primary database |
| `redis` | `redis:7-alpine` | 6379:6379 (dev only) | BullMQ queue + cache |
| `api` | built from `apps/api/Dockerfile` | 3001 (REST), 3002 (WS) | NestJS API + Socket.io gateways |
| `worker` | built from `apps/worker/Dockerfile` | 3003 (health) | Test execution (Playwright) |
| `web` | built from `apps/web/Dockerfile` | dev: 3000, prod: 80 (configurable via `WEB_HOST_PORT`) | React frontend (nginx in prod, vite in dev) |

Internal communication uses docker DNS — `api` resolves to the api container,
`postgres` to the DB, etc. Only the listed host ports are published; postgres
and redis are reachable only from inside the docker network in prod.

---

## Prerequisites

- **Docker** + **Docker Compose** (Docker Desktop on Mac/Windows works)
- **Node 20+** and **pnpm 10+** — only needed for non-container tooling
  (linting, ad-hoc scripts). The dev stack runs entirely in containers.

Install pnpm globally if you don't have it:
```bash
npm install -g pnpm@10
```

---

## Quick start (development)

Everything runs in containers with hot-reload. Source code is bind-mounted,
so edits in your editor trigger automatic reload (vite HMR for web, `nest
start --watch` for api, `ts-node-dev` for worker).

```bash
# 1. Clone
git clone <repo-url> qa-platform
cd qa-platform

# 2. Start the dev stack (builds first time, ~5 min)
pnpm run dev
```

That's it. Once the build completes you'll see streamed logs from api +
worker + web. Open <http://localhost:3000> in your browser.

### Other dev commands

| Command | Purpose |
|---|---|
| `pnpm run dev:up` | Start in background (no log streaming) |
| `pnpm run dev:logs` | Tail api/worker/web logs |
| `pnpm run dev:status` | `docker compose ps` |
| `pnpm run dev:down` | Stop everything |
| `pnpm run dev:restart` | Restart api/worker/web (keeps data) |
| `pnpm run dev:rebuild` | Force-rebuild images (after Dockerfile change) |
| `pnpm run dev:host` | Run apps natively (no Docker) — postgres + redis still in containers |

### Database tasks

```bash
pnpm run db:migrate    # Apply pending Prisma migrations
pnpm run db:generate   # Regenerate Prisma client
pnpm run db:studio     # Open Prisma Studio (GUI for the DB)
```

---

## Production deploy

Single command, single env file. Runs the same five containers but with
production builds (no bind mounts, no watch mode, nginx-served frontend,
`always` restart policy, health checks gating start order).

```bash
# 1. Copy + edit the env template (one-time)
cp .env.production.example .env.production
$EDITOR .env.production    # fill in real secrets, replace every CHANGE_ME

# 2. Deploy
pnpm run deploy:prod
```

The `deploy:prod` script ([scripts/deploy-prod.sh](scripts/deploy-prod.sh))
runs in order:

1. **Pre-flight** — refuses if `.env.production` is missing, has `CHANGE_ME`
   placeholders, or `JWT_SECRET` is shorter than 32 chars
2. Pulls postgres + redis images
3. Builds api / worker / web images
4. Starts postgres + redis, waits for healthy
5. Runs `prisma migrate deploy` (idempotent; never resets)
6. Starts api / worker / web
7. Polls health endpoints until all return 200 (or fails after 2 min and
   dumps logs)

### Other prod commands

| Command | Purpose |
|---|---|
| `pnpm run prod:up` | Start without orchestration |
| `pnpm run prod:down` | Stop all containers |
| `pnpm run prod:logs` | Tail api/worker/web logs |
| `pnpm run prod:status` | `docker compose ps` |
| `pnpm run prod:rebuild` | Rebuild + recreate (after code change) |
| `pnpm run prod:migrate` | Run pending migrations standalone |

### Single env file

Every container reads from the same `.env.production` at the project root,
declared via `env_file:` in [docker/prod/docker-compose.yml](docker/prod/docker-compose.yml).
One change → applied everywhere. The template
[.env.production.example](.env.production.example) documents every variable.

### Web port

The web container listens on **port 80** by default (standard HTTP). If
you're running behind a reverse proxy that owns 80/443, or on a host
where Docker can't bind privileged ports, set `WEB_HOST_PORT` in
`.env.production` (e.g. `WEB_HOST_PORT=8080`) — the deploy script picks
it up automatically and the health check uses the same port.

---

## Architecture overview

```
┌──────────┐    HTTP      ┌──────────┐
│   web    │─────────────▶│   api    │──┐
│  (vite/  │              │ (NestJS) │  │ Prisma
│  nginx)  │◀─────────────│          │  ▼
└──────────┘   Socket.io  │  ┌────┐  │ ┌──────────┐
     ▲                    │  │ WS │  │ │ postgres │
     │                    │  └────┘  │ │  + pgvec │
     │                    └────┬─────┘ └──────────┘
     │                         │ BullMQ
     │                         ▼
     │                   ┌──────────┐    Playwright
     │                   │  redis   │◀───┌──────────┐
     │                   └──────────┘    │  worker  │
     │                                   │ (Chrome) │
     └───────── Socket.io ──────────────▶│          │
                  (screencast)           └──────────┘
```

- **API** owns all DB writes via Prisma, exposes REST under `/api/v1/`,
  hosts two Socket.io gateways on port 3002 (`/` for run-status events,
  `/screencast` for live browser frames).
- **Worker** dequeues jobs from BullMQ, drives Playwright Chromium, streams
  CDP screencast frames back into Redis pub/sub which the API forwards to
  connected browsers.
- **Web** is a SPA — no SSR. Talks to api over `/api/v1/`, subscribes to
  WebSocket for live updates.

Full architecture spec: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Testing

```bash
pnpm run test:api        # Jest — API unit + integration
pnpm run test:worker     # Jest — worker unit
pnpm run test:web        # Vitest — frontend
pnpm run test:all        # All three
pnpm run test:smoke      # Playwright cross-app E2E
pnpm run ci:check        # build all + run all tests (CI gate)
```

---

## Documentation

| File | Topic |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Full system architecture, all 25 data models, service map |
| [docs/RUN_EXECUTION_SPEC.md](docs/RUN_EXECUTION_SPEC.md) | Run trigger → BullMQ → worker → Playwright → DB flow |
| [docs/STEP_DEFINITION_SPEC.md](docs/STEP_DEFINITION_SPEC.md) | Canonical step JSON, all 22 step types |
| [docs/MANUAL_TESTING.md](docs/MANUAL_TESTING.md) | Manual test runner, evidence capture, sessions |
| [docs/LIVE_TEST_VIEWER.md](docs/LIVE_TEST_VIEWER.md) | CDP screencast pipeline, manual iframe mode |
| [docs/AI_LAYER.md](docs/AI_LAYER.md) | LangChain setup, embeddings, vector backends |
| [docs/MULTI_TENANCY_AND_RBAC.md](docs/MULTI_TENANCY_AND_RBAC.md) | Org model, RBAC tiers, env-scoped access |
| [docs/PLUGIN_REGISTRY.md](docs/PLUGIN_REGISTRY.md) | Unified plugin architecture (Slack/Jira/ClickUp/etc.) |
| [docs/UI_LAYOUT.md](docs/UI_LAYOUT.md) | Navigation shell, dashboard, top nav |
| [docs/WORKER_ARCHITECTURE.md](docs/WORKER_ARCHITECTURE.md) | BullMQ queues, worker pool, fair queuing |

Full doc index lives in [CLAUDE.md](CLAUDE.md) (also the contributor guide
for AI-assisted edits).

---

## Troubleshooting

**"`pnpm run dev` build fails on `pnpm install --frozen-lockfile`"**
Lockfile was written by a newer pnpm than the image has. Make sure
Dockerfiles pin `pnpm@10` (matches `pnpm-lock.yaml` v9 format). Already
fixed in committed Dockerfiles; only resurfaces if you regenerate the
lockfile with an older pnpm.

**"API container crashes with `libssl.so.1.1: No such file or directory`"**
Prisma engine mismatch — schema needs both `native` and
`debian-openssl-3.0.x` in `binaryTargets`. Already configured in
[apps/api/prisma/schema.prisma](apps/api/prisma/schema.prisma).

**"WebSocket connection fails / live screencast blank"**
Port 3002 must be reachable from the browser. In dev that's mapped in
[docker/dev/docker-compose.yml](docker/dev/docker-compose.yml); in prod
in [docker/prod/docker-compose.yml](docker/prod/docker-compose.yml).
Behind a reverse proxy you'll need to upgrade the connection on
`/socket.io/` paths.

**"Live preview shows the QA Platform's own dashboard"**
The environment's `baseUrl` is misconfigured — pointing at the platform
instead of the system under test. Edit it under Project → Environments.

**"Hot reload not picking up file changes (Mac/WSL)"**
File events don't propagate reliably through the docker fs layer. The dev
images set `CHOKIDAR_USEPOLLING=1` and vite uses polling fallback when that
env is set — already configured. If still slow, try `pnpm run dev:host` to
run apps natively while keeping postgres + redis containerised.

---

## Contributing

Read [CLAUDE.md](CLAUDE.md) before making non-trivial changes — it documents
the canonical specs, monorepo conventions, and the order of phases the
implementation plan follows. Don't deviate from the tech stack without
discussion.
