import { Controller, Get, Param, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService, type AnalyticsFilters } from './analytics.service';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { OrgRoleGuard } from '../../common/guards/org-role.guard';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TestFailureCategory, IssueType } from '@prisma/client';
import { clampLimit } from '../../common/util/pagination';

/**
 * Org-scoped analytics endpoints.
 *
 * Membership in the org is the only role required at the controller level —
 * MANAGER + members all use this surface. The per-method `resolveScope` call
 * applies the actual visibility rules:
 *   - ORG_ADMIN / PLATFORM_ADMIN → every project in the org
 *   - Members → only projects they're a ProjectMember of, intersected with
 *     env-RBAC (UAT-only users see UAT data, etc.)
 *
 * That keeps "Managers see analytics for their assigned projects" working
 * without a separate endpoint surface, and ORG_ADMINs get full visibility
 * through the same routes.
 */
@ApiTags('analytics') @ApiBearerAuth()
@Controller('orgs/:orgId/analytics')
@UseGuards(OrgRoleGuard)
export class AnalyticsController {
  constructor(
    private readonly service: AnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Parse the common filter query-string into the service shape. Lives on
   * the controller (not in a DTO) because dates need a typed Date instance
   * and class-transformer's coercion isn't worth the boilerplate for a few
   * optional params.
   *
   * Date strings that don't parse are rejected with a 400 — silently
   * dropping them to undefined would make a typo "fromDate=fooboar" look
   * like "no filter", and the bad-input would never reach the user as
   * actionable feedback.
   */
  private parseFilters(q: Record<string, string | undefined>): AnalyticsFilters {
    const parseDate = (raw: string | undefined, name: string): Date | undefined => {
      if (!raw) return undefined;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException(`Invalid ${name} — expected an ISO-8601 date string (e.g. 2026-05-26T00:00:00.000Z)`);
      }
      return d;
    };
    // Validate enum values up-front — silently dropping a typo'd category
    // would surface as "no filter applied" with no feedback. Throw 400.
    const enumOrThrow = <T extends string>(raw: string | undefined, name: string, valid: readonly T[]): T | undefined => {
      if (!raw) return undefined;
      if (!(valid as readonly string[]).includes(raw)) {
        throw new BadRequestException(`Invalid ${name} — expected one of ${valid.join(', ')}`);
      }
      return raw as T;
    };
    return {
      projectId: q.projectId || undefined,
      moduleId: q.moduleId || undefined,
      featureId: q.featureId || undefined,
      userId: q.userId || undefined,
      environmentId: q.environmentId || undefined,
      failureCategory: enumOrThrow(q.failureCategory, 'failureCategory', Object.values(TestFailureCategory)),
      issueCategory: enumOrThrow(q.issueCategory, 'issueCategory', Object.values(TestFailureCategory)),
      issueType: enumOrThrow(q.issueType, 'issueType', Object.values(IssueType)),
      fromDate: parseDate(q.fromDate, 'fromDate'),
      toDate: parseDate(q.toDate, 'toDate'),
    };
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Top-line KPI strip for the dashboard header' })
  async kpis(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.kpis(scope);
  }

  @Get('runs-trend')
  @ApiOperation({ summary: 'Daily run counts (passed/failed) + AVG-per-day for the line chart' })
  async runsTrend(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.runsTrend(scope);
  }

  @Get('failure-categories')
  @ApiOperation({ summary: 'TestRun.failureCategory breakdown — donut data' })
  async failureCategories(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.failureCategoryBreakdown(scope);
  }

  @Get('issue-categories')
  @ApiOperation({ summary: 'Issue.category breakdown — donut data' })
  async issueCategories(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.issueCategoryBreakdown(scope);
  }

  @Get('issue-types')
  @ApiOperation({ summary: 'Issue.type breakdown (BUG/SNAG/QUERY) — secondary donut' })
  async issueTypes(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.issueTypeBreakdown(scope);
  }

  @Get('failures-by-feature')
  @ApiOperation({ summary: 'Top features by failure count + their pass rate' })
  async failuresByFeature(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    const limit = clampLimit(q.limit, { def: 10, max: 100 });
    return this.service.failuresByFeature(scope, limit);
  }

  @Get('failures-by-module')
  @ApiOperation({ summary: 'Top modules by failure count + pass rate' })
  async failuresByModule(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    const limit = clampLimit(q.limit, { def: 10, max: 100 });
    return this.service.failuresByModule(scope, limit);
  }

  @Get('failures-by-project')
  @ApiOperation({ summary: 'Cross-project failure ranking (org-admin view; members see their projects only)' })
  async failuresByProject(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.failuresByProject(scope);
  }

  @Get('bug-resolution-time')
  @ApiOperation({ summary: 'AVG / p50 / p90 resolution time across resolved issues' })
  async bugResolutionTime(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    return this.service.bugResolutionTime(scope);
  }

  @Get('assignee-leaderboard')
  @ApiOperation({ summary: 'Per-user productivity leaderboard (runs / issues / resolution time)' })
  async assigneeLeaderboard(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload, @Query() q: Record<string, string>) {
    const scope = await this.service.resolveScope(user, orgId, this.parseFilters(q));
    const limit = clampLimit(q.limit, { def: 25, max: 100 });
    return this.service.assigneeLeaderboard(scope, limit);
  }

  /**
   * Helper for the analytics filter bar — returns the projects the caller
   * can see in this org, so the project dropdown is auto-scoped to their
   * access. For ORG_ADMIN this is every project; for members it's their
   * ProjectMember set. The frontend uses this to populate the dropdown.
   */
  @Get('visible-projects')
  @ApiOperation({ summary: 'Projects the caller can see in this org (drives the analytics filter dropdown)' })
  async visibleProjects(@Param('orgId') orgId: string, @CurrentUser() user: JwtPayload) {
    const scope = await this.service.resolveScope(user, orgId, {});
    if (scope.projectIds.length === 0) return [];
    return this.prisma.project.findMany({
      where: { id: { in: scope.projectIds }, orgId },
      select: { id: true, name: true, orgId: true },
      orderBy: { name: 'asc' },
    });
  }
}
