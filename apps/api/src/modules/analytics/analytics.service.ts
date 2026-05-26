import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { Prisma, RunStatus, IssueStatus, TestFailureCategory, IssueType } from '@prisma/client';
import type { JwtPayload } from '../../common/decorators/current-user.decorator';

/**
 * AnalyticsService
 * ----------------
 * Org-level BI aggregations. Three rules govern every method here:
 *
 *  1. Visibility is **per-caller, not per-org**. ORG_ADMIN and
 *     PLATFORM_ADMIN see every project in the org; everyone else sees
 *     only projects they're a member of, with their per-project env-RBAC
 *     applied. The resolveVisibleProjects helper builds this list once
 *     per request and every query reuses it.
 *
 *  2. Preview test runs (isPreview=true) are **always excluded**. Same
 *     rule as RunsService — debug iterations don't belong in BI numbers.
 *
 *  3. Aggregations use `prisma.groupBy()` so the database does the work.
 *     The in-process pattern used by RunsService is fine for the
 *     project-scoped views, but for org-wide donuts and leaderboards we
 *     can easily be summing across tens of thousands of rows.
 */

export interface AnalyticsFilters {
  /** Restrict to one project. Caller must have access to it. */
  projectId?: string;
  /** Restrict to one module (implies a project). */
  moduleId?: string;
  /** Restrict to one feature. */
  featureId?: string;
  /** Restrict per-user (filters TestRun.triggeredById + Issue.assignedToId). */
  userId?: string;
  /** Restrict to one environment (intersected with caller's env-RBAC). */
  environmentId?: string;
  /**
   * Restrict TestRun queries to a single failureCategory. Set by clicking
   * a slice in the failure-category donut. Issue queries are unaffected
   * by this filter — use issueCategory for the bug-side donut click.
   */
  failureCategory?: TestFailureCategory;
  /** Restrict Issue queries to a single category — set by the bug donut. */
  issueCategory?: TestFailureCategory;
  /** Restrict Issue queries to a single type (BUG/SNAG/QUERY). */
  issueType?: IssueType;
  /** Inclusive ISO date range. Default: last 30 days. */
  fromDate?: Date;
  toDate?: Date;
}

interface ResolvedScope {
  /** Project ids the caller can see, intersected with the filter. */
  projectIds: string[];
  /** Resolved date range — never undefined inside the service. */
  fromDate: Date;
  toDate: Date;
  /** Filters that need a per-row check (passed straight to where clauses). */
  moduleId?: string;
  featureId?: string;
  userId?: string;
  environmentId?: string;
  failureCategory?: TestFailureCategory;
  issueCategory?: TestFailureCategory;
  issueType?: IssueType;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the "what is the caller allowed to see?" scope. PLATFORM_ADMIN
   * and ORG_ADMIN get every project in the org. Everyone else gets the
   * intersection of their ProjectMember rows + the requested filter.
   *
   * If the caller passes a projectId they can't see → throw 403. If the
   * intersection is empty (e.g. member with no project memberships) →
   * returns empty projectIds; the caller methods short-circuit to zero.
   */
  async resolveScope(
    user: JwtPayload,
    orgId: string,
    filters: AnalyticsFilters,
  ): Promise<ResolvedScope> {
    const isPlatformAdmin = user.platformRole === 'PLATFORM_ADMIN';
    const isOrgAdmin = user.activeOrgId === orgId && user.orgRole === 'ORG_ADMIN';

    let allowedProjectIds: string[];
    if (isPlatformAdmin || isOrgAdmin) {
      // Full org-wide visibility — fetch every project in the org.
      const all = await this.prisma.project.findMany({
        where: { orgId },
        select: { id: true },
      });
      allowedProjectIds = all.map((p) => p.id);
    } else {
      // Member: only projects they're a member of WITHIN this org.
      const memberships = await this.prisma.projectMember.findMany({
        where: { userId: user.sub, project: { orgId } },
        select: { projectId: true },
      });
      allowedProjectIds = memberships.map((m) => m.projectId);
    }

    // Apply the filter's projectId if present — must be in the allowed set.
    if (filters.projectId) {
      if (!allowedProjectIds.includes(filters.projectId)) {
        throw new ForbiddenException('You do not have access to this project');
      }
      allowedProjectIds = [filters.projectId];
    }

    // Default date range: last 30 days. Inclusive on both ends.
    const toDate = filters.toDate ?? new Date();
    const fromDate = filters.fromDate ?? new Date(toDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    return {
      projectIds: allowedProjectIds,
      fromDate,
      toDate,
      moduleId: filters.moduleId,
      featureId: filters.featureId,
      userId: filters.userId,
      environmentId: filters.environmentId,
      failureCategory: filters.failureCategory,
      issueCategory: filters.issueCategory,
      issueType: filters.issueType,
    };
  }

  /** Shared TestRun where clause. Excludes previews; applies scope + date range. */
  private testRunWhere(scope: ResolvedScope): Prisma.TestRunWhereInput {
    const where: Prisma.TestRunWhereInput = {
      projectId: { in: scope.projectIds },
      isPreview: false,
      createdAt: { gte: scope.fromDate, lte: scope.toDate },
    };
    if (scope.environmentId) where.environmentId = scope.environmentId;
    if (scope.userId) where.triggeredById = scope.userId;
    if (scope.featureId) where.testDefinition = { featureId: scope.featureId };
    else if (scope.moduleId) where.testDefinition = { feature: { moduleId: scope.moduleId } };
    // Donut-click filter: when set, every TestRun query narrows to a
    // single failureCategory. The donut itself ignores this (otherwise
    // clicking a slice would collapse the donut to one slice — confusing).
    if (scope.failureCategory) where.failureCategory = scope.failureCategory;
    return where;
  }

  /** Shared Issue where clause. Applies scope + date range. */
  private issueWhere(scope: ResolvedScope): Prisma.IssueWhereInput {
    const where: Prisma.IssueWhereInput = {
      projectId: { in: scope.projectIds },
      deletedAt: null,
      createdAt: { gte: scope.fromDate, lte: scope.toDate },
    };
    if (scope.userId) where.assignedToId = scope.userId;
    if (scope.featureId) where.featureId = scope.featureId;
    else if (scope.moduleId) where.moduleId = scope.moduleId;
    // Same donut-click semantics on the bug side.
    if (scope.issueCategory) where.category = scope.issueCategory;
    if (scope.issueType) where.type = scope.issueType;
    return where;
  }

  /**
   * Daily run counts + AVG/day total. Drives the runs-trend line chart
   * and the AVG-runs/day KPI on the dashboard. Fetch + group in-process
   * mirrors RunsService.getTrend; volume is small (one row per run is
   * fine for 30 days × ~3 runs/day average).
   */
  async runsTrend(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return { total: 0, avgPerDay: 0, days: [] as Array<{ date: string; total: number; passed: number; failed: number }> };
    const runs = await this.prisma.testRun.findMany({
      where: this.testRunWhere(scope),
      select: { createdAt: true, status: true },
    });
    const byDay = new Map<string, { date: string; total: number; passed: number; failed: number }>();
    for (const r of runs) {
      const date = r.createdAt.toISOString().slice(0, 10);
      const row = byDay.get(date) ?? { date, total: 0, passed: 0, failed: 0 };
      row.total++;
      if (r.status === RunStatus.PASSED) row.passed++;
      if (r.status === RunStatus.FAILED) row.failed++;
      byDay.set(date, row);
    }
    const days = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
    const dayCount = Math.max(
      1,
      Math.ceil((scope.toDate.getTime() - scope.fromDate.getTime()) / (24 * 60 * 60 * 1000)),
    );
    return {
      total: runs.length,
      avgPerDay: Math.round((runs.length / dayCount) * 10) / 10,
      days,
    };
  }

  /**
   * Failure breakdown by category (donut).
   *
   * Donut data deliberately ignores its OWN filter — when the user
   * clicks a slice we set scope.failureCategory so every OTHER widget
   * narrows, but this donut should keep showing the full mix so the
   * user can switch to a different slice. Same pattern for the two
   * issue donuts below.
   */
  async failureCategoryBreakdown(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return [] as Array<{ category: TestFailureCategory | null; count: number }>;
    const scopeForDonut = { ...scope, failureCategory: undefined };
    const rows = await this.prisma.testRun.groupBy({
      by: ['failureCategory'],
      where: { ...this.testRunWhere(scopeForDonut), status: RunStatus.FAILED },
      _count: { _all: true },
    });
    return rows.map((r) => ({ category: r.failureCategory, count: r._count._all }));
  }

  /** Issue breakdown by category (donut). Same shape; complements failureCategoryBreakdown. */
  async issueCategoryBreakdown(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return [] as Array<{ category: TestFailureCategory | null; count: number }>;
    const scopeForDonut = { ...scope, issueCategory: undefined };
    const rows = await this.prisma.issue.groupBy({
      by: ['category'],
      where: this.issueWhere(scopeForDonut),
      _count: { _all: true },
    });
    return rows.map((r) => ({ category: r.category, count: r._count._all }));
  }

  /** Issue breakdown by type (BUG / SNAG / QUERY) — secondary donut on the dashboard. */
  async issueTypeBreakdown(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return [] as Array<{ type: IssueType; count: number }>;
    const scopeForDonut = { ...scope, issueType: undefined };
    const rows = await this.prisma.issue.groupBy({
      by: ['type'],
      where: this.issueWhere(scopeForDonut),
      _count: { _all: true },
    });
    return rows.map((r) => ({ type: r.type, count: r._count._all }));
  }

  /**
   * Top-N features by failure count + their pass-rate. Fetch counts in
   * two passes (total + failed) then hydrate names. This is cheap even
   * across the whole org because failureCategory + status are indexed.
   */
  async failuresByFeature(scope: ResolvedScope, limit = 10) {
    if (scope.projectIds.length === 0) return [];
    const grouped = await this.prisma.testRun.groupBy({
      by: ['testDefinitionId'],
      where: { ...this.testRunWhere(scope), status: { in: [RunStatus.PASSED, RunStatus.FAILED] } },
      _count: { _all: true },
    });
    // Pull each test's featureId so we can roll up. One query for all.
    const testDefIds = grouped.map((g) => g.testDefinitionId);
    if (testDefIds.length === 0) return [];
    const tests = await this.prisma.testDefinition.findMany({
      where: { id: { in: testDefIds }, featureId: { not: null } },
      select: { id: true, featureId: true, feature: { select: { id: true, name: true, module: { select: { id: true, name: true } } } } },
    });
    // groupBy failed separately so we can compute pass-rate per feature.
    const failedGrouped = await this.prisma.testRun.groupBy({
      by: ['testDefinitionId'],
      where: { ...this.testRunWhere(scope), status: RunStatus.FAILED },
      _count: { _all: true },
    });
    const failedByTest = new Map(failedGrouped.map((g) => [g.testDefinitionId, g._count._all]));
    // Roll up to feature level.
    type Roll = { featureId: string; featureName: string; moduleName: string; total: number; failed: number };
    const byFeature = new Map<string, Roll>();
    for (const g of grouped) {
      const t = tests.find((tt) => tt.id === g.testDefinitionId);
      if (!t?.featureId || !t.feature) continue;
      const key = t.featureId;
      const row = byFeature.get(key) ?? {
        featureId: t.feature.id,
        featureName: t.feature.name,
        moduleName: t.feature.module?.name ?? '—',
        total: 0,
        failed: 0,
      };
      row.total += g._count._all;
      row.failed += failedByTest.get(g.testDefinitionId) ?? 0;
      byFeature.set(key, row);
    }
    return [...byFeature.values()]
      .sort((a, b) => b.failed - a.failed || a.featureName.localeCompare(b.featureName))
      .slice(0, limit)
      .map((r) => ({
        ...r,
        passRate: r.total > 0 ? Math.round(((r.total - r.failed) / r.total) * 100) : null,
      }));
  }

  /** Same shape as failuresByFeature but rolled to module. */
  async failuresByModule(scope: ResolvedScope, limit = 10) {
    if (scope.projectIds.length === 0) return [];
    const features = await this.failuresByFeature(scope, 10_000); // pull all, roll in-process
    type Roll = { moduleId: string; moduleName: string; total: number; failed: number; featureCount: number };
    const byModule = new Map<string, Roll>();
    // Need moduleIds — re-query for feature → module mapping in one shot.
    const featureIds = features.map((f) => f.featureId);
    const featureRows = featureIds.length > 0
      ? await this.prisma.feature.findMany({
          where: { id: { in: featureIds } },
          select: { id: true, moduleId: true, module: { select: { id: true, name: true } } },
        })
      : [];
    const featureMod = new Map(featureRows.map((f) => [f.id, f]));
    for (const f of features) {
      const fr = featureMod.get(f.featureId);
      if (!fr?.module) continue;
      const key = fr.module.id;
      const row = byModule.get(key) ?? {
        moduleId: fr.module.id,
        moduleName: fr.module.name,
        total: 0,
        failed: 0,
        featureCount: 0,
      };
      row.total += f.total;
      row.failed += f.failed;
      row.featureCount++;
      byModule.set(key, row);
    }
    return [...byModule.values()]
      .sort((a, b) => b.failed - a.failed)
      .slice(0, limit)
      .map((r) => ({
        ...r,
        passRate: r.total > 0 ? Math.round(((r.total - r.failed) / r.total) * 100) : null,
      }));
  }

  /** Rolled to project — the cross-project leaderboard. */
  async failuresByProject(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return [];
    const grouped = await this.prisma.testRun.groupBy({
      by: ['projectId', 'status'],
      where: this.testRunWhere(scope),
      _count: { _all: true },
    });
    const projects = await this.prisma.project.findMany({
      where: { id: { in: scope.projectIds } },
      select: { id: true, name: true },
    });
    type Roll = { projectId: string; projectName: string; total: number; passed: number; failed: number };
    const byProject = new Map<string, Roll>();
    for (const p of projects) {
      byProject.set(p.id, { projectId: p.id, projectName: p.name, total: 0, passed: 0, failed: 0 });
    }
    for (const g of grouped) {
      const row = byProject.get(g.projectId);
      if (!row) continue;
      row.total += g._count._all;
      if (g.status === RunStatus.PASSED) row.passed += g._count._all;
      if (g.status === RunStatus.FAILED) row.failed += g._count._all;
    }
    return [...byProject.values()]
      .filter((r) => r.total > 0)
      .sort((a, b) => b.failed - a.failed)
      .map((r) => ({
        ...r,
        passRate: r.total > 0 ? Math.round((r.passed / r.total) * 100) : null,
      }));
  }

  /**
   * AVG bug resolution time — milliseconds from Issue.createdAt → resolvedAt,
   * across RESOLVED/CLOSED issues in scope. Uses the in-table `resolvedAt`
   * timestamp directly (issue.service stamps it when status flips terminal).
   */
  async bugResolutionTime(scope: ResolvedScope) {
    if (scope.projectIds.length === 0) return { count: 0, avgMs: 0, p50Ms: 0, p90Ms: 0 };
    const rows = await this.prisma.issue.findMany({
      where: {
        ...this.issueWhere(scope),
        status: { in: [IssueStatus.RESOLVED, IssueStatus.CLOSED] },
        resolvedAt: { not: null },
      },
      select: { createdAt: true, resolvedAt: true },
    });
    if (rows.length === 0) return { count: 0, avgMs: 0, p50Ms: 0, p90Ms: 0 };
    const durations = rows
      .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()))
      .sort((a, b) => a - b);
    const sum = durations.reduce((s, d) => s + d, 0);
    return {
      count: durations.length,
      avgMs: Math.round(sum / durations.length),
      p50Ms: durations[Math.floor(durations.length * 0.5)] ?? 0,
      p90Ms: durations[Math.floor(durations.length * 0.9)] ?? 0,
    };
  }

  /**
   * Per-assignee leaderboard — runs triggered, issues reported, issues
   * resolved, avg-resolution. Drives the per-person dashboard for managers.
   */
  async assigneeLeaderboard(scope: ResolvedScope, limit = 25) {
    if (scope.projectIds.length === 0) return [];

    // Runs triggered per user (groupBy is index-aided).
    const runRows = await this.prisma.testRun.groupBy({
      by: ['triggeredById'],
      where: { ...this.testRunWhere(scope), triggeredById: { not: null } },
      _count: { _all: true },
    });

    // Issues reported.
    const reportedRows = await this.prisma.issue.groupBy({
      by: ['reportedById'],
      where: { projectId: { in: scope.projectIds }, deletedAt: null, createdAt: { gte: scope.fromDate, lte: scope.toDate } },
      _count: { _all: true },
    });

    // Issues resolved (assignedToId is the person who held the issue when
    // it went terminal — matches what managers want to credit).
    const resolvedRows = await this.prisma.issue.findMany({
      where: {
        projectId: { in: scope.projectIds },
        deletedAt: null,
        status: { in: [IssueStatus.RESOLVED, IssueStatus.CLOSED] },
        resolvedAt: { gte: scope.fromDate, lte: scope.toDate, not: null },
      },
      select: { resolvedById: true, createdAt: true, resolvedAt: true },
    });

    // Compose. Collect every userId we've seen, then hydrate names in one shot.
    type Row = { userId: string; userName: string; userEmail: string; runsTriggered: number; issuesReported: number; issuesResolved: number; avgResolutionMs: number };
    const userIds = new Set<string>();
    const map = new Map<string, Row>();
    const ensure = (id: string): Row => {
      const existing = map.get(id);
      if (existing) return existing;
      const fresh: Row = { userId: id, userName: '', userEmail: '', runsTriggered: 0, issuesReported: 0, issuesResolved: 0, avgResolutionMs: 0 };
      map.set(id, fresh);
      return fresh;
    };
    for (const r of runRows) {
      if (!r.triggeredById) continue;
      userIds.add(r.triggeredById);
      ensure(r.triggeredById).runsTriggered = r._count._all;
    }
    for (const r of reportedRows) {
      if (!r.reportedById) continue;
      userIds.add(r.reportedById);
      ensure(r.reportedById).issuesReported = r._count._all;
    }
    // Aggregate resolved + duration per resolver.
    const durByUser = new Map<string, number[]>();
    for (const r of resolvedRows) {
      if (!r.resolvedById || !r.resolvedAt) continue;
      userIds.add(r.resolvedById);
      const arr = durByUser.get(r.resolvedById) ?? [];
      arr.push(r.resolvedAt.getTime() - r.createdAt.getTime());
      durByUser.set(r.resolvedById, arr);
    }
    for (const [uid, durs] of durByUser) {
      const row = ensure(uid);
      row.issuesResolved = durs.length;
      row.avgResolutionMs = durs.length > 0 ? Math.round(durs.reduce((s, d) => s + d, 0) / durs.length) : 0;
    }

    if (userIds.size === 0) return [];
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...userIds] } },
      select: { id: true, name: true, email: true },
    });
    for (const u of users) {
      const row = map.get(u.id);
      if (row) {
        row.userName = u.name ?? '';
        row.userEmail = u.email ?? '';
      }
    }

    return [...map.values()]
      .filter((r) => r.runsTriggered + r.issuesReported + r.issuesResolved > 0)
      .sort((a, b) =>
        (b.runsTriggered + b.issuesReported + b.issuesResolved) -
        (a.runsTriggered + a.issuesReported + a.issuesResolved),
      )
      .slice(0, limit);
  }

  /**
   * Top-line KPIs for the dashboard header — single round-trip to keep the
   * page feel snappy. Re-uses the per-method helpers under the hood so the
   * numbers can't drift from the detailed breakdowns.
   */
  async kpis(scope: ResolvedScope) {
    const [runs, openIssues, resolution] = await Promise.all([
      this.runsTrend(scope),
      this.prisma.issue.count({
        where: { ...this.issueWhere(scope), status: { in: [IssueStatus.OPEN, IssueStatus.IN_PROGRESS] } },
      }),
      this.bugResolutionTime(scope),
    ]);
    const failedDays = runs.days.reduce((s, d) => s + d.failed, 0);
    const dayCount = runs.days.length || 1;
    return {
      totalRuns: runs.total,
      avgRunsPerDay: runs.avgPerDay,
      avgFailsPerDay: Math.round((failedDays / dayCount) * 10) / 10,
      openIssues,
      avgResolutionMs: resolution.avgMs,
    };
  }
}
