import { PrismaClient, RunStatus, StepStatus, StepType, TestCaseType, Prisma } from '@prisma/client';
import { Browser, BrowserContext, Page } from 'playwright';
import { StepRunner } from '../steps/step.runner';
import { ApiStepRunner } from '../steps/api.step.runner';
import { ShellStepRunner } from '../steps/shell.step.runner';
import { ArtifactCollector } from '../collectors/artifact.collector';
import { ScreencastService } from '../services/screencast.service';
import { WorkerEventsService } from '../services/worker.events.service';
import { BrowserSession } from '../services/browser.session';
import * as path from 'path';

/**
 * Rewrite "localhost" / "127.0.0.1" in the env baseUrl to the docker-host
 * alias the worker container can actually reach. The recorder iframe + the
 * user's browser need `localhost` (their host network); the worker, being
 * a container on a docker network, needs `host.docker.internal` (Docker
 * Desktop) or `WORKER_HOST_REWRITE` if the deployer set one.
 *
 * This is dev-time only — production envs use real hostnames everywhere
 * and the rewrite is a no-op.
 */
function rewriteForWorker(baseUrl: string): string {
  if (!baseUrl) return baseUrl;
  const target = process.env.WORKER_HOST_REWRITE ?? 'host.docker.internal';
  return baseUrl
    .replace(/(:\/\/)localhost(\b)/, `$1${target}$2`)
    .replace(/(:\/\/)127\.0\.0\.1(\b)/, `$1${target}$2`);
}

export class RunExecutor {
  constructor(private readonly prisma: PrismaClient) {}

  async execute(runId: string): Promise<void> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: { testDefinition: true, environment: true },
    });
    if (!run) throw new Error(`Run ${runId} not found`);

    const startedAt = new Date();
    await this.prisma.testRun.update({ where: { id: runId }, data: { status: RunStatus.RUNNING, startedAt } });

    const events = new WorkerEventsService();
    await events.connect();

    await events.emitRunUpdated({
      id: runId,
      status: RunStatus.RUNNING,
      projectId: run.projectId,
      featureRunId: run.featureRunId,
      startedAt,
      completedAt: null,
      duration: null,
      errorMessage: null,
    });

    const testType: TestCaseType = run.testDefinition.type;
    const config = (run.testDefinition.config ?? {}) as Record<string, unknown>;
    const storagePath = process.env.ARTIFACT_STORAGE_PATH ?? './artifacts';
    const runDir = path.join(storagePath, 'runs', runId);

    const runWithEnv = run as NonNullable<typeof run> & {
      testDefinition: { steps: Prisma.JsonValue; config: Prisma.JsonValue | null };
      environment: { baseUrl: string; headers: Prisma.JsonValue | null; variables: Prisma.JsonValue | null };
    };

    try {
      if (testType === TestCaseType.API) {
        await this.executeApiRun(runWithEnv, runId, runDir, startedAt, events);
      } else if (testType === TestCaseType.SHELL) {
        await this.executeShellRun(runWithEnv, runId, runDir, startedAt, events);
      } else {
        await this.executeUiRun(runWithEnv, runId, runDir, startedAt, config, events);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.prisma.testRun.update({
        where: { id: runId },
        data: { status: RunStatus.ERROR, completedAt: new Date(), errorMessage: msg, duration: Date.now() - startedAt.getTime() },
      });
      await events.emitRunUpdated({
        id: runId,
        status: RunStatus.ERROR,
        projectId: run.projectId,
        featureRunId: run.featureRunId,
        startedAt,
        completedAt: new Date(),
        duration: Date.now() - startedAt.getTime(),
        errorMessage: msg,
      });
      throw err;
    } finally {
      await events.disconnect();
    }
  }

  // ─── UI (Playwright) ────────────────────────────────────────────────────────

  private async executeUiRun(
    run: Awaited<ReturnType<PrismaClient['testRun']['findUnique']>> & { testDefinition: { steps: Prisma.JsonValue; config: Prisma.JsonValue | null }; environment: { baseUrl: string; headers: Prisma.JsonValue | null } },
    runId: string,
    runDir: string,
    startedAt: Date,
    config: Record<string, unknown>,
    events: WorkerEventsService,
  ) {
    const browserName = (config.browser as string) ?? 'chromium';
    const headless = config.headless !== false;
    const timeout = (config.timeout as number) ?? 30000;

    const session = new BrowserSession();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let screencast: ScreencastService | null = null;
    let cancelled = false;
    let abortWatcher: NodeJS.Timeout | null = null;

    try {
      // Bounded launch — fails fast if Chromium can't start, instead of
      // blocking subsequent steps on their own 30s default timeouts.
      const handles = await session.start({
        browserName,
        headless,
        baseURL: rewriteForWorker(run!.environment.baseUrl),
        extraHTTPHeaders: (run!.environment.headers ?? {}) as Record<string, string>,
        defaultTimeout: timeout,
      });
      browser = handles.browser;
      context = handles.context;
      page = handles.page;
      await context.tracing.start({ screenshots: true, snapshots: true });

      screencast = new ScreencastService(page, runId);
      await screencast.start();

      // Hard-kill watchdog: poll the run's status every second; if it becomes
      // CANCELLED, force-kill the browser so any mid-flight Playwright call
      // throws immediately instead of waiting for its own timeout. Without
      // this, a long step (e.g. a 60s wait) would block the abort.
      abortWatcher = setInterval(() => {
        this.prisma.testRun.findUnique({ where: { id: runId }, select: { status: true } })
          .then(r => {
            if (r?.status === RunStatus.CANCELLED && !cancelled) {
              cancelled = true;
              session.forceKill(); // SIGKILL — instant, doesn't wait for graceful close
            }
          })
          .catch(() => {});
      }, 1000);

      const steps = run!.testDefinition.steps as Record<string, unknown>[];
      const collector = new ArtifactCollector(this.prisma, runId, runDir);
      const runner = new StepRunner(page, collector, rewriteForWorker(run!.environment.baseUrl), {
        // Env-scoped variables live on Environment.variables and are available
        // as {{KEY}} in any step input. They sit BELOW built-ins, so a test
        // can't shadow RUN_ID by setting one on the env.
        ...(((run!.environment as { variables?: Record<string, string> | null }).variables) ?? {}),
        RUN_ID: runId,
        TEST_RUN_ID: runId,
        FEATURE_RUN_ID: run!.featureRunId ?? runId,
      });
      let allPassed = true;

      for (let i = 0; i < steps.length; i++) {
        const currentRun = await this.prisma.testRun.findUnique({
          where: { id: runId },
          select: { status: true },
        });
        if (currentRun?.status === RunStatus.CANCELLED) {
          cancelled = true;
          break;
        }

        const stepDef = steps[i];
        const stepRecord = await this.prisma.runStep.create({
          data: {
            runId,
            index: i,
            name: (stepDef.name as string) ?? `Step ${i + 1}`,
            type: stepDef.type as StepType,
            input: (stepDef.input ?? Prisma.DbNull) as Prisma.InputJsonValue,
            status: StepStatus.RUNNING,
            startedAt: new Date(),
          },
        });

        try {
          const result = await runner.runStep(stepDef, {
            stepIndex: i,
            stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
          });
          const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
          const statusAfterStep = await this.prisma.testRun.findUnique({
            where: { id: runId },
            select: { status: true },
          });
          if (statusAfterStep?.status === RunStatus.CANCELLED) {
            cancelled = true;
            await this.prisma.runStep.update({
              where: { id: stepRecord.id },
              data: { status: StepStatus.SKIPPED, completedAt: new Date(), duration: stepDuration, errorMessage: 'Skipped by user', executedBy: 'AUTOMATED' },
            });
            break;
          }
          await this.prisma.runStep.update({
            where: { id: stepRecord.id },
            data: {
              status: StepStatus.PASSED,
              output: (result ?? Prisma.DbNull) as Prisma.InputJsonValue,
              completedAt: new Date(),
              duration: stepDuration,
              executedBy: 'AUTOMATED',
            },
          });
          await events.emitStepCompleted({
            runId,
            stepId: stepRecord.id,
            index: i,
            status: StepStatus.PASSED,
            screenshotPath: null,
            duration: stepDuration,
            errorMessage: null,
          });
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // If the watchdog already detected cancellation and force-closed the
          // browser, the throw is the abort, not a real failure. Mark SKIPPED
          // and exit the loop without polluting the report with a fake fail.
          if (cancelled) {
            const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
            await this.prisma.runStep.update({
              where: { id: stepRecord.id },
              data: { status: StepStatus.SKIPPED, completedAt: new Date(), duration: stepDuration, errorMessage: 'Aborted by user', executedBy: 'AUTOMATED' },
            });
            break;
          }
          allPassed = false;
          let screenshotPath: string | null = null;
          try {
            const fname = `step-${i}-failure.png`;
            const fp = path.join(runDir, fname);
            await page.screenshot({ path: fp, fullPage: true });
            // Stamp the failed step's index + name so the UI can pin this
            // screenshot to its step row without filename-pattern matching.
            await collector.register('SCREENSHOT', fname, fp, {
              stepIndex: i,
              stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
              trigger: 'failure',
            });
            screenshotPath = fp;
          } catch {}
          const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
          await this.prisma.runStep.update({
            where: { id: stepRecord.id },
            data: { status: StepStatus.FAILED, errorMessage: msg, completedAt: new Date(), duration: stepDuration, executedBy: 'AUTOMATED' },
          });
          await events.emitStepCompleted({
            runId,
            stepId: stepRecord.id,
            index: i,
            status: StepStatus.FAILED,
            screenshotPath,
            duration: stepDuration,
            errorMessage: msg,
          });
          await events.emitStepFailed({
            runId,
            stepId: stepRecord.id,
            index: i,
            stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
            errorMessage: msg,
          });
          break;
        }
      }

      const tracePath = path.join(runDir, 'trace.zip');
      // Tracing stop can throw if the watchdog already force-closed the browser.
      // The trace is best-effort on cancelled runs; don't let it block teardown.
      try {
        await context.tracing.stop({ path: tracePath });
        await collector.register('TRACE', 'trace.zip', tracePath);
      } catch {
        if (!cancelled) throw new Error('Failed to stop tracing');
      }

      const completedAt = new Date();
      const finalStatus = cancelled ? RunStatus.CANCELLED : allPassed ? RunStatus.PASSED : RunStatus.FAILED;
      await this.prisma.testRun.update({
        where: { id: runId },
        data: { status: finalStatus, completedAt, duration: completedAt.getTime() - startedAt.getTime() },
      });
      await events.emitRunUpdated({
        id: runId,
        status: finalStatus,
        projectId: run!.projectId,
        featureRunId: run!.featureRunId,
        startedAt,
        completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
        errorMessage: null,
      });
    } finally {
      if (abortWatcher) clearInterval(abortWatcher);
      // Stop screencast before tearing down the browser — otherwise the CDP
      // session inside it can throw "Target closed" warnings into stderr.
      await screencast?.stop().catch(() => {});
      // session.close() is bounded (race + SIGKILL fallback) and removes the
      // throwaway user-data-dir. Guarantees we never hang here, no matter how
      // wedged Chromium is.
      await session.close();
      // After the browser is fully torn down, fire the abort-completed signal.
      // This is what the web UI waits on before unlocking the manual mode.
      if (cancelled) {
        await events.emitRunAbortCompleted({
          runId,
          projectId: run!.projectId,
          featureRunId: run!.featureRunId ?? null,
        }).catch(() => {});
      }
    }
  }

  // ─── API ─────────────────────────────────────────────────────────────────────

  private async executeApiRun(
    run: NonNullable<Awaited<ReturnType<PrismaClient['testRun']['findUnique']>>> & { testDefinition: { steps: Prisma.JsonValue }; environment: { baseUrl: string; variables: Prisma.JsonValue | null } },
    runId: string,
    runDir: string,
    startedAt: Date,
    events: WorkerEventsService,
  ) {
    const collector = new ArtifactCollector(this.prisma, runId, runDir);
    const runner = new ApiStepRunner(rewriteForWorker(run.environment.baseUrl), {
      ...((run.environment as { variables?: Record<string, string> | null }).variables ?? {}),
      RUN_ID: runId,
      TEST_RUN_ID: runId,
    });
    const steps = run.testDefinition.steps as Record<string, unknown>[];
    let allPassed = true;

    for (let i = 0; i < steps.length; i++) {
      const stepDef = steps[i];
      const stepRecord = await this.prisma.runStep.create({
        data: {
          runId,
          index: i,
          name: (stepDef.name as string) ?? `Step ${i + 1}`,
          type: stepDef.type as StepType,
          input: (stepDef.input ?? Prisma.DbNull) as Prisma.InputJsonValue,
          status: StepStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      try {
        const result = await runner.runStep(stepDef);
        const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
        await this.prisma.runStep.update({
          where: { id: stepRecord.id },
          data: {
            status: StepStatus.PASSED,
            output: (result ?? Prisma.DbNull) as Prisma.InputJsonValue,
            completedAt: new Date(),
            duration: stepDuration,
          },
        });
        await events.emitStepCompleted({
          runId,
          stepId: stepRecord.id,
          index: i,
          status: StepStatus.PASSED,
          screenshotPath: null,
          duration: stepDuration,
          errorMessage: null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        allPassed = false;
        const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
        await this.prisma.runStep.update({
          where: { id: stepRecord.id },
          data: { status: StepStatus.FAILED, errorMessage: msg, completedAt: new Date(), duration: stepDuration },
        });
        await events.emitStepCompleted({
          runId,
          stepId: stepRecord.id,
          index: i,
          status: StepStatus.FAILED,
          screenshotPath: null,
          duration: stepDuration,
          errorMessage: msg,
        });
        await events.emitStepFailed({
          runId,
          stepId: stepRecord.id,
          index: i,
          stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
          errorMessage: msg,
        });
        break;
      }
    }

    const completedAt = new Date();
    const finalStatus = allPassed ? RunStatus.PASSED : RunStatus.FAILED;
    await this.prisma.testRun.update({
      where: { id: runId },
      data: { status: finalStatus, completedAt, duration: completedAt.getTime() - startedAt.getTime() },
    });
    await events.emitRunUpdated({
      id: runId,
      status: finalStatus,
      projectId: run.projectId,
      featureRunId: run.featureRunId,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      errorMessage: null,
    });
  }

  // ─── Shell ────────────────────────────────────────────────────────────────────

  private async executeShellRun(
    run: NonNullable<Awaited<ReturnType<PrismaClient['testRun']['findUnique']>>> & { testDefinition: { steps: Prisma.JsonValue } },
    runId: string,
    runDir: string,
    startedAt: Date,
    events: WorkerEventsService,
  ) {
    const collector = new ArtifactCollector(this.prisma, runId, runDir);
    const runner = new ShellStepRunner();
    const steps = run.testDefinition.steps as Record<string, unknown>[];
    let allPassed = true;

    for (let i = 0; i < steps.length; i++) {
      const stepDef = steps[i];
      const stepRecord = await this.prisma.runStep.create({
        data: {
          runId,
          index: i,
          name: (stepDef.name as string) ?? `Step ${i + 1}`,
          type: stepDef.type as StepType,
          input: (stepDef.input ?? Prisma.DbNull) as Prisma.InputJsonValue,
          status: StepStatus.RUNNING,
          startedAt: new Date(),
        },
      });

      try {
        const result = await runner.runStep(stepDef);
        const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
        await this.prisma.runStep.update({
          where: { id: stepRecord.id },
          data: {
            status: StepStatus.PASSED,
            output: (result ?? Prisma.DbNull) as Prisma.InputJsonValue,
            completedAt: new Date(),
            duration: stepDuration,
          },
        });
        await events.emitStepCompleted({
          runId,
          stepId: stepRecord.id,
          index: i,
          status: StepStatus.PASSED,
          screenshotPath: null,
          duration: stepDuration,
          errorMessage: null,
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        allPassed = false;
        const stepDuration = Date.now() - stepRecord.startedAt!.getTime();
        await this.prisma.runStep.update({
          where: { id: stepRecord.id },
          data: { status: StepStatus.FAILED, errorMessage: msg, completedAt: new Date(), duration: stepDuration },
        });
        await events.emitStepCompleted({
          runId,
          stepId: stepRecord.id,
          index: i,
          status: StepStatus.FAILED,
          screenshotPath: null,
          duration: stepDuration,
          errorMessage: msg,
        });
        await events.emitStepFailed({
          runId,
          stepId: stepRecord.id,
          index: i,
          stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
          errorMessage: msg,
        });
        break;
      }
    }

    const completedAt = new Date();
    const finalStatus = allPassed ? RunStatus.PASSED : RunStatus.FAILED;
    await this.prisma.testRun.update({
      where: { id: runId },
      data: { status: finalStatus, completedAt, duration: completedAt.getTime() - startedAt.getTime() },
    });
    await events.emitRunUpdated({
      id: runId,
      status: finalStatus,
      projectId: run.projectId,
      featureRunId: run.featureRunId,
      startedAt,
      completedAt,
      duration: completedAt.getTime() - startedAt.getTime(),
      errorMessage: null,
    });
  }
}
