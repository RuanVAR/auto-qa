import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const execP = promisify(exec);

const REAPER_INTERVAL_MS = Number(process.env.REAPER_INTERVAL_MS ?? 60_000);
// Don't reap a process younger than this — it might be a healthy in-flight run.
const REAP_MIN_AGE_SEC = Number(process.env.REAPER_MIN_AGE_SEC ?? 600); // 10 min
const TMP_DIR_PREFIX = 'qa-pw-';

/**
 * Background sweeper. Two responsibilities:
 *
 *   1. Kill orphaned Chromium processes left behind by crashed/aborted runs.
 *      `BrowserSession.close()` covers the happy + SIGKILL paths, but a node
 *      process crash before close() runs would leave Chromium pids dangling.
 *      Without this they accumulate over days and exhaust file descriptors.
 *
 *   2. Remove stale `qa-pw-*` user-data-dirs in the system tmp dir. Each run
 *      gets one; the session removes its own on close, but only on success.
 *      A crashed worker leaves them behind — at ~50 MB each, /tmp fills up
 *      fast. We delete any that haven't been modified in REAP_MIN_AGE_SEC.
 *
 * Both operations are conservative on age (default: 10 min) so an in-flight
 * long-running test is never collected by mistake.
 */
export class ProcessReaper {
  private timer: NodeJS.Timeout | null = null;

  start(): void {
    if (this.timer) return;
    // Stagger the first run so worker startup is fast — gives the first jobs
    // time to claim their browsers before we start looking for orphans.
    this.timer = setInterval(() => {
      this.tick().catch((err) => {
        console.warn('[Reaper] tick failed:', err?.message ?? err);
      });
    }, REAPER_INTERVAL_MS);
    // Don't keep the event loop alive just for the reaper.
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Single sweep — exposed so tests / health checks can trigger it manually. */
  async tick(): Promise<{ killed: number; dirs: number }> {
    const [killed, dirs] = await Promise.all([
      this.killOrphanChromium(),
      this.removeStaleUserDataDirs(),
    ]);
    if (killed > 0 || dirs > 0) {
      console.log(`[Reaper] killed=${killed} dirs=${dirs}`);
    }
    return { killed, dirs };
  }

  /**
   * Find Chromium pids whose --user-data-dir is one of our `qa-pw-*` tempdirs,
   * older than the cutoff, and SIGKILL them. Matching by tempdir path is the
   * safest filter — never touches the QA engineer's own browsers.
   */
  private async killOrphanChromium(): Promise<number> {
    const cutoffSec = REAP_MIN_AGE_SEC;
    // ps output: pid, etime (seconds), command. Mac/Linux `ps -eo` syntax:
    //   pid, etimes (elapsed seconds), command
    let stdout = '';
    try {
      const result = await execP(`ps -eo pid=,etimes=,command= 2>/dev/null`, { maxBuffer: 4 * 1024 * 1024 });
      stdout = result.stdout;
    } catch {
      return 0;
    }

    const candidates = stdout
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes(TMP_DIR_PREFIX))
      .map(line => {
        const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
        if (!m) return null;
        return { pid: Number(m[1]), age: Number(m[2]), cmd: m[3] };
      })
      .filter((p): p is { pid: number; age: number; cmd: string } => p !== null && p.age >= cutoffSec);

    let killed = 0;
    for (const c of candidates) {
      try {
        process.kill(c.pid, 'SIGKILL');
        killed++;
      } catch {
        // Pid already gone — fine.
      }
    }
    return killed;
  }

  /**
   * Remove `qa-pw-*` directories in os.tmpdir() that haven't been touched in
   * REAP_MIN_AGE_SEC seconds. Each one is a discarded persistent-context
   * profile from BrowserSession; long runs may take minutes, so the age
   * threshold protects in-flight work.
   */
  private async removeStaleUserDataDirs(): Promise<number> {
    const tmp = os.tmpdir();
    let entries: string[];
    try {
      entries = await fs.readdir(tmp);
    } catch {
      return 0;
    }
    const cutoffMs = Date.now() - REAP_MIN_AGE_SEC * 1000;
    let removed = 0;
    for (const name of entries) {
      if (!name.startsWith(TMP_DIR_PREFIX)) continue;
      const full = path.join(tmp, name);
      try {
        const stat = await fs.stat(full);
        if (stat.mtimeMs > cutoffMs) continue;
        await fs.rm(full, { recursive: true, force: true });
        removed++;
      } catch {
        // Permission / race — skip.
      }
    }
    return removed;
  }
}
