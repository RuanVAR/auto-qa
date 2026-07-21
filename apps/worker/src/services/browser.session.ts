import { chromium, firefox, webkit, Browser, BrowserContext, Page, BrowserType } from 'playwright';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { scrubString } from '@qa-platform/shared';

const LAUNCH_TIMEOUT_MS = Number(process.env.BROWSER_LAUNCH_TIMEOUT_MS ?? 20_000);
const CLOSE_TIMEOUT_MS = Number(process.env.BROWSER_CLOSE_TIMEOUT_MS ?? 8_000);
const MAX_DIAGNOSTIC_EVENTS = 1_000;
const MAX_DIAGNOSTIC_TEXT = 4_000;

export type BrowserDiagnostic = {
  at: string;
  type: string;
  text?: string;
  url?: string;
  status?: number;
};

/**
 * Owns one Playwright browser + context + page for a single run.
 *
 * The reason this exists rather than calling chromium.launch() inline:
 *   1. Launches must fail fast — a stalled launch would otherwise leave the
 *      run blocked on the next step's 30 s default timeout, masking the real
 *      problem and starving the worker pool.
 *   2. Closes must never hang — a broken page can keep `browser.close()` busy
 *      forever, leaking pids that accumulate across runs and slowly degrade
 *      every subsequent test (this was a real production incident).
 *   3. Each run gets its own throwaway user-data-dir so cookies, service
 *      workers, IndexedDB, and HTTP cache from one test cannot leak into the
 *      next — important when many QA engineers share one worker.
 */
export class BrowserSession {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private userDataDir: string | null = null;
  private closed = false;
  // Playwright Video handle, captured when recordVideo is on. The .webm is only
  // finalized after context.close(), so videoPath() must be called post-close.
  private video: { path(): Promise<string> } | null = null;
  private readonly consoleLog: BrowserDiagnostic[] = [];
  private readonly networkLog: BrowserDiagnostic[] = [];

  async start(opts: {
    browserName?: string;
    headless?: boolean;
    baseURL: string;
    extraHTTPHeaders?: Record<string, string>;
    defaultTimeout?: number;
    /** Per-action delay in ms — see Environment.slowMoMs for sourcing. */
    slowMo?: number;
    /**
     * localStorage to seed into every page BEFORE app scripts run (via
     * addInitScript). Used by the Environment auth-seed so tests boot already
     * authenticated (e.g. { token: "<jwt>" }) without driving the UI login.
     */
    localStorageSeed?: Record<string, string>;
    /**
     * Directory to write a full-run screen recording into (Playwright
     * recordVideo). When set, the run leaves a .webm reviewable afterward;
     * retrieve its path via videoPath() AFTER close(). Independent of the live
     * CDP screencast (which keeps streaming the in-progress view).
     */
    recordVideoDir?: string;
    /** Viewport override (e.g. mobile sizes). Omit for Playwright's default. */
    viewport?: { width: number; height: number };
  }): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const browserName = opts.browserName ?? 'chromium';
    const headless = opts.headless !== false;

    // Isolation comes from `newContext()` below, which is already a clean
    // profile — we deliberately do NOT use launchPersistentContext.
    //
    // This directory is a staging area only. Note it is NOT passed to Playwright
    // as --user-data-dir. An earlier comment here claimed it was, and the
    // process reaper was written against that claim: it matched on a flag that
    // never appeared on any command line, so it silently reaped nothing for as
    // long as it has existed. See BROWSER_PROC_PATTERNS in process.reaper.ts.
    this.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-pw-'));

    const launcher: BrowserType = browserName === 'firefox' ? firefox
      : browserName === 'webkit' ? webkit
      : chromium;

    const launchPromise = (async () => {
      this.browser = await launcher.launch({ headless, ...(opts.slowMo ? { slowMo: opts.slowMo } : {}) });
      const ctx = await this.browser.newContext({
        baseURL: opts.baseURL,
        extraHTTPHeaders: opts.extraHTTPHeaders ?? {},
        ...(opts.recordVideoDir ? { recordVideo: { dir: opts.recordVideoDir } } : {}),
        ...(opts.viewport ? { viewport: opts.viewport } : {}),
      });
      this.context = ctx;
      // Seed localStorage (e.g. an auth token) before any app script runs, so
      // the SPA boots authenticated. addInitScript runs at document-start on
      // every page/navigation for the context's origin.
      if (opts.localStorageSeed && Object.keys(opts.localStorageSeed).length > 0) {
        await ctx.addInitScript((seed: Record<string, string>) => {
          try {
            for (const k of Object.keys(seed)) window.localStorage.setItem(k, seed[k]);
          } catch {
            /* localStorage may be unavailable on about:blank — ignored */
          }
        }, opts.localStorageSeed);
      }
      const page = await ctx.newPage();
      this.page = page;
      this.attachDiagnostics(page);
      if (opts.recordVideoDir) this.video = (page.video() as { path(): Promise<string> } | null) ?? null;
      if (opts.defaultTimeout) page.setDefaultTimeout(opts.defaultTimeout);
      return { browser: this.browser, context: ctx, page };
    })();

    return await this.race(launchPromise, LAUNCH_TIMEOUT_MS, 'Browser launch');
  }

  /**
   * Tear down the browser, never hanging. Order:
   *   1. Try graceful close, racing each step against CLOSE_TIMEOUT_MS.
   *   2. If anything stalls, fall through to forceKill which sends SIGKILL
   *      to the underlying browser process and resolves immediately.
   *   3. Always remove the user-data-dir to keep /tmp clean.
   *
   * Idempotent: safe to call from a `finally` even if start() already threw.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.race(this.page?.close(), CLOSE_TIMEOUT_MS, 'page.close').catch(() => {});
      await this.race(this.context?.close(), CLOSE_TIMEOUT_MS, 'context.close').catch(() => {});
      await this.race(this.browser?.close(), CLOSE_TIMEOUT_MS, 'browser.close').catch(() => {});
    } finally {
      this.forceKill();
      await this.removeUserDataDir();
    }
  }

  /**
   * SIGKILL the browser process tree. Called on close() and also externally
   * by the abort watchdog when a run is cancelled and we cannot wait for
   * graceful shutdown.
   */
  forceKill(): void {
    try {
      // Playwright's Browser has a `process()` method at runtime that returns
      // the spawned ChildProcess (chromium-only). It's not on the public type
      // so we cast — calling .kill('SIGKILL') is the only way to guarantee
      // the underlying Chromium process tree dies when graceful close hangs.
      const proc = (this.browser as unknown as { process?: () => { killed: boolean; kill: (sig: string) => void } | null })?.process?.();
      if (proc && !proc.killed) {
        proc.kill('SIGKILL');
      }
    } catch {
      // Process may already be gone; nothing to do.
    }
  }

  /**
   * Resolve the recorded video's local path. Only valid AFTER close() (the
   * .webm is finalized on context close). Returns null when recording was off
   * or the file isn't available.
   */
  async videoPath(): Promise<string | null> {
    try {
      return this.video ? await this.video.path() : null;
    } catch {
      return null;
    }
  }

  diagnostics(): { console: BrowserDiagnostic[]; network: BrowserDiagnostic[] } {
    return { console: [...this.consoleLog], network: [...this.networkLog] };
  }

  private attachDiagnostics(page: Page): void {
    const add = (target: BrowserDiagnostic[], entry: BrowserDiagnostic) => {
      if (target.length >= MAX_DIAGNOSTIC_EVENTS) return;
      target.push({
        ...entry,
        text: entry.text ? scrubString(entry.text).slice(0, MAX_DIAGNOSTIC_TEXT) : undefined,
        url: entry.url ? scrubString(entry.url).slice(0, MAX_DIAGNOSTIC_TEXT) : undefined,
      });
    };

    page.on('console', (message) => add(this.consoleLog, {
      at: new Date().toISOString(), type: message.type(), text: message.text(),
    }));
    page.on('pageerror', (error) => add(this.consoleLog, {
      at: new Date().toISOString(), type: 'pageerror', text: error.message,
    }));
    page.on('requestfailed', (request) => add(this.networkLog, {
      at: new Date().toISOString(), type: 'requestfailed', url: request.url(),
      text: request.failure()?.errorText,
    }));
    page.on('response', (response) => {
      if (response.status() >= 400) {
        add(this.networkLog, {
          at: new Date().toISOString(), type: 'response', url: response.url(), status: response.status(),
        });
      }
    });
  }

  private async removeUserDataDir(): Promise<void> {
    if (!this.userDataDir) return;
    try {
      await fs.rm(this.userDataDir, { recursive: true, force: true });
    } catch {
      // Reaper will pick this up on the next cycle.
    }
    this.userDataDir = null;
  }

  /**
   * Run a promise with a hard deadline. If it doesn't settle in time, reject
   * with a clear error rather than leaving the caller blocked indefinitely.
   * Accepts undefined (no-op) so callers can pass `this.page?.close()`.
   */
  private async race<T>(p: Promise<T> | undefined, ms: number, label: string): Promise<T> {
    if (!p) return undefined as unknown as T;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        p,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label} exceeded ${ms} ms`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
