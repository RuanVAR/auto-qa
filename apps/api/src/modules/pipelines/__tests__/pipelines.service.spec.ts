import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PipelinesService } from '../pipelines.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { FeatureRunsService } from '../../feature-runs/feature-runs.service';
import { RunsGateway } from '../../websocket/runs.gateway';

const automatableTest = { type: 'UI', steps: [{ index: 0, type: 'NAVIGATE' }], config: {} };

const stage = (order: number, over: Partial<Record<string, unknown>> = {}) => ({
  order,
  featureId: `feat-${order}`,
  environmentId: 'env-1',
  onFailure: 'HALT',
  featureName: `Feature ${order}`,
  envName: 'Staging',
  ...over,
});

const basePipeline = {
  id: 'pipe-1',
  projectId: 'proj-1',
  name: 'Release regression',
  updatesFeatureStatus: false,
  stages: [
    { order: 0, featureId: 'feat-0', environmentId: 'env-1', onFailure: 'HALT', feature: { id: 'feat-0', name: 'Feature 0' }, environment: { id: 'env-1', name: 'Staging' } },
    { order: 1, featureId: 'feat-1', environmentId: 'env-1', onFailure: 'HALT', feature: { id: 'feat-1', name: 'Feature 1' }, environment: { id: 'env-1', name: 'Staging' } },
  ],
};

const runningRun = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 'prun-1',
  pipelineId: 'pipe-1',
  status: 'RUNNING',
  trigger: 'api',
  stagesSnapshot: [stage(0), stage(1)],
  currentStageOrder: 0,
  stageResults: [],
  startedAt: new Date(),
  completedAt: null,
  createdById: 'user-1',
  pipeline: { id: 'pipe-1', name: 'Release regression', projectId: 'proj-1', updatesFeatureStatus: false },
  featureRuns: [],
  ...over,
});

const mockPrisma = {
  pipeline: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() },
  pipelineStage: { deleteMany: jest.fn(), createMany: jest.fn() },
  pipelineRun: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), update: jest.fn(), updateMany: jest.fn() },
  featureRun: { findUnique: jest.fn(), findFirst: jest.fn() },
  feature: { findMany: jest.fn() },
  environment: { findMany: jest.fn() },
  $transaction: jest.fn(),
};

const mockFeatureRuns = { start: jest.fn(), stop: jest.fn() };
const mockGateway = { emitPipelineRunUpdated: jest.fn() };

describe('PipelinesService', () => {
  let service: PipelinesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Default $transaction: run the callback against the same mock client.
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => unknown) => fn(mockPrisma));
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PipelinesService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeatureRunsService, useValue: mockFeatureRuns },
        { provide: RunsGateway, useValue: mockGateway },
      ],
    }).compile();
    service = module.get(PipelinesService);
  });

  // ─── Validation matrix ─────────────────────────────────────────────

  describe('create validation', () => {
    const validTargets = () => {
      mockPrisma.feature.findMany.mockResolvedValue([
        { id: 'feat-0', testDefinitions: [automatableTest] },
        { id: 'feat-1', testDefinitions: [automatableTest] },
      ]);
      mockPrisma.environment.findMany.mockResolvedValue([{ id: 'env-1', supportsAutomation: true }]);
    };

    it('rejects zero stages', async () => {
      await expect(service.create('proj-1', 'user-1', { name: 'p', stages: [] }))
        .rejects.toThrow('at least one stage');
    });

    it('rejects more than 20 stages', async () => {
      const stages = Array.from({ length: 21 }, (_, i) => ({ featureId: `f${i}`, environmentId: 'env-1' }));
      await expect(service.create('proj-1', 'user-1', { name: 'p', stages }))
        .rejects.toThrow('at most 20');
    });

    it('rejects an empty name', async () => {
      await expect(service.create('proj-1', 'user-1', { name: '   ', stages: [{ featureId: 'f', environmentId: 'e' }] }))
        .rejects.toThrow('name is required');
    });

    it('reports ALL invalid stages in one error, not just the first', async () => {
      mockPrisma.feature.findMany.mockResolvedValue([
        // feat-0 exists but has no automatable test; feat-1 missing entirely
        { id: 'feat-0', testDefinitions: [{ type: 'UI', steps: [], config: {} }] },
      ]);
      mockPrisma.environment.findMany.mockResolvedValue([{ id: 'env-1', supportsAutomation: false }]);
      const err = await service.create('proj-1', 'user-1', {
        name: 'p',
        stages: [
          { featureId: 'feat-0', environmentId: 'env-1' },
          { featureId: 'feat-1', environmentId: 'env-1' },
        ],
      }).catch((e: BadRequestException) => e);
      const msg = (err as Error).message;
      expect(msg).toContain('Stage 1: feature has no automatable test');
      expect(msg).toContain('Stage 1: environment is not automation-enabled');
      expect(msg).toContain('Stage 2: feature not found');
    });

    it('normalizes stage order from array position', async () => {
      validTargets();
      mockPrisma.pipeline.create.mockResolvedValue({ id: 'pipe-1' });
      await service.create('proj-1', 'user-1', {
        name: 'p',
        stages: [
          { featureId: 'feat-1', environmentId: 'env-1' },
          { featureId: 'feat-0', environmentId: 'env-1' },
        ],
      });
      const created = mockPrisma.pipeline.create.mock.calls[0][0].data.stages.create;
      expect(created.map((s: { order: number; featureId: string }) => [s.order, s.featureId]))
        .toEqual([[0, 'feat-1'], [1, 'feat-0']]);
    });

    it('maps duplicate-name P2002 to a 409', async () => {
      validTargets();
      const p2002 = Object.assign(new Error('unique'), { code: 'P2002', clientVersion: 'x' });
      Object.setPrototypeOf(p2002, (await import('@prisma/client')).Prisma.PrismaClientKnownRequestError.prototype);
      mockPrisma.pipeline.create.mockRejectedValue(p2002);
      await expect(service.create('proj-1', 'user-1', { name: 'dup', stages: [{ featureId: 'feat-0', environmentId: 'env-1' }] }))
        .rejects.toThrow(ConflictException);
    });
  });

  // ─── Trigger ───────────────────────────────────────────────────────

  describe('trigger', () => {
    beforeEach(() => {
      mockPrisma.pipeline.findUnique.mockResolvedValue(basePipeline);
      mockPrisma.feature.findMany.mockResolvedValue([
        { id: 'feat-0', testDefinitions: [automatableTest] },
        { id: 'feat-1', testDefinitions: [automatableTest] },
      ]);
      mockPrisma.environment.findMany.mockResolvedValue([{ id: 'env-1', supportsAutomation: true }]);
    });

    it('409s when a run is already RUNNING', async () => {
      mockPrisma.pipelineRun.findFirst.mockResolvedValue({ id: 'prun-existing' });
      await expect(service.trigger('pipe-1', 'user-1', 'api')).rejects.toThrow(ConflictException);
    });

    it('creates a run with the stages snapshot and starts stage 0', async () => {
      mockPrisma.pipelineRun.findFirst.mockResolvedValue(null);
      mockPrisma.pipelineRun.create.mockResolvedValue(runningRun());
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockFeatureRuns.start.mockResolvedValue({ featureRun: { id: 'fr-0' } });

      await service.trigger('pipe-1', 'user-1', 'ci');

      const created = mockPrisma.pipelineRun.create.mock.calls[0][0].data;
      expect(created.trigger).toBe('ci');
      expect(created.stagesSnapshot).toHaveLength(2);
      expect(created.stagesSnapshot[0]).toMatchObject({ order: 0, featureId: 'feat-0', featureName: 'Feature 0' });
      // stage 0 started with the internal back-link + isolation flag
      expect(mockFeatureRuns.start).toHaveBeenCalledWith(
        'feat-0',
        { runMode: 'AUTOMATED', environmentId: 'env-1', trigger: 'pipeline' },
        'user-1',
        { pipelineRunId: 'prun-1', pipelineExcludesFromCanonical: true },
      );
    });

    it('re-validates rotted definitions at trigger time', async () => {
      mockPrisma.environment.findMany.mockResolvedValue([]); // env deactivated since creation
      await expect(service.trigger('pipe-1', 'user-1', 'api'))
        .rejects.toThrow('environment not found or inactive');
    });
  });

  // ─── Advance idempotency + policy ──────────────────────────────────

  describe('onFeatureRunMaybeTerminal', () => {
    const terminalFeatureRun = (over: Partial<Record<string, unknown>> = {}) => ({
      id: 'fr-0',
      status: 'COMPLETE',
      pipelineRunId: 'prun-1',
      testRuns: [{ status: 'PASSED' }, { status: 'PASSED' }],
      ...over,
    });

    it('no-ops for non-pipeline runs', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(terminalFeatureRun({ pipelineRunId: null }));
      await service.onFeatureRunMaybeTerminal('fr-0');
      expect(mockPrisma.pipelineRun.updateMany).not.toHaveBeenCalled();
    });

    it('no-ops while the feature run is still RUNNING', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(terminalFeatureRun({ status: 'RUNNING' }));
      await service.onFeatureRunMaybeTerminal('fr-0');
      expect(mockPrisma.pipelineRun.updateMany).not.toHaveBeenCalled();
    });

    it('advances exactly once — the losing racer matches 0 rows and stops', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(terminalFeatureRun());
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 0 }); // claim lost
      await service.onFeatureRunMaybeTerminal('fr-0');
      // No result recorded, no next stage started
      expect(mockPrisma.pipelineRun.update).not.toHaveBeenCalled();
      expect(mockFeatureRuns.start).not.toHaveBeenCalled();
    });

    it('passing stage → records PASSED and starts the next stage', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(terminalFeatureRun());
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 }); // claim won
      mockPrisma.pipelineRun.update.mockResolvedValue({});
      mockFeatureRuns.start.mockResolvedValue({ featureRun: { id: 'fr-1' } });

      await service.onFeatureRunMaybeTerminal('fr-0');

      const recorded = mockPrisma.pipelineRun.update.mock.calls[0][0].data.stageResults;
      expect(recorded[0]).toMatchObject({ order: 0, status: 'PASSED', passed: 2, failed: 0 });
      expect(mockFeatureRuns.start).toHaveBeenCalledWith(
        'feat-1', expect.anything(), expect.anything(), expect.objectContaining({ pipelineRunId: 'prun-1' }),
      );
    });

    it('HALT policy: failing stage skips the rest and the run FAILS', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(
        terminalFeatureRun({ testRuns: [{ status: 'PASSED' }, { status: 'FAILED' }] }),
      );
      // Stateful mock: findUnique reflects stageResults accumulated by
      // update() so finalize() sees the FAILED/SKIPPED results — as the real
      // DB would.
      let results: unknown[] = [];
      mockPrisma.pipelineRun.findUnique.mockImplementation(async () => runningRun({ stageResults: results }));
      mockPrisma.pipelineRun.update.mockImplementation(async (args: { data?: { stageResults?: unknown[] } }) => {
        if (args.data?.stageResults) results = args.data.stageResults;
        return {};
      });
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });

      await service.onFeatureRunMaybeTerminal('fr-0');

      // Never starts stage 1
      expect(mockFeatureRuns.start).not.toHaveBeenCalled();
      // Stage 1 recorded as SKIPPED in one of the stageResults writes
      const writes = mockPrisma.pipelineRun.update.mock.calls.map(c => c[0].data);
      const skipped = writes.flatMap(w => (w.stageResults as Array<{ order: number; status: string }> | undefined) ?? []);
      expect(skipped.some(r => r.order === 1 && r.status === 'SKIPPED')).toBe(true);
      // Finalized as FAILED
      const finalizes = mockPrisma.pipelineRun.updateMany.mock.calls.map(c => c[0]);
      expect(finalizes.some(f => f.data?.status === 'FAILED')).toBe(true);
    });

    it('CONTINUE policy: failing stage still advances to the next', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue(
        terminalFeatureRun({ testRuns: [{ status: 'FAILED' }] }),
      );
      const run = runningRun({ stagesSnapshot: [stage(0, { onFailure: 'CONTINUE' }), stage(1)] });
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(run);
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.pipelineRun.update.mockResolvedValue({});
      mockFeatureRuns.start.mockResolvedValue({ featureRun: { id: 'fr-1' } });

      await service.onFeatureRunMaybeTerminal('fr-0');

      expect(mockFeatureRuns.start).toHaveBeenCalledWith('feat-1', expect.anything(), expect.anything(), expect.anything());
    });
  });

  // ─── Stop cascade ──────────────────────────────────────────────────

  describe('stop', () => {
    it('409s on an already-terminal run', async () => {
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun({ status: 'COMPLETE' }));
      await expect(service.stop('prun-1')).rejects.toThrow(ConflictException);
    });

    it('cancels the run, stops the current feature run, skips the rest', async () => {
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.pipelineRun.update.mockResolvedValue({});
      mockPrisma.featureRun.findFirst.mockResolvedValue({ id: 'fr-0' });
      mockFeatureRuns.stop.mockResolvedValue({});

      await service.stop('prun-1');

      expect(mockPrisma.pipelineRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'CANCELLED' }) }),
      );
      expect(mockFeatureRuns.stop).toHaveBeenCalledWith('fr-0');
      const writes = mockPrisma.pipelineRun.update.mock.calls.map(c => c[0].data);
      const results = writes.flatMap(w => (w.stageResults as Array<{ order: number; status: string }> | undefined) ?? []);
      expect(results.some(r => r.order === 1 && r.status === 'SKIPPED')).toBe(true);
    });

    it('a dead browser on the current run does not break the cascade', async () => {
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.pipelineRun.update.mockResolvedValue({});
      mockPrisma.featureRun.findFirst.mockResolvedValue({ id: 'fr-0' });
      mockFeatureRuns.stop.mockRejectedValue(new Error('already terminal'));

      await expect(service.stop('prun-1')).resolves.toBeUndefined();
    });
  });

  // ─── Delete guard ──────────────────────────────────────────────────

  describe('remove', () => {
    it('blocks deletion while a run is active', async () => {
      mockPrisma.pipeline.findUnique.mockResolvedValue(basePipeline);
      mockPrisma.pipelineRun.findFirst.mockResolvedValue({ id: 'prun-live' });
      await expect(service.remove('pipe-1')).rejects.toThrow(ConflictException);
    });

    it('404s for an unknown pipeline', async () => {
      mockPrisma.pipeline.findUnique.mockResolvedValue(null);
      await expect(service.remove('nope')).rejects.toThrow(NotFoundException);
    });
  });

  // ─── Severed-advance recovery ──────────────────────────────────────

  describe('advance recovery', () => {
    const TEN_MIN_AGO = new Date(Date.now() - 10 * 60 * 1000);

    it('a FeatureRun already in stageResults is never re-processed', async () => {
      mockPrisma.featureRun.findUnique.mockResolvedValue({
        id: 'fr-0', status: 'COMPLETE', pipelineRunId: 'prun-1', testRuns: [{ status: 'PASSED' }],
      });
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun({
        currentStageOrder: 1,
        stageResults: [{ order: 0, featureRunId: 'fr-0', status: 'PASSED', passed: 1, failed: 0 }],
      }));
      await service.onFeatureRunMaybeTerminal('fr-0');
      expect(mockPrisma.pipelineRun.updateMany).not.toHaveBeenCalled();
      expect(mockFeatureRuns.start).not.toHaveBeenCalled();
    });

    it('a stage that fails to start claims currentStageOrder before applying policy', async () => {
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(
        runningRun({ stagesSnapshot: [stage(0, { onFailure: 'CONTINUE' }), stage(1)] }),
      );
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.pipelineRun.update.mockResolvedValue({});
      mockFeatureRuns.start
        .mockRejectedValueOnce(new Error('environment unreachable'))
        .mockResolvedValueOnce({ featureRun: { id: 'fr-1' } });

      await (service as unknown as { startStage(id: string, order: number): Promise<void> })
        .startStage('prun-1', 0);

      expect(mockPrisma.pipelineRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ currentStageOrder: 0 }),
        data: { currentStageOrder: 1 },
      }));
      // CONTINUE → stage 1 started exactly once
      expect(mockFeatureRuns.start).toHaveBeenCalledTimes(2);
      expect(mockFeatureRuns.start).toHaveBeenLastCalledWith(
        'feat-1', expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('tick resumes a run severed before stage 0 ever started', async () => {
      mockPrisma.pipelineRun.findMany.mockResolvedValue([{
        id: 'prun-1', startedAt: TEN_MIN_AGO, currentStageOrder: 0,
        stageResults: [], stagesSnapshot: [stage(0), stage(1)],
      }]);
      mockPrisma.featureRun.findFirst.mockResolvedValue(null);
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(runningRun());
      mockFeatureRuns.start.mockResolvedValue({ featureRun: { id: 'fr-0' } });

      await service.tick();

      expect(mockFeatureRuns.start).toHaveBeenCalledWith(
        'feat-0', expect.anything(), expect.anything(),
        expect.objectContaining({ pipelineRunId: 'prun-1' }),
      );
    });

    it('tick resumes a run severed between the claim and starting the next stage', async () => {
      const res0 = { order: 0, featureRunId: 'fr-0', status: 'PASSED', passed: 2, failed: 0 };
      mockPrisma.pipelineRun.findMany.mockResolvedValue([{
        id: 'prun-1', startedAt: TEN_MIN_AGO, currentStageOrder: 1,
        stageResults: [res0], stagesSnapshot: [stage(0), stage(1)],
      }]);
      // Latest FeatureRun is terminal AND already recorded → not the lost-signal case.
      mockPrisma.featureRun.findFirst.mockResolvedValue({ id: 'fr-0', status: 'COMPLETE', updatedAt: TEN_MIN_AGO });
      mockPrisma.pipelineRun.findUnique.mockResolvedValue(
        runningRun({ currentStageOrder: 1, stageResults: [res0] }),
      );
      mockFeatureRuns.start.mockResolvedValue({ featureRun: { id: 'fr-1' } });

      await service.tick();

      expect(mockPrisma.featureRun.findUnique).not.toHaveBeenCalled(); // no re-process of fr-0
      expect(mockFeatureRuns.start).toHaveBeenCalledWith(
        'feat-1', expect.anything(), expect.anything(), expect.anything(),
      );
    });

    it('tick resume honors a severed HALT: skips the rest, never starts the next stage', async () => {
      const res0 = { order: 0, featureRunId: 'fr-0', status: 'FAILED', passed: 1, failed: 1 };
      let results: unknown[] = [res0];
      mockPrisma.pipelineRun.findMany.mockResolvedValue([{
        id: 'prun-1', startedAt: TEN_MIN_AGO, currentStageOrder: 1,
        stageResults: [res0], stagesSnapshot: [stage(0), stage(1)],
      }]);
      mockPrisma.featureRun.findFirst.mockResolvedValue({ id: 'fr-0', status: 'COMPLETE', updatedAt: TEN_MIN_AGO });
      mockPrisma.pipelineRun.findUnique.mockImplementation(async () =>
        runningRun({ currentStageOrder: 1, stageResults: results }));
      mockPrisma.pipelineRun.update.mockImplementation(async (args: { data?: { stageResults?: unknown[] } }) => {
        if (args.data?.stageResults) results = args.data.stageResults;
        return {};
      });
      mockPrisma.pipelineRun.updateMany.mockResolvedValue({ count: 1 });

      await service.tick();

      expect(mockFeatureRuns.start).not.toHaveBeenCalled();
      expect(results.some(r => (r as { order: number; status: string }).order === 1
        && (r as { order: number; status: string }).status === 'SKIPPED')).toBe(true);
      const finalizes = mockPrisma.pipelineRun.updateMany.mock.calls.map(c => c[0]);
      expect(finalizes.some(f => f.data?.status === 'FAILED')).toBe(true);
    });

    it('tick leaves a freshly-triggered run alone (resume grace)', async () => {
      mockPrisma.pipelineRun.findMany.mockResolvedValue([{
        id: 'prun-1', startedAt: new Date(), currentStageOrder: 0,
        stageResults: [], stagesSnapshot: [stage(0), stage(1)],
      }]);
      mockPrisma.featureRun.findFirst.mockResolvedValue(null);

      await service.tick();

      expect(mockFeatureRuns.start).not.toHaveBeenCalled();
      expect(mockPrisma.pipelineRun.updateMany).not.toHaveBeenCalled();
    });
  });
});
