import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EmailService } from '../../email/email.service';
import { webUrl } from '../../common/config/urls';
import { appName } from '../../common/config/app';
import { ReportType, ReportFormat, RunStatus, PhaseStatus, Prisma } from '@prisma/client';
import { StorageProvider } from '@qa-platform/storage';
import { createArtifactStorage } from '../../common/storage/artifact-storage';
import { QueueService } from '../queue/queue.service';
import { PlatformBrandingService } from '../platform/platform-branding.service';
import { StatsService } from '../stats/stats.service';
import { streamToBuffer } from '../../common/util/stream';

interface GenerateReportPayload {
  configId?: string;
  projectId: string;
  type: ReportType;
  featureId?: string;
  moduleId?: string;
  phaseId?: string;
  /** Source QaWorkSession id when type=SESSION — drives the per-sitting
   *  rollup (tests run / passes / fails / issues) for "what did I get done
   *  in this session" reports. */
  workSessionId?: string;
  /** Source TestRunSession id — when set with type=SESSION, the rollup is
   *  sourced from a NAMED manual test run instead of a QaWorkSession (same
   *  payload shape, so the SESSION renderer is reused). */
  testRunSessionId?: string;
  environmentId?: string;
  includeSession?: boolean;
  includeFeature?: boolean;
  includeProject?: boolean;
  includeCharts?: boolean;
  /** Include the per-test pass/fail/bug list for the scoped feature(s) /
   *  module / session. Defaults true. */
  includeTests?: boolean;
  format?: ReportFormat; // legacy — reports now always render to PDF
  /** Optional email delivery — when present + non-empty, the rendered
   *  artifact is emailed to these addresses immediately after generation
   *  (PDF as attachment, HTML inline). Errors are logged but don't fail the
   *  generate request — the report itself is always saved. */
  recipientEmails?: string[];
  /** Optional free-form note included in the generated report body. */
  additionalText?: string;
  /** Optional saved filter spec — when present, the report adds a "Filtered
   *  tests" section scoped to the matching test definitions, and echoes the
   *  filters in the header. Mirrors the tests-browse filter params so a
   *  filtered list view becomes a report 1:1. */
  appliedFilters?: ReportFilters;
}

export interface ReportFilters {
  search?: string;
  tags?: string[];
  epics?: string[];
  moduleId?: string;
  featureId?: string;
  status?: 'PASSED' | 'FAILED' | 'OUTSTANDING';
}

/**
 * Reports — composable progress reports per the TESTING_PHASES_AND_REPORTS spec.
 *
 * Two layers:
 *   1. ReportConfig — saved reusable setup (admin saves "Weekly UAT" once)
 *   2. GeneratedReport — immutable snapshot rendered at a point in time
 *
 * The render pipeline:
 *   buildPayload(filters)  →  Prisma queries → structured JSON
 *                          ↓
 *                   renderHtml(payload)
 *                          ↓
 *                  (optional Puppeteer → PDF)
 *                          ↓
 *               write file → store path on GeneratedReport
 *
 * Puppeteer is loaded lazily so HTML-only requests don't pay the import cost.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly storage: StorageProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly queue: QueueService,
    private readonly platformBranding: PlatformBrandingService,
    private readonly stats: StatsService,
  ) {
    // Report PDFs go through the same artifact-scoped storage backend the worker
    // writes to (ARTIFACT_STORAGE_PATH).
    this.storage = createArtifactStorage();
  }

  /**
   * Opens a generated report's artifact for streaming through the storage
   * backend. Returns null when the report has no artifact yet (PDF still
   * rendering) or the object is missing.
   */
  async openArtifact(report: { artifactPath: string | null; title: string; format: ReportFormat }) {
    if (!report.artifactPath) return null;
    if (!(await this.storage.exists(report.artifactPath))) return null;
    const isPdf = report.format === ReportFormat.PDF;
    const filename = `${report.title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${isPdf ? 'pdf' : 'html'}`;
    return {
      mimeType: isPdf ? 'application/pdf' : 'text/html; charset=utf-8',
      filename,
      streamFull: () => this.storage.stream(report.artifactPath as string),
    };
  }

  // ─── Report configs (templates) ──────────────────────────────────────

  listConfigs(projectId: string) {
    return this.prisma.reportConfig.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
  }

  createConfig(projectId: string, userId: string, dto: GenerateReportPayload & { name: string }) {
    return this.prisma.reportConfig.create({
      data: {
        projectId,
        name: dto.name,
        type: dto.type,
        featureId: dto.featureId,
        moduleId: dto.moduleId,
        phaseId: dto.phaseId,
        environmentId: dto.environmentId,
        includeSession: dto.includeSession ?? false,
        includeFeature: dto.includeFeature ?? true,
        includeProject: dto.includeProject ?? false,
        includeCharts: dto.includeCharts ?? true,
        createdById: userId,
      },
    });
  }

  async deleteConfig(id: string) {
    return this.prisma.reportConfig.delete({ where: { id } });
  }

  /** projectId for a generated report — for object-level access checks on
   *  the report :id endpoints (get / download / preview), which were IDORs. */
  async getProjectIdForGenerated(id: string): Promise<string> {
    const r = await this.prisma.generatedReport.findUnique({ where: { id }, select: { projectId: true } });
    if (!r) throw new NotFoundException('Report not found');
    return r.projectId;
  }

  /** projectId for a saved report template — guards the delete endpoint. */
  async getProjectIdForConfig(id: string): Promise<string> {
    const c = await this.prisma.reportConfig.findUnique({ where: { id }, select: { projectId: true } });
    if (!c) throw new NotFoundException('Report template not found');
    return c.projectId;
  }

  // ─── Generation ─────────────────────────────────────────────────────

  /**
   * Generates a report from either an existing ReportConfig (if configId
   * is passed) or ad-hoc filters. Stores the snapshot + writes the artifact
   * file. Returns the GeneratedReport row.
   */
  async generate(userId: string, dto: GenerateReportPayload): Promise<{ report: { id: string; title: string; format: ReportFormat; artifactPath: string | null }; payload: object }> {
    let cfg: Awaited<ReturnType<typeof this.prisma.reportConfig.findUnique>> = null;
    if (dto.configId) {
      cfg = await this.prisma.reportConfig.findUnique({ where: { id: dto.configId } });
      if (!cfg) throw new NotFoundException('ReportConfig not found');
    }
    // Spread carefully — Prisma rows have `null` where the DTO uses
    // `undefined`. Coerce so downstream optional checks behave consistently.
    const merged: GenerateReportPayload = {
      ...(cfg ? {
        type: cfg.type,
        featureId: cfg.featureId ?? undefined,
        moduleId: cfg.moduleId ?? undefined,
        phaseId: cfg.phaseId ?? undefined,
        environmentId: cfg.environmentId ?? undefined,
        includeSession: cfg.includeSession,
        includeFeature: cfg.includeFeature,
        includeProject: cfg.includeProject,
        includeCharts: cfg.includeCharts,
        projectId: (cfg as { projectId?: string }).projectId,
      } : {}),
      ...dto,
    } as GenerateReportPayload;

    // SESSION reports without an explicit projectId — fall back to the
    // session's lastProjectId. Lets the WorkSessionBadge fire a global
    // "Generate Report" without knowing which project the user is in.
    if (merged.type === ReportType.SESSION && !merged.projectId && merged.workSessionId) {
      const sess = await this.prisma.qaWorkSession.findUnique({
        where: { id: merged.workSessionId }, select: { lastProjectId: true },
      });
      if (sess?.lastProjectId) merged.projectId = sess.lastProjectId;
    }
    if (!merged.projectId) throw new BadRequestException('projectId is required');
    if (!merged.type) throw new BadRequestException('type is required');

    const payload = await this.buildPayload(merged);
    if (merged.additionalText?.trim()) {
      (payload as Record<string, unknown>).additionalText = merged.additionalText.trim();
    }
    // Stamp resolved branding into the (frozen) payload so the PDF header — and
    // any later in-app re-render — shows the right logo + name. Resolution:
    // org → platform default → built-in AdVantage mark (handled by renderHtml).
    const brandProject = await this.prisma.project.findUnique({
      where: { id: merged.projectId },
      select: { org: { select: { name: true, logoUrl: true } } },
    });
    const platform = await this.platformBranding.get();
    const resolvedLogo = brandProject?.org?.logoUrl ?? platform.logoUrl ?? null;
    const resolvedName = brandProject?.org?.name ?? platform.appName ?? null;
    if (resolvedLogo || resolvedName) {
      (payload as Record<string, unknown>).orgBrand = { name: resolvedName, logoUrl: resolvedLogo };
    }
    // Reports always render to PDF for download + email. The HTML is an
    // internal render step (it's the PDF's input) and also the on-demand
    // in-app preview — it is never stored as the deliverable artifact.
    const format = ReportFormat.PDF;
    const title = this.titleFor(merged, payload);
    const html = this.renderHtml(title, payload, merged);

    // Resolve cascade scope keys so this report shows up in module + project
    // Reports views without join gymnastics.
    // - feature-scoped report → write featureId + derive moduleId from the feature
    // - module-scoped report  → write moduleId only
    // - project-scoped report → leave both null
    let resolvedModuleId  = merged.moduleId  ?? null;
    let resolvedFeatureId = merged.featureId ?? null;
    if (resolvedFeatureId && !resolvedModuleId) {
      const f = await this.prisma.feature.findUnique({
        where: { id: resolvedFeatureId }, select: { moduleId: true },
      });
      if (f) resolvedModuleId = f.moduleId;
    }

    // Sanitise + dedupe recipient list; basic email regex (server-side
    // gatekeeping — frontend also validates). Empty array is the no-email
    // case (default); any invalid entry is dropped silently rather than
    // failing the whole generate request.
    const recipientEmails = sanitiseRecipientList(merged.recipientEmails ?? []);

    // Stage the snapshot row first so we have the id for the file name.
    const row = await this.prisma.generatedReport.create({
      data: {
        configId: merged.configId,
        projectId: merged.projectId,
        moduleId:  resolvedModuleId,
        featureId: resolvedFeatureId,
        testRunSessionId: merged.testRunSessionId ?? null,
        type: merged.type,
        format,
        title,
        payload: payload as unknown as Prisma.InputJsonValue,
        generatedById: userId,
        recipientEmails,
      },
    });

    // The PDF renders asynchronously on the worker queue to keep API latency
    // stable. Email delivery is handled by the cron once the worker writes
    // artifactPath. The HTML preview is regenerated on demand from the frozen
    // payload (see renderStoredHtml) — no HTML file is stored.
    await this.queue.enqueueReportPdf({
      reportId: row.id,
      projectId: merged.projectId,
      html,
    });

    return { report: { id: row.id, title, format, artifactPath: null }, payload };
  }

  /**
   * Send the rendered report to a list of recipients. Always treated as
   * best-effort — failures are logged but never propagated to the caller
   * because the GeneratedReport row is the source of truth (recipients can
   * always be re-emailed via a manual resend later). Stamps `emailedAt` on
   * success so the UI can show "✉ sent" next to each report row.
   */
  private async dispatchReportEmail(
    reportId: string,
    artifactKey: string,
    format: ReportFormat,
    title: string,
    recipients: string[],
    generatedByUserId: string,
  ): Promise<void> {
    // Project context for the email body — fetch from the report's project
    // (cheap; one row). Generated-by display name pulled from the user.
    const [report, generatedByUser] = await Promise.all([
      this.prisma.generatedReport.findUnique({
        where: { id: reportId },
        select: { id: true, projectId: true, payload: true, project: { select: { name: true, org: { select: { name: true, logoUrl: true } } } } },
      }),
      this.prisma.user.findUnique({
        where: { id: generatedByUserId },
        select: { name: true, email: true },
      }),
    ]);
    if (!report) return;

    // Pull at-a-glance numbers from the payload if present. Templates expect
    // these — fall back to zeros so the email still renders cleanly when the
    // payload doesn't carry pass/fail counts (e.g. PROJECT scope w/o runs).
    const summary = extractSummaryStats(report.payload);

    // Build the attachment from the rendered file. PDF is the canonical
    // attachment format; HTML reports attach as html-typed files which most
    // clients display as text — still useful, but PDF is the recommended UX.
    // Read through the storage backend (local / S3 / GCS / Azure).
    const fileBuf = await streamToBuffer(await this.storage.stream(artifactKey));
    const attachmentName = `${title.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.${format === ReportFormat.PDF ? 'pdf' : 'html'}`;
    const attachments = [{
      filename: attachmentName,
      content: fileBuf,
      contentType: format === ReportFormat.PDF ? 'application/pdf' : 'text/html; charset=utf-8',
    }];

    // viewUrl points the user back into the WEB app, not the raw API
    // download endpoint — the download URL is JWT-protected, so a click
    // from email gets a 401. WEB_URL → /projects/:id?report=:reportId is
    // the canonical landing point; the project page handles auth + opens
    // the report viewer.
    const webBase = webUrl();
    const viewUrl = `${webBase}/projects/${report.projectId}?report=${report.id}`;

    // Send to all recipients in a single message — ESPs handle the list
    // well and it's cheaper than per-recipient sends. EmailService never
    // throws on send failure (returns null), so we await but always check.
    const result = await this.email.sendReportGenerated(
      recipients,
      {
        reportTitle:   title,
        projectName:   report.project?.name ?? 'Project',
        generatedBy:   generatedByUser?.name ?? generatedByUser?.email ?? 'Unknown user',
        passRate:      summary.passRate,
        totalRuns:     summary.totalRuns,
        passed:        summary.passed,
        failed:        summary.failed,
        viewUrl,
      },
      attachments,
      report.project?.org
        ? { name: report.project.org.name, logoUrl: report.project.org.logoUrl }
        : undefined,
    );

    if (result) {
      await this.prisma.generatedReport.update({
        where: { id: reportId },
        data: { emailedAt: new Date() },
      });
      this.logger.log(`[reports] emailed ${reportId} to ${recipients.length} recipient(s)`);
    } else {
      this.logger.warn(`[reports] email skipped or failed for ${reportId} (provider returned null)`);
    }
  }

  /**
   * Re-send an already-generated report to a fresh recipient list. Reuses the
   * stored artifact + email path (no re-render). Caller checks project access.
   */
  async reSendReport(
    reportId: string,
    recipientEmails: string[],
    userId: string,
  ): Promise<{ ok: true; recipients: number }> {
    const report = await this.prisma.generatedReport.findUnique({
      where: { id: reportId },
      select: { id: true, artifactPath: true, format: true, title: true },
    });
    if (!report) throw new NotFoundException('Report not found');
    if (!report.artifactPath) {
      throw new BadRequestException('Report is still rendering — try again shortly.');
    }
    const clean = Array.from(
      new Set(
        recipientEmails
          .map((e) => e.trim().toLowerCase())
          .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)),
      ),
    );
    if (!clean.length) throw new BadRequestException('Add at least one valid recipient email.');
    await this.prisma.generatedReport.update({
      where: { id: reportId },
      data: { recipientEmails: clean },
    });
    await this.dispatchReportEmail(report.id, report.artifactPath, report.format, report.title, clean, userId);
    return { ok: true, recipients: clean.length };
  }

  /**
   * Backstop sender for reports generated asynchronously (PDF queue).
   * Runs every minute, picks reports that are fully rendered but not emailed.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'reports-email-dispatch' })
  async dispatchPendingReportEmails(): Promise<void> {
    const pending = await this.prisma.generatedReport.findMany({
      where: {
        emailedAt: null,
        artifactPath: { not: null },
        recipientEmails: { isEmpty: false },
      },
      orderBy: { generatedAt: 'asc' },
      take: 25,
      select: {
        id: true,
        title: true,
        format: true,
        artifactPath: true,
        recipientEmails: true,
        generatedById: true,
      },
    });

    for (const report of pending) {
      if (!report.artifactPath) continue;
      if (!(await this.storage.exists(report.artifactPath))) continue;
      try {
        await this.dispatchReportEmail(
          report.id,
          report.artifactPath,
          report.format,
          report.title,
          report.recipientEmails,
          report.generatedById,
        );
      } catch (err) {
        this.logger.warn(`[reports] pending email dispatch failed for ${report.id}: ${(err as Error).message}`);
      }
    }
  }

  /** Default recipient roster for a project — used by the frontend modal to
   *  pre-fill the recipients chip input when the user toggles "Email this
   *  report". Pulls the union of org-admins (any project gets them) and the
   *  project's MANAGER + TECH_LEAD + OWNER members. De-duplicated by email.
   *
   *  Implemented as two membership queries → collected userIds → one User
   *  query. Avoids relation-include shape quirks and keeps the SQL trivially
   *  optimisable (three indexed lookups). */
  async getDefaultRecipients(projectId: string): Promise<Array<{ email: string; name: string | null; role: string }>> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project || !project.orgId) throw new NotFoundException('Project not found or missing org');

    const [orgAdminMemberships, projectMemberships] = await Promise.all([
      this.prisma.orgMember.findMany({
        where: { orgId: project.orgId, role: 'ORG_ADMIN' },
        select: { userId: true },
      }),
      this.prisma.projectMember.findMany({
        where: {
          projectId,
          role: { in: ['OWNER', 'TECH_LEAD', 'MANAGER'] },
        },
        select: { userId: true, role: true },
      }),
    ]);

    // Build a userId → role map. ORG_ADMIN takes precedence over project
    // roles when the same person holds both (rare but real for owners).
    const userRole = new Map<string, string>();
    for (const m of projectMemberships) userRole.set(m.userId, m.role);
    for (const m of orgAdminMemberships) userRole.set(m.userId, 'ORG_ADMIN');

    if (userRole.size === 0) return [];

    // One indexed lookup for all users — drops deactivated/suspended.
    const users = await this.prisma.user.findMany({
      where: {
        id: { in: Array.from(userRole.keys()) },
        accountStatus: { notIn: ['DEACTIVATED', 'SUSPENDED'] },
      },
      select: { id: true, email: true, name: true },
    });

    // Dedupe by email — same user can have two memberships in some setups.
    const map = new Map<string, { email: string; name: string | null; role: string }>();
    for (const u of users) {
      if (!u.email) continue;
      if (!map.has(u.email)) {
        map.set(u.email, { email: u.email, name: u.name ?? null, role: userRole.get(u.id) ?? 'MEMBER' });
      }
    }
    return Array.from(map.values()).sort((a, b) => a.email.localeCompare(b.email));
  }

  listGenerated(
    projectId: string,
    opts: {
      type?: ReportType;
      environmentId?: string;
      moduleId?: string;
      featureId?: string;
      limit?: number;
    } = {},
  ) {
    // Cascade query semantics:
    //   featureId given → only that feature's reports
    //   moduleId given (no featureId) → all reports under that module (incl. its features)
    //   neither → all reports for the project (incl. all modules + features)
    return this.prisma.generatedReport.findMany({
      where: {
        projectId,
        ...(opts.type ? { type: opts.type } : {}),
        ...(opts.featureId ? { featureId: opts.featureId } : {}),
        ...(opts.moduleId && !opts.featureId ? { moduleId: opts.moduleId } : {}),
      },
      orderBy: { generatedAt: 'desc' },
      take: opts.limit ?? 50,
      include: {
        generatedBy: { select: { id: true, name: true, email: true } },
        feature: { select: { id: true, name: true, moduleId: true } },
        module:  { select: { id: true, name: true } },
      },
    });
  }

  /** Single most recent report at a given scope, or null. */
  async getLatest(projectId: string, scope: { moduleId?: string; featureId?: string } = {}) {
    const list = await this.listGenerated(projectId, { ...scope, limit: 1 });
    return list[0] ?? null;
  }

  async getGenerated(id: string) {
    const r = await this.prisma.generatedReport.findUnique({
      where: { id },
      include: {
        config: true,
        generatedBy: { select: { id: true, name: true, email: true } },
      },
    });
    if (!r) throw new NotFoundException('Report not found');
    return r;
  }


  /**
   * Re-render a generated report's HTML from its frozen payload. renderHtml
   * is pure over the payload, so the in-app preview never needs an HTML file
   * on disk — and this works for historical reports too. Download + email
   * use the PDF artifact; this HTML is preview-only.
   */
  renderStoredHtml(report: { title: string; type: ReportType; projectId: string; payload: Prisma.JsonValue }): string {
    return this.renderHtml(
      report.title,
      (report.payload ?? {}) as Record<string, unknown>,
      { type: report.type, projectId: report.projectId } as GenerateReportPayload,
    );
  }

  // ─── Payload builder ────────────────────────────────────────────────

  /** Pulls the data needed to render the report as a structured object. */
  private async buildPayload(dto: GenerateReportPayload): Promise<Record<string, unknown>> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
      include: { phases: { orderBy: { order: 'asc' }, include: { environment: true } } },
    });
    if (!project) throw new NotFoundException('Project not found');

    const env = dto.environmentId
      ? await this.prisma.environment.findUnique({ where: { id: dto.environmentId } })
      : null;

    // Project-wide coverage stats — the SAME numbers the project dashboard
    // shows (StatsService: latest run per test definition, passRate =
    // passed / total-test-cases). Previously this counted every TestRun row
    // ("X% across N runs"), which silently disagreed with the dashboard.
    // `total` here is now the count of TEST CASES, not run rows.
    const coverage = await this.stats.computeProjectStats(dto.projectId, dto.environmentId ?? null);
    const projectSummary = {
      total: coverage.total,
      passed: coverage.passed,
      failed: coverage.failed,
      skipped: coverage.skipped,
      neverRun: coverage.neverRun,
      needsRetest: coverage.needsRetest,
      passRate: coverage.passRate ?? 0,
    };

    // Always resolve the feature block when a featureId is provided, even
    // if the user un-toggled "include feature" — the title needs the name,
    // and the toggle only controls whether the section renders, not whether
    // we look up the data.
    let featureBlock: Record<string, unknown> | null = null;
    if (dto.featureId) {
      featureBlock = await this.featurePayload(dto.featureId, dto.environmentId);
    }

    let moduleBlock: Record<string, unknown> | null = null;
    if (dto.type === ReportType.MODULE && dto.moduleId) {
      moduleBlock = await this.modulePayload(dto.moduleId, dto.environmentId, dto.includeTests ?? true);
    }

    let phaseBlock: Record<string, unknown> | null = null;
    if (dto.type === ReportType.PHASE && dto.phaseId) {
      phaseBlock = await this.phasePayload(dto.phaseId);
    }

    let sessionBlock: Record<string, unknown> | null = null;
    if (dto.type === ReportType.SESSION && (dto.testRunSessionId || dto.workSessionId)) {
      // A NAMED manual test run reuses the SESSION rollup + renderer.
      sessionBlock = dto.testRunSessionId
        ? await this.runPayload(dto.testRunSessionId, dto.projectId)
        : await this.sessionPayload(dto.workSessionId!, dto.projectId);
    }

    // Filtered-set block — built only when the caller passed an active filter
    // spec (the "Use current filters" path). Scopes the per-test list +
    // tallies to the matching test definitions.
    let filteredBlock: Record<string, unknown> | null = null;
    if (dto.appliedFilters && Object.keys(dto.appliedFilters).length > 0) {
      filteredBlock = await this.filteredPayload(dto.projectId, dto.appliedFilters, dto.environmentId);
    }

    return {
      generatedAt: new Date().toISOString(),
      project: { id: project.id, name: project.name, slug: project.slug },
      environment: env ? { id: env.id, name: env.name, type: env.type, baseUrl: env.baseUrl } : null,
      phases: project.phases.map(p => ({
        id: p.id, name: p.name, order: p.order, color: p.color,
        environment: p.environment ? { id: p.environment.id, name: p.environment.name } : null,
      })),
      includeSection: {
        session: dto.includeSession ?? false,
        feature: dto.includeFeature ?? true,
        project: dto.includeProject ?? false,
        tests: dto.includeTests ?? true,
      },
      projectSummary,
      feature: featureBlock,
      module: moduleBlock,
      phase: phaseBlock,
      session: sessionBlock,
      appliedFilters: dto.appliedFilters ?? null,
      filtered: filteredBlock,
    };
  }

  /**
   * Resolve the test definitions matching an applied-filter spec and tally
   * their latest-run statuses + bug counts. Mirrors tests.service.browse's
   * structural predicates so a filtered list view maps 1:1 to a report.
   */
  private async filteredPayload(projectId: string, filters: ReportFilters, environmentId?: string) {
    const where: Prisma.TestDefinitionWhereInput = { projectId, isActive: true, deletedAt: null };
    if (filters.search?.trim()) {
      const s = filters.search.trim();
      where.OR = [
        { name: { contains: s, mode: 'insensitive' } },
        { description: { contains: s, mode: 'insensitive' } },
        { tags: { has: s } },
      ];
    }
    if (filters.featureId) where.featureId = filters.featureId;
    if (filters.moduleId) where.feature = { moduleId: filters.moduleId };
    if (filters.tags?.length) where.tags = { hasSome: filters.tags };
    if (filters.epics?.length) {
      where.feature = {
        ...(where.feature as Prisma.FeatureWhereInput | undefined),
        ticketLinks: { some: { deletedAt: null, externalEpicName: { in: filters.epics } } },
      };
    }

    const defs = await this.prisma.testDefinition.findMany({
      where,
      select: { id: true, name: true, type: true },
      orderBy: { name: 'asc' },
    });
    let tests = await this.resolveTestStatuses(defs, environmentId);

    // Status filter is post-resolution since it's derived from the latest run.
    if (filters.status === 'PASSED' || filters.status === 'FAILED') {
      tests = tests.filter((t) => t.latestStatus === filters.status);
    } else if (filters.status === 'OUTSTANDING') {
      tests = tests.filter((t) => t.latestStatus === 'NEVER_RUN');
    }

    const passed = tests.filter((t) => t.latestStatus === 'PASSED').length;
    const failed = tests.filter((t) => t.latestStatus === 'FAILED').length;
    const skipped = tests.filter((t) => t.latestStatus === 'SKIPPED').length;
    const neverRun = tests.filter((t) => t.latestStatus === 'NEVER_RUN').length;
    const bugCount = tests.reduce((sum, t) => sum + t.issueCount, 0);

    return {
      total: tests.length,
      passed, failed, skipped, neverRun, bugCount,
      passRate: tests.length > 0 ? Math.round((passed / tests.length) * 100) : 0,
      tests,
    };
  }

  /**
   * For a set of test definitions, resolve each one's latest run status,
   * failure message and linked-issue count. Shared by the feature + module
   * report sections that render the per-test pass/fail/bug list.
   */
  private async resolveTestStatuses(
    testDefs: Array<{ id: string; name: string; type: string }>,
    environmentId?: string,
  ) {
    const envFilter = environmentId ? { environmentId } : {};
    return Promise.all(testDefs.map(async td => {
      const latest = await this.prisma.testRun.findFirst({
        where: { testDefinitionId: td.id, ...envFilter },
        orderBy: { createdAt: 'desc' },
        select: { status: true, errorMessage: true, completedAt: true },
      });
      const issueCount = await this.prisma.issue.count({
        where: { testDefinitionId: td.id },
      });
      return {
        id: td.id, name: td.name, type: td.type,
        latestStatus: latest?.status ?? 'NEVER_RUN',
        latestError: latest?.errorMessage ?? null,
        latestCompletedAt: latest?.completedAt ?? null,
        issueCount,
      };
    }));
  }

  private async featurePayload(featureId: string, environmentId?: string) {
    const feature = await this.prisma.feature.findUnique({
      where: { id: featureId },
      include: {
        module: { select: { id: true, name: true, projectId: true } },
        testDefinitions: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
      },
    });
    if (!feature) throw new NotFoundException('Feature not found');

    // Per-test latest-run + failure summary + linked-issue count. Drives the
    // "list of tests with status, failure description, bug count" section.
    const envFilter = environmentId ? { environmentId } : {};
    const testsWithStatus = await this.resolveTestStatuses(feature.testDefinitions, environmentId);
    const featurePhases = await this.prisma.featurePhase.findMany({
      where: { featureId },
      include: {
        phase: { include: { environment: true } },
        promotedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { phase: { order: 'asc' } },
    });
    const recentRuns = await this.prisma.featureRun.findMany({
      where: { featureId, ...envFilter },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: {
        environment: { select: { name: true, type: true } },
        testRuns: { select: { status: true } },
      },
    });
    // Aggregate issue count for the feature (all tests in it).
    const featureIssueCount = await this.prisma.issue.count({ where: { featureId } });
    return {
      id: feature.id,
      name: feature.name,
      module: feature.module,
      testCount: feature.testDefinitions.length,
      tests: testsWithStatus,
      issueCount: featureIssueCount,
      phases: featurePhases.map(fp => ({
        id: fp.id,
        name: fp.phase.name,
        order: fp.phase.order,
        env: fp.phase.environment ? fp.phase.environment.name : null,
        status: fp.status,
        startedAt: fp.startedAt,
        completedAt: fp.completedAt,
        promotedAt: fp.promotedAt,
        promotedBy: fp.promotedBy ? fp.promotedBy.name : null,
        notes: fp.notes,
      })),
      recentRuns: recentRuns.map(r => ({
        id: r.id, status: r.status, runMode: r.runMode,
        env: r.environment?.name,
        passed: r.testRuns.filter(t => t.status === RunStatus.PASSED).length,
        failed: r.testRuns.filter(t => t.status === RunStatus.FAILED).length,
        total: r.testRuns.length,
        createdAt: r.createdAt,
      })),
    };
  }

  private async modulePayload(moduleId: string, environmentId?: string, includeTests = true) {
    const mod = await this.prisma.module.findUnique({
      where: { id: moduleId },
      include: {
        features: {
          where: { deletedAt: null },
          include: {
            testDefinitions: { where: { deletedAt: null }, select: { id: true, name: true, type: true } },
          },
        },
      },
    });
    if (!mod) throw new NotFoundException('Module not found');
    const phases = await this.prisma.projectPhase.findMany({
      where: { projectId: mod.projectId }, orderBy: { order: 'asc' },
    });
    const features = [];
    for (const f of mod.features) {
      const fp = await this.prisma.featurePhase.findMany({
        where: { featureId: f.id }, include: { phase: true }, orderBy: { phase: { order: 'asc' } },
      });
      const current = fp.find(x => x.status === PhaseStatus.IN_PROGRESS) ?? fp.find(x => x.status === PhaseStatus.FAILED) ?? fp[fp.length - 1];
      features.push({
        id: f.id, name: f.name,
        currentPhase: current?.phase.name ?? '—',
        currentStatus: current?.status ?? PhaseStatus.PENDING,
        testCount: f.testDefinitions.length,
        // Per-test pass/fail/bug list — only resolved when the report asks
        // for it (one query per test, so the cost is opt-in).
        tests: includeTests ? await this.resolveTestStatuses(f.testDefinitions, environmentId) : [],
      });
    }
    return {
      id: mod.id, name: mod.name,
      phases: phases.map(p => ({ id: p.id, name: p.name, order: p.order })),
      features,
    };
  }

  /**
   * Per-session rollup. Drives the "Generate Report" button on the active
   * QA session card. Aggregates everything done during this sitting:
   *   - test runs triggered (TestRun.workSessionId == sessionId)
   *   - pass / fail / cancelled counts
   *   - issues filed during the window (createdAt between session bounds)
   *   - module + feature breakdown
   *   - phase coverage (which phases were touched)
   * Scoped to projectId so a multi-project tester sees only the runs that
   * landed in this project's report.
   */
  private async sessionPayload(workSessionId: string, projectId: string) {
    const session = await this.prisma.qaWorkSession.findUnique({
      where: { id: workSessionId },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
    if (!session) throw new NotFoundException('Work session not found');

    // Test runs attributed to this session, scoped to the report's project.
    const testRuns = await this.prisma.testRun.findMany({
      where: { workSessionId, projectId },
      include: {
        environment: { select: { id: true, name: true } },
        testDefinition: {
          select: {
            id: true, name: true,
            feature: { select: { id: true, name: true, module: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    const passed = testRuns.filter(r => r.status === RunStatus.PASSED).length;
    const failed = testRuns.filter(r => r.status === RunStatus.FAILED).length;
    const errored = testRuns.filter(r => r.status === RunStatus.ERROR).length;
    const cancelled = testRuns.filter(r => r.status === RunStatus.CANCELLED).length;

    // Issues filed during the session window. Use createdAt-bound rather than
    // a session FK (no such FK in schema) — close enough for reporting and
    // avoids a schema migration just for this rollup.
    const issues = await this.prisma.issue.findMany({
      where: {
        projectId,
        createdAt: {
          gte: session.startedAt,
          lte: session.endedAt ?? new Date(),
        },
        // Scope to the user's own filings — otherwise a multi-tester project
        // pollutes one tester's session report with everyone else's bugs.
        reportedById: session.userId,
      },
      select: { id: true, type: true, severity: true, status: true, title: true, featureId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    // Module + feature breakdown. Group testRuns by feature → module.
    type FeatureRollup = { featureId: string; featureName: string; tests: number; passed: number; failed: number };
    type ModuleRollup = { moduleId: string; moduleName: string; features: Map<string, FeatureRollup>; tests: number; passed: number; failed: number };
    const byModule = new Map<string, ModuleRollup>();
    for (const r of testRuns) {
      const f = r.testDefinition.feature;
      if (!f) continue;
      const m = f.module;
      if (!m) continue;
      let mr = byModule.get(m.id);
      if (!mr) {
        mr = { moduleId: m.id, moduleName: m.name, features: new Map(), tests: 0, passed: 0, failed: 0 };
        byModule.set(m.id, mr);
      }
      let fr = mr.features.get(f.id);
      if (!fr) {
        fr = { featureId: f.id, featureName: f.name, tests: 0, passed: 0, failed: 0 };
        mr.features.set(f.id, fr);
      }
      mr.tests++; fr.tests++;
      if (r.status === RunStatus.PASSED) { mr.passed++; fr.passed++; }
      if (r.status === RunStatus.FAILED || r.status === RunStatus.ERROR) { mr.failed++; fr.failed++; }
    }
    const breakdown = [...byModule.values()].map(m => ({
      moduleId: m.moduleId,
      moduleName: m.moduleName,
      tests: m.tests, passed: m.passed, failed: m.failed,
      features: [...m.features.values()],
    }));

    // Phase coverage: which phases this session touched, derived from the
    // FeaturePhases of features the user ran tests against.
    const featureIds = [...new Set(testRuns.map(r => r.testDefinition.feature?.id).filter(Boolean))] as string[];
    const featurePhases = featureIds.length > 0
      ? await this.prisma.featurePhase.findMany({
          where: { featureId: { in: featureIds } },
          include: { phase: { select: { name: true, order: true } } },
        })
      : [];
    const phaseCoverage = featurePhases.reduce<Record<string, { name: string; order: number; features: number }>>((acc, fp) => {
      if (fp.status === PhaseStatus.IN_PROGRESS || fp.status === PhaseStatus.PASSED) {
        const k = fp.phase.name;
        if (!acc[k]) acc[k] = { name: k, order: fp.phase.order, features: 0 };
        acc[k].features++;
      }
      return acc;
    }, {});
    const phases = Object.values(phaseCoverage).sort((a, b) => a.order - b.order);

    const durationMs = (session.endedAt ?? new Date()).getTime() - session.startedAt.getTime();

    return {
      id: session.id,
      user: session.user,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      durationMs,
      totals: {
        tests: testRuns.length,
        passed, failed, errored, cancelled,
        issues: issues.length,
        issuesByType: this.bucketBy(issues, i => i.type),
        issuesBySeverity: this.bucketBy(issues, i => i.severity),
      },
      breakdown,
      phases,
      // Flat per-test-run list for the optional "test list" report section.
      tests: testRuns.map(r => ({
        name: r.testDefinition.name,
        feature: r.testDefinition.feature?.name ?? null,
        module: r.testDefinition.feature?.module?.name ?? null,
        status: r.status,
        error: r.errorMessage ?? null,
        env: r.environment?.name ?? null,
        createdAt: r.createdAt,
      })),
      issues: issues.slice(0, 20).map(i => ({
        id: i.id, type: i.type, severity: i.severity, status: i.status,
        title: i.title, createdAt: i.createdAt,
      })),
    };
  }

  /**
   * Rollup for a NAMED manual test run (TestRunSession). Same shape as
   * sessionPayload so the SESSION renderer is reused — but sourced from the run
   * and its precise Issue.testRunSessionId FK (no createdAt window needed).
   */
  private async runPayload(testRunSessionId: string, projectId: string) {
    const run = await this.prisma.testRunSession.findUnique({
      where: { id: testRunSessionId },
      include: { createdBy: { select: { id: true, name: true, email: true } } },
    });
    if (!run) throw new NotFoundException('Test run not found');

    const testRuns = await this.prisma.testRun.findMany({
      where: { testRunSessionId, projectId },
      include: {
        environment: { select: { id: true, name: true } },
        testDefinition: {
          select: {
            id: true, name: true,
            feature: { select: { id: true, name: true, module: { select: { id: true, name: true } } } },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const passed = testRuns.filter(r => r.status === RunStatus.PASSED).length;
    const failed = testRuns.filter(r => r.status === RunStatus.FAILED).length;
    const errored = testRuns.filter(r => r.status === RunStatus.ERROR).length;
    const cancelled = testRuns.filter(r => r.status === RunStatus.CANCELLED).length;

    const issues = await this.prisma.issue.findMany({
      where: { testRunSessionId, deletedAt: null },
      select: { id: true, type: true, severity: true, status: true, title: true, featureId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });

    type FeatureRollup = { featureId: string; featureName: string; tests: number; passed: number; failed: number };
    type ModuleRollup = { moduleId: string; moduleName: string; features: Map<string, FeatureRollup>; tests: number; passed: number; failed: number };
    const byModule = new Map<string, ModuleRollup>();
    for (const r of testRuns) {
      const f = r.testDefinition.feature; if (!f) continue;
      const m = f.module; if (!m) continue;
      let mr = byModule.get(m.id);
      if (!mr) { mr = { moduleId: m.id, moduleName: m.name, features: new Map(), tests: 0, passed: 0, failed: 0 }; byModule.set(m.id, mr); }
      let fr = mr.features.get(f.id);
      if (!fr) { fr = { featureId: f.id, featureName: f.name, tests: 0, passed: 0, failed: 0 }; mr.features.set(f.id, fr); }
      mr.tests++; fr.tests++;
      if (r.status === RunStatus.PASSED) { mr.passed++; fr.passed++; }
      if (r.status === RunStatus.FAILED || r.status === RunStatus.ERROR) { mr.failed++; fr.failed++; }
    }
    const breakdown = [...byModule.values()].map(m => ({
      moduleId: m.moduleId, moduleName: m.moduleName,
      tests: m.tests, passed: m.passed, failed: m.failed,
      features: [...m.features.values()],
    }));

    const durationMs = (run.endedAt ?? new Date()).getTime() - run.startedAt.getTime();
    return {
      id: run.id,
      name: run.name,
      user: run.createdBy,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      durationMs,
      totals: {
        tests: testRuns.length, passed, failed, errored, cancelled,
        issues: issues.length,
        issuesByType: this.bucketBy(issues, i => i.type),
        issuesBySeverity: this.bucketBy(issues, i => i.severity),
      },
      breakdown,
      phases: [] as { name: string; order: number; features: number }[],
      tests: testRuns.map(r => ({
        name: r.testDefinition.name,
        feature: r.testDefinition.feature?.name ?? null,
        module: r.testDefinition.feature?.module?.name ?? null,
        status: r.status,
        error: r.errorMessage ?? null,
        env: r.environment?.name ?? null,
        createdAt: r.createdAt,
      })),
      issues: issues.slice(0, 20).map(i => ({
        id: i.id, type: i.type, severity: i.severity, status: i.status,
        title: i.title, createdAt: i.createdAt,
      })),
    };
  }

  private bucketBy<T>(items: T[], key: (x: T) => string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const x of items) {
      const k = key(x);
      out[k] = (out[k] ?? 0) + 1;
    }
    return out;
  }

  private async phasePayload(phaseId: string) {
    const phase = await this.prisma.projectPhase.findUnique({
      where: { id: phaseId }, include: { environment: true },
    });
    if (!phase) throw new NotFoundException('Phase not found');
    const featurePhases = await this.prisma.featurePhase.findMany({
      where: { phaseId },
      include: { feature: { include: { module: { select: { name: true } } } } },
    });
    return {
      id: phase.id, name: phase.name,
      environment: phase.environment ? { name: phase.environment.name, baseUrl: phase.environment.baseUrl } : null,
      features: featurePhases.map(fp => ({
        id: fp.featureId,
        name: fp.feature.name,
        moduleName: fp.feature.module.name,
        status: fp.status,
        startedAt: fp.startedAt,
        completedAt: fp.completedAt,
        notes: fp.notes,
      })),
    };
  }

  // ─── Rendering ──────────────────────────────────────────────────────

  private titleFor(dto: GenerateReportPayload, payload: Record<string, unknown>): string {
    const project = payload.project as { name?: string };
    switch (dto.type) {
      case ReportType.FEATURE: return `Feature Progress — ${(payload.feature as { name?: string })?.name ?? '?'}`;
      case ReportType.MODULE:  return `Module Progress — ${(payload.module as { name?: string })?.name ?? '?'}`;
      case ReportType.PHASE:   return `Phase Progress — ${(payload.phase as { name?: string })?.name ?? '?'}`;
      case ReportType.PROJECT: return `Project Progress — ${project?.name ?? '?'}`;
      case ReportType.SESSION: {
        const s = payload.session as { name?: string; user?: { name?: string }; startedAt?: string } | null;
        const date = s?.startedAt ? String(s.startedAt).slice(0, 10) : '';
        // Named test run → title after the run; ad-hoc QA work session → tester + date.
        if (dto.testRunSessionId && s?.name) return `Test Run — ${s.name}`;
        return `Session Report — ${s?.user?.name ?? 'tester'}${date ? ' · ' + date : ''}`;
      }
    }
  }

  /**
   * Self-contained HTML — inlined CSS so PDFs render identically without any
   * external asset fetch (Puppeteer doesn't have access to our static dir).
   * Kept hand-written rather than a templating engine to avoid one more
   * runtime dep; report layout is structured enough that string interpolation
   * is fine.
   */
  private renderHtml(title: string, p: Record<string, unknown>, dto: GenerateReportPayload): string {
    const orgBrand = p.orgBrand as { name: string; logoUrl: string | null } | undefined;
    const project = p.project as { name: string };
    const env = p.environment as { name: string; type: string; baseUrl: string } | null;
    const summary = p.projectSummary as { total: number; passed: number; failed: number; passRate: number };
    const phases = p.phases as Array<{ name: string; order: number; environment: { name: string } | null }>;
    const includeFeature = (p.includeSection as { feature: boolean }).feature;
    const includeProject = (p.includeSection as { project: boolean }).project;
    // Per-test list toggle — defaults on for older payloads without the key.
    const includeTests = (p.includeSection as { tests?: boolean }).tests ?? true;

    const featureSection = includeFeature && p.feature ? this.featureSection(p.feature as Record<string, unknown>, includeTests) : '';
    const moduleSection  = p.module ? this.moduleSection(p.module as Record<string, unknown>, includeTests) : '';
    const phaseSection   = p.phase  ? this.phaseSectionHtml(p.phase as Record<string, unknown>) : '';
    const projectSection = includeProject ? this.projectSection(summary, phases) : '';
    const sessionSection = p.session ? this.sessionSection(p.session as Record<string, unknown>, includeTests) : '';
    const appliedFiltersBar = this.appliedFiltersBar(p.appliedFilters as ReportFilters | null);
    const filteredSection = p.filtered ? this.filteredSection(p.filtered as Record<string, unknown>) : '';
    const additionalText = (typeof p.additionalText === 'string' ? p.additionalText : dto.additionalText)?.trim();
    const additionalSection = additionalText
      ? `<h2>Additional Notes</h2><div class="note-block">${this.multiline(additionalText)}</div>`
      : '';

    const totalRuns = summary.total;
    const skipped = totalRuns - summary.passed - summary.failed;
    const donut = this.donutSvg([
      { label: 'Passed', value: summary.passed, color: '#10b981' },
      { label: 'Failed', value: summary.failed, color: '#ef4444' },
      { label: 'Other',  value: Math.max(0, skipped), color: '#94a3b8' },
    ], 150);

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${this.esc(title)}</title>
<style>
  :root { --ink: #0f172a; --muted: #64748b; --soft: #f1f5f9; --line: #e2e8f0; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: var(--ink); max-width: 920px; margin: 32px auto; padding: 0 28px; line-height: 1.45; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: -0.01em; }
  h2 { font-size: 15px; margin: 26px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
  h3 { font-size: 12px; margin: 14px 0 6px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
  .meta { color: var(--muted); font-size: 12px; }

  .brand-header { display:flex; align-items:center; gap:14px; padding-bottom:16px; border-bottom: 2px solid #7c3aed; }
  .brand-logo { width:36px; height:36px; border-radius:10px; background:linear-gradient(135deg,#7c3aed,#5b21b6); color:white; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:16px; box-shadow:0 4px 12px rgba(124,58,237,0.30); }
  .brand-name { font-weight:700; font-size:13px; color:#7c3aed; letter-spacing:0.04em; text-transform:uppercase; }
  .brand-tagline { font-size:11px; color:var(--muted); }

  .hero { display:grid; grid-template-columns: 190px 1fr; gap:28px; padding:18px; margin:18px 0 8px; background:var(--soft); border-radius:14px; align-items:center; }
  .hero-totals { display:grid; grid-template-columns: repeat(2,1fr); gap:10px; }
  .total { padding:10px 12px; background:white; border-radius:10px; border:1px solid var(--line); }
  .total .v { font-size:22px; font-weight:700; line-height:1.1; }
  .total .l { font-size:10.5px; color:var(--muted); text-transform:uppercase; letter-spacing:0.05em; margin-top:2px; }

  table { width:100%; border-collapse:collapse; font-size:13px; }
  th, td { text-align:left; padding:8px 10px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
  th { background:#f8fafc; color:#475569; font-weight:600; font-size:11px; text-transform:uppercase; letter-spacing:0.04em; }

  .badge { display:inline-block; padding:2px 7px; border-radius:999px; font-size:10.5px; font-weight:600; }
  .b-pass  { background:#d1fae5; color:#065f46 }
  .b-fail  { background:#fee2e2; color:#991b1b }
  .b-prog  { background:#dbeafe; color:#1e3a8a }
  .b-pend  { background:#f3f4f6; color:#475569 }
  .b-block { background:#fef3c7; color:#92400e }
  .b-skip  { background:#e5e7eb; color:#475569 }
  .b-never { background:#f8fafc; color:#94a3b8; border:1px dashed #cbd5e1; }

  .err { background:#fef2f2; color:#991b1b; padding:6px 8px; border-radius:6px; font-size:11.5px; font-family:'SF Mono',Monaco,monospace; margin-top:4px; word-break:break-word; }
  .bug-pill { display:inline-flex; align-items:center; gap:3px; background:rgba(251,191,36,0.18); color:#92400e; padding:1px 6px; border-radius:4px; font-size:10.5px; font-weight:600; }
  .stat { display:inline-block; margin-right:14px; padding:6px 12px; border-radius:8px; background:var(--soft); font-size:12px; }
  .pass { color:#059669; } .fail { color:#dc2626; }
  .note-block { white-space: normal; background:#f8fafc; border:1px solid #e2e8f0; color:#0f172a; padding:12px; border-radius:8px; font-size:13px; line-height:1.55; }
</style></head>
<body>
  <header class="brand-header">
    ${orgBrand?.logoUrl
      ? `<div class="brand-logo" style="background:none;box-shadow:none;"><img src="${this.esc(orgBrand.logoUrl)}" alt="" style="width:36px;height:36px;object-fit:contain;border-radius:10px;" /></div>`
      : `<div class="brand-logo">⚡</div>`}
    <div>
      <div class="brand-name">${this.esc(orgBrand?.name || appName())}</div>
      <div class="brand-tagline">Automated &amp; manual testing reports</div>
    </div>
  </header>

  <div style="margin-top:18px;">
    <h1>${this.esc(title)}</h1>
    <div class="meta">
      Project: <strong>${this.esc(project.name)}</strong>
      ${env ? ` · Environment: <strong>${this.esc(env.name)}</strong>` : ' · All environments'}
      · Generated ${this.esc((p.generatedAt as string).slice(0, 19).replace('T', ' '))}
    </div>
    ${appliedFiltersBar}
  </div>

  <section class="hero">
    <div>${donut}</div>
    <div class="hero-totals">
      <div class="total"><div class="v">${totalRuns}</div><div class="l">Total runs</div></div>
      <div class="total"><div class="v" style="color:#059669;">${summary.passed}</div><div class="l">Passed</div></div>
      <div class="total"><div class="v" style="color:#dc2626;">${summary.failed}</div><div class="l">Failed</div></div>
      <div class="total"><div class="v" style="color:#7c3aed;">${summary.passRate}%</div><div class="l">Pass rate</div></div>
    </div>
  </section>

  ${phases.length > 0 ? `<h2>Pipeline</h2>
  <table>
    <tr><th>Order</th><th>Phase</th><th>Environment</th></tr>
    ${phases.map(ph => `<tr>
      <td>${ph.order}</td>
      <td>${this.esc(ph.name)}</td>
      <td>${ph.environment ? this.esc(ph.environment.name) : '—'}</td>
    </tr>`).join('')}
  </table>` : ''}

  ${filteredSection}
  ${sessionSection}
  ${featureSection}
  ${moduleSection}
  ${phaseSection}
  ${projectSection}
  ${additionalSection}
</body></html>`;
  }

  /** Compact chip row echoing the active filters under the report header. */
  private appliedFiltersBar(f: ReportFilters | null): string {
    if (!f) return '';
    const chips: string[] = [];
    if (f.search?.trim()) chips.push(`Search: “${this.esc(f.search.trim())}”`);
    if (f.tags?.length) chips.push(`Tags: ${f.tags.map((t) => this.esc(t)).join(', ')}`);
    if (f.epics?.length) chips.push(`Epics: ${f.epics.map((e) => this.esc(e)).join(', ')}`);
    if (f.status) chips.push(`Status: ${this.esc(f.status)}`);
    if (chips.length === 0) return '';
    return `<div class="meta" style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px;">
      ${chips.map((c) => `<span style="background:#ede9fe; color:#5b21b6; padding:2px 8px; border-radius:999px; font-size:11px; font-weight:600;">${c}</span>`).join('')}
    </div>`;
  }

  /** Per-test table + tallies for the filtered set ("Use current filters"). */
  private filteredSection(block: Record<string, unknown>): string {
    const b = block as {
      total: number; passed: number; failed: number; skipped: number; neverRun: number;
      bugCount: number; passRate: number;
      tests: Array<{ id: string; name: string; type: string; latestStatus: string; latestError: string | null; issueCount: number }>;
    };
    const badge = (s: string) => {
      const cls = s === 'PASSED' ? 'b-pass' : s === 'FAILED' ? 'b-fail'
        : s === 'SKIPPED' ? 'b-skip' : s === 'NEVER_RUN' ? 'b-never' : 'b-pend';
      const label = s === 'NEVER_RUN' ? 'Not run' : s.charAt(0) + s.slice(1).toLowerCase();
      return `<span class="badge ${cls}">${label}</span>`;
    };
    return `<h2>Filtered tests</h2>
      <div style="margin-bottom:10px;">
        <span class="stat">Total: <strong>${b.total}</strong></span>
        <span class="stat pass">Passed: <strong>${b.passed}</strong></span>
        <span class="stat fail">Failed: <strong>${b.failed}</strong></span>
        <span class="stat">Skipped: <strong>${b.skipped}</strong></span>
        <span class="stat">Not run: <strong>${b.neverRun}</strong></span>
        <span class="stat">Bugs logged: <strong>${b.bugCount}</strong></span>
        <span class="stat">Pass rate: <strong>${b.passRate}%</strong></span>
      </div>
      ${b.tests.length === 0 ? '<div class="meta">No tests match these filters.</div>' : `<table>
        <tr><th>Test</th><th>Type</th><th>Status</th><th>Bugs</th></tr>
        ${b.tests.map((t) => `<tr>
          <td>${this.esc(t.name)}${t.latestError ? `<div class="err">${this.esc(t.latestError)}</div>` : ''}</td>
          <td>${this.esc(t.type)}</td>
          <td>${badge(t.latestStatus)}</td>
          <td>${t.issueCount > 0 ? `<span class="bug-pill">🐞 ${t.issueCount}</span>` : '—'}</td>
        </tr>`).join('')}
      </table>`}`;
  }

  private multiline(value: string): string {
    return this.esc(value).replace(/\r?\n/g, '<br />');
  }

  /**
   * Hand-rolled SVG donut. Three segments max — passed / failed / other —
   * so a manual-arc approach is fine and avoids pulling in a chart library.
   * Self-contained: no fonts, no remote refs — survives PDF generation.
   */
  private donutSvg(slices: Array<{ label: string; value: number; color: string }>, size: number): string {
    const r = size / 2 - 16;
    const cx = size / 2, cy = size / 2;
    const total = slices.reduce((s, x) => s + x.value, 0) || 1;
    const stroke = 22;
    let acc = 0;
    const arcs = slices.filter(s => s.value > 0).map(s => {
      // 100% slice: a single arc has the same start+end angle and renders
      // nothing in some engines — draw a full circle to handle that.
      if (s.value === total) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${s.color}" stroke-width="${stroke}" />`;
      }
      const startAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
      acc += s.value;
      const endAngle = (acc / total) * Math.PI * 2 - Math.PI / 2;
      const large = (s.value / total) > 0.5 ? 1 : 0;
      const sx = cx + r * Math.cos(startAngle), sy = cy + r * Math.sin(startAngle);
      const ex = cx + r * Math.cos(endAngle),   ey = cy + r * Math.sin(endAngle);
      return `<path d="M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}" fill="none" stroke="${s.color}" stroke-width="${stroke}" stroke-linecap="butt" />`;
    }).join('');
    const passRate = Math.round(((slices[0]?.value ?? 0) / total) * 100);
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="${stroke}" />
      ${arcs}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="22" font-weight="700" fill="#0f172a" font-family="-apple-system, sans-serif">${passRate}%</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="9" fill="#64748b" font-family="-apple-system, sans-serif" letter-spacing="0.05em">PASS RATE</text>
    </svg>`;
  }

  private sessionSection(s: Record<string, unknown>, includeTests: boolean): string {
    const user = s.user as { name: string; email: string } | null;
    const t = s.totals as { tests: number; passed: number; failed: number; errored: number; cancelled: number; issues: number; issuesByType: Record<string, number>; issuesBySeverity: Record<string, number> };
    const breakdown = s.breakdown as Array<{ moduleName: string; tests: number; passed: number; failed: number; features: Array<{ featureName: string; tests: number; passed: number; failed: number }> }>;
    const phases = s.phases as Array<{ name: string; features: number }>;
    const issues = s.issues as Array<{ type: string; severity: string; status: string; title: string; createdAt: string }>;
    const testList = (s.tests ?? []) as Array<{ name: string; feature: string | null; module: string | null; status: string; error: string | null; env: string | null; createdAt: string }>;
    const startedAt = String(s.startedAt ?? '').slice(0, 19).replace('T', ' ');
    const endedAt = s.endedAt ? String(s.endedAt).slice(0, 19).replace('T', ' ') : 'ongoing';
    const durationH = Math.floor(((s.durationMs as number) || 0) / 3_600_000);
    const durationM = Math.floor((((s.durationMs as number) || 0) % 3_600_000) / 60_000);

    const issueTypeChips = Object.entries(t.issuesByType).map(([k, v]) => `<span class="stat">${this.esc(k)}: <strong>${v}</strong></span>`).join('');
    const sevChips = Object.entries(t.issuesBySeverity).map(([k, v]) => `<span class="stat">${this.esc(k)}: <strong>${v}</strong></span>`).join('');

    return `
  <h2>Session</h2>
  <p class="meta">
    Tester: <strong>${this.esc(user?.name ?? '?')}</strong> (${this.esc(user?.email ?? '')})
    · Started: ${this.esc(startedAt)}
    · Ended: ${this.esc(endedAt)}
    · Duration: ${durationH}h ${durationM}m
  </p>

  <div>
    <span class="stat">Tests: <strong>${t.tests}</strong></span>
    <span class="stat">Passed: <strong class="pass">${t.passed}</strong></span>
    <span class="stat">Failed: <strong class="fail">${t.failed}</strong></span>
    ${t.errored ? `<span class="stat">Errored: <strong class="fail">${t.errored}</strong></span>` : ''}
    ${t.cancelled ? `<span class="stat">Cancelled: <strong>${t.cancelled}</strong></span>` : ''}
    <span class="stat">Issues filed: <strong>${t.issues}</strong></span>
  </div>

  ${t.issues > 0 ? `
  <p style="margin-top:10px;">
    <strong>Issue types:</strong> ${issueTypeChips || '—'}<br />
    <strong>Severity:</strong> ${sevChips || '—'}
  </p>` : ''}

  <h3 style="font-size:14px; margin-top:18px;">Module / Feature breakdown</h3>
  ${breakdown.length === 0 ? '<p class="meta">No tests run in this session.</p>' : `
  <table>
    <tr><th>Module</th><th>Feature</th><th>Tests</th><th>Passed</th><th>Failed</th></tr>
    ${breakdown.flatMap(m => m.features.map((f, i) => `<tr>
      <td>${i === 0 ? this.esc(m.moduleName) : ''}</td>
      <td>${this.esc(f.featureName)}</td>
      <td>${f.tests}</td>
      <td class="pass">${f.passed}</td>
      <td class="fail">${f.failed}</td>
    </tr>`)).join('')}
    <tr style="font-weight:600; background:#f9fafb;">
      <td colspan="2">Totals</td>
      <td>${t.tests}</td>
      <td class="pass">${t.passed}</td>
      <td class="fail">${t.failed}</td>
    </tr>
  </table>`}

  ${includeTests && testList.length > 0 ? `
  <h3 style="font-size:14px; margin-top:14px;">Test runs</h3>
  <table>
    <tr><th>Test</th><th>Feature</th><th>Status</th><th>When</th></tr>
    ${testList.map(tr => {
      const failed = tr.status === 'FAILED' || tr.status === 'ERROR';
      const errorRow = failed && tr.error ? `<tr><td></td><td colspan="3"><div class="err">${this.esc(tr.error.slice(0, 400))}</div></td></tr>` : '';
      return `<tr>
      <td><strong>${this.esc(tr.name)}</strong></td>
      <td>${this.esc(tr.feature ?? '—')}</td>
      <td>${this.statusBadge(tr.status)}</td>
      <td style="color:#64748b;">${this.esc(String(tr.createdAt).slice(0, 10))}</td>
    </tr>${errorRow}`;
    }).join('')}
  </table>` : ''}

  ${phases.length > 0 ? `
  <h3 style="font-size:14px; margin-top:14px;">Phases touched</h3>
  <table>
    <tr><th>Phase</th><th>Features active</th></tr>
    ${phases.map(p => `<tr><td>${this.esc(p.name)}</td><td>${p.features}</td></tr>`).join('')}
  </table>` : ''}

  ${issues.length > 0 ? `
  <h3 style="font-size:14px; margin-top:14px;">Issues filed</h3>
  <table>
    <tr><th>Type</th><th>Severity</th><th>Status</th><th>Title</th><th>Date</th></tr>
    ${issues.map(i => `<tr>
      <td>${this.esc(i.type)}</td>
      <td>${this.esc(i.severity)}</td>
      <td>${this.statusBadge(i.status)}</td>
      <td>${this.esc(i.title)}</td>
      <td>${this.esc(String(i.createdAt).slice(0, 10))}</td>
    </tr>`).join('')}
  </table>` : ''}`;
  }

  /**
   * Renders the per-test pass/fail/bug table — shared by the feature and
   * module report sections. Each failed test gets an expanded error row.
   */
  private testListTable(
    tests: Array<{ name: string; type: string; latestStatus: string; latestError: string | null; latestCompletedAt: string | null; issueCount: number }>,
  ): string {
    if (tests.length === 0) return '<p class="meta">No test cases defined.</p>';
    return `<table>
    <tr><th style="width:32px"></th><th>Test</th><th style="width:120px">Status</th><th style="width:90px">Issues</th><th style="width:120px">Last run</th></tr>
    ${tests.map((t, i) => {
      const failed = t.latestStatus === 'FAILED' || t.latestStatus === 'ERROR';
      const errorRow = failed && t.latestError ? `
        <tr><td></td><td colspan="4"><div class="err">${this.esc(t.latestError.slice(0, 400))}</div></td></tr>` : '';
      return `<tr>
        <td style="color:#94a3b8;font-variant-numeric:tabular-nums;">${i + 1}</td>
        <td><strong>${this.esc(t.name)}</strong> <span style="color:#94a3b8; font-size:11px;">· ${this.esc(t.type)}</span></td>
        <td>${this.statusBadge(t.latestStatus === 'NEVER_RUN' ? 'NEVER' : t.latestStatus)}</td>
        <td>${t.issueCount > 0 ? `<span class="bug-pill">🐞 ${t.issueCount}</span>` : '<span style="color:#cbd5e1">—</span>'}</td>
        <td style="color:#64748b;">${t.latestCompletedAt ? this.esc(String(t.latestCompletedAt).slice(0, 10)) : '—'}</td>
      </tr>${errorRow}`;
    }).join('')}
  </table>`;
  }

  private featureSection(f: Record<string, unknown>, includeTests: boolean): string {
    const phases = f.phases as Array<{ name: string; status: string; env: string | null; promotedAt: string | null; notes: string | null }>;
    const recent = f.recentRuns as Array<{ id: string; status: string; runMode: string; env: string; passed: number; failed: number; total: number; createdAt: string }>;
    const tests = (f.tests ?? []) as Array<{ name: string; type: string; latestStatus: string; latestError: string | null; latestCompletedAt: string | null; issueCount: number }>;
    const issueCount = (f.issueCount as number) ?? 0;

    return `
  <h2>Feature: ${this.esc(f.name as string)}</h2>
  <p class="meta">
    Module: ${this.esc((f.module as { name: string }).name)}
    · Test cases: <strong>${f.testCount}</strong>
    · Issues filed: <strong>${issueCount}</strong>
  </p>

  ${includeTests ? `<h3>Test cases</h3>
  ${this.testListTable(tests)}` : ''}

  <h3>Phase pipeline</h3>
  <table>
    <tr><th>Phase</th><th>Env</th><th>Status</th><th>Promoted</th><th>Notes</th></tr>
    ${phases.map(p => `<tr>
      <td>${this.esc(p.name)}</td>
      <td>${p.env ? this.esc(p.env) : '—'}</td>
      <td>${this.statusBadge(p.status)}</td>
      <td>${p.promotedAt ? this.esc(String(p.promotedAt).slice(0, 10)) : '—'}</td>
      <td>${this.esc(p.notes ?? '')}</td>
    </tr>`).join('')}
  </table>

  <h3>Recent runs</h3>
  <table>
    <tr><th>Date</th><th>Env</th><th>Mode</th><th>Status</th><th>Pass / Total</th></tr>
    ${recent.map(r => `<tr>
      <td>${this.esc(String(r.createdAt).slice(0, 10))}</td>
      <td>${this.esc(r.env ?? '—')}</td>
      <td>${this.esc(r.runMode)}</td>
      <td>${this.statusBadge(r.status)}</td>
      <td>${r.passed}${r.failed ? ` <span class="fail">(${r.failed} failed)</span>` : ''} / ${r.total}</td>
    </tr>`).join('')}
  </table>`;
  }

  private moduleSection(m: Record<string, unknown>, includeTests: boolean): string {
    const features = m.features as Array<{
      name: string; currentPhase: string; currentStatus: string;
      testCount?: number;
      tests?: Array<{ name: string; type: string; latestStatus: string; latestError: string | null; latestCompletedAt: string | null; issueCount: number }>;
    }>;
    return `
  <h2>Module: ${this.esc(m.name as string)}</h2>
  <table>
    <tr><th>Feature</th><th>Current phase</th><th>Status</th>${includeTests ? '<th style="width:70px">Tests</th>' : ''}</tr>
    ${features.map(f => `<tr>
      <td>${this.esc(f.name)}</td>
      <td>${this.esc(f.currentPhase)}</td>
      <td>${this.statusBadge(f.currentStatus)}</td>
      ${includeTests ? `<td>${f.testCount ?? 0}</td>` : ''}
    </tr>`).join('')}
  </table>
  ${includeTests
    ? features.filter(f => (f.tests?.length ?? 0) > 0).map(f => `
  <h3>Tests — ${this.esc(f.name)}</h3>
  ${this.testListTable(f.tests ?? [])}`).join('')
    : ''}`;
  }

  private phaseSectionHtml(ph: Record<string, unknown>): string {
    const features = ph.features as Array<{ name: string; moduleName: string; status: string; notes: string | null }>;
    const env = ph.environment as { name: string } | null;
    return `
  <h2>Phase: ${this.esc(ph.name as string)}${env ? ` (${this.esc(env.name)})` : ''}</h2>
  <table>
    <tr><th>Feature</th><th>Module</th><th>Status</th><th>Notes</th></tr>
    ${features.map(f => `<tr>
      <td>${this.esc(f.name)}</td>
      <td>${this.esc(f.moduleName)}</td>
      <td>${this.statusBadge(f.status)}</td>
      <td>${this.esc(f.notes ?? '')}</td>
    </tr>`).join('')}
  </table>`;
  }

  private projectSection(summary: { total: number; passed: number; failed: number; passRate: number }, phases: Array<{ name: string; order: number }>): string {
    return `
  <h2>Project Overview</h2>
  <p>Pass rate: <strong>${summary.passRate}%</strong> across ${summary.total} test case(s) — ${summary.passed} passed, ${summary.failed} failed. Pipeline configured with ${phases.length} phase(s).</p>`;
  }

  private statusBadge(s: string): string {
    const cls = s === 'PASSED' ? 'b-pass'
      : s === 'FAILED' || s === 'ERROR' ? 'b-fail'
      : s === 'IN_PROGRESS' || s === 'RUNNING' ? 'b-prog'
      : s === 'BLOCKED' ? 'b-block'
      : s === 'SKIPPED' || s === 'CANCELLED' ? 'b-skip'
      : s === 'NEVER' ? 'b-never'
      : 'b-pend';
    return `<span class="badge ${cls}">${this.esc(s)}</span>`;
  }

  private esc(s: string): string {
    if (typeof s !== 'string') s = String(s ?? '');
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
  }

}

// ─── Helpers (file-scoped — pure, no DI) ────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Trim, lowercase, dedupe, and drop invalid email entries. The frontend
 *  also validates, but this is the gatekeeping layer the API trusts. */
function sanitiseRecipientList(input: string[]): string[] {
  const out = new Set<string>();
  for (const raw of input) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim().toLowerCase();
    if (!trimmed || !EMAIL_RE.test(trimmed)) continue;
    out.add(trimmed);
  }
  return Array.from(out);
}

/** Pull pass/fail/total numbers out of a report payload regardless of
 *  shape — different report types nest the stats under different keys.
 *  Returns zeros when the payload has nothing useful (e.g. ad-hoc PROJECT
 *  report without runs); the email still renders, just with 0/0/0/0. */
function extractSummaryStats(payload: unknown): {
  totalRuns: number;
  passed: number;
  failed: number;
  passRate: number;
} {
  const p = payload as Record<string, unknown> | null;
  if (!p || typeof p !== 'object') return { totalRuns: 0, passed: 0, failed: 0, passRate: 0 };

  // Current payload shape:
  // - project/feature/module/phase reports: projectSummary { total, passed, failed, passRate }
  // - session reports: session.totals { tests, passed, failed, ... }
  // Keep legacy fallbacks for older snapshots that used summary/stats keys.
  const projectSummary = p.projectSummary as Record<string, unknown> | undefined;
  const legacySummary =
    (p.summary as Record<string, unknown> | undefined) ??
    (p.stats   as Record<string, unknown> | undefined);
  const sessionTotals = ((p.session as Record<string, unknown> | undefined)?.totals ??
    undefined) as Record<string, unknown> | undefined;

  const block = projectSummary ?? sessionTotals ?? legacySummary ?? {};

  const passed    = numberOrZero(block.passed);
  const failed    = numberOrZero(block.failed);
  const totalRuns = numberOrZero(
    block.totalRuns ?? block.total ?? block.tests ?? (passed + failed),
  );
  const passRate  = totalRuns > 0 ? Math.round((passed / totalRuns) * 100) : 0;

  return { totalRuns, passed, failed, passRate };
}

function numberOrZero(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}
