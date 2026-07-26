import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';
import { PrismaService } from '../../../common/prisma/prisma.service';

const mockBullQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getWaitingCount:   jest.fn().mockResolvedValue(2),
  getActiveCount:    jest.fn().mockResolvedValue(1),
  getCompletedCount: jest.fn().mockResolvedValue(50),
  getFailedCount:    jest.fn().mockResolvedValue(3),
};

// Second queue added when the worker took on report-PDF rendering. Tests
// here exercise the run queue only; this stub just keeps DI happy.
const mockReportPdfQueue = {
  add: jest.fn().mockResolvedValue({ id: 'pdf-1' }),
};

const mockCodeIndexQueue = {
  add: jest.fn().mockResolvedValue({ id: 'code-index:index-1:3' }),
};

const mockPrisma = {
  testRun: {
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    findUnique: jest.fn().mockResolvedValue({ ladderAttempt: 1 }),
  },
};

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.testRun.findUnique.mockResolvedValue({ ladderAttempt: 1 });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QUEUE_NAMES.TEST_RUN, useValue: mockBullQueue },
        { provide: QUEUE_NAMES.REPORT_PDF, useValue: mockReportPdfQueue },
        { provide: QUEUE_NAMES.CODE_INDEX, useValue: mockCodeIndexQueue },
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get<QueueService>(QueueService);
  });

  describe('enqueueCodeIndex', () => {
    it('uses the generation-scoped idempotency key required by the indexer', async () => {
      const data = {
        branchIndexId: 'index-1',
        generation: 3,
        force: true,
        requestedById: 'user-1',
        trigger: 'MANUAL' as const,
      };

      await service.enqueueCodeIndex(data);

      expect(mockCodeIndexQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.CODE_INDEX,
        data,
        { jobId: 'code-index:index-1:3' },
      );
    });
  });

  describe('enqueueRun', () => {
    it('calls queue.add with correct job name and payload', async () => {
      await service.enqueueRun({ runId: 'run-123' });

      expect(mockBullQueue.add).toHaveBeenCalledTimes(1);
      expect(mockBullQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.EXECUTE_RUN,
        { runId: 'run-123' },
        expect.objectContaining({ jobId: 'run-run-123-attempt-1' }),
      );
    });

    it('scopes the jobId to the current ladder attempt, not just the runId', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValueOnce({ ladderAttempt: 2 });
      await service.enqueueRun({ runId: 'abc' });
      const [, , options] = mockBullQueue.add.mock.calls[0] as [string, unknown, { jobId: string }];
      expect(options.jobId).toBe('run-abc-attempt-2');
    });

    it("a retry-ladder re-enqueue of the same runId gets a DIFFERENT jobId than the completed attempt-1 job, so BullMQ's dedup can never silently swallow it", async () => {
      mockPrisma.testRun.findUnique.mockResolvedValueOnce({ ladderAttempt: 1 });
      await service.enqueueRun({ runId: 'abc' });
      mockPrisma.testRun.findUnique.mockResolvedValueOnce({ ladderAttempt: 2 });
      await service.enqueueRun({ runId: 'abc' });

      const jobIds = mockBullQueue.add.mock.calls.map((c) => (c[2] as { jobId: string }).jobId);
      expect(jobIds).toEqual(['run-abc-attempt-1', 'run-abc-attempt-2']);
      expect(new Set(jobIds).size).toBe(2);
    });

    it('falls back to attempt 1 when the TestRun row is missing (defensive — should not happen in practice)', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValueOnce(null);
      await service.enqueueRun({ runId: 'ghost' });
      const [, , options] = mockBullQueue.add.mock.calls[0] as [string, unknown, { jobId: string }];
      expect(options.jobId).toBe('run-ghost-attempt-1');
    });
  });

  describe('getQueueMetrics', () => {
    it('returns waiting, active, completed, failed counts', async () => {
      const metrics = await service.getQueueMetrics();
      expect(metrics).toEqual({ waiting: 2, active: 1, completed: 50, failed: 3 });
    });

    it('queries all four queue depth methods', async () => {
      await service.getQueueMetrics();
      expect(mockBullQueue.getWaitingCount).toHaveBeenCalled();
      expect(mockBullQueue.getActiveCount).toHaveBeenCalled();
      expect(mockBullQueue.getCompletedCount).toHaveBeenCalled();
      expect(mockBullQueue.getFailedCount).toHaveBeenCalled();
    });
  });
});
