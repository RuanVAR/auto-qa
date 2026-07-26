import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
// Automated runs precheck env reachability — stub it as reachable so unit
// tests don't need a live target.
jest.mock('../../environments/environments.service', () => ({
  ...jest.requireActual('../../environments/environments.service'),
  checkBaseUrlReachable: jest.fn().mockResolvedValue({ reachable: true }),
}));
import { RunsService } from '../runs.service';
import { RunStepsService } from '../runs-steps.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { QueueService } from '../../queue/queue.service';
import { RunsGateway } from '../../websocket/runs.gateway';
import { WorkSessionsService } from '../../work-sessions/work-sessions.service';
import { FeatureRunsService } from '../../feature-runs/feature-runs.service';

const mockRun = {
  id: 'run-1',
  status: 'PENDING',
  trigger: 'manual',
  projectId: 'proj-1',
  environmentId: 'env-1',
  testDefinitionId: 'test-1',
  createdAt: new Date(),
  updatedAt: new Date(),
  startedAt: null,
  completedAt: null,
  duration: null,
  errorMessage: null,
  metadata: null,
  triggeredById: null,
  featureRunId: null,
  featureVersionId: null,
  steps: [],
  artifacts: [],
  aiSummaries: [],
  selectorHeals: [],
  environment: { id: 'env-1', name: 'Staging', type: 'STAGING' },
  testDefinition: { id: 'test-1', name: 'Login test', type: 'UI' },
  featureVersion: null,
};

const mockPrisma = {
  testRun: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
  environmentRelease: { findFirst: jest.fn() },
  testDefinition: { findUnique: jest.fn(), findMany: jest.fn() },
  environment: { findUnique: jest.fn() },
  project: { findUnique: jest.fn() },
  runStep: {
    findFirst: jest.fn(),
    findMany: jest.fn(),
    update: jest.fn(),
    count: jest.fn(),
  },
};

const mockQueue = { enqueueRun: jest.fn() };
const mockGateway = { emitRunUpdated: jest.fn(), emitStepCompleted: jest.fn(), emitStepFailed: jest.fn(), emitFeatureRunUpdated: jest.fn() };
const mockWorkSessions = { attachToSession: jest.fn() };
const mockFeatureRunsService = { onRunComplete: jest.fn() };

describe('RunsService', () => {
  let service: RunsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: QueueService, useValue: mockQueue },
        { provide: RunsGateway, useValue: mockGateway },
        { provide: WorkSessionsService, useValue: mockWorkSessions },
        { provide: FeatureRunsService, useValue: mockFeatureRunsService },
      ],
    }).compile();
    service = module.get<RunsService>(RunsService);
    mockPrisma.environmentRelease.findFirst.mockResolvedValue(null);
  });

  describe('findByProject', () => {
    it('returns paginated runs with total', async () => {
      mockPrisma.testRun.findMany.mockResolvedValue([mockRun]);
      mockPrisma.testRun.count.mockResolvedValue(1);
      const result = await service.findByProject('proj-1');
      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });

    it('applies status filter', async () => {
      mockPrisma.testRun.findMany.mockResolvedValue([]);
      mockPrisma.testRun.count.mockResolvedValue(0);
      await service.findByProject('proj-1', { status: 'PASSED' as never });
      expect(mockPrisma.testRun.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ status: 'PASSED' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('returns a run with relations', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue(mockRun);
      const result = await service.findOne('run-1');
      expect(result.id).toBe('run-1');
    });

    it('throws NotFoundException when run not found', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue(null);
      await expect(service.findOne('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('trigger', () => {
    it('creates a run and enqueues it', async () => {
      mockPrisma.environment.findUnique.mockResolvedValue({ id: 'env-1', supportsAutomation: true });
      // An automated run needs an executable test — steps (or SCRIPT source).
      mockPrisma.testDefinition.findUnique.mockResolvedValue({
        id: 'test-1',
        type: 'UI',
        steps: [{ index: 0, name: 'Go', type: 'NAVIGATE', input: { url: '/' } }],
      });
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      mockPrisma.environmentRelease.findFirst.mockResolvedValue({ id: 'release-1' });
      mockPrisma.testRun.create.mockResolvedValue(mockRun);
      mockQueue.enqueueRun.mockResolvedValue({ id: 'job-1' });

      const result = await service.trigger('proj-1', { environmentId: 'env-1', testDefinitionId: 'test-1' });
      expect(result.status).toBe('PENDING');
      expect(mockPrisma.testRun.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            environmentReleaseId: 'release-1',
          }),
        }),
      );
      expect(mockQueue.enqueueRun).toHaveBeenCalledWith({ runId: 'run-1' });
    });

    it('rejects an automated run for a test with no steps', async () => {
      mockPrisma.environment.findUnique.mockResolvedValue({ id: 'env-1', supportsAutomation: true });
      mockPrisma.testDefinition.findUnique.mockResolvedValue({ id: 'test-1', type: 'UI', steps: [] });
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });

      await expect(
        service.trigger('proj-1', { environmentId: 'env-1', testDefinitionId: 'test-1' }),
      ).rejects.toThrow('not automatable');
    });

    it('allows an automated run for a SCRIPT test with source', async () => {
      mockPrisma.environment.findUnique.mockResolvedValue({ id: 'env-1', supportsAutomation: true });
      mockPrisma.testDefinition.findUnique.mockResolvedValue({
        id: 'test-1', type: 'SCRIPT', steps: [], config: { script: 'await page.goto("/");' },
      });
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      mockPrisma.testRun.create.mockResolvedValue(mockRun);
      mockQueue.enqueueRun.mockResolvedValue({ id: 'job-1' });

      const result = await service.trigger('proj-1', { environmentId: 'env-1', testDefinitionId: 'test-1' });
      expect(result.status).toBe('PENDING');
    });

    it('throws NotFoundException when environment not found', async () => {
      mockPrisma.environment.findUnique.mockResolvedValue(null);
      mockPrisma.testDefinition.findUnique.mockResolvedValue({ id: 'test-1' });
      mockPrisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
      await expect(service.trigger('proj-1', { environmentId: 'bad-env', testDefinitionId: 'test-1' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('cancels a PENDING run', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ ...mockRun, status: 'PENDING' });
      mockPrisma.testRun.update.mockResolvedValue({ ...mockRun, status: 'CANCELLED' });
      const result = await service.cancel('run-1');
      expect(result.status).toBe('CANCELLED');
    });

    it('throws when run is already in terminal state', async () => {
      mockPrisma.testRun.findUnique.mockResolvedValue({ ...mockRun, status: 'PASSED' });
      // The service now reports the specific status it found instead of the
      // generic "already in terminal state" phrasing — assert against the new
      // user-facing message so a re-word doesn't ripple through tests.
      await expect(service.cancel('run-1')).rejects.toThrow('Run is already passed');
    });
  });

  describe('getStats', () => {
    it('returns correct stats and passRate', async () => {
      mockPrisma.testRun.count
        .mockResolvedValueOnce(10)
        .mockResolvedValueOnce(8)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(0);
      const stats = await service.getStats('proj-1');
      expect(stats.total).toBe(10);
      expect(stats.passed).toBe(8);
      expect(stats.passRate).toBe(80);
    });

    it('returns passRate 0 when no runs', async () => {
      mockPrisma.testRun.count.mockResolvedValue(0);
      const stats = await service.getStats('proj-1');
      expect(stats.passRate).toBe(0);
    });
  });

  describe('completeManualRun', () => {
    it('sets run to PASSED when all steps passed', async () => {
      mockPrisma.testRun.findUniqueOrThrow.mockResolvedValue({
        ...mockRun,
        steps: [
          { id: 'step-1', status: 'PASSED' },
          { id: 'step-2', status: 'PASSED' },
        ],
      });
      mockPrisma.testRun.update.mockResolvedValue({ ...mockRun, status: 'PASSED' });

      const result = await service.completeManualRun('run-1');
      expect(mockPrisma.testRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED' }) }),
      );
      expect(result.status).toBe('PASSED');
    });

    it('sets run to FAILED when any step failed', async () => {
      mockPrisma.testRun.findUniqueOrThrow.mockResolvedValue({
        ...mockRun,
        steps: [
          { id: 'step-1', status: 'PASSED' },
          { id: 'step-2', status: 'FAILED' },
        ],
      });
      mockPrisma.testRun.update.mockResolvedValue({ ...mockRun, status: 'FAILED' });

      const result = await service.completeManualRun('run-1');
      expect(mockPrisma.testRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
      );
      expect(result.status).toBe('FAILED');
    });
  });

  describe('getFlakyTests — flake scoring monitors', () => {
    const runs = (statuses: string[]) => statuses.map(status => ({ status, createdAt: new Date(), steps: [] }));

    it('flags via transitionCount once ≥3 transitions occur in the last 10, from the 6th run on', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: {} }); // defaults: passOnRetry+transitionCount on
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        { id: 'test-1', name: 'Flaky test', type: 'UI', runs: runs(['PASSED', 'FAILED', 'PASSED', 'FAILED', 'PASSED', 'FAILED']) },
      ]);

      const result = await service.getFlakyTests('proj-1');

      expect(result).toHaveLength(1);
      expect(result[0].flaggedMonitors).toContain('transitionCount');
    });

    it('does not flag a stable test (no transitions)', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: {} });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        { id: 'test-1', name: 'Stable test', type: 'UI', runs: runs(['PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED', 'PASSED']) },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(0);
    });

    it('does not evaluate transitionCount before 6 runs exist', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: {} });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        { id: 'test-1', name: 'New test', type: 'UI', runs: runs(['PASSED', 'FAILED', 'PASSED', 'FAILED']) },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(0);
    });

    it('flags via passOnRetry when a recent run needed a retry to pass', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: {} });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        {
          id: 'test-1', name: 'Retry-recovered test', type: 'UI',
          runs: [{ status: 'PASSED', createdAt: new Date(), steps: [{ id: 'step-1' }] }],
        },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].flaggedMonitors).toEqual(['passOnRetry']);
    });

    it('failureRate monitor is off by default even with a high failure rate', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: {} });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        { id: 'test-1', name: 'Broken test', type: 'UI', runs: runs(['FAILED', 'FAILED', 'FAILED']) },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(0); // no transitions, no retry recovery, failureRate disabled
    });

    it('honours a project opting into failureRate', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({
        flakeConfig: { passOnRetry: false, transitionCount: false, failureRate: true, failureRateThreshold: 0.3, failureRateWindowDays: 14 },
      });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        { id: 'test-1', name: 'Broken test', type: 'UI', runs: runs(['FAILED', 'FAILED', 'FAILED', 'PASSED']) },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(1);
      expect(result[0].flaggedMonitors).toEqual(['failureRate']);
    });

    it('a disabled monitor never flags, even when its condition holds', async () => {
      mockPrisma.project.findUnique.mockResolvedValue({ flakeConfig: { passOnRetry: false, transitionCount: true, failureRate: false } });
      mockPrisma.testDefinition.findMany.mockResolvedValue([
        {
          id: 'test-1', name: 'Retry-recovered but monitor off', type: 'UI',
          runs: [{ status: 'PASSED', createdAt: new Date(), steps: [{ id: 'step-1' }] }],
        },
      ]);

      const result = await service.getFlakyTests('proj-1');
      expect(result).toHaveLength(0);
    });
  });

  describe('getFingerprintOccurrences', () => {
    it('reports count and first-seen date scoped to the project', async () => {
      mockPrisma.runStep.count.mockResolvedValue(17);
      const firstSeen = new Date('2026-07-06T00:00:00Z');
      mockPrisma.runStep.findFirst.mockResolvedValue({ createdAt: firstSeen });

      const result = await service.getFingerprintOccurrences('proj-1', 'abc123');

      expect(mockPrisma.runStep.count).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ failureFingerprint: 'abc123', run: expect.objectContaining({ projectId: 'proj-1' }) }),
      }));
      expect(result).toEqual({ fingerprint: 'abc123', count: 17, firstSeenAt: firstSeen });
    });

    it('returns null firstSeenAt when there are no occurrences', async () => {
      mockPrisma.runStep.count.mockResolvedValue(0);
      mockPrisma.runStep.findFirst.mockResolvedValue(null);

      const result = await service.getFingerprintOccurrences('proj-1', 'nope');
      expect(result).toEqual({ fingerprint: 'nope', count: 0, firstSeenAt: null });
    });
  });
});

// ─── RunStepsService unit tests ───────────────────────────────────────────────

describe('RunStepsService — markStepStatus', () => {
  let stepsService: RunStepsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RunStepsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: FeatureRunsService, useValue: mockFeatureRunsService },
      ],
    }).compile();
    stepsService = module.get<RunStepsService>(RunStepsService);
  });

  it('updates step status to PASSED', async () => {
    mockPrisma.runStep.findFirst.mockResolvedValue({ id: 'step-1', runId: 'run-1' });
    mockPrisma.runStep.update.mockResolvedValue({ id: 'step-1', status: 'PASSED', runId: 'run-1' });
    mockPrisma.runStep.findMany.mockResolvedValue([{ id: 'step-1', status: 'PASSED' }]);

    const result = await stepsService.markStepStatus('run-1', 'step-1', { status: 'PASSED' });
    expect(mockPrisma.runStep.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED' }) }),
    );
    expect(result.status).toBe('PASSED');
  });

  it('when all steps passed → auto-completes the test run as PASSED', async () => {
    mockPrisma.runStep.findFirst.mockResolvedValue({ id: 'step-1', runId: 'run-1' });
    mockPrisma.runStep.update.mockResolvedValue({ id: 'step-1', status: 'PASSED', runId: 'run-1' });
    mockPrisma.runStep.findMany.mockResolvedValue([
      { id: 'step-1', status: 'PASSED' },
      { id: 'step-2', status: 'PASSED' },
    ]);
    mockPrisma.testRun.update.mockResolvedValue({ id: 'run-1', status: 'PASSED' });

    await stepsService.markStepStatus('run-1', 'step-1', { status: 'PASSED' });

    expect(mockPrisma.testRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'PASSED' }) }),
    );
  });

  it('when any step FAILED → auto-completes the test run as FAILED', async () => {
    mockPrisma.runStep.findFirst.mockResolvedValue({ id: 'step-2', runId: 'run-1' });
    mockPrisma.runStep.update.mockResolvedValue({ id: 'step-2', status: 'FAILED', runId: 'run-1' });
    mockPrisma.runStep.findMany.mockResolvedValue([
      { id: 'step-1', status: 'PASSED' },
      { id: 'step-2', status: 'FAILED' },
    ]);
    mockPrisma.testRun.update.mockResolvedValue({ id: 'run-1', status: 'FAILED' });

    await stepsService.markStepStatus('run-1', 'step-2', { status: 'FAILED' });

    expect(mockPrisma.testRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });
});
