import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  EmbeddingClient,
  GitHubTransport,
  scrubString,
} from '@qa-platform/shared';
import {
  codeIndexConcurrency,
  codeIndexJobsPerMinute,
  loadCodeIndexLimits,
} from './config';
import { RedisProgressPublisher } from './events/progress-publisher';
import { startHealthServer } from './health/server';
import { IndexingService } from './indexing/indexing-service';
import { PrismaIndexStore } from './persistence/index-store';
import { createCodeIndexWorker } from './queue/code-index.worker';

async function bootstrap(): Promise<void> {
  const redisUrl = requiredEnv('REDIS_URL');
  requiredEnv('DATABASE_URL');
  requiredEnv('SECRETS_KEK');

  const limits = loadCodeIndexLimits();
  const prisma = new PrismaClient();
  const publisher = new RedisProgressPublisher(redisUrl);
  await prisma.$connect();
  await publisher.connect();

  const service = new IndexingService({
    store: new PrismaIndexStore(prisma, limits.statementTimeoutMs),
    github: new GitHubTransport(),
    embeddings: new EmbeddingClient(),
    publisher,
    limits,
  });
  let queueReady = false;
  const worker = createCodeIndexWorker(
    redisUrl,
    service,
    codeIndexConcurrency(),
    codeIndexJobsPerMinute(),
  );
  worker.on('ready', () => {
    queueReady = true;
    console.log('[Indexer] Connected to Redis; code-index queue ready');
  });
  worker.on('closing', () => {
    queueReady = false;
  });
  worker.on('active', (job) => {
    console.log(`[Indexer] Job ${job.id} started`);
  });
  worker.on('completed', (job, result) => {
    console.log(`[Indexer] Job ${job.id} completed: ${JSON.stringify(result)}`);
  });
  worker.on('failed', (job, error) => {
    console.error(`[Indexer] Job ${job?.id ?? 'unknown'} failed: ${scrubString(error.message)}`);
  });
  worker.on('error', (error) => {
    console.error(`[Indexer] Queue error: ${scrubString(error.message)}`);
  });

  const port = Number(process.env.INDEXER_HEALTH_PORT ?? 3004);
  const healthServer = startHealthServer(port, {
    workerReady: () => queueReady,
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
    },
    redis: async () => publisher.ping(),
  });
  console.log(`[Indexer] Health server on :${port} (GET /health, /ready)`);
  console.log(`[Indexer] Starting with concurrency ${codeIndexConcurrency()}`);
  console.log(
    `[Indexer] Distributed start limit ${codeIndexJobsPerMinute()} job(s)/minute`,
  );

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    queueReady = false;
    console.log(`[Indexer] ${signal} received; shutting down`);
    await new Promise<void>((resolve) => healthServer.close(() => resolve()));
    await worker.close();
    await publisher.close();
    await prisma.$disconnect();
  };
  process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void shutdown('SIGINT');
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} env var required`);
  return value;
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[Indexer] Fatal: ${scrubString(message)}`);
  process.exitCode = 1;
});
