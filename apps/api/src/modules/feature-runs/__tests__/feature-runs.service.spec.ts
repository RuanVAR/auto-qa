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

const run = (id: string, status: string, extra: Partial<Record<string, unknown>> = {}) => ({ id, status, ladderAttempt: 1, passedAtAttempt: null, ...extra });

const mockPrisma = {
  testRun: { findUnique: jest.fn(), findMany: jest.fn(), count: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  featureRun: { findUnique: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  testRunSession: { updateMany: jest.fn() },
  runStep: { deleteMany: jest.fn() },
  $queryRaw: jest.fn().mockResolvedValue([]), // no duration history in these tests → orderByDurationDesc is a no-op
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
    mockPrisma.featureRun.update.mockResolvedValue({ id: 'fr-1', featureId: 'feat-1', status: 'COMPLETE' });
    mockPrisma.featureRun.updateMany.mockResolvedValue({ count: 1 }); // "claim succeeded" by default
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
      retryLadderEnabled: true,
      currentLadderAttempt: 1,
      failFast: false,
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

  describe('onRunComplete — Phase 4.2 retry ladder', () => {
    const baseFeatureRun = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'fr-1',
      featureId: 'feat-1',
      status: 'RUNNING',
      concurrency: 3,
      environmentId: 'env-1',
      pipelineRunId: null,
      retryLadderEnabled: true,
      currentLadderAttempt: 1,
      failFast: false,
      ...overrides,
    });

    it('enters wave 2 when failures exist: resets in place, clears old steps, enqueues the batch', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun(),
        testRuns: [run('t1', 'PASSED'), run('t2', 'FAILED'), run('t3', 'FAILED')],
      });

      await service.onRunComplete('t2');

      expect(mockPrisma.featureRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'fr-1', currentLadderAttempt: 1 },
        data: { currentLadderAttempt: 2 },
      });
      expect(mockPrisma.runStep.deleteMany).toHaveBeenCalledWith({
        where: { runId: { in: ['t2', 't3'] } },
      });
      expect(mockPrisma.testRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t2', 't3'] }, status: { in: ['FAILED', 'ERROR', 'TIMED_OUT'] } },
        data: expect.objectContaining({ status: 'PENDING', ladderAttempt: 2 }),
      });
      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(2);
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't2' });
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't3' });
      // Must NOT finalize while a wave is in flight.
      expect(mockPrisma.featureRun.update).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETE' }) }),
      );
    });

    it('caps wave 2 at a batch of 5 even with more failures', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      const failed = Array.from({ length: 7 }, (_, i) => run(`f${i}`, 'FAILED'));
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun(),
        testRuns: failed,
      });

      await service.onRunComplete('f0');

      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(5);
    });

    it('wave 3 (serial) enqueues at most 1', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ currentLadderAttempt: 2 }),
        testRuns: [run('t1', 'FAILED', { ladderAttempt: 2 }), run('t2', 'FAILED', { ladderAttempt: 2 })],
      });

      await service.onRunComplete('t1');

      expect(mockPrisma.featureRun.updateMany).toHaveBeenCalledWith({
        where: { id: 'fr-1', currentLadderAttempt: 2 },
        data: { currentLadderAttempt: 3 },
      });
      expect(mockQueue.enqueueRun).toHaveBeenCalledTimes(1);
    });

    it('backs off with no side effects when a concurrent call already claimed this wave (the race caught live)', async () => {
      // Two TestRuns in the same FeatureRun completing near-simultaneously
      // both call onRunComplete; both read allDone=true. The SECOND to reach
      // the atomic claim must see 0 rows updated and do nothing further —
      // simulated here by mocking updateMany's count as 0 (another caller won).
      mockPrisma.featureRun.updateMany.mockResolvedValueOnce({ count: 0 });
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun(),
        testRuns: [run('t1', 'PASSED'), run('t2', 'FAILED'), run('t3', 'FAILED')],
      });

      await service.onRunComplete('t2');

      expect(mockPrisma.runStep.deleteMany).not.toHaveBeenCalled();
      expect(mockPrisma.testRun.updateMany).not.toHaveBeenCalled();
      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
      // Must not fall through to finalize either — the surviving caller owns that.
      expect(mockPrisma.featureRun.update).not.toHaveBeenCalled();
    });

    it('does not start a 4th wave — finalizes as COMPLETE after attempt 3 exhausts', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ currentLadderAttempt: 3 }),
        testRuns: [run('t1', 'PASSED', { ladderAttempt: 1, passedAtAttempt: 1 }), run('t2', 'FAILED', { ladderAttempt: 3 })],
      });

      await service.onRunComplete('t2');

      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
      expect(mockPrisma.featureRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETE' }) }),
      );
    });

    it('does not retry when retryLadderEnabled is false — finalizes on the first failure', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ retryLadderEnabled: false }),
        testRuns: [run('t1', 'PASSED', { passedAtAttempt: 1 }), run('t2', 'FAILED')],
      });

      await service.onRunComplete('t2');

      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
      expect(mockPrisma.testRun.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.featureRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETE' }) }),
      );
    });

    it('stamps passedAtAttempt on every unstamped PASSED test when finalizing, attempt-1 included', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'PASSED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun(),
        testRuns: [
          run('t1', 'PASSED', { ladderAttempt: 1, passedAtAttempt: null }),
          run('t2', 'PASSED', { ladderAttempt: 3, passedAtAttempt: null }), // recovered on the serial wave
        ],
      });

      await service.onRunComplete('t1');

      expect(mockPrisma.testRun.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { passedAtAttempt: 1 } });
      expect(mockPrisma.testRun.update).toHaveBeenCalledWith({ where: { id: 't2' }, data: { passedAtAttempt: 3 } });
    });
  });

  describe('onRunComplete — Phase 4.5 fail-fast', () => {
    const baseFeatureRun = (overrides: Partial<Record<string, unknown>> = {}) => ({
      id: 'fr-1',
      featureId: 'feat-1',
      status: 'RUNNING',
      concurrency: 3,
      environmentId: 'env-1',
      pipelineRunId: null,
      retryLadderEnabled: false, // fail-fast is only actionable with the ladder off
      currentLadderAttempt: 1,
      failFast: true,
      ...overrides,
    });

    it('cancels never-attempted PENDING tests (not FAILED) once a failure is final', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      // onRunComplete re-derives state after cancelling (see the fourth test
      // below) — the second read must reflect the now-CANCELLED rows, or a
      // static mock makes it look like nothing changed and it recurses
      // forever trying to cancel the "still pending" rows again.
      mockPrisma.featureRun.findUnique
        .mockResolvedValueOnce({
          ...baseFeatureRun(),
          testRuns: [run('t1', 'FAILED'), run('t2', 'PENDING'), run('t3', 'PENDING')],
        })
        .mockResolvedValueOnce({
          ...baseFeatureRun(),
          testRuns: [run('t1', 'FAILED'), run('t2', 'CANCELLED'), run('t3', 'CANCELLED')],
        });

      await service.onRunComplete('t1');

      expect(mockPrisma.testRun.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ['t2', 't3'] } },
        data: expect.objectContaining({ status: 'CANCELLED' }),
      });
      expect(mockQueue.enqueueRun).not.toHaveBeenCalled();
    });

    it('does not fail-fast while the retry ladder is still enabled — a failure is not final until the whole run has had its first attempt', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ retryLadderEnabled: true }),
        testRuns: [run('t1', 'FAILED'), run('t2', 'PENDING')],
      });

      await service.onRunComplete('t1');

      expect(mockPrisma.testRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
      // Falls through to the normal top-up path instead.
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't2' });
    });

    it('does nothing when failFast is off, even with a final failure and pending tests', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ featureRunId: 'fr-1', status: 'FAILED' });
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        ...baseFeatureRun({ failFast: false }),
        testRuns: [run('t1', 'FAILED'), run('t2', 'PENDING')],
      });

      await service.onRunComplete('t1');

      expect(mockPrisma.testRun.updateMany).not.toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 't2' });
    });

    it('re-checks and finalizes immediately after cancelling if nothing else is in flight', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValueOnce({ featureRunId: 'fr-1', status: 'FAILED' });
      // First read: t1 just failed, t2/t3 still pending, nothing else in flight.
      mockPrisma.featureRun.findUnique.mockResolvedValueOnce({
        ...baseFeatureRun(),
        testRuns: [run('t1', 'FAILED'), run('t2', 'PENDING'), run('t3', 'PENDING')],
      });
      // Second read (the recursive re-entry after cancelling): everything is
      // now terminal (t2/t3 CANCELLED) — must finalize as COMPLETE.
      mockPrisma.featureRun.findUnique.mockResolvedValueOnce({
        ...baseFeatureRun(),
        testRuns: [run('t1', 'FAILED'), run('t2', 'CANCELLED'), run('t3', 'CANCELLED')],
      });

      await service.onRunComplete('t1');

      expect(mockPrisma.featureRun.findUnique).toHaveBeenCalledTimes(2);
      expect(mockPrisma.featureRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'COMPLETE' }) }),
      );
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
