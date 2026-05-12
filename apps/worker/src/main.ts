import 'dotenv/config';
import * as http from 'http';
import { chromium } from 'playwright';
import { createWorker } from './queue/run.worker';
import { createReportPdfWorker } from './queue/report-pdf.worker';
import { ProcessReaper } from './services/process.reaper';

const HEALTH_PORT = Number(process.env.WORKER_HEALTH_PORT ?? 3003);
const HEALTH_PROBE_TIMEOUT_MS = Number(process.env.WORKER_HEALTH_PROBE_TIMEOUT_MS ?? 8_000);

/**
 * Liveness probe: launches a short-lived headless Chromium and immediately
 * closes it, racing against a deadline. If this fails, an orchestrator
 * (PM2 / docker / k8s) should restart the worker — the most common cause
 * is the Chromium installation getting wedged after long uptime.
 *
 * Cheap (under 2 s on a healthy host) so it can be polled every 30-60 s
 * without affecting throughput.
 */
async function healthProbe(): Promise<{ ok: boolean; reason?: string; ms: number }> {
  const t0 = Date.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      (async () => {
        const browser = await chromium.launch({ headless: true });
        await browser.close();
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('health probe timeout')), HEALTH_PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, ms: Date.now() - t0 };
  } catch (err) {
    return { ok: false, reason: (err as Error)?.message ?? 'unknown', ms: Date.now() - t0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function startHealthServer(reaper: ProcessReaper): http.Server {
  const server = http.createServer(async (req, res) => {
    if (req.url === '/health') {
      // Liveness — process is up and Chromium can start. Returns 503 if the
      // probe fails so the orchestrator can recycle the pod.
      const probe = await healthProbe();
      res.writeHead(probe.ok ? 200 : 503, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(probe));
    } else if (req.url === '/ready') {
      // Readiness — bare ack that the HTTP server is up. Used by load
      // balancers that don't want to pay the launch cost on every check.
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ready: true }));
    } else if (req.url === '/reap') {
      // Manual reaper trigger — handy for debugging without waiting an hour.
      const result = await reaper.tick();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(HEALTH_PORT, () => {
    console.log(`[Worker] Health server on :${HEALTH_PORT} (GET /health, /ready, /reap)`);
  });
  return server;
}

async function bootstrap() {
  console.log('[Worker] Starting QA test execution worker...');

  const reaper = new ProcessReaper();
  reaper.start();

  const healthServer = startHealthServer(reaper);

  const runWorker = createWorker();
  runWorker.on('ready', () => console.log('[Worker] Connected to Redis — run queue ready'));
  runWorker.on('active', (job) => console.log(`[Worker] Job ${job.id} started — run: ${job.data.runId}`));
  runWorker.on('completed', (job) => console.log(`[Worker] Job ${job.id} completed`));
  runWorker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed: ${err.message}`));

  const reportPdfWorker = createReportPdfWorker();
  reportPdfWorker.on('ready', () => console.log('[Worker] Connected to Redis — report PDF queue ready'));
  reportPdfWorker.on('active', (job) => console.log(`[Worker] Job ${job.id} started — report: ${job.data.reportId}`));
  reportPdfWorker.on('completed', (job) => console.log(`[Worker] Job ${job.id} completed`));
  reportPdfWorker.on('failed', (job, err) => console.error(`[Worker] Job ${job?.id} failed: ${err.message}`));

  // Last-resort safety nets so an unhandled error in a step or socket handler
  // never takes the whole worker down. Crashed workers strand all in-flight
  // runs and degrade the user experience for every QA engineer connected.
  process.on('uncaughtException', (err) => {
    console.error('[Worker] uncaughtException:', err?.message ?? err, err?.stack);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Worker] unhandledRejection:', (reason as Error)?.message ?? reason);
  });

  // Graceful shutdown: stop accepting new jobs, let active ones finish,
  // then close everything. SIGTERM is what Docker/PM2 send first.
  const shutdown = async (signal: string) => {
    console.log(`[Worker] ${signal} received — shutting down`);
    reaper.stop();
    healthServer.close();
    await Promise.all([
      runWorker.close(),
      reportPdfWorker.close(),
    ]);
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => { console.error('[Worker] Fatal:', err); process.exit(1); });
