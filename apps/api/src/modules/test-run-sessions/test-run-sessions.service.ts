import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { RunStatus, RunSessionStatus, ReportType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { accessCtx } from '../../common/access/access-context';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { ReportsService } from '../reports/reports.service';
import { CreateTestRunSessionDto, GenerateRunReportDto } from './dto/create-test-run-session.dto';

/**
 * Named manual Test Runs (TestRunSession). A deliberate QA sitting that spans one
 * or more features: tests marked during the run carry its id (stamped at
 * feature-run start + on each mark), bugs logged carry it too, and the run can be
 * finished (→ duration) then viewed/reported on as one unit. Sits ABOVE the
 * existing per-feature machinery — it does not re-implement marking.
 */
@Injectable()
export class TestRunSessionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
    private readonly reports: ReportsService,
  ) {}

  async create(projectId: string, dto: CreateTestRunSessionDto, user: JwtPayload) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    // Optional refs must belong to this project.
    if (dto.startedFromFeatureId) {
      const f = await this.prisma.feature.findFirst({
        where: { id: dto.startedFromFeatureId, deletedAt: null, module: { projectId } },
        select: { id: true },
      });
      if (!f) throw new BadRequestException('startedFromFeatureId does not belong to this project');
    }
    if (dto.environmentId) {
      const e = await this.prisma.environment.findFirst({
        where: { id: dto.environmentId, projectId, deletedAt: null },
        select: { id: true },
      });
      if (!e) throw new BadRequestException('environmentId does not belong to this project');
    }
    const now = new Date();
    return this.prisma.testRunSession.create({
      data: {
        name: dto.name.trim(),
        projectId,
        startedFromFeatureId: dto.startedFromFeatureId ?? null,
        environmentId: dto.environmentId ?? null,
        createdById: user.sub,
        status: RunSessionStatus.ACTIVE,
        startedAt: now,
        lastHeartbeatAt: now,
      },
    });
  }

  /** Load minimal session + assert the caller can see its project. */
  private async loadForAccess(id: string, user: JwtPayload) {
    const session = await this.prisma.testRunSession.findUnique({
      where: { id },
      select: { id: true, projectId: true, status: true, startedAt: true },
    });
    if (!session) throw new NotFoundException('Test run not found');
    await this.envAccess.assertProjectAccess(user.sub, session.projectId, accessCtx(user));
    return session;
  }

  /** Full detail: the run + every result (across features) + bugs logged in it. */
  async get(id: string, user: JwtPayload) {
    await this.loadForAccess(id, user);
    const session = await this.prisma.testRunSession.findUniqueOrThrow({
      where: { id },
      include: {
        startedFromFeature: { select: { id: true, name: true } },
        environment: { select: { id: true, name: true, type: true } },
        createdBy: { select: { id: true, name: true, email: true } },
      },
    });
    const testRuns = await this.prisma.testRun.findMany({
      where: { testRunSessionId: id },
      include: {
        testDefinition: { select: { id: true, name: true, feature: { select: { id: true, name: true } } } },
        environment: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const issues = await this.prisma.issue.findMany({
      where: { testRunSessionId: id, deletedAt: null },
      select: {
        id: true, title: true, type: true, severity: true, status: true,
        category: true, featureId: true, testDefinitionId: true, createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    // Latest report generated for this run (drives the View / re-email UI).
    const latestReport = await this.prisma.generatedReport.findFirst({
      where: { testRunSessionId: id },
      select: { id: true, title: true, format: true, generatedAt: true, emailedAt: true, recipientEmails: true },
      orderBy: { generatedAt: 'desc' },
    });
    return {
      ...session,
      counts: this.countByStatus(testRuns.map((r) => r.status)),
      testRuns,
      issues,
      latestReport,
    };
  }

  /** Table view: one row per run, with pass/fail counts. */
  async list(
    projectId: string,
    user: JwtPayload,
    filters: {
      status?: RunSessionStatus;
      moduleId?: string;
      featureId?: string;
      testId?: string;
      tag?: string;
      limit?: number;
      page?: number;
    },
  ) {
    await this.envAccess.assertProjectAccess(user.sub, projectId, accessCtx(user));
    const limit = filters.limit ?? 50;
    const page = filters.page ?? 1;
    const where: Prisma.TestRunSessionWhereInput = { projectId };
    if (filters.status) where.status = filters.status;

    // Scope filters: a run "matches" a feature/module/test/tag when any of its
    // feature runs or test runs touch it. AND-combined so they narrow together.
    const and: Prisma.TestRunSessionWhereInput[] = [];
    if (filters.featureId) and.push({ featureRuns: { some: { featureId: filters.featureId } } });
    if (filters.moduleId)
      and.push({ featureRuns: { some: { feature: { moduleId: filters.moduleId } } } });
    if (filters.testId) and.push({ testRuns: { some: { testDefinitionId: filters.testId } } });
    if (filters.tag)
      and.push({
        OR: [
          { featureRuns: { some: { feature: { tags: { has: filters.tag } } } } },
          { testRuns: { some: { testDefinition: { tags: { has: filters.tag } } } } },
        ],
      });
    if (and.length) where.AND = and;

    const [sessions, total] = await Promise.all([
      this.prisma.testRunSession.findMany({
        where,
        include: {
          startedFromFeature: { select: { id: true, name: true } },
          environment: { select: { id: true, name: true } },
          createdBy: { select: { id: true, name: true, email: true } },
          _count: { select: { testRuns: true, issues: true } },
        },
        orderBy: { startedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.testRunSession.count({ where }),
    ]);

    // One groupBy for pass/fail counts across the page's runs.
    const ids = sessions.map((s) => s.id);
    const grouped = ids.length
      ? await this.prisma.testRun.groupBy({
          by: ['testRunSessionId', 'status'],
          where: { testRunSessionId: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const byId = new Map<string, { passed: number; failed: number; other: number }>();
    for (const g of grouped) {
      const key = g.testRunSessionId;
      if (!key) continue;
      const cur = byId.get(key) ?? { passed: 0, failed: 0, other: 0 };
      if (g.status === RunStatus.PASSED) cur.passed += g._count._all;
      else if (g.status === RunStatus.FAILED) cur.failed += g._count._all;
      else cur.other += g._count._all;
      byId.set(key, cur);
    }
    const items = sessions.map((s) => ({ ...s, results: byId.get(s.id) ?? { passed: 0, failed: 0, other: 0 } }));
    return { items, total, page, limit };
  }

  async finish(id: string, user: JwtPayload) {
    return this.close(id, user, RunSessionStatus.COMPLETED);
  }

  async abandon(id: string, user: JwtPayload) {
    return this.close(id, user, RunSessionStatus.ABANDONED);
  }

  private async close(id: string, user: JwtPayload, status: RunSessionStatus) {
    const session = await this.loadForAccess(id, user);
    if (session.status !== RunSessionStatus.ACTIVE) {
      throw new BadRequestException(`Test run is already ${session.status.toLowerCase()}`);
    }
    const endedAt = new Date();
    const duration = endedAt.getTime() - new Date(session.startedAt).getTime();
    return this.prisma.testRunSession.update({ where: { id }, data: { status, endedAt, duration } });
  }

  async heartbeat(id: string, user: JwtPayload) {
    await this.loadForAccess(id, user);
    await this.prisma.testRunSession.update({ where: { id }, data: { lastHeartbeatAt: new Date() } });
    return { ok: true };
  }

  /**
   * Generate a run-scoped report (reuses the SESSION report engine, sourced from
   * this run's results + bugs). Stored against the feature the run started from,
   * and emailed if recipients are supplied.
   */
  async generateReport(id: string, user: JwtPayload, dto: GenerateRunReportDto) {
    const session = await this.prisma.testRunSession.findUnique({
      where: { id },
      select: { id: true, projectId: true, startedFromFeatureId: true },
    });
    if (!session) throw new NotFoundException('Test run not found');
    await this.envAccess.assertProjectAccess(user.sub, session.projectId, accessCtx(user));
    // A RUN report must contain ONLY this run's own results + bugs. We do NOT
    // pass featureId — that makes buildPayload attach the whole feature block
    // (Phase Pipeline, Recent Runs, feature-wide test list), which is noise here.
    // includeFeature/includeProject are also off so no project/feature sections
    // render — just the run (session) block.
    const { report } = await this.reports.generate(user.sub, {
      type: ReportType.SESSION,
      projectId: session.projectId,
      testRunSessionId: session.id,
      includeSession: true,   // the run's own results + bugs — the report's body
      includeFeature: false,  // no Phase Pipeline / Recent Runs (feature noise)
      includeProject: false,  // no project-wide section
      ...(dto.recipientEmails?.length ? { recipientEmails: dto.recipientEmails } : {}),
      ...(dto.additionalText?.trim() ? { additionalText: dto.additionalText.trim() } : {}),
    });
    return report;
  }

  private countByStatus(statuses: RunStatus[]) {
    let passed = 0, failed = 0, other = 0;
    for (const s of statuses) {
      if (s === RunStatus.PASSED) passed++;
      else if (s === RunStatus.FAILED) failed++;
      else other++;
    }
    return { total: statuses.length, passed, failed, other };
  }
}
