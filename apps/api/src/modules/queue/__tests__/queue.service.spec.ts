import { Test, TestingModule } from '@nestjs/testing';
import { QueueService } from '../queue.service';
import { QUEUE_NAMES, JOB_NAMES } from '../queue.constants';

const mockBullQueue = {
  add: jest.fn().mockResolvedValue({ id: 'job-1' }),
  getWaitingCount:   jest.fn().mockResolvedValue(2),
  getActiveCount:    jest.fn().mockResolvedValue(1),
  getCompletedCount: jest.fn().mockResolvedValue(50),
  getFailedCount:    jest.fn().mockResolvedValue(3),
};

describe('QueueService', () => {
  let service: QueueService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QueueService,
        { provide: QUEUE_NAMES.TEST_RUN, useValue: mockBullQueue },
      ],
    }).compile();
    service = module.get<QueueService>(QueueService);
  });

  describe('enqueueRun', () => {
    it('calls queue.add with correct job name and payload', async () => {
      await service.enqueueRun({ runId: 'run-123' });

      expect(mockBullQueue.add).toHaveBeenCalledTimes(1);
      expect(mockBullQueue.add).toHaveBeenCalledWith(
        JOB_NAMES.EXECUTE_RUN,
        { runId: 'run-123' },
        expect.objectContaining({ jobId: 'run-run-123' }),
      );
    });

    it('uses run-specific jobId to deduplicate', async () => {
      await service.enqueueRun({ runId: 'abc' });
      const [, , options] = mockBullQueue.add.mock.calls[0] as [string, unknown, { jobId: string }];
      expect(options.jobId).toBe('run-abc');
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
