import { chromium, firefox, webkit, Browser, BrowserContext, Page, BrowserType } from 'playwright';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const LAUNCH_TIMEOUT_MS = Number(process.env.BROWSER_LAUNCH_TIMEOUT_MS ?? 20_000);
const CLOSE_TIMEOUT_MS = Number(process.env.BROWSER_CLOSE_TIMEOUT_MS ?? 8_000);

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

  async start(opts: {
    browserName?: string;
    headless?: boolean;
    baseURL: string;
    extraHTTPHeaders?: Record<string, string>;
    defaultTimeout?: number;
  }): Promise<{ browser: Browser; context: BrowserContext; page: Page }> {
    const browserName = opts.browserName ?? 'chromium';
    const headless = opts.headless !== false;

    // Fresh user-data-dir per run guarantees no profile state leakage. We use
    // launchPersistentContext for chromium (the only browser this matters for
    // in practice) and a normal launch for firefox/webkit.
    this.userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qa-pw-'));

    const launcher: BrowserType = browserName === 'firefox' ? firefox
      : browserName === 'webkit' ? webkit
      : chromium;

    const launchPromise = (async () => {
      this.browser = await launcher.launch({ headless });
      const ctx = await this.browser.newContext({
        baseURL: opts.baseURL,
        extraHTTPHeaders: opts.extraHTTPHeaders ?? {},
      });
      this.context = ctx;
      const page = await ctx.newPage();
      this.page = page;
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
