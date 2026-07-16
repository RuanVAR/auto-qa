import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { parseExpression } from 'cron-parser';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FeatureRunsService } from '../feature-runs/feature-runs.service';
import { FeatureRunStatus, RunMode } from '@prisma/client';
import { clampLimit } from '../../common/util/pagination';

export interface UpsertRunScheduleDto {
  featureId: string;
  environmentId: string;
  cronExpr: string;
  timezone?: string;
  enabled?: boolean;
}

/**
 * Recurring AUTOMATED feature runs — "run feature X on env Y at cron Z".
 *
 * Mirrors ReportSchedulesService's in-process @Cron tick (not BullMQ
 * repeatables: those live in Redis and need two-way sync with DB rows on
 * every mutation; a DB-scanning tick has no such split-brain).
 *
 * Multi-instance safety: firing claims the row via an updateMany that
 * matches the OLD nextRunAt and advances it in the same statement — the
 * losing instance matches 0 rows and skips.
 */
@Injectable()
export class RunSchedulesService {
  private readonly logger = new Logger(RunSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly featureRuns: FeatureRunsService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────

  list(projectId: string) {
    return this.prisma.runSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        feature: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
        // Last few outcomes so the panel answers "is my nightly run healthy?"
        // without a click. Newest first; the row renders [0] as the last result.
        featureRuns: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: { id: true, status: true, createdAt: true, completedAt: true },
        },
      },
    });
  }

  /** Full run history for one schedule — the drill-in behind a schedule row. */
  async history(id: string, limit = 50) {
    await this.findOne(id); // 404 for an unknown schedule rather than an empty list
    return this.prisma.featureRun.findMany({
      where: { runScheduleId: id },
      orderBy: { createdAt: 'desc' },
      take: clampLimit(limit, { def: 50, max: 200 }),
      select: {
        id: true,
        status: true,
        createdAt: true,
        startedAt: true,
        completedAt: true,
        duration: true,
        testRuns: { select: { status: true } },
      },
    });
  }

  async create(projectId: string, userId: string, dto: UpsertRunScheduleDto) {
    await this.validateTarget(projectId, dto.featureId, dto.environmentId);
    const nextRunAt = this.nextFire(dto.cronExpr, dto.timezone ?? 'UTC');
    return this.prisma.runSchedule.create({
      data: {
        projectId,
        featureId: dto.featureId,
        environmentId: dto.environmentId,
        cronExpr: dto.cronExpr,
        timezone: dto.timezone ?? 'UTC',
        enabled: dto.enabled ?? true,
        nextRunAt,
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: Partial<UpsertRunScheduleDto>) {
    const existing = await this.findOne(id);
    if (dto.featureId || dto.environmentId) {
      await this.validateTarget(
        existing.projectId,
        dto.featureId ?? existing.featureId,
        dto.environmentId ?? existing.environmentId,
      );
    }
    const cronExpr = dto.cronExpr ?? existing.cronExpr;
    const timezone = dto.timezone ?? existing.timezone;
    // Re-anchor the next fire whenever cadence or enablement changes.
    const nextRunAt = this.nextFire(cronExpr, timezone);
    return this.prisma.runSchedule.update({
      where: { id },
      data: { ...dto, cronExpr, timezone, nextRunAt },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.runSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Run schedule not found');
    return s;
  }

  async remove(id: string) {
    await this.findOne(id); // clean 404 instead of Prisma P2025 → 500
    return this.prisma.runSchedule.delete({ where: { id } });
  }

  /** Preview the next N fire times — powers the UI's cron validation. */
  preview(cronExpr: string, timezone = 'UTC', count = 3): string[] {
    const it = this.parse(cronExpr, timezone);
    return Array.from({ length: count }, () => it.next().toISOString());
  }

  // ─── Cron tick ─────────────────────────────────────────────────────

  @Cron(CronExpression.EVERY_MINUTE, { name: 'run-schedules-tick' })
  async tick(): Promise<void> {
    const now = new Date();
    let due: Awaited<ReturnType<typeof this.prisma.runSchedule.findMany>>;
    try {
      due = await this.prisma.runSchedule.findMany({
        where: { enabled: true, nextRunAt: { lte: now } },
      });
    } catch (err) {
      this.logger.error(`tick failed to load schedules: ${(err as Error).message}`);
      return;
    }

    for (const s of due) {
      try {
        await this.fire(s);
      } catch (err) {
        this.logger.error(`schedule ${s.id} failed: ${(err as Error).message}`);
      }
    }
  }

  private async fire(s: {
    id: string; projectId: string; featureId: string; environmentId: string;
    cronExpr: string; timezone: string; nextRunAt: Date | null; createdById: string;
  }): Promise<void> {
    // Claim: advance nextRunAt only if it still holds the value we read.
    // A concurrent instance that already claimed it matches 0 rows.
    const next = this.nextFire(s.cronExpr, s.timezone);
    const claimed = await this.prisma.runSchedule.updateMany({
      where: { id: s.id, nextRunAt: s.nextRunAt },
      data: { nextRunAt: next, lastRunAt: new Date() },
    });
    if (claimed.count === 0) return;

    // Guard rails — the env gate inside start() re-checks supportsAutomation,
    // but checking here first turns config drift into a log line instead of
    // a thrown-and-swallowed run attempt every minute.
    const env = await this.prisma.environment.findUnique({
      where: { id: s.environmentId },
      select: { supportsAutomation: true, isActive: true, deletedAt: true },
    });
    if (!env || !env.isActive || env.deletedAt || !env.supportsAutomation) {
      this.logger.warn(`schedule ${s.id}: environment no longer automation-eligible — skipped`);
      return;
    }
    const feature = await this.prisma.feature.findFirst({
      where: { id: s.featureId, deletedAt: null },
      select: { id: true, testDefinitions: { where: { deletedAt: null }, select: { id: true }, take: 1 } },
    });
    if (!feature || feature.testDefinitions.length === 0) {
      this.logger.warn(`schedule ${s.id}: feature missing or has no tests — skipped`);
      return;
    }
    // Skip-if-running: don't stack a second automated run of the same
    // feature+env while the previous one is still going.
    const running = await this.prisma.featureRun.findFirst({
      where: {
        featureId: s.featureId,
        environmentId: s.environmentId,
        runMode: RunMode.AUTOMATED,
        status: { in: [FeatureRunStatus.RUNNING, FeatureRunStatus.PAUSED] },
      },
      select: { id: true },
    });
    if (running) {
      this.logger.log(`schedule ${s.id}: previous run ${running.id} still active — skipped`);
      return;
    }

    const { featureRun } = await this.featureRuns.start(
      s.featureId,
      { runMode: 'AUTOMATED', environmentId: s.environmentId, trigger: 'scheduled' },
      s.createdById, // attribution: the schedule's creator
      { runScheduleId: s.id }, // back-link so the run shows in this schedule's history
    );
    await this.prisma.runSchedule.update({
      where: { id: s.id },
      data: { lastFeatureRunId: featureRun.id },
    });
    this.logger.log(`[scheduled-run] schedule ${s.id} → featureRun ${featureRun.id}`);
  }

  // ─── Helpers ───────────────────────────────────────────────────────

  private parse(cronExpr: string, timezone: string) {
    try {
      return parseExpression(cronExpr, { tz: timezone });
    } catch (err) {
      throw new BadRequestException(`Invalid cron expression or timezone: ${(err as Error).message}`);
    }
  }

  private nextFire(cronExpr: string, timezone: string): Date {
    return this.parse(cronExpr, timezone).next().toDate();
  }

  private async validateTarget(projectId: string, featureId: string, environmentId: string) {
    const feature = await this.prisma.feature.findFirst({
      where: { id: featureId, deletedAt: null, module: { projectId } },
      select: { id: true },
    });
    if (!feature) throw new BadRequestException('Feature not found in this project');
    const env = await this.prisma.environment.findFirst({
      where: { id: environmentId, projectId, deletedAt: null },
      select: { supportsAutomation: true },
    });
    if (!env) throw new BadRequestException('Environment not found in this project');
    if (!env.supportsAutomation) {
      throw new BadRequestException(
        'This environment is not enabled for automation. Turn on "Supports automation" in the environment settings first.',
      );
    }
  }
}
