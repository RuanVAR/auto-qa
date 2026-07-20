import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CronLock } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ReportsService } from '../reports/reports.service';
import {
  ReportFrequency, ReportScope, ReportType, ReportFormat, Prisma,
} from '@prisma/client';

interface CreateScheduleDto {
  name: string;
  scope: ReportScope;
  scopeId?: string;
  phaseId?: string;
  frequency: ReportFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  sendTime: string;          // "09:00"
  recipients: string[];
  includeCharts?: boolean;
  /** Optional saved filter spec — scopes the scheduled report to a tag/epic/
   *  status/search subset, mirroring the "Use current filters" report path. */
  appliedFilters?: {
    search?: string; tags?: string[]; epics?: string[];
    moduleId?: string; featureId?: string;
    status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
  };
}

/**
 * Scheduled reports.
 *
 * Two responsibilities:
 *
 *   1. CRUD around `PhaseReportSchedule` rows (called from API endpoints).
 *   2. A 5-minute cron tick that scans for schedules whose next-fire time
 *      has passed, generates the report via ReportsService, and updates
 *      `lastSentAt` so we don't re-fire on the next tick.
 *
 * The cron runs in the API process — running it in the worker would be
 * cleaner but requires moving the report templating engine over too. For
 * now this is fine; report generation is cheap (sub-second HTML).
 *
 * Email delivery is logged to stdout — same temporary stub as the handover
 * notification in R3. Replace with a real SMTP send when notifications
 * gains mail support; the recipients are already persisted on the schedule
 * so no data is lost.
 */
@Injectable()
export class ReportSchedulesService {
  private readonly logger = new Logger(ReportSchedulesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: ReportsService,
  ) {}

  // ─── CRUD ──────────────────────────────────────────────────────────

  list(projectId: string) {
    return this.prisma.phaseReportSchedule.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: {
        phase: { select: { id: true, name: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async create(projectId: string, userId: string, dto: CreateScheduleDto) {
    this.validateTime(dto);
    return this.prisma.phaseReportSchedule.create({
      data: {
        projectId,
        name: dto.name,
        scope: dto.scope,
        scopeId: dto.scopeId,
        phaseId: dto.phaseId,
        frequency: dto.frequency,
        dayOfWeek: dto.frequency === ReportFrequency.WEEKLY ? dto.dayOfWeek ?? 1 : null,
        dayOfMonth: dto.frequency === ReportFrequency.MONTHLY ? dto.dayOfMonth ?? 1 : null,
        sendTime: dto.sendTime,
        recipients: dto.recipients,
        includeCharts: dto.includeCharts ?? true,
        appliedFilters: dto.appliedFilters ?? Prisma.JsonNull,
        createdById: userId,
      },
    });
  }

  async update(id: string, dto: Partial<CreateScheduleDto>) {
    if (dto.sendTime || dto.frequency) this.validateTime({ ...await this.findOne(id), ...dto });
    const { appliedFilters, ...rest } = dto;
    return this.prisma.phaseReportSchedule.update({
      where: { id },
      data: {
        ...rest,
        ...(appliedFilters !== undefined ? { appliedFilters: appliedFilters ?? Prisma.JsonNull } : {}),
      },
    });
  }

  async findOne(id: string) {
    const s = await this.prisma.phaseReportSchedule.findUnique({ where: { id } });
    if (!s) throw new NotFoundException('Schedule not found');
    return s;
  }

  async remove(id: string) {
    // findOne throws NotFoundException if the id doesn't exist — without
    // this pre-check, a bare prisma.delete() on a missing id throws Prisma
    // error P2025 which Nest serialises as 500 Internal Server Error. The
    // client should see a clean 404 and a helpful message ("Schedule not
    // found") so it can decide whether to refresh the list (already deleted
    // elsewhere) or surface the error to the user.
    await this.findOne(id);
    return this.prisma.phaseReportSchedule.delete({ where: { id } });
  }

  /** Run a schedule immediately (manual trigger from the UI/admin). */
  async runNow(id: string, userId: string) {
    const s = await this.findOne(id);
    return this.runSchedule(s, userId);
  }

  private validateTime(s: { sendTime?: string; frequency?: ReportFrequency; dayOfWeek?: number | null; dayOfMonth?: number | null }) {
    if (s.sendTime && !/^\d{2}:\d{2}$/.test(s.sendTime)) {
      throw new BadRequestException('sendTime must be HH:mm');
    }
    if (s.frequency === ReportFrequency.WEEKLY && (s.dayOfWeek == null || s.dayOfWeek < 0 || s.dayOfWeek > 6)) {
      throw new BadRequestException('dayOfWeek must be 0–6 for WEEKLY');
    }
    if (s.frequency === ReportFrequency.MONTHLY && (s.dayOfMonth == null || s.dayOfMonth < 1 || s.dayOfMonth > 28)) {
      throw new BadRequestException('dayOfMonth must be 1–28 for MONTHLY');
    }
  }

  // ─── Cron tick ─────────────────────────────────────────────────────

  /**
   * Every 5 minutes, scan due schedules and run them. We use 5 minutes (not
   * 1) so a brief outage doesn't fire 60 missed schedules on recovery; the
   * "did this fire today already" check on lastSentAt makes it idempotent.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'report-schedules-tick' })
  @CronLock('report-schedules-tick', { ttl: 600 })
  async tick(): Promise<void> {
    const now = new Date();
    let due: Array<Awaited<ReturnType<typeof this.prisma.phaseReportSchedule.findFirst>>>;
    try {
      due = await this.prisma.phaseReportSchedule.findMany({
        where: { /* no status field — fetch all and filter in-process */ },
      });
    } catch (err) {
      this.logger.error(`tick failed to load schedules: ${(err as Error).message}`);
      return;
    }

    for (const s of due) {
      if (!s) continue;
      if (!this.isDue(s, now)) continue;
      // Skip if already sent in the current period.
      if (this.alreadySentInThisPeriod(s, now)) continue;
      try {
        await this.runSchedule(s, s.createdById);
      } catch (err) {
        this.logger.error(`schedule ${s.id} failed: ${(err as Error).message}`);
      }
    }
  }

  /** Whether `now` is at or past the schedule's most recent fire time. */
  private isDue(s: { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; sendTime: string }, now: Date): boolean {
    const [hh, mm] = s.sendTime.split(':').map(Number);
    const target = new Date(now);
    target.setSeconds(0, 0);
    target.setHours(hh, mm);
    if (s.frequency === ReportFrequency.WEEKLY && s.dayOfWeek !== null) {
      if (now.getDay() !== s.dayOfWeek) return false;
    }
    if (s.frequency === ReportFrequency.MONTHLY && s.dayOfMonth !== null) {
      if (now.getDate() !== s.dayOfMonth) return false;
    }
    return now >= target;
  }

  private alreadySentInThisPeriod(s: { frequency: ReportFrequency; lastSentAt: Date | null }, now: Date): boolean {
    if (!s.lastSentAt) return false;
    const last = s.lastSentAt;
    switch (s.frequency) {
      case ReportFrequency.DAILY:
        return last.toDateString() === now.toDateString();
      case ReportFrequency.WEEKLY: {
        // Same calendar week (ISO-ish: Sun-anchored). Fine for our 5-min tick.
        const ms = 7 * 24 * 60 * 60 * 1000;
        return now.getTime() - last.getTime() < ms;
      }
      case ReportFrequency.MONTHLY:
        return last.getMonth() === now.getMonth() && last.getFullYear() === now.getFullYear();
    }
  }

  private async runSchedule(
    s: { id: string; projectId: string; scope: ReportScope; scopeId: string | null; phaseId: string | null; recipients: string[]; name: string; appliedFilters?: unknown },
    userId: string,
  ) {
    // Map ReportScope → ReportType. PHASE schedules use ReportType.PHASE
    // when phaseId is set; otherwise the doc says scope alone is fine.
    const type: ReportType = s.phaseId
      ? ReportType.PHASE
      : ({ FEATURE: ReportType.FEATURE, MODULE: ReportType.MODULE, PROJECT: ReportType.PROJECT }[s.scope as keyof typeof ReportScope]);

    // Carry the schedule's saved filter spec (if any) so the generated report
    // is scoped + annotated exactly like the filtered list view that created it.
    const appliedFilters = (s.appliedFilters && typeof s.appliedFilters === 'object')
      ? (s.appliedFilters as Record<string, unknown>)
      : undefined;
    const base = {
      projectId: s.projectId, type,
      featureId: s.scope === ReportScope.FEATURE ? s.scopeId ?? undefined : undefined,
      moduleId: s.scope === ReportScope.MODULE ? s.scopeId ?? undefined : undefined,
      phaseId: s.phaseId ?? undefined,
      includeFeature: true, includeProject: true,
      recipientEmails: s.recipients,
      ...(appliedFilters ? { appliedFilters } : {}),
    };

    // Try PDF first (better for email attachments). If Playwright isn't
    // available in this process the service falls back to HTML.
    let format: ReportFormat = ReportFormat.PDF;
    let generated;
    try {
      generated = await this.reports.generate(userId, { ...base, format });
    } catch {
      format = ReportFormat.HTML;
      generated = await this.reports.generate(userId, { ...base, format });
    }

    await this.prisma.phaseReportSchedule.update({
      where: { id: s.id },
      data: { lastSentAt: new Date() },
    });

    this.logger.log(`[scheduled-report] "${s.name}" generated (${generated.report.title}) — recipients: ${s.recipients.join(', ')} — artifact: ${generated.report.artifactPath ?? 'pending'}`);
    return { schedule: s.id, generated: generated.report };
  }
}
