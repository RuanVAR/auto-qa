# 02 — Phase 0: Survival

**Do this before anything else. It is not parallelisable with feature work.**

Four of these six items each take under an hour and each removes a failure mode
that can end the business. Nothing in Phases 1–6 matters if the database is lost
or the credentials are leaked.

**Total effort: ~1 day.** Target: complete in one sitting.

> **Implementation status (2026-07-21):** Repository controls for backup and
> restore tooling, secret-safe Docker contexts, artifact retention, Sentry,
> resource limits, and CI gates are present. The unchecked acceptance items are
> deliberately operational: they require a real S3 bucket, production alerting,
> credential rotation, and an observed restore drill before this phase can be
> declared complete.

---

## 0.1 — Postgres backups with a *tested* restore `[ ]` S

### The problem

There is no backup of any kind. Verified by grepping `pg_dump|backup|restore|
snapshot|wal` across `scripts/`, `docker/`, `.github/`, `docs/` and the repo root
— the only hit is an unrelated mention of feature *versioning* snapshots.

Production data lives in a single Docker named volume (`postgres_data`) on one
Lightsail instance's disk. A disk failure, a bad migration, or one mistyped
`docker volume prune` is **total unrecoverable loss**.

- **RPO: infinite.** **RTO: "re-enter everything by hand."**
- `docker compose down -v` ends the business.
- Lightsail offers automatic instance snapshots, but nothing in this repo
  configures or verifies them, so they cannot be relied on.

### Implementation

Create `scripts/backup-db.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

# Nightly logical backup → S3-compatible storage, 30-day retention.
# Runs on the prod host via cron. Intentionally simple: pg_dump custom format
# (-Fc) so pg_restore can do selective/parallel restore.

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/qa-${STAMP}.dump"
BUCKET="${BACKUP_BUCKET:?BACKUP_BUCKET must be set}"

docker exec qa-postgres-prod pg_dump \
  -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc --no-owner --no-acl \
  > "${OUT}"

# Fail loudly on an empty/truncated dump rather than uploading garbage.
SIZE=$(stat -f%z "${OUT}" 2>/dev/null || stat -c%s "${OUT}")
if [ "${SIZE}" -lt 100000 ]; then
  echo "FATAL: dump only ${SIZE} bytes — refusing to upload" >&2
  exit 1
fi

aws s3 cp "${OUT}" "s3://${BUCKET}/db/qa-${STAMP}.dump" \
  --storage-class STANDARD_IA
rm -f "${OUT}"

# Retention: delete anything older than 30 days.
CUTOFF=$(date -u -d '30 days ago' +%Y%m%d 2>/dev/null || date -u -v-30d +%Y%m%d)
aws s3 ls "s3://${BUCKET}/db/" | while read -r _ _ _ key; do
  ts="${key#qa-}"; ts="${ts%%T*}"
  [ -n "${ts}" ] && [ "${ts}" -lt "${CUTOFF}" ] && aws s3 rm "s3://${BUCKET}/db/${key}"
done

echo "backup ok: qa-${STAMP}.dump (${SIZE} bytes)"
```

Install on the host:

```
0 2 * * * /home/ubuntu/qa_platform/scripts/backup-db.sh >> /var/log/qa-backup.log 2>&1
```

### The restore test — this is the part that matters

A backup you have never restored is not a backup. Create
`scripts/verify-restore.sh` and **run it before declaring this item done**:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Pull the newest dump, restore into a THROWAWAY container, assert row counts.
LATEST=$(aws s3 ls "s3://${BACKUP_BUCKET}/db/" | sort | tail -1 | awk '{print $4}')
aws s3 cp "s3://${BACKUP_BUCKET}/db/${LATEST}" /tmp/verify.dump

docker run -d --name qa-restore-test -e POSTGRES_PASSWORD=verify \
  -e POSTGRES_USER=qa_user -e POSTGRES_DB=qa_verify postgres:16-alpine
sleep 10
docker cp /tmp/verify.dump qa-restore-test:/tmp/
docker exec qa-restore-test pg_restore -U qa_user -d qa_verify --no-owner /tmp/verify.dump

for t in organisations projects test_definitions test_runs users; do
  n=$(docker exec qa-restore-test psql -U qa_user -d qa_verify -tAc "SELECT count(*) FROM ${t};")
  echo "  ${t}: ${n}"
  [ "${n}" -gt 0 ] || { echo "FATAL: ${t} empty after restore" >&2; exit 1; }
done

docker rm -f qa-restore-test && rm -f /tmp/verify.dump
echo "RESTORE VERIFIED"
```

### Acceptance
- [ ] `backup-db.sh` runs nightly via cron and writes to S3
- [ ] `verify-restore.sh` has been run **at least once** and passed
- [ ] Restore procedure documented in `docs/RUNBOOK.md` with the exact commands
- [ ] An alert fires if no backup lands for 36 h

---

## 0.2 — Get `.env*` out of Docker images `[ ]` S

### The problem — verified, not assumed

`.dockerignore:14` contains the pattern `.env`. That pattern does **not** match
`.env.production`. Confirmed against fnmatch semantics:

```
patterns matching '.env.production': NONE -> file IS included in build context
```

`.env.production` is present (4,139 bytes) and all three production Dockerfiles
do `COPY . .` (`apps/api/Dockerfile:12`, `apps/worker/Dockerfile:24`,
`apps/web/Dockerfile:11`).

**Result:** ~27 populated secrets — `POSTGRES_PASSWORD`, `JWT_SECRET`,
`JWT_REFRESH_SECRET`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `AI_API_KEY`,
`GOOGLE_CLIENT_SECRET`, `EMAIL_PASS` and more — are readable layers in
`qa-platform/api:latest` and `qa-platform/worker:latest`.

Blast radius is currently limited because images never leave the host. Any
`docker save`, registry push, or host compromise exfiltrates the entire set.

Separately: a live `GOCSPX-` Google OAuth client secret sits in
`docker/dev/.env:36`. It is correctly gitignored and was **never committed**
(verified via `git log --all` on that path), but it is in the build context.

### Implementation

Append to `.dockerignore`:

```
# Secrets must never enter a build context. The bare `.env` pattern does NOT
# match `.env.production` / `docker/dev/.env` — this glob does.
.env*
!.env*.example
```

Then:
1. Rebuild all three images.
2. **Verify** nothing leaked:
   ```bash
   docker run --rm --entrypoint sh qa-platform/api:latest -c \
     'ls -la /app/.env* 2>&1 | head'    # expect: No such file
   docker history --no-trunc qa-platform/api:latest | grep -ci 'JWT_SECRET' # expect 0
   ```
3. **Rotate every credential** in `.env.production` — assume all are compromised.
4. Rotate the dev Google OAuth secret.

### Acceptance
- [ ] `.dockerignore` updated
- [ ] Images rebuilt and verified free of `.env*`
- [ ] All ~27 production credentials rotated
- [ ] Dev Google OAuth secret rotated

---

## 0.3 — Artifact retention `[ ]` S

### The problem

`RECORD_VIDEO` defaults to `true`. Every UI run writes a video *and* a trace.
There is **no retention, TTL, quota or purge** anywhere in `packages/storage`,
the artifacts module, or the worker — verified by grep.

Production runs `STORAGE_PROVIDER=local` (`.env.production.example:73`), so
artifacts land in the `artifacts_data` volume **on the same root disk as
Postgres**. When it fills, Postgres cannot write WAL.

**Unbounded video growth eventually corrupts the database.**

`scripts/docker-cleanup.sh` reclaims Docker images; it never touches artifacts.

### Implementation

**a) Retention job** — new `apps/api/src/modules/artifacts/artifact-retention.service.ts`:

```ts
/**
 * Artifacts have no lifecycle policy, so they grow until the disk fills — and
 * because production stores them on the same volume as Postgres, a full disk
 * means the database cannot write WAL. This sweep is the only thing bounding
 * that growth.
 *
 * Policy (env-tunable):
 *   VIDEO   → 14 days   (largest, least often revisited)
 *   TRACE   → 30 days   (needed for debugging regressions)
 *   SCREENSHOT → 90 days (small, high evidentiary value)
 *   Artifacts attached to a run linked to an OPEN Issue are never deleted.
 */
@Cron('0 3 * * *', { name: 'artifact-retention' })
async sweep(): Promise<void> { /* … */ }
```

Rules:
- Never delete an artifact whose `TestRun` has a linked `Issue` in a non-closed
  status — evidence for an open bug must survive.
- Never delete artifacts for runs referenced by a `GeneratedReport`.
- Delete from object storage **first**, then the `Artifact` row, so a crash
  leaves an orphaned row (harmless) rather than an orphaned blob (invisible).
- Log bytes reclaimed; emit as a metric.

**b) Disk alert** — `scripts/disk-alert.sh`, cron every 15 min, alert at >75 %
and page at >90 %.

**c) Immediate relief**: set `RECORD_VIDEO=false` by default in production and
make it per-project opt-in. Traces already contain screenshots and network data;
video is largely redundant once the trace viewer is embedded (item 3.1).

### Acceptance
- [ ] Retention sweep runs nightly, honours the open-issue exemption
- [ ] Disk alert configured at 75 % / 90 %
- [ ] `RECORD_VIDEO` defaults off in prod
- [ ] Current disk usage measured and recorded in the runbook

---

## 0.4 — Error tracking and uptime monitoring `[ ]` S

### The problem

Grep for `sentry|opentelemetry|prom-client|datadog|newrelic|winston|pino` across
the entire repo: **zero matches.** No error tracking, no metrics, no tracing, no
structured logging, no alerting.

When a run silently fails: the worker logs to stdout → nothing scrapes stdout →
BullMQ retries once → the job sits in the failed set until evicted at 200 entries
→ the stuck-runs cron eventually cancels it → **the UI shows a cancelled run and
nobody is told.** A worker that dies at 18:00 Friday is discovered Monday.

### Implementation

**a) Sentry** in all three apps (`@sentry/node` for api/worker, `@sentry/react`
for web). Minimum viable:

```ts
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  // Never ship secrets to a third party — the worker interpolates credentials
  // into step inputs, so scrub aggressively before send.
  beforeSend: scrubSecrets,
});
```

Wire into: the Nest global exception filter, the BullMQ `failed` handler
(`worker/src/main.ts:82`), and the React error boundary.

**b) Uptime monitor** on `GET /api/v1/health` — it already returns 503 correctly
when Postgres or Redis is unreachable (`health.controller.ts:33-57`). Any
external service (UptimeRobot, Better Stack) at 1-minute interval.

**c) Queue-depth alert.** `worker.controller.ts:24-41` already exposes live
BullMQ counts. Alert when `waiting > 50` for >10 min (worker is dead or wedged)
or `failed` grows by >10 in an hour.

### Acceptance
- [ ] Sentry receiving from api, worker and web; a deliberate test error appears
- [ ] Secret scrubbing verified — trigger an error on a step with credentials and
      confirm no plaintext reaches Sentry
- [ ] Uptime monitor on `/api/v1/health` with alerting
- [ ] Queue-depth alert configured

---

## 0.5 — Resource limits and log rotation `[ ]` S

### The problem

Neither compose file sets `deploy.resources.limits`, `mem_limit`, `ulimits`,
`pids_limit`, or `logging` options. Consequences on a ~2 GB box:

- A runaway Chromium can OOM-kill Postgres. Nothing is protected from anything.
- Default `json-file` logging with **no `max-size`/`max-file`** grows until the
  disk fills — compounding 0.3.
- **Worst case is 6 concurrent Chromium instances**: `report-pdf.worker.ts:59`
  reuses `WORKER_CONCURRENCY` (default 3) and launches its own browser per job,
  in the same container as the 3 run browsers. See item 1.5.

### Implementation

Add to every service in `docker/prod/docker-compose.yml`:

```yaml
    mem_limit: 512m          # postgres 640m, worker 900m — tune from measurement
    memswap_limit: 1g
    pids_limit: 512
    logging:
      driver: json-file
      options: { max-size: "10m", max-file: "3" }
```

Budget on a 2 GB host — measure before committing to these numbers:

| Service | Limit |
|---|---|
| postgres | 640m |
| redis | 128m |
| api | 384m |
| worker | 768m (holds Chromium) |
| web (nginx) | 64m |

### Acceptance
- [ ] Memory limits on every service, summing below physical RAM
- [ ] Log rotation on every service
- [ ] Stack survives a full pipeline run without OOM (verify with `docker stats`)

---

## 0.6 — CI gates on `ci:check` `[ ]` S

### The problem

`.github/workflows/deploy.yml:12-27` runs `pnpm lint` and nothing else. No
typecheck, no tests, no build verification.

`package.json:53` already defines `ci:check` (lint + three builds + all tests)
and **nothing invokes it**. Code that does not compile passes the gate and fails
on the production host *after* containers have been recreated.

Compounding: images are `:latest` only, so there is **no rollback**; on health
timeout the deploy exits 1 leaving broken containers running; and there is no
`concurrency:` group, so two pushes run two overlapping deploys that both
`git reset --hard` the same checkout.

### Implementation

```yaml
concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: false     # never interrupt a deploy mid-migration

jobs:
  check:
    steps:
      - run: pnpm install --frozen-lockfile --ignore-scripts
      - run: pnpm lint
      - run: pnpm --filter api exec tsc --noEmit
      - run: pnpm --filter web exec tsc --noEmit
      - run: pnpm --filter worker exec tsc --noEmit
      - run: pnpm --filter api test
      - run: pnpm --filter worker test
  deploy:
    needs: check
```

Also tag images with the commit SHA alongside `latest` so rollback is possible:

```bash
docker tag qa-platform/api:latest qa-platform/api:${GITHUB_SHA::7}
```

and raise `docker-cleanup.sh`'s prune window above 72 h so the last known-good
image survives.

### Acceptance
- [ ] CI runs lint + typecheck + tests before deploying
- [ ] `concurrency` group prevents overlapping deploys
- [ ] Images tagged with commit SHA; rollback documented in the runbook
- [ ] A deliberately broken commit is caught by CI, not by the prod host

---

## Phase 0 exit criteria

- [ ] A restore from S3 has been **performed and verified**, not just configured
- [ ] `docker history` on every prod image is free of secrets, and all
      credentials have been rotated
- [ ] Artifact retention is running and disk usage is trending flat or down
- [ ] Sentry is receiving errors and an alert has been proven to fire
- [ ] Every container has a memory limit and rotating logs
- [ ] CI blocks a non-compiling commit
- [ ] `docs/RUNBOOK.md` exists covering: restore, rollback, credential rotation,
      disk-full recovery, and "the worker is dead" triage
