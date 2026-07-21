# Runbook

What to do when production is unhappy. Written for someone under pressure at
2am — commands are copy-pasteable and assume nothing.

Host: single AWS Lightsail instance (~2 GB), `ubuntu` user, stack at
`~/qa_platform`.

---

## Restore the database

**Prerequisite:** `scripts/verify-restore.sh` should have been run recently. A
backup that has never been restored is an assumption, not a backup.

```bash
cd ~/qa_platform

# 1. What have we got?
aws s3 ls s3://$BACKUP_BUCKET/db/ | tail -10

# 2. Prove the newest one is usable BEFORE touching production.
#    This restores into a throwaway container and asserts row counts.
./scripts/verify-restore.sh

# 3. Stop everything that writes.
docker compose -f docker/prod/docker-compose.yml --env-file .env.production stop api worker

# 4. Pull the dump.
aws s3 cp s3://$BACKUP_BUCKET/db/<chosen>.dump /tmp/restore.dump

# 5. Restore. --clean drops existing objects first; take a snapshot of the
#    volume first if the current state has ANY value.
docker cp /tmp/restore.dump qa-postgres-prod:/tmp/
docker exec qa-postgres-prod pg_restore \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner /tmp/restore.dump

# 6. Bring it back.
docker compose -f docker/prod/docker-compose.yml --env-file .env.production start api worker

# 7. Confirm.
curl -fsS localhost:3001/api/v1/health && echo OK
```

**Backups run** nightly at 02:00 UTC via cron → `scripts/backup-db.sh`, retained
30 days. If no backup has landed in 36h, that is itself an incident.

---

## Disk is full (or nearly)

This is the failure mode that corrupts the database: artifacts share a disk with
Postgres, and when it fills Postgres cannot write WAL.

```bash
df -h /
docker system df

# Biggest consumers
sudo du -sh /var/lib/docker/volumes/* 2>/dev/null | sort -h | tail -5

# 1. Reclaim Docker first — safe, fast, usually enough.
bash scripts/docker-cleanup.sh
docker image prune -af

# 2. Force an artifact sweep (normally nightly at 03:00 UTC).
docker exec qa-api-prod node -e "
  require('/app/apps/api/dist/main');  // or restart the API to trigger on boot
"
# Simpler: restart the API and wait for the 03:00 cron, or temporarily lower
# retention and restart:
#   RETENTION_VIDEO_DAYS=3 docker compose ... up -d api

# 3. Emergency: stop recording video on new runs.
#    Set RECORD_VIDEO=false in .env.production and restart the worker.
```

Retention policy (all env-tunable): video 14d, trace 30d, screenshot 90d,
log/HAR 30d, reports never. Artifacts attached to an **unresolved issue** or a
**generated report** are exempt at any age.

---

## Rollback a bad deploy

Images are tagged with the commit SHA as well as `latest`.

```bash
cd ~/qa_platform
docker images | grep qa-platform          # find the previous SHA tag

# Re-tag the known-good image as latest and restart
docker tag qa-platform/api:<good-sha> qa-platform/api:latest
docker tag qa-platform/worker:<good-sha> qa-platform/worker:latest
docker tag qa-platform/web:<good-sha> qa-platform/web:latest
docker compose -f docker/prod/docker-compose.yml --env-file .env.production up -d
```

⚠️ **Migrations are not rolled back.** `prisma migrate deploy` runs before the
containers restart, so if the bad deploy included a destructive migration, code
rollback alone will not fix it — you need a database restore. This is why
migrations must follow expand → migrate → contract
(`docs/plan/09-CONVENTIONS.md §2`).

---

## The worker is dead / runs are stuck

Symptom: queue depth climbing, runs sitting in `QUEUED` or `RUNNING`.

```bash
# Is it alive?
docker ps | grep qa-worker-prod
curl -fsS localhost:3003/ready

# What does it think it's doing?
docker logs qa-worker-prod --tail 100

# Queue depth
curl -fsS localhost:3001/api/v1/worker/queue-status

# Orphaned browsers eating memory?
docker exec qa-worker-prod ps aux | grep -c chrome

# Restart. In-flight runs are reclaimed by the stuck-run cron within 15-60 min,
# or re-picked by BullMQ after lockDuration.
docker compose -f docker/prod/docker-compose.yml --env-file .env.production restart worker
```

**Known ceiling:** with `N` worker replicas, the process ceiling is
`N × (WORKER_CONCURRENCY + PDF_WORKER_CONCURRENCY)` Chromium instances. At the
defaults that is `N × 4`: three run browsers and one PDF browser per worker.

The production Compose limits reserve up to 1,216 MiB for Postgres, Redis, API,
and web, then add 768 MiB for every worker replica. The configured container
ceiling is therefore `1,216 MiB + (N × 768 MiB)`, before Docker, kernel, and host
process overhead. On the current ~2 GiB deployment profile, **one worker is the
safe maximum**. Scaling workers requires a larger host (or lower measured limits)
and this check before deployment:

```text
host usable memory >= 1,216 MiB + (worker replicas × 768 MiB) + host headroom
```

Memory limits are ceilings, not reservations, so validate sustained usage with
`docker stats` while run and PDF queues are both active. Do not raise either
browser concurrency solely because more workers can join the queue.

---

## Rotate credentials

Do this immediately if an image has ever left the host, or on any suspected
compromise.

```bash
# 1. Edit .env.production — every value, not just the suspected one.
#    JWT_SECRET and JWT_REFRESH_SECRET must be >=32 chars.
#    Rotating JWT_SECRET logs everyone out. That is expected.

# 2. SECRETS_KEK needs the staged path, or every encrypted value becomes
#    unreadable:
#      SECRETS_KEK_PREVIOUS=<old>   SECRETS_KEK=<new>
#    Leave PREVIOUS in place until everything has been re-saved.

# 3. Rebuild and restart.
bash scripts/deploy-prod.sh

# 4. Verify secrets are NOT in the images.
docker run --rm --entrypoint sh qa-platform/api:latest -c 'ls -la /app/.env* 2>&1'
# expect: No such file or directory
```

---

## Alerts and what they mean

| Alert | Meaning | First action |
|---|---|---|
| Uptime monitor on `/api/v1/health` | API down, or Postgres/Redis unreachable (it returns 503) | `docker ps`, then API logs |
| Disk ≥75% | Retention is not keeping up | Run the disk section above |
| Disk ≥90% | **Postgres WAL at risk** | Reclaim immediately; consider stopping the worker |
| No backup in 36h | Backup cron failed | `cat ~/qa_platform/logs/backup.log` |
| Queue depth >50 for 10 min | Worker dead or wedged | Worker section above |
| Sentry: spike in 5xx | Application error | Check the release tag against the last deploy |

---

## Health endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/v1/health` | Liveness + DB/Redis readiness. **503** when a dependency is down |
| `:3003/ready` | Worker readiness, cheap |
| `:3003/health` | Worker health — actually launches Chromium to prove it is not wedged |
| `GET /api/v1/worker/queue-status` | Live BullMQ counts |

---

## Environment variables that matter operationally

| Variable | Default | Effect |
|---|---|---|
| `WORKER_CONCURRENCY` | 3 | Concurrent run browsers |
| `PDF_WORKER_CONCURRENCY` | 1 | Concurrent PDF browsers — **adds to the above** |
| `RECORD_VIDEO` | false in production | Biggest single contributor to disk growth |
| `RETENTION_VIDEO_DAYS` | 14 | |
| `RETENTION_TRACE_DAYS` | 30 | |
| `RETENTION_SCREENSHOT_DAYS` | 90 | |
| `ARTIFACT_RETENTION_ENABLED` | true | Set `false` to pause the sweep |
| `SENTRY_DSN` | unset | Unset = no error reporting at all |
| `BACKUP_PROVIDER` | auto | `s3` or `azure`; chooses only when one target is configured |
| `BACKUP_BUCKET` | — | Required when `BACKUP_PROVIDER=s3` |
| `BACKUP_AZURE_CONTAINER` | — | Dedicated private Blob container when provider is `azure` |
| `BACKUP_AZURE_ACCOUNT` | — | Managed-identity storage account for Azure backups |
| `BACKUP_AZURE_CONNECTION_STRING` | — | Azure fallback when managed identity is unavailable |
| `BACKUP_MAX_AGE_HOURS` | 36 | Freshness alert threshold |
| `DISK_WARN_PCT` / `DISK_PAGE_PCT` | 75 / 90 | |
| `ALERT_WEBHOOK` | unset | Slack/Teams incoming webhook for disk alerts |
| `PRODUCTION_HARDENING_REQUIRED` | true | Blocks deploys missing backups, Sentry or alert routing |

---

## Cron on the production host

```
0  2 * * *  ~/qa_platform/scripts/backup-db.sh              >> ~/qa_platform/logs/backup.log 2>&1
15 * * * *  ~/qa_platform/scripts/check-backup-freshness.sh  >> ~/qa_platform/logs/backup-health.log 2>&1
*/15 * * * * ~/qa_platform/scripts/disk-alert.sh             >> ~/qa_platform/logs/disk.log 2>&1
0  3 * * *  ~/qa_platform/scripts/docker-cleanup.sh          >> ~/qa_platform/logs/docker-cleanup.log 2>&1
```

These are installed idempotently by `scripts/deploy-prod.sh`. Artifact retention
runs **inside the API** at 03:00 UTC, not as host cron.

For Azure Blob backups, install the Azure CLI on the deployment host and grant
its managed identity `Storage Blob Data Contributor` on the dedicated backup
container. Authenticate it once with `az login --identity`, then set
`BACKUP_PROVIDER=azure`, `BACKUP_AZURE_CONTAINER`, and `BACKUP_AZURE_ACCOUNT`.
Use `BACKUP_AZURE_CONNECTION_STRING` only if managed identity is unavailable.
