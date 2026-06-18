import { PrismaClient, RunStatus, StepStatus, StepType, TestCaseType, Prisma } from '@prisma/client';
import { Browser, BrowserContext, Page } from 'playwright';
import { StepRunner } from '../steps/step.runner';
import { ApiStepRunner } from '../steps/api.step.runner';
import { ShellStepRunner } from '../steps/shell.step.runner';
import { ArtifactCollector } from '../collectors/artifact.collector';
import { ScreencastService } from '../services/screencast.service';
import { WorkerEventsService } from '../services/worker.events.service';
import { BrowserSession } from '../services/browser.session';
import { resolveAuthSeed, AUTH_SEED_VAR } from '../services/auth-seed';
import { StorageProvider, createStorageProvider } from '@qa-platform/storage';
import { decryptSecret } from '@qa-platform/shared';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

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

// Phase 5c — env config is encrypted at rest. Dual-read: prefer the ciphertext
// columns, fall back to legacy plaintext JSON for rows not yet re-saved.
type EnvCryptoRow = {
  variables?: unknown; variablesCiphertext?: Uint8Array | null; variablesKeyId?: string | null;
  headers?: unknown; headersCiphertext?: Uint8Array | null; headersKeyId?: string | null;
};
function resolveEnvVariables(env: EnvCryptoRow): Record<string, string> {
  if (env.variablesCiphertext && env.variablesKeyId) {
    try { return decryptSecret(Buffer.from(env.variablesCiphertext), env.variablesKeyId); } catch { return {}; }
  }
  return (env.variables as Record<string, string>) ?? {};
}
function resolveEnvHeaders(env: EnvCryptoRow): Record<string, string> {
  if (env.headersCiphertext && env.headersKeyId) {
    try { return decryptSecret(Buffer.from(env.headersCiphertext), env.headersKeyId); } catch { return {}; }
  }
  return (env.headers as Record<string, string>) ?? {};
}

/**
 * Decrypt the environment's named credentials and flatten them into run
 * variables: a credential "login" with { EMAIL, PASSWORD } becomes
 * {{LOGIN_EMAIL}} / {{LOGIN_PASSWORD}}. Best-effort per credential.
 */
async function resolveEnvCredentialVars(
  prisma: PrismaClient,
  environmentId: string | null | undefined,
): Promise<Record<string, string>> {
  if (!environmentId) return {};
  const creds = await prisma.environmentCredential.findMany({
    where: { environmentId },
    select: { name: true, secretsCiphertext: true, secretsKeyId: true },
  });
  const vars: Record<string, string> = {};
  for (const c of creds) {
    try {
      const fields = decryptSecret(Buffer.from(c.secretsCiphertext), c.secretsKeyId);
      const prefix = c.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
      for (const [k, v] of Object.entries(fields)) vars[`${prefix}_${k}`] = v;
    } catch {
      // skip a credential that fails to decrypt (e.g. KEK rotated out)
    }
  }
  return vars;
}

export class RunExecutor {
  private readonly storage: StorageProvider;

  constructor(private readonly prisma: PrismaClient) {
    // One provider per executor — backend chosen by STORAGE_PROVIDER, local
    // fallback. The local backend roots at ARTIFACT_STORAGE_PATH; cloud
    // backends ignore it.
    this.storage = createStorageProvider(process.env, {
      localBasePath: process.env.ARTIFACT_STORAGE_PATH ?? './artifacts',
    });
  }

  async execute(runId: string): Promise<void> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: { testDefinition: true, environment: true },
    });
    if (!run) throw new Error(`Run ${runId} not found`);

    const startedAt = new Date();
    // Per-run claim (Phase 6e): atomically transition PENDING/QUEUED → RUNNING.
    // If 0 rows update, another worker already claimed this run (duplicate
    // delivery / manual re-trigger) or it's no longer runnable — bail rather
    // than clobber the in-flight execution. A crashed RUNNING run is recovered
    // by the stuck-run reaper, not by re-delivery.
    const claim = await this.prisma.testRun.updateMany({
      where: { id: runId, status: { in: [RunStatus.PENDING, RunStatus.QUEUED] } },
      data: { status: RunStatus.RUNNING, startedAt },
    });
    if (claim.count === 0) {
      console.warn(`[run ${runId}] already claimed or not runnable — skipping duplicate execution`);
      return;
    }

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
    // LOCAL temp staging dir — Playwright writes here, the collector uploads
    // each file through the storage provider and then deletes it. The final
    // resting place (local disk / bucket) is owned by the provider, not this
    // path. Using os.tmpdir keeps staging separate from ARTIFACT_STORAGE_PATH
    // so the local provider never copies a file onto itself.
    const runDir = path.join(os.tmpdir(), 'qa-run-artifacts', runId);

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
      // Remove the local staging dir. register() already unlinks each
      // uploaded file; this sweeps up anything that failed to upload so the
      // worker's tmp doesn't grow across runs.
      await fs.promises.rm(runDir, { recursive: true, force: true }).catch(() => {});
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
    // Whole-run deadline. RUN_TIMEOUT_MS was a documented env var that was
    // never actually enforced — a hung step (infinite wait, never-resolving
    // navigation) would run unbounded until the API's stuck-run cron reaped
    // it ~60 min later. Enforce it here so a wedged run terminates at the
    // intended cap and reports an honest TIMED_OUT.
    const runTimeoutMs = Number(process.env.RUN_TIMEOUT_MS) || 300_000;
    const deadline = startedAt.getTime() + runTimeoutMs;

    // Full-run video: durable .webm reviewable after the run (separate from the
    // live CDP screencast). On by default; disable per-test via config or via
    // RECORD_VIDEO=false on the worker. Written to a subdir of runDir so it
    // survives the throwaway user-data-dir, and registered AFTER close().
    const recordVideo = process.env.RECORD_VIDEO !== 'false' && config.recordVideo !== false;
    const recordVideoDir = recordVideo ? path.join(runDir, 'video') : undefined;

    const session = new BrowserSession();
    let browser: Browser | null = null;
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let screencast: ScreencastService | null = null;
    let cancelled = false;
    let timedOut = false;
    let abortWatcher: NodeJS.Timeout | null = null;

    try {
      // Bounded launch — fails fast if Chromium can't start, instead of
      // blocking subsequent steps on their own 30s default timeouts.
      // Pull per-env slow-mo if set. Useful in dev — lets the tester
      // actually see Playwright drive the browser instead of blink-fast
      // execution. UAT / Prod envs default to 0 (full speed).
      const slowMoMs = (run!.environment as { slowMoMs?: number | null }).slowMoMs ?? 0;
      // Environment-level auth seed: mint/inject a token so the test boots
      // authenticated (no per-test UI login). Configured via the env's
      // `__authSeed` variable — see services/auth-seed.ts.
      const envVariables = resolveEnvVariables(run!.environment);
      const localStorageSeed = await resolveAuthSeed(envVariables);
      if (localStorageSeed) {
        console.log(`[run ${runId}] auth-seed: injecting localStorage [${Object.keys(localStorageSeed).join(', ')}]`);
      }
      // Per-env named credentials → {{NAME_FIELD}} vars (Phase 5c).
      const credentialVars = await resolveEnvCredentialVars(this.prisma, run!.environmentId);
      const handles = await session.start({
        browserName,
        headless,
        baseURL: rewriteForWorker(run!.environment.baseUrl),
        extraHTTPHeaders: resolveEnvHeaders(run!.environment),
        defaultTimeout: timeout,
        slowMo: slowMoMs > 0 ? slowMoMs : undefined,
        localStorageSeed: localStorageSeed ?? undefined,
        recordVideoDir,
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
        // Run-level deadline check first — no DB round-trip needed. If the
        // run has blown past RUN_TIMEOUT_MS, force-kill the browser and flag
        // it as a timeout (distinct from a user cancel, so the final status
        // is TIMED_OUT not CANCELLED).
        if (!cancelled && Date.now() > deadline) {
          timedOut = true;
          cancelled = true; // breaks the step loop + drives teardown
          session.forceKill();
          return;
        }
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
      const collector = new ArtifactCollector(this.prisma, runId, runDir, this.storage);
      // Env-scoped variables are exposed as {{KEY}}, but the auth-seed config
      // (creds / token recipe) must NOT be interpolatable — strip it out.
      const { [AUTH_SEED_VAR]: _omitAuthSeed, ...stepVariables } = envVariables as Record<string, string>;
      const runner = new StepRunner(page, collector, rewriteForWorker(run!.environment.baseUrl), {
        // Env-scoped variables live on Environment.variables and are available
        // as {{KEY}} in any step input. They sit BELOW built-ins, so a test
        // can't shadow RUN_ID by setting one on the env.
        ...stepVariables,
        // Per-env credentials (e.g. {{LOGIN_EMAIL}}) sit above env vars but
        // below the built-ins.
        ...credentialVars,
        RUN_ID: runId,
        TEST_RUN_ID: runId,
        FEATURE_RUN_ID: run!.featureRunId ?? runId,
      });
      let allPassed = true;

      // Pre-step navigation: if the test doesn't start with a NAVIGATE,
      // Playwright would be sitting on about:blank when step 0 runs — which
      // makes every selector-based step (CLICK, FILL, WAIT_FOR_SELECTOR…)
      // fail immediately. This commonly happens with recorded tests where
      // the initial NAVIGATE was lost (e.g. emitted before the recorder was
      // paired). Land the page on the env's baseUrl first; if the user DID
      // record a NAVIGATE as step 0, it'll re-navigate harmlessly.
      const firstType = (steps[0]?.type as string | undefined) ?? '';
      const base = rewriteForWorker(run!.environment.baseUrl);
      if (steps.length > 0 && firstType !== 'NAVIGATE' && base) {
        try {
          console.log(`[run ${runId}] auto-navigating to ${base} (test doesn't start with NAVIGATE)`);
          await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 15000 });
        } catch (e) {
          console.warn(`[run ${runId}] pre-navigation to ${base} failed:`, (e as Error).message);
        }
      }

      for (let i = 0; i < steps.length; i++) {
        // Break immediately if the watchdog already flagged a timeout / abort
        // — otherwise we'd churn through the remaining steps creating rows
        // that all throw against the now-dead browser (the deadline doesn't
        // write CANCELLED to the DB, so the status check below wouldn't catch
        // it on its own).
        if (cancelled) break;
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
          // Per-step retry (Phase 6d): re-run a flaky step up to `retries`
          // times with a short backoff before failing. Aborts honour cancel.
          const maxRetries = Math.max(0, Math.min(5, Number((stepDef as { retries?: number }).retries ?? 0)));
          let result: unknown;
          let attempt = 0;
          for (;;) {
            try {
              result = await runner.runStep(stepDef, {
                stepIndex: i,
                stepName: (stepDef.name as string) ?? `Step ${i + 1}`,
              });
              break;
            } catch (stepErr) {
              if (cancelled || attempt >= maxRetries) throw stepErr;
              attempt++;
              console.log(`[run ${runId}] step ${i} failed, retry ${attempt}/${maxRetries}`);
              await page.waitForTimeout(500 * attempt).catch(() => {});
            }
          }
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
          // continueOnFail (Phase 6d): keep running subsequent steps so the run
          // surfaces every failure, not just the first. The test still ends
          // FAILED (allPassed is already false).
          if ((stepDef as { continueOnFail?: boolean }).continueOnFail === true) continue;
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
      // Timeout takes precedence over the generic cancel — a deadline kill
      // sets BOTH timedOut and cancelled, but the honest status is TIMED_OUT.
      const finalStatus = timedOut
        ? RunStatus.TIMED_OUT
        : cancelled ? RunStatus.CANCELLED : allPassed ? RunStatus.PASSED : RunStatus.FAILED;
      const timeoutMessage = timedOut
        ? `Run exceeded the ${Math.round(runTimeoutMs / 1000)}s run timeout (RUN_TIMEOUT_MS) and was terminated.`
        : null;
      await this.prisma.testRun.update({
        where: { id: runId },
        data: {
          status: finalStatus,
          completedAt,
          duration: completedAt.getTime() - startedAt.getTime(),
          ...(timeoutMessage ? { errorMessage: timeoutMessage } : {}),
        },
      });
      await events.emitRunUpdated({
        id: runId,
        status: finalStatus,
        projectId: run!.projectId,
        featureRunId: run!.featureRunId,
        startedAt,
        completedAt,
        duration: completedAt.getTime() - startedAt.getTime(),
        errorMessage: timeoutMessage,
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
      // The recordVideo .webm is finalized only after the context closes, so
      // register it now (best-effort — never let it block teardown). One video
      // per run, reviewable from the run detail page.
      if (recordVideo) {
        try {
          const videoPath = await session.videoPath();
          if (videoPath) {
            const videoCollector = new ArtifactCollector(this.prisma, runId, runDir, this.storage);
            await videoCollector.register('VIDEO', 'run-video.webm', videoPath, {
              testDefinitionId: run!.testDefinitionId,
              trigger: 'run',
            });
          }
        } catch (err) {
          console.warn(`[run ${runId}] video registration failed: ${(err as Error).message}`);
        }
      }
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
    const collector = new ArtifactCollector(this.prisma, runId, runDir, this.storage);
    const credentialVars = await resolveEnvCredentialVars(this.prisma, run.environmentId);
    const runner = new ApiStepRunner(rewriteForWorker(run.environment.baseUrl), {
      ...resolveEnvVariables(run.environment),
      ...credentialVars,
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
    const collector = new ArtifactCollector(this.prisma, runId, runDir, this.storage);
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
