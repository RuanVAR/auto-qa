# Worker Architecture — Concurrent Test Execution

## The Problem

Every automated test run requires a Playwright browser context:

- Browser context creation: ~10ms (cheap — reuse the browser process)
- Browser process launch: ~1–2s (expensive — keep one alive per worker)
- Memory per context: 50–150MB depending on page complexity
- CPU: spikes during page render, navigation, screenshot capture

If 10 users each trigger a feature run with 5 test cases simultaneously,
that is potentially 50 concurrent browser contexts. On an unguarded single
server, this exhausts RAM and starves every user.

The architecture must answer:
- How many tests run simultaneously?
- What happens when demand exceeds capacity?
- How does one user's heavy run not slow down another user's quick run?
- How do you add capacity without changing code?

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  API Server                                                       │
│                                                                   │
│  User A triggers run  →  QueueService.enqueue(job, priority=HIGH) │
│  User B triggers run  →  QueueService.enqueue(job, priority=HIGH) │
│  Scheduled run fires  →  QueueService.enqueue(job, priority=LOW)  │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                          ┌──────▼──────┐
                          │    Redis    │
                          │             │
                          │  qa:high    │  ← manually triggered runs
                          │  qa:normal  │  ← API / CI webhook runs
                          │  qa:low     │  ← scheduled runs
                          │  qa:index   │  ← repo indexing
                          │  qa:reports │  ← PDF report generation
                          └──────┬──────┘
                                 │  BullMQ distributes across all workers
              ┌──────────────────┼──────────────────┐
              │                  │                  │
    ┌─────────▼────────┐ ┌──────▼──────────┐ ┌────▼──────────────┐
    │   Worker #1      │ │   Worker #2     │ │   Worker #3       │
    │                  │ │                │ │                   │
    │  concurrency: 3  │ │ concurrency: 3 │ │  concurrency: 3   │
    │                  │ │                │ │                   │
    │  [run A] [run B] │ │ [run C]        │ │  [run D] [run E]  │
    │  [run F]         │ │                │ │  [run G]          │
    │                  │ │                │ │                   │
    │  Browser process │ │ Browser process│ │  Browser process  │
    │  (1 per worker)  │ │ (1 per worker) │ │  (1 per worker)   │
    │  Context A ──┐   │ │  Context C     │ │  Context D ──┐    │
    │  Context B ──┤   │ │                │ │  Context E ──┤    │
    │  Context F ──┘   │ │                │ │  Context G ──┘    │
    └──────────────────┘ └────────────────┘ └───────────────────┘
         writes to              writes to           writes to
        /artifacts             /artifacts           /artifacts
                   (shared named Docker volume)
```

**Key points:**
- BullMQ is the coordinator — it distributes jobs across however many workers exist
- Each worker maintains **one browser process** but runs **N contexts concurrently** (N = `WORKER_CONCURRENCY`)
- Browser contexts are isolated — separate cookies, localStorage, network sessions
- Workers are stateless — you can add or remove them without touching the API
- Redis is the only shared state between workers

---

## Queue Structure

Five separate BullMQ queues with explicit priority ordering:

| Queue | Priority | Jobs | Typical volume |
|-------|----------|------|---------------|
| `qa:high` | 1 (highest) | Manually triggered runs (user clicked Play) | Sporadic, immediate |
| `qa:normal` | 2 | API-triggered runs, CI webhook runs | Medium |
| `qa:low` | 3 | Scheduled (cron) runs | High volume, can wait |
| `qa:index` | 4 | Repo indexing jobs | Background |
| `qa:reports` | 5 (lowest) | PDF report generation | Background |

Each worker listens on **all queues in priority order**. A worker picks the
highest-priority available job first. If all queues are empty, it waits.

```typescript
// apps/worker/src/worker.module.ts
const workers = [
  { queue: 'qa:high',    processor: RunProcessor,    concurrency: WORKER_CONCURRENCY },
  { queue: 'qa:normal',  processor: RunProcessor,    concurrency: WORKER_CONCURRENCY },
  { queue: 'qa:low',     processor: RunProcessor,    concurrency: WORKER_CONCURRENCY },
  { queue: 'qa:index',   processor: IndexProcessor,  concurrency: 1 },
  { queue: 'qa:reports', processor: ReportProcessor, concurrency: 2 },
];
```

> **Why not one queue with priority numbers?**
> BullMQ's per-job priority (`{ priority: 1 }`) works within a single queue but
> has O(log n) overhead as the queue grows. Separate named queues with ordered
> worker listeners is simpler and more predictable.

---

## Worker Concurrency Model

### Browser pool per worker

Each worker process launches **one Chromium browser** at startup and keeps it alive.
Each concurrent test run gets a **new browser context** from that browser.

```typescript
// apps/worker/src/execution/browser-pool.service.ts
@Injectable()
export class BrowserPoolService implements OnModuleInit, OnModuleDestroy {
  private browser: Browser | null = null;
  private activeContexts = new Map<string, BrowserContext>();

  async onModuleInit() {
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',   // prevents /dev/shm exhaustion in Docker
        '--disable-gpu',
        '--memory-pressure-off',
      ],
    });
  }

  async acquireContext(runId: string): Promise<BrowserContext> {
    if (!this.browser) throw new Error('Browser not initialised');
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      ignoreHTTPSErrors: true,
    });
    this.activeContexts.set(runId, context);
    return context;
  }

  async releaseContext(runId: string): Promise<void> {
    const context = this.activeContexts.get(runId);
    if (context) {
      await context.close().catch(() => {}); // never throw on cleanup
      this.activeContexts.delete(runId);
    }
  }

  async onModuleDestroy() {
    // Close all open contexts first, then the browser
    await Promise.all([...this.activeContexts.values()].map(c => c.close().catch(() => {})));
    await this.browser?.close().catch(() => {});
  }
}
```

**Why contexts not separate browser processes?**

| | Browser process per run | Browser context per run (chosen) |
|--|------------------------|----------------------------------|
| Launch time | 1–2s per run | ~10ms per run |
| Memory | ~150MB base + page content | ~50MB per context (shared base) |
| Isolation | Full process isolation | Cookie/storage/network isolation |
| CDP session | Separate port per process | One CDP session per context |
| Verdict | Wasteful, slow | ✅ Fast, efficient, sufficient isolation |

Browser contexts provide the isolation that matters for testing: each context has
its own cookies, localStorage, IndexedDB, and network stack. They cannot read
each other's state.

### Concurrency setting

```bash
WORKER_CONCURRENCY=3   # default — 3 concurrent test runs per worker instance
```

With `WORKER_CONCURRENCY=3` and 3 worker instances:
- Maximum 9 concurrent test runs
- Each worker uses ~3 × 100MB = ~300MB for contexts + 100MB browser base = ~400MB per worker
- Total: ~1.2GB for browsers + app overhead

**Tuning guide:**

| Server RAM | Recommended workers | Concurrency | Max concurrent runs |
|-----------|--------------------|-----------  |---------------------|
| 4GB | 1 | 2 | 2 |
| 8GB | 2 | 3 | 6 |
| 16GB | 3 | 4 | 12 |
| 32GB | 4 | 5 | 20 |
| 64GB+ | 6+ | 5 | 30+ |

---

## Fair Queuing — Per-Org Rate Limiting

Without limits, a single org could queue 200 scheduled runs and starve every
other org's manual runs on the same priority level.

### Two-level protection

**Level 1 — Queue priority** (described above): manual runs always picked
before scheduled runs, regardless of which org queued them.

**Level 2 — Per-org concurrency limit**: an org cannot have more than N runs
*active* simultaneously, regardless of queue depth.

```typescript
// apps/worker/src/execution/run-processor.ts
@Processor('qa:high')
@Processor('qa:normal')
@Processor('qa:low')
export class RunProcessor {
  constructor(
    private browserPool: BrowserPoolService,
    private orgLimiter: OrgConcurrencyLimiter,
  ) {}

  async process(job: Job<RunJobData>) {
    const { runId, orgId } = job.data;

    // Check if this org is already at its concurrent run limit
    const allowed = await this.orgLimiter.acquire(orgId);
    if (!allowed) {
      // Re-queue with a delay — BullMQ will retry
      await job.moveToDelayed(Date.now() + 5_000);
      return;
    }

    const context = await this.browserPool.acquireContext(runId);
    try {
      await this.runExecutor.execute(runId, context);
    } finally {
      await this.browserPool.releaseContext(runId);
      await this.orgLimiter.release(orgId);
    }
  }
}
```

```typescript
// apps/worker/src/execution/org-concurrency-limiter.ts
@Injectable()
export class OrgConcurrencyLimiter {
  // Uses Redis counters so the limit is shared across all worker instances
  constructor(private redis: Redis) {}

  async acquire(orgId: string): Promise<boolean> {
    const key = `org:active-runs:${orgId}`;
    const limit = parseInt(process.env.ORG_MAX_CONCURRENT_RUNS ?? '5');

    // Atomic increment + check
    const current = await this.redis.incr(key);
    await this.redis.expire(key, 3600); // safety TTL

    if (current > limit) {
      await this.redis.decr(key);
      return false;
    }
    return true;
  }

  async release(orgId: string): Promise<void> {
    const key = `org:active-runs:${orgId}`;
    await this.redis.decr(key);
  }
}
```

```bash
ORG_MAX_CONCURRENT_RUNS=5   # max active runs per org at any moment (default: 5)
```

> The counter lives in Redis — shared across all worker instances.
> If worker #1 and worker #2 both have jobs from the same org, the Redis
> counter correctly reflects the total, not a per-worker count.

---

## Job Timeout Enforcement

Runaway tests (infinite loops, hung pages, network timeouts) block a worker
concurrency slot indefinitely without enforcement.

### Three-layer timeout

```
Layer 1: Per-step timeout (Playwright)     default 30s
          → set by test config: config.timeout
          → Playwright throws TimeoutError if step doesn't complete

Layer 2: Per-run timeout (RunExecutor)     default 10 minutes
          → RunExecutor has an overall wall-clock timer
          → If exceeded: abort remaining steps, mark run TIMED_OUT

Layer 3: BullMQ job timeout               default 15 minutes
          → Hard kill — BullMQ marks job FAILED if worker doesn't
            acknowledge completion within this window
          → Catches cases where RunExecutor itself hangs
```

```typescript
// BullMQ job options set at enqueue time
await queue.add('run', jobData, {
  timeout: 15 * 60 * 1000,         // 15 min hard kill (Layer 3)
  attempts: 1,                      // no automatic retry (test failures are intentional)
  removeOnComplete: { age: 86400 }, // keep completed jobs 24h for status queries
  removeOnFail: { age: 86400 },
});
```

```typescript
// RunExecutor — Layer 2 wall-clock timeout
async execute(runId: string, context: BrowserContext) {
  const RUN_TIMEOUT_MS = parseInt(process.env.RUN_TIMEOUT_MS ?? '600000'); // 10 min

  const runPromise = this.executeSteps(runId, context);
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Run timed out')), RUN_TIMEOUT_MS)
  );

  try {
    await Promise.race([runPromise, timeoutPromise]);
  } catch (err) {
    if (err.message === 'Run timed out') {
      await this.markRunTimedOut(runId);
    }
    throw err;
  }
}
```

---

## Memory Safety

### Worker memory limit

Each worker Docker container has a hard memory limit. If the container exceeds
it, Docker kills it and BullMQ automatically re-queues the in-progress jobs
(they are not lost — BullMQ marks them as stalled and a new worker picks them up).

```yaml
# docker-compose.yml
worker:
  image: qa-platform/worker
  deploy:
    resources:
      limits:
        memory: 2G          # hard kill at 2GB
        cpus: '2.0'
      reservations:
        memory: 512M
```

### Stalled job recovery

BullMQ has a built-in stalled job checker. If a worker crashes mid-job (OOM,
SIGKILL), the job is automatically moved back to the queue after a configurable
stalledInterval:

```typescript
new Worker('qa:high', processor, {
  stalledInterval: 30_000,   // check for stalled jobs every 30s
  maxStalledCount: 1,        // move stalled job back to queue once; mark failed after that
});
```

### Graceful shutdown

```typescript
// apps/worker/src/main.ts
process.on('SIGTERM', async () => {
  logger.log('SIGTERM received — graceful shutdown starting');

  // Stop accepting new jobs from all workers
  await Promise.all(workers.map(w => w.pause()));

  // Wait for in-progress jobs to finish (up to 30s)
  const shutdown = workers.map(w => w.close());
  await Promise.race([
    Promise.all(shutdown),
    new Promise(res => setTimeout(res, 30_000)),
  ]);

  // Close browser and Redis connections
  await browserPool.onModuleDestroy();
  await redis.quit();

  process.exit(0);
});
```

This is critical for rolling deploys — the old worker finishes its current jobs
before the container exits.

---

## Horizontal Scaling

Workers are stateless. Scale by running more instances:

### Docker Compose (single server)

```yaml
# docker-compose.yml
worker:
  image: qa-platform/worker
  environment:
    WORKER_CONCURRENCY: 3
  deploy:
    replicas: 3   # 3 worker instances = 9 max concurrent runs
  depends_on: [redis, postgres]
```

Scale up/down at runtime:
```bash
docker-compose up --scale worker=5   # 5 instances = 15 max concurrent
docker-compose up --scale worker=1   # scale down to 1
```

### Docker Swarm / Kubernetes

```yaml
# kubernetes/worker-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qa-worker
spec:
  replicas: 3
  template:
    spec:
      containers:
        - name: worker
          image: qa-platform/worker
          env:
            - name: WORKER_CONCURRENCY
              value: "3"
          resources:
            limits:
              memory: 2Gi
              cpu: "2"
---
# Horizontal Pod Autoscaler — scale based on BullMQ queue depth
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: qa-worker-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: qa-worker
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: External
      external:
        metric:
          name: bullmq_queue_depth   # custom metric from Prometheus exporter
        target:
          type: AverageValue
          averageValue: "5"    # scale up when avg queue depth > 5 jobs per worker
```

### No code changes required

Because BullMQ is the coordinator:
- All worker instances connect to the same Redis
- Redis distributes jobs atomically — no double-processing
- Adding a new worker immediately increases throughput
- Removing a worker gracefully drains its jobs

---

## Queue Monitoring & Visibility

### API endpoints for queue stats

```
GET /api/v1/queue/stats
```

Returns:
```json
{
  "queues": {
    "qa:high":    { "waiting": 0, "active": 3, "delayed": 0, "failed": 1 },
    "qa:normal":  { "waiting": 12, "active": 6, "delayed": 0, "failed": 0 },
    "qa:low":     { "waiting": 45, "active": 3, "delayed": 2, "failed": 3 },
    "qa:index":   { "waiting": 1, "active": 0, "delayed": 0, "failed": 0 },
    "qa:reports": { "waiting": 0, "active": 2, "delayed": 0, "failed": 0 }
  },
  "workers": {
    "total": 3,
    "activeRuns": 12,
    "capacity": 9
  },
  "estimatedWaitTime": {
    "qa:high": "0s",
    "qa:normal": "~45s",
    "qa:low": "~3m"
  }
}
```

### Platform Admin — Queue dashboard

```
┌──────────────────────────────────────────────────────────────────────┐
│  Platform Admin → Queue Monitor                                       │
│  ─────────────────────────────────────────────────────────────────   │
│                                                                       │
│  Workers: 3 active · 12/9 concurrent runs (9 capacity)               │
│                                                                       │
│  ┌──────────────┬──────────┬────────┬──────────┬──────────────────┐  │
│  │ Queue        │ Waiting  │ Active │ Failed   │ Est. wait        │  │
│  ├──────────────┼──────────┼────────┼──────────┼──────────────────┤  │
│  │ High (manual)│ 0        │ 3      │ 1        │ immediate        │  │
│  │ Normal (API) │ 12       │ 6      │ 0        │ ~45s             │  │
│  │ Low (sched.) │ 45       │ 3      │ 3        │ ~3m              │  │
│  │ Indexing     │ 1        │ 0      │ 0        │ ~20s             │  │
│  │ Reports      │ 0        │ 2      │ 0        │ immediate        │  │
│  └──────────────┴──────────┴────────┴──────────┴──────────────────┘  │
│                                                                       │
│  Active Runs                                                          │
│  Acme Corp    Login Flow (v2.0)    Worker #1   00:42   [View]        │
│  Acme Corp    Checkout (v1.1)      Worker #1   01:15   [View]        │
│  Globex Inc   API Suite            Worker #2   00:08   [View]        │
│  ...                                                                  │
│                                                                       │
│  [ Retry All Failed ]   [ Drain Queue ]   [ Pause All Workers ]      │
└──────────────────────────────────────────────────────────────────────┘
```

### User-facing queue position

When a user triggers a run and the queue is busy, they see an estimated wait:

```
┌─────────────────────────────────────────────────────┐
│  ⏳ Run queued                                       │
│  Position in queue: 4th                             │
│  Estimated start: ~45 seconds                       │
│                                                     │
│  We'll notify you when the run starts.              │
└─────────────────────────────────────────────────────┘
```

This updates via WebSocket as runs ahead complete.

---

## Run Isolation — What Cannot Leak Between Concurrent Runs

| Resource | Isolation mechanism |
|----------|-------------------|
| Cookies / session | Separate browser context — completely isolated |
| localStorage / IndexedDB | Separate browser context — completely isolated |
| Network requests | Separate browser context — separate network stack |
| Files / artifacts | Each run writes to `artifacts/{runId}/` — no shared path |
| DB records | All writes scoped to `runId` — no cross-run queries |
| CDP sessions | Each context has its own CDP session |
| Environment variables | Resolved per-run from the selected Environment record |
| Redis keys | All run-related keys namespaced: `run:{runId}:*` |
| Screencast | Published to `screencast:{featureRunId}` — unique per run |

---

## Configuration Reference

```bash
# ── Worker Scaling ─────────────────────────────────────────────
WORKER_CONCURRENCY=3          # concurrent runs per worker instance
WORKER_REPLICAS=1             # set via docker-compose --scale, not env var

# ── Per-Org Limits ─────────────────────────────────────────────
ORG_MAX_CONCURRENT_RUNS=5     # max active runs per org at once

# ── Timeouts ───────────────────────────────────────────────────
RUN_TIMEOUT_MS=600000         # 10 min per-run wall-clock timeout
STEP_TIMEOUT_MS=30000         # 30s per-step Playwright timeout
JOB_TIMEOUT_MS=900000         # 15 min BullMQ hard kill

# ── Queue Behaviour ────────────────────────────────────────────
BULLMQ_STALLED_INTERVAL=30000 # check for stalled jobs every 30s
BULLMQ_MAX_STALLED_COUNT=1    # retry once, then mark failed

# ── Screencast (from LIVE_TEST_VIEWER.md) ─────────────────────
SCREENCAST_ENABLED=true
SCREENCAST_QUALITY=80
SCREENCAST_MAX_WIDTH=1280
SCREENCAST_MAX_HEIGHT=800
```

---

## What Happens Under Each Scenario

### Scenario A — Small team, light load
3 users trigger runs simultaneously on a single worker with `WORKER_CONCURRENCY=3`.

```
Worker #1:  [run A] [run B] [run C]  ← all start immediately
Queue:      empty
```
All users see their run start within 2s. No queueing.

---

### Scenario B — Busy period, queue forms
8 manual runs triggered in quick succession, 1 worker, concurrency 3.

```
Worker #1:  [run A] [run B] [run C]  ← running
Queue high: [run D] [run E] [run F] [run G] [run H]  ← waiting
```

User sees "Position 1 · ~30s" for run D. As each run completes, the next
queues immediately. Scheduled runs stay in `qa:low` and never jump ahead
of manual runs.

---

### Scenario C — Large org floods the queue
Org "Acme" has 50 scheduled tests. They all fire at once. `ORG_MAX_CONCURRENT_RUNS=5`.

```
Worker #1 (concurrency 3):
  [Acme run 1] [Acme run 2] [Acme run 3]

Worker #2 (concurrency 3):
  [Acme run 4] [Acme run 5] [Globex run X]  ← Globex's run not blocked
```

Acme's remaining 45 scheduled runs wait in the queue, but other orgs
(Globex, Initech) can still get their runs scheduled on available worker slots.

---

### Scenario D — Worker OOM crash
Worker #2 runs out of memory mid-run.

```
Docker kills worker #2 container
BullMQ stalledInterval fires (30s)
Stalled jobs detected: run C, run D
Jobs moved back to qa:normal queue
Worker #1 and #3 pick them up within seconds
Run C and D restart from the beginning
Users notified via WebSocket: "Run restarted"
```

No data loss. The `TestRun` record is reset to `PENDING` before retry.

---

### Scenario E — Rolling deploy
New worker image deployed.

```
Old worker #1 receives SIGTERM
→ stops accepting new jobs
→ waits for run A, run B to complete (up to 30s)
→ closes browser, exits cleanly

New worker #1 starts
→ connects to Redis
→ immediately starts picking up queued jobs
```

Zero downtime for runs that aren't in-flight. In-flight runs complete on
the old worker before it exits.

---

## Summary — What The Platform Does Automatically

| Situation | What happens automatically |
|-----------|--------------------------|
| Queue builds up | Jobs wait in priority order; users see position + estimate |
| One org over-uses capacity | Per-org limiter defers their excess jobs; other orgs unaffected |
| Worker OOM crash | BullMQ detects stalled jobs, moves back to queue, another worker picks up |
| Runaway test (hung page) | Step timeout (30s) + run timeout (10m) + BullMQ job timeout (15m) kills it |
| Multiple users watch same run | Single Redis subscription, Socket.io fans out to all browser tabs |
| Scale up needed | `docker-compose up --scale worker=5` — no config, no code change |
| Rolling deploy | Graceful drain: old worker finishes current jobs before exit |
| Scheduled run during busy period | Queued in `qa:low`; manual runs always served first |
