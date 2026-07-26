import {
  CODE_INDEX_JOB,
  CODE_INDEX_QUEUE,
  type CodeIndexJobData,
} from '@qa-platform/shared';
import { Queue, QueueEvents, Worker } from 'bullmq';
import { createCodeIndexWorker } from './code-index.worker';

const runIntegration = process.env.CODE_INDEX_QUEUE_TEST === '1' ? describe : describe.skip;

runIntegration('code-index BullMQ consumer integration', () => {
  const redisUrl = process.env.REDIS_URL ?? '';
  let queue: Queue<CodeIndexJobData>;
  let events: QueueEvents;
  let worker: Worker<CodeIndexJobData>;
  const processJob = jest.fn(async (data: CodeIndexJobData) => ({
    outcome: 'READY',
    generation: data.generation,
  }));

  beforeAll(() => {
    queue = new Queue<CodeIndexJobData>(CODE_INDEX_QUEUE, {
      connection: { url: redisUrl },
    });
    events = new QueueEvents(CODE_INDEX_QUEUE, {
      connection: { url: redisUrl },
    });
    worker = createCodeIndexWorker(redisUrl, { process: processJob }, 1);
  });

  afterAll(async () => {
    await Promise.all([worker.close(), events.close(), queue.close()]);
  });

  it('claims and processes the shared code-index job contract', async () => {
    await events.waitUntilReady();
    await worker.waitUntilReady();
    const data: CodeIndexJobData = {
      branchIndexId: 'queue-index-1',
      generation: 4,
      force: false,
      trigger: 'MANUAL',
      requestedById: 'user-1',
    };
    const queued = await queue.add(CODE_INDEX_JOB, data, {
      jobId: 'code-index:queue-index-1:4',
      removeOnComplete: true,
      removeOnFail: true,
    });

    await expect(queued.waitUntilFinished(events, 10_000)).resolves.toEqual({
      outcome: 'READY',
      generation: 4,
    });
    expect(processJob).toHaveBeenCalledWith(data);
  });
});
