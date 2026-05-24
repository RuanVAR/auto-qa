import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RunStatus } from '@prisma/client';

export type WorkSessionActivityType =
  | 'MARK_PASS'
  | 'MARK_FAIL'
  | 'TEST_MODE'
  | 'ISSUE_LOGGED';

export interface AttachActivityPayload {
  testDefinitionId?: string;
  featureId?: string;
  moduleId?: string;
  projectId?: string;
  activityType: WorkSessionActivityType;
}

@Injectable()
export class WorkSessionsService {
  private readonly logger = new Logger(WorkSessionsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Sessions idle for this long are considered abandoned. Two paths close
   *  them: `resolveOrCreateActive` (lazy — on the next activity for that
   *  user) and the `closeStaleSessions` cron (active — every 15 min,
   *  regardless of whether the user comes back). Without the cron, a
   *  browser closed without logging out left a "session" ticking for days. */
  private static readonly STALE_SESSION_MS = 4 * 60 * 60 * 1000; // 4 hours

  /** Resolve the user's active session for this org, creating one if none.
   *  If the existing open session has been idle for >4 h it is silently
   *  closed (reason: 'idle-timeout') and a fresh one is opened. This prevents
   *  phantom sessions that persist across logouts or overnight gaps from
   *  accumulating wall-clock time forever. */
  async resolveOrCreateActive(userId: string, orgId: string) {
    const existing = await this.prisma.qaWorkSession.findFirst({
      where: { userId, orgId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (existing) {
      const idleMs = Date.now() - new Date(existing.lastActiveAt).getTime();
      if (idleMs > WorkSessionsService.STALE_SESSION_MS) {
        // Close the stale session and fall through to create a fresh one.
        await this.prisma.qaWorkSession.update({
          where: { id: existing.id },
          data: { endedAt: new Date(), endedReason: 'idle-timeout' },
        });
      } else {
        return this.prisma.qaWorkSession.update({
          where: { id: existing.id },
          data: { lastActiveAt: new Date() },
        });
      }
    }
    return this.prisma.qaWorkSession.create({
      data: { userId, orgId },
    });
  }

  /** End the user's currently active session for this org (if any). */
  async endActive(userId: string, orgId: string, reason: string = 'manual') {
    const active = await this.prisma.qaWorkSession.findFirst({
      where: { userId, orgId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) return null;
    return this.prisma.qaWorkSession.update({
      where: { id: active.id },
      data: { endedAt: new Date(), endedReason: reason },
    });
  }

  /** Helper used by logout / org-switch / token-expiry interceptors. */
  async end(sessionId: string, reason: string) {
    const session = await this.prisma.qaWorkSession.findUnique({ where: { id: sessionId } });
    if (!session || session.endedAt) return session;
    return this.prisma.qaWorkSession.update({
      where: { id: sessionId },
      data: { endedAt: new Date(), endedReason: reason },
    });
  }

  /** End all active sessions for the user (across all orgs) — used on logout. */
  async endAllForUser(userId: string, reason: string = 'logout') {
    await this.prisma.qaWorkSession.updateMany({
      where: { userId, endedAt: null },
      data: { endedAt: new Date(), endedReason: reason },
    });
  }

  /** Update the last-* pointers and lastActiveAt on a session. */
  async recordActivity(sessionId: string, payload: AttachActivityPayload) {
    return this.prisma.qaWorkSession.update({
      where: { id: sessionId },
      data: {
        lastActiveAt: new Date(),
        lastActivityAt: new Date(),
        lastActivityType: payload.activityType,
        ...(payload.testDefinitionId !== undefined ? { lastTestDefinitionId: payload.testDefinitionId } : {}),
        ...(payload.featureId !== undefined ? { lastFeatureId: payload.featureId } : {}),
        ...(payload.moduleId !== undefined ? { lastModuleId: payload.moduleId } : {}),
        ...(payload.projectId !== undefined ? { lastProjectId: payload.projectId } : {}),
      },
    });
  }

  /**
   * Resolve-or-create the active session AND record activity in one call.
   * Returns sessionId for callers to set `workSessionId` on their row.
   */
  async attachToSession(
    userId: string,
    orgId: string,
    payload: AttachActivityPayload,
  ): Promise<string> {
    const session = await this.resolveOrCreateActive(userId, orgId);
    await this.recordActivity(session.id, payload);
    return session.id;
  }

  /** Active session + stats + breakdown for the current user. */
  async getCurrentWithStats(userId: string, orgId: string) {
    const active = await this.prisma.qaWorkSession.findFirst({
      where: { userId, orgId, endedAt: null },
      orderBy: { startedAt: 'desc' },
    });
    if (!active) return null;

    const stats = await this.computeSessionStats(active.id);
    const breakdown = await this.computeBreakdown(active.id);
    return { session: active, stats, breakdown };
  }

  /** The most-recent ENDED session for this user in this org, with activity pointers + counts. */
  async getLastSessionForUser(userId: string, orgId: string) {
    const last = await this.prisma.qaWorkSession.findFirst({
      where: { userId, orgId, endedAt: { not: null } },
      orderBy: { endedAt: 'desc' },
    });
    if (!last) return null;
    const stats = await this.computeSessionStats(last.id);

    // Hydrate minimal metadata for the "continue where you left off" card
    const [testDefinition, feature, module, project] = await Promise.all([
      last.lastTestDefinitionId
        ? this.prisma.testDefinition.findUnique({
            where: { id: last.lastTestDefinitionId },
            select: { id: true, name: true, type: true },
          })
        : null,
      last.lastFeatureId
        ? this.prisma.feature.findUnique({
            where: { id: last.lastFeatureId },
            select: { id: true, name: true },
          })
        : null,
      last.lastModuleId
        ? this.prisma.module.findUnique({
            where: { id: last.lastModuleId },
            select: { id: true, name: true },
          })
        : null,
      last.lastProjectId
        ? this.prisma.project.findUnique({
            where: { id: last.lastProjectId },
            select: { id: true, name: true, slug: true },
          })
        : null,
    ]);

    return {
      session: last,
      stats,
      lastContext: { testDefinition, feature, module, project },
    };
  }

  /** Paginated list of this user's past sessions in this org. */
  async listHistory(userId: string, orgId: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = { userId, orgId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.qaWorkSession.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.qaWorkSession.count({ where }),
    ]);
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  async getBreakdown(sessionId: string) {
    const session = await this.prisma.qaWorkSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Work session not found');
    return {
      session,
      stats: await this.computeSessionStats(sessionId),
      breakdown: await this.computeBreakdown(sessionId),
    };
  }

  /**
   * Background sweep — close any session whose `lastActiveAt` is older than
   * the stale threshold. Runs every 15 minutes so a session abandoned without
   * a logout (browser closed, token expired, machine slept) is reliably
   * marked ended within ~15 min of crossing the 4 h idle line, instead of
   * lingering until the user next does some activity in that org.
   */
  // Raw cron expression — this version of @nestjs/schedule's CronExpression
  // enum doesn't include an EVERY_15_MINUTES helper.
  @Cron('*/15 * * * *', { name: 'work-sessions-stale-sweep' })
  async closeStaleSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - WorkSessionsService.STALE_SESSION_MS);
    const result = await this.prisma.qaWorkSession.updateMany({
      where: { endedAt: null, lastActiveAt: { lt: cutoff } },
      data: { endedAt: new Date(), endedReason: 'idle-timeout' },
    });
    if (result.count > 0) {
      this.logger.log(`stale sweep closed ${result.count} session(s)`);
    }
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  private async computeSessionStats(sessionId: string) {
    const [totalTestRuns, passed, failed, issuesLogged] = await this.prisma.$transaction([
      this.prisma.testRun.count({ where: { workSessionId: sessionId } }),
      this.prisma.testRun.count({ where: { workSessionId: sessionId, status: RunStatus.PASSED } }),
      this.prisma.testRun.count({ where: { workSessionId: sessionId, status: RunStatus.FAILED } }),
      this.prisma.issue.count({ where: { workSessionId: sessionId, deletedAt: null } }),
    ]);
    return { totalTestRuns, passed, failed, issuesLogged };
  }

  /**
   * Returns stats grouped by module → feature for this session.
   * Pulls all testRuns + issues that belong to the session, then folds them into a tree.
   */
  private async computeBreakdown(sessionId: string) {
    const [testRuns, issues] = await Promise.all([
      this.prisma.testRun.findMany({
        where: { workSessionId: sessionId },
        select: {
          id: true,
          status: true,
          testDefinition: {
            select: {
              id: true,
              feature: {
                select: {
                  id: true,
                  name: true,
                  module: { select: { id: true, name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.issue.findMany({
        where: { workSessionId: sessionId, deletedAt: null },
        select: {
          id: true,
          moduleId: true,
          featureId: true,
          module: { select: { id: true, name: true } },
          feature: { select: { id: true, name: true, moduleId: true } },
        },
      }),
    ]);

    type FeatureAgg = {
      featureId: string | null;
      featureName: string;
      testRuns: number;
      passed: number;
      failed: number;
      issues: number;
    };
    type ModuleAgg = {
      moduleId: string | null;
      moduleName: string;
      features: Map<string, FeatureAgg>;
    };

    const modules = new Map<string, ModuleAgg>();

    const ensureModule = (moduleId: string | null, moduleName: string): ModuleAgg => {
      const key = moduleId ?? '__unassigned__';
      let m = modules.get(key);
      if (!m) {
        m = { moduleId, moduleName, features: new Map() };
        modules.set(key, m);
      }
      return m;
    };
    const ensureFeature = (m: ModuleAgg, featureId: string | null, featureName: string): FeatureAgg => {
      const key = featureId ?? '__unassigned__';
      let f = m.features.get(key);
      if (!f) {
        f = { featureId, featureName, testRuns: 0, passed: 0, failed: 0, issues: 0 };
        m.features.set(key, f);
      }
      return f;
    };

    for (const run of testRuns) {
      const feature = run.testDefinition?.feature ?? null;
      const mod = feature?.module ?? null;
      const m = ensureModule(mod?.id ?? null, mod?.name ?? 'Unassigned');
      const f = ensureFeature(m, feature?.id ?? null, feature?.name ?? 'Unassigned');
      f.testRuns += 1;
      if (run.status === RunStatus.PASSED) f.passed += 1;
      if (run.status === RunStatus.FAILED) f.failed += 1;
    }

    for (const issue of issues) {
      const modId = issue.module?.id ?? issue.feature?.moduleId ?? null;
      const modName = issue.module?.name ?? 'Unassigned';
      const m = ensureModule(modId, modName);
      const f = ensureFeature(m, issue.feature?.id ?? null, issue.feature?.name ?? 'Unassigned');
      f.issues += 1;
    }

    return Array.from(modules.values()).map(m => ({
      moduleId: m.moduleId,
      moduleName: m.moduleName,
      features: Array.from(m.features.values()),
    }));
  }
}
