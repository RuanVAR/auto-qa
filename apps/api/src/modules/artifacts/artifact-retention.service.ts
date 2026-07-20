import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { StorageProvider } from '@qa-platform/storage';
import { ArtifactType, IssueStatus } from '@prisma/client';
import { CronLock } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ARTIFACT_STORAGE } from './artifacts.service';

/**
 * Age-based artifact retention.
 *
 * Artifacts had no lifecycle policy of any kind: every run wrote a video and a
 * trace, and nothing ever removed them. In production `STORAGE_PROVIDER=local`,
 * so they accumulate on the same disk as Postgres — meaning unbounded artifact
 * growth does not merely waste space, it eventually stops the database writing
 * WAL. This sweep is the only thing bounding that.
 *
 * Policy is per-type because the value/size trade-off differs sharply:
 *   VIDEO      largest, least often revisited          → shortest retention
 *   TRACE      needed to debug a regression            → medium
 *   SCREENSHOT small, high evidentiary value           → longest
 *   LOG/HAR    small, useful alongside a trace         → medium
 *   REPORT     a deliberate artefact someone generated → never swept here
 *
 * Two exemptions override age entirely, because deleting these would destroy
 * evidence someone is actively relying on:
 *   1. artifacts belonging to a run linked to an unresolved Issue
 *   2. artifacts belonging to a run referenced by a GeneratedReport
 */
@Injectable()
export class ArtifactRetentionService {
  private readonly logger = new Logger(ArtifactRetentionService.name);

  /** Types that are never swept by age. */
  private static readonly NEVER_SWEEP: ReadonlySet<ArtifactType> = new Set([
    ArtifactType.REPORT,
  ]);

  /** Issue statuses that still count as "someone is working on this". */
  private static readonly UNRESOLVED: readonly IssueStatus[] = [
    IssueStatus.OPEN,
    IssueStatus.IN_PROGRESS,
    IssueStatus.READY_FOR_QA,
  ];

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ARTIFACT_STORAGE) private readonly storage: StorageProvider,
  ) {}

  private retentionDays(type: ArtifactType): number {
    const env = (k: string, d: number) => {
      const v = Number(process.env[k]);
      return Number.isFinite(v) && v > 0 ? v : d;
    };
    switch (type) {
      case ArtifactType.VIDEO:
        return env('RETENTION_VIDEO_DAYS', 14);
      case ArtifactType.TRACE:
        return env('RETENTION_TRACE_DAYS', 30);
      case ArtifactType.SCREENSHOT:
        return env('RETENTION_SCREENSHOT_DAYS', 90);
      case ArtifactType.LOG:
      case ArtifactType.HAR:
        return env('RETENTION_LOG_DAYS', 30);
      default:
        return env('RETENTION_DEFAULT_DAYS', 90);
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'artifact-retention' })
  @CronLock('artifact-retention', { ttl: 3600 })
  async sweep(): Promise<void> {
    if (process.env.ARTIFACT_RETENTION_ENABLED === 'false') {
      this.logger.log('artifact retention disabled by env — skipping');
      return;
    }

    const started = Date.now();
    let deleted = 0;
    let bytes = 0;
    let skipped = 0;

    try {
      const protectedRunIds = await this.protectedRunIds();

      for (const type of Object.values(ArtifactType)) {
        if (ArtifactRetentionService.NEVER_SWEEP.has(type)) continue;

        const cutoff = new Date(Date.now() - this.retentionDays(type) * 86_400_000);

        // Batched rather than loaded at once: on a host that has never swept,
        // the first run may match a very large number of rows.
        for (;;) {
          const batch = await this.prisma.artifact.findMany({
            where: {
              type,
              createdAt: { lt: cutoff },
              ...(protectedRunIds.size > 0
                ? { runId: { notIn: [...protectedRunIds] } }
                : {}),
            },
            select: { id: true, path: true, sizeBytes: true },
            take: 500,
          });
          if (batch.length === 0) break;

          for (const a of batch) {
            // Storage first, then the row. A crash between the two leaves an
            // orphaned row (harmless, and swept next time) rather than an
            // orphaned blob (invisible, and never reclaimed).
            try {
              await this.storage.delete(a.path);
            } catch (e) {
              // A missing object is the expected case on re-runs; anything else
              // is worth knowing about but must not stop the sweep.
              this.logger.debug(
                `could not delete ${a.path}: ${(e as Error).message}`,
              );
            }
            await this.prisma.artifact.delete({ where: { id: a.id } }).catch(() => {
              skipped += 1;
            });
            deleted += 1;
            bytes += a.sizeBytes ?? 0;
          }
        }
      }

      this.logger.log(
        `artifact retention: removed ${deleted} artifacts (${this.humanBytes(bytes)}), ` +
          `${skipped} skipped, in ${Date.now() - started}ms`,
      );
    } catch (e) {
      // Retention failing must never take the API down; the disk alert is the
      // backstop that makes a persistently failing sweep visible.
      this.logger.error(`artifact retention failed: ${(e as Error).message}`);
    }
  }

  /**
   * Runs whose artifacts are exempt from age-based deletion: anything attached
   * to an unresolved issue, or referenced by a generated report.
   */
  private async protectedRunIds(): Promise<Set<string>> {
    const [issueRuns, reportRuns] = await Promise.all([
      this.prisma.issue.findMany({
        where: {
          testRunId: { not: null },
          status: { in: [...ArtifactRetentionService.UNRESOLVED] },
        },
        select: { testRunId: true },
      }),
      this.prisma.generatedReport.findMany({
        where: { testRunSessionId: { not: null } },
        select: { testRunSessionId: true },
      }),
    ]);

    const ids = new Set<string>();
    for (const i of issueRuns) if (i.testRunId) ids.add(i.testRunId);

    // Reports reference a session, not a run — expand to the session's runs.
    const sessionIds = reportRuns
      .map((r) => r.testRunSessionId)
      .filter((s): s is string => Boolean(s));
    if (sessionIds.length > 0) {
      const runs = await this.prisma.testRun.findMany({
        where: { testRunSessionId: { in: sessionIds } },
        select: { id: true },
      });
      for (const r of runs) ids.add(r.id);
    }

    return ids;
  }

  private humanBytes(n: number): string {
    if (n < 1024) return `${n} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
      v /= 1024;
      i += 1;
    }
    return `${v.toFixed(1)} ${units[i]}`;
  }
}
