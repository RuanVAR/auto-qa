import * as fs from 'fs';
import { RunExecutor } from '../executors/run.executor';

const mockEvents = {
  connect: jest.fn(), disconnect: jest.fn(), emitRunUpdated: jest.fn(),
  emitStepCompleted: jest.fn(), emitStepFailed: jest.fn(), emitRunAbortCompleted: jest.fn().mockResolvedValue(undefined),
};
const mockApiRunStep = jest.fn();
const mockUiRunStep = jest.fn();
const mockCollectorRegister = jest.fn();
const mockPage = {
  goto: jest.fn(), screenshot: jest.fn(), locator: jest.fn(), waitForTimeout: jest.fn(),
};
const mockContext = {
  tracing: { start: jest.fn(), stop: jest.fn() },
};
const mockSession = {
  start: jest.fn(), close: jest.fn(), forceKill: jest.fn(), diagnostics: jest.fn(), videoPath: jest.fn(),
};
const mockScreencast = { start: jest.fn(), stop: jest.fn() };

jest.mock('@qa-platform/storage', () => ({ createStorageProvider: jest.fn(() => ({})) }));
jest.mock('../collectors/artifact.collector', () => ({
  ArtifactCollector: jest.fn(() => ({ register: mockCollectorRegister })),
}));
jest.mock('../services/worker.events.service', () => ({
  WorkerEventsService: jest.fn(() => mockEvents),
}));
jest.mock('../services/browser.session', () => ({
  BrowserSession: jest.fn(() => mockSession),
}));
jest.mock('../services/screencast.service', () => ({
  ScreencastService: jest.fn(() => mockScreencast),
}));
jest.mock('../steps/api.step.runner', () => ({
  ApiStepRunner: jest.fn(() => ({ runStep: mockApiRunStep })),
}));
jest.mock('../steps/step.runner', () => ({
  StepRunner: jest.fn(() => ({ runStep: mockUiRunStep, getLastResolution: jest.fn(() => null) })),
}));
jest.mock('../utils/defect-matcher', () => ({ matchDefectsForFailure: jest.fn() }));

const apiRun = {
  id: 'run-1', projectId: 'project-1', featureRunId: null,
  testDefinitionId: 'test-1', environmentId: 'env-1', status: 'PENDING',
  metadata: null,
  testDefinition: {
    type: 'API', config: null,
    steps: [{ name: 'Authenticate', type: 'API_REQUEST', input: { headers: { authorization: '{{API_TOKEN}}' } } }],
  },
  environment: { baseUrl: 'https://api.example.test', variables: { API_TOKEN: 'top-secret-token' }, headers: null },
};

function uiRun(steps: Record<string, unknown>[], config: Record<string, unknown> = {}) {
  return {
    ...apiRun,
    testDefinition: { type: 'UI', config: { recordVideo: false, ...config }, steps },
    environment: { baseUrl: 'https://app.example.test', variables: {}, headers: null, slowMoMs: 0 },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('RunExecutor', () => {
  const prisma = {
    testRun: { findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() },
    runStep: { create: jest.fn(), update: jest.fn(), findMany: jest.fn() },
    environmentCredential: { findMany: jest.fn() },
    project: { findUnique: jest.fn() },
    selectorHeal: { create: jest.fn(), updateMany: jest.fn() },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.testRun.findUnique.mockResolvedValue(apiRun);
    prisma.testRun.updateMany.mockResolvedValue({ count: 1 });
    prisma.testRun.update.mockResolvedValue({});
    prisma.runStep.create.mockImplementation(({ data }) => ({ id: `step-${data.index}`, startedAt: new Date() }));
    prisma.runStep.update.mockResolvedValue({});
    prisma.runStep.findMany.mockResolvedValue([]);
    prisma.environmentCredential.findMany.mockResolvedValue([]);
    prisma.project.findUnique.mockResolvedValue({ healSensitivity: 0.8 });
    prisma.selectorHeal.create.mockResolvedValue({});
    prisma.selectorHeal.updateMany.mockResolvedValue({ count: 0 });
    mockApiRunStep.mockResolvedValue({ response: 'top-secret-token' });
    mockUiRunStep.mockResolvedValue({});
    mockCollectorRegister.mockResolvedValue({});
    mockPage.goto.mockResolvedValue({});
    mockPage.screenshot.mockResolvedValue({});
    mockPage.locator.mockReturnValue({});
    mockPage.waitForTimeout.mockResolvedValue({});
    mockContext.tracing.start.mockResolvedValue({});
    mockContext.tracing.stop.mockResolvedValue({});
    mockSession.start.mockResolvedValue({ browser: {}, context: mockContext, page: mockPage });
    mockSession.close.mockResolvedValue({});
    mockSession.forceKill.mockImplementation(() => undefined);
    mockSession.diagnostics.mockReturnValue({ console: [], network: [] });
    mockSession.videoPath.mockResolvedValue(null);
    mockScreencast.start.mockResolvedValue({});
    mockScreencast.stop.mockResolvedValue({});
  });

  afterEach(() => {
    jest.useRealTimers();
    delete process.env.RUN_TIMEOUT_MS;
  });

  it('bails when the atomic claim loses, without opening an execution session', async () => {
    prisma.testRun.updateMany.mockResolvedValue({ count: 0 });

    await new RunExecutor(prisma as never).execute('run-1');

    expect(mockEvents.connect).not.toHaveBeenCalled();
    expect(prisma.runStep.create).not.toHaveBeenCalled();
  });

  it('claims a pending run and never persists a resolved secret in API evidence', async () => {
    await new RunExecutor(prisma as never).execute('run-1');

    expect(prisma.testRun.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'run-1', status: { in: ['PENDING', 'QUEUED'] } },
    }));
    const persistedInput = prisma.runStep.create.mock.calls[0][0].data.input;
    const persistedOutput = prisma.runStep.update.mock.calls[0][0].data.output;
    expect(JSON.stringify(persistedInput)).not.toContain('top-secret-token');
    expect(JSON.stringify(persistedOutput)).not.toContain('top-secret-token');
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'PASSED' }));
  });

  it('redacts a secret echoed by a failed API request before notifying the UI', async () => {
    mockApiRunStep.mockRejectedValue(new Error('Authentication failed for top-secret-token'));

    await new RunExecutor(prisma as never).execute('run-1');

    const failure = prisma.runStep.update.mock.calls[0][0].data.errorMessage as string;
    expect(failure).not.toContain('top-secret-token');
    expect(mockEvents.emitStepFailed).toHaveBeenCalledWith(expect.objectContaining({
      errorMessage: expect.not.stringContaining('top-secret-token'),
    }));
  });

  it('retries a UI step and records the successful second attempt', async () => {
    const run = uiRun([{ name: 'Flaky click', type: 'CLICK', retries: 1, input: { selector: '#save' } }]);
    prisma.testRun.findUnique.mockImplementation(({ include }) => Promise.resolve(include ? run : { status: 'RUNNING' }));
    mockUiRunStep.mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ ok: true });

    await new RunExecutor(prisma as never).execute('run-1');

    expect(mockUiRunStep).toHaveBeenCalledTimes(2);
    expect(mockPage.waitForTimeout).toHaveBeenCalledWith(500);
    expect(prisma.runStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'PASSED', attempts: 2, attemptsToPass: 2,
    }) }));
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'PASSED' }));
  });

  it('marks the run failed and surfaces the last error when retries exhaust', async () => {
    const run = uiRun([{ name: 'Broken click', type: 'CLICK', retries: 1, input: { selector: '#save' } }]);
    prisma.testRun.findUnique.mockImplementation(({ include }) => Promise.resolve(include ? run : { status: 'RUNNING' }));
    mockUiRunStep.mockRejectedValue(new Error('still broken'));

    await new RunExecutor(prisma as never).execute('run-1');

    expect(mockUiRunStep).toHaveBeenCalledTimes(2);
    expect(prisma.runStep.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'FAILED', errorMessage: 'still broken', attempts: 2,
    }) }));
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('continues after an opted-in failure but leaves the run failed', async () => {
    const run = uiRun([
      { name: 'First', type: 'CLICK', continueOnFail: true, input: { selector: '#first' } },
      { name: 'Second', type: 'CLICK', input: { selector: '#second' } },
    ]);
    prisma.testRun.findUnique.mockImplementation(({ include }) => Promise.resolve(include ? run : { status: 'RUNNING' }));
    mockUiRunStep.mockRejectedValueOnce(new Error('first failed')).mockResolvedValueOnce({ ok: true });

    await new RunExecutor(prisma as never).execute('run-1');

    expect(mockUiRunStep).toHaveBeenCalledTimes(2);
    expect(prisma.runStep.create).toHaveBeenCalledTimes(2);
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'FAILED' }));
  });

  it('times out a hung UI run, force-kills the browser, and reports TIMED_OUT', async () => {
    jest.useFakeTimers();
    process.env.RUN_TIMEOUT_MS = '1';
    const run = uiRun([{ name: 'Hung', type: 'CLICK', input: { selector: '#wait' } }]);
    const pendingStep = deferred<unknown>();
    prisma.testRun.findUnique.mockImplementation(({ include }) => Promise.resolve(include ? run : { status: 'RUNNING' }));
    mockUiRunStep.mockReturnValue(pendingStep.promise);
    mockSession.forceKill.mockImplementation(() => pendingStep.reject(new Error('browser closed')));

    const execution = new RunExecutor(prisma as never).execute('run-1');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    await execution;

    expect(mockSession.forceKill).toHaveBeenCalled();
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'TIMED_OUT' }));
    expect(mockSession.close).toHaveBeenCalled();
  });

  it('cancels an in-flight UI run without misreporting it as a failure', async () => {
    jest.useFakeTimers();
    const run = uiRun([{ name: 'Cancelable', type: 'CLICK', input: { selector: '#cancel' } }]);
    const pendingStep = deferred<unknown>();
    let statusReads = 0;
    prisma.testRun.findUnique.mockImplementation(({ include }) => {
      if (include) return Promise.resolve(run);
      statusReads++;
      return Promise.resolve({ status: statusReads === 1 ? 'RUNNING' : 'CANCELLED' });
    });
    mockUiRunStep.mockReturnValue(pendingStep.promise);
    mockSession.forceKill.mockImplementation(() => pendingStep.reject(new Error('browser closed')));

    const execution = new RunExecutor(prisma as never).execute('run-1');
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1000);
    await execution;

    expect(mockSession.forceKill).toHaveBeenCalled();
    expect(mockEvents.emitRunUpdated).toHaveBeenCalledWith(expect.objectContaining({ status: 'CANCELLED' }));
    expect(mockEvents.emitRunAbortCompleted).toHaveBeenCalledWith(expect.objectContaining({ runId: 'run-1' }));
  });

  it('closes the browser and removes staging data when UI setup throws', async () => {
    const run = uiRun([{ name: 'Never starts', type: 'CLICK', input: { selector: '#never' } }]);
    prisma.testRun.findUnique.mockResolvedValue(run);
    mockSession.start.mockRejectedValue(new Error('Chromium unavailable'));
    const remove = jest.spyOn(fs.promises, 'rm').mockResolvedValue(undefined);

    await expect(new RunExecutor(prisma as never).execute('run-1')).rejects.toThrow('Chromium unavailable');

    expect(mockSession.close).toHaveBeenCalled();
    expect(remove).toHaveBeenCalledWith(expect.stringContaining('qa-run-artifacts/run-1'), { recursive: true, force: true });
    remove.mockRestore();
  });
});
