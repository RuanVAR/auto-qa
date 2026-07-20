import { Test, TestingModule } from '@nestjs/testing';
import { FeatureRunsService, DEFAULT_FEATURE_CONCURRENCY } from '../feature-runs.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { RunsGateway } from '../../websocket/runs.gateway';
import { NotificationsService } from '../../notifications/notifications.service';
import { WorkSessionsService } from '../../work-sessions/work-sessions.service';
import { SignoffService } from '../../signoff/signoff.service';
import { FeatureVersionsService } from '../../feature-versions/feature-versions.service';

/**
 * Phase 4.1 (docs/plan/06-PHASE-4-SCALE.md §4.1) — the windowed fan-out
 * replacing the old single-pointer enqueue. Scoped to onRunComplete() and
 * resume(), which have simple mockable Prisma shapes; start()'s full
 * transactional path is exercised live on the dev stack instead, per the
 * project convention that races/transactions aren't mocked-Prisma testable.
 */

const run = (id: string, status: string) => ({ id, status });

const mockPrisma = {
  testRun: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn() },
  featureRun: { findUnique: jest.fn(), update: jest.fn() },
  testRunSession: { updateMany: jest.fn() },
};
const mockQueue = { enqueueRun: jest.fn() };
const mockGateway = { emitFeatureRunUpdated: jest.fn() };
const mockNotifications = {};
const mockWorkSessions = {};
const mockSignoff = { requestSignoff: jest.fn().mockResolvedValue(undefined) };
const mockFeatureVersions = {};

describe('FeatureRunsService — Phase 4.1 windowed fan-out', () => {
  let service: FeatureRunsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeatureRunsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QueueService, useValue: mockQueue },
        { provide: RunsGateway, useValue: mockGateway },
        { provide: NotificationsService, useValue: mockNotifications },
        { provide: WorkSessionsService, useValue: mockWorkSessions },
        { provide: SignoffService, useValue: mockSignoff },
        { provide: FeatureVersionsService, useValue: mockFeatureVersions },
      ],
    }).compile();
    service = module.get(FeatureRunsService);
  });

  describe('onRunComplete', () => {
    const baseFeatureRun = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'fr-1',
      featureId: 'feat-1',
      status: 'RUNNING',
      concurrency: 3,
      environmentId: 'env-1',
      pipelineRunId: null,
      ...overrides,
    });

    it('tops up the window to the full concurrency budget, not just one test', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'PASSED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun(),
        testRuns: [
          run('t1', 'PASSED'), // the one that just completed
          run('t2', 'PENDING'),
          run('t3', 'PENDING'),
          run('t4', 'PENDING'),
          run('t5', 'PENDING'),
        ],
      });

      await service.onRunComplete('t1');

      // concurrency=3, 0 currently in-flight (QUEUED/RUNNING) → top up 3 of the 4 pending
      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(3);
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't2' });
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't3' });
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't4' });
    });

    it('enqueues nothing when the window is already full', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'PASSED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ concurrency: 2 }),
        testRuns: [
          run('t1', 'PASSED'),
          run('t2', 'RUNNING'),
          run('t3', 'QUEUED'),
          run('t4', 'PENDING'),
        ],
      });

      await service.onRunComplete('t1');

      // concurrency=2, 2 already in-flight (t2 RUNNING + t3 QUEUED) → no room
      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
    });

    it('tops up only the remaining slots, not the full budget, when some are already in-flight', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ concurrency: 3 }),
        testRuns: [
          run('t1', 'FAILED'),
          run('t2', 'RUNNING'),
          run('t3', 'PENDING'),
          run('t4', 'PENDING'),
        ],
      });

      await service.onRunComplete('t1');

      // concurrency=3, 1 in-flight (t2) → exactly 2 slots, both pending fit
      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(2);
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't3' });
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't4' });
    });

    it('falls back to DEFAULT_FEATURE_CONCURRENCY when concurrency is null', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'PASSED' });
      const pending = Array.from({ length: DEFAULT_FEATURE_CONCURRENCY + 2 }, (_, i) => run(`t${i + 2}`, 'PENDING'));
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ concurrency: null }),
        testRuns: [run('t1', 'PASSED'), ...pending],
      });

      await service.onRunComplete('t1');

      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(DEFAULT_FEATURE_CONCURRENCY);
    });

    it('never enqueues once the feature run is no longer RUNNING (e.g. cancelled mid-flight)', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'PASSED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ status: 'CANCELLED' }),
        testRuns: [run('t1', 'PASSED'), run('t2', 'PENDING')],
      });

      await service.onRunComplete('t1');

      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
    });
  });

  describe('resume', () => {
    it('tops up the window rather than enqueueing a single next run', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'fr-1',
        status: 'PAUSED',
        concurrency: 3,
        testRunSessionId: null,
      } as never);
      mockPrisma.testRun.findMany.mockResolvedValue([
        { id: 't3' }, { id: 't4' }, { id: 't5' },
      ]);
      mockPrisma.testRun.count.mockResolvedValue(1); // one already RUNNING/QUEUED
      mockPrisma.featureRun.update.mockResolvedValue({});

      await service.resume('fr-1');

      // concurrency=3, 1 in-flight → 2 slots, first 2 pending enqueued
      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(2);
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't3' });
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't4' });
      expect(mockQueue.enqueueRun).not.toHaveBeenCalledWith({ runId: 't5' });
    });

    it('enqueues nothing on resume when the window is already full', async () => {
      jest.spyOn(service, 'findOne').mockResolvedValue({
        id: 'fr-1',
        status: 'PAUSED',
        concurrency: 2,
        testRunSessionId: null,
      } as never);
      mockPrisma.testRun.findMany.mockResolvedValue([{ id: 't3' }]);
      mockPrisma.testRun.count.mockResolvedValue(2);
      mockPrisma.featureRun.update.mockResolvedValue({});

      await service.resume('fr-1');

      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
    });
  });
});
