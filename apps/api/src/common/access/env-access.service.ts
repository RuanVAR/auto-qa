import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Centralised environment access control.
 *
 * Every endpoint that touches per-env data (run lists, run triggers, sign-off,
 * promote, env-scoped stats) consults this service so the rules live in one
 * place and stay consistent. Two complementary entry points:
 *
 *   1. assertEnvAccess(userId, projectId, envId)
 *      — throws 403 if the user can't act in that env. Use whenever the
 *      caller passes an explicit envId in a query or body.
 *
 *   2. getAllowedEnvIds(userId, projectId)
 *      — returns null when the user is unrestricted (org admin / project
 *      owner / project tech lead / member with no env restriction); returns
 *      a (possibly empty) array of envIds otherwise. Use this to add an
 *      `environmentId IN (...)` clause to *list* endpoints so a user with
 *      no explicit filter still only sees what they're allowed to.
 *
 * Authority hierarchy (highest to lowest):
 *   - PLATFORM_ADMIN              → unrestricted everywhere
 *   - ORG_ADMIN within the org    → unrestricted across all the org's projects
 *   - ProjectMember OWNER/TECH_LEAD → unrestricted within the project
 *   - ProjectMember with empty allowedEnvironmentIds → unrestricted within project
 *   - ProjectMember with non-empty allowedEnvironmentIds → restricted
 *   - Non-member of the project   → forbidden
 *
 * The "empty allowed list = unrestricted" rule matches the schema comment on
 * ProjectMember.allowedEnvironmentIds and matches what the env list endpoint
 * already does, so behaviour is consistent across the whole platform.
 */
@Injectable()
export class EnvAccessService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Throw 403 unless `userId` is allowed to operate in `envId` within
   * `projectId`. Also validates that the env actually belongs to that
   * project, so a forged envId from another project can never slip through.
   */
  async assertEnvAccess(
    userId: string,
    projectId: string,
    envId: string,
    context: { jwtRoleHint?: { orgRole?: string | null; platformRole?: string | null }; orgId?: string | null } = {},
  ): Promise<void> {
    // Platform admins bypass everything.
    if (context.jwtRoleHint?.platformRole === 'PLATFORM_ADMIN') return;

    const env = await this.prisma.environment.findUnique({
      where: { id: envId },
      select: { id: true, projectId: true, project: { select: { orgId: true } } },
    });
    if (!env) throw new NotFoundException('Environment not found');
    if (env.projectId !== projectId) {
      // Catches cross-project leaks where someone forges an envId from another
      // project. Always 403 (not 400) — don't leak whether the env exists in
      // some other project.
      throw new ForbiddenException('Environment does not belong to this project');
    }

    // Org admins of the env's owning org bypass project membership checks.
    if (context.jwtRoleHint?.orgRole === 'ORG_ADMIN' && env.project.orgId === (context.orgId ?? env.project.orgId)) {
      return;
    }

    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this project');
    if (member.role === 'OWNER' || member.role === 'TECH_LEAD') return;
    if (member.allowedEnvironmentIds.length === 0) return; // unrestricted
    if (!member.allowedEnvironmentIds.includes(envId)) {
      throw new ForbiddenException('You do not have access to this environment');
    }
  }

  /**
   * Throw 403 unless `userId` can access `projectId` at all — i.e. they are a
   * platform admin, an ORG_ADMIN of the project's org, or a ProjectMember
   * (any role). Use this to guard resources that have NO environment to scope
   * on (e.g. a manual feature run with environmentId=null, a work session, an
   * issue) where assertEnvAccess can't apply. Membership-only; no env filter.
   */
  async assertProjectAccess(
    userId: string,
    projectId: string,
    context: { jwtRoleHint?: { orgRole?: string | null; platformRole?: string | null }; orgId?: string | null } = {},
  ): Promise<void> {
    if (context.jwtRoleHint?.platformRole === 'PLATFORM_ADMIN') return;
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (context.jwtRoleHint?.orgRole === 'ORG_ADMIN' && project.orgId === (context.orgId ?? project.orgId)) {
      return;
    }
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) throw new ForbiddenException('Not a member of this project');
  }

  /**
   * Returns:
   *   - `null` when the caller is unrestricted (no env filter needed).
   *   - `string[]` of env IDs the caller can see otherwise.
   *
   * Callers should treat `null` as "do not add an `environmentId IN (...)`
   * clause" and `[]` as "this user can't see any envs in this project; return
   * an empty result set."
   */
  async getAllowedEnvIds(
    userId: string,
    projectId: string,
    context: { jwtRoleHint?: { orgRole?: string | null; platformRole?: string | null }; orgId?: string | null } = {},
  ): Promise<string[] | null> {
    if (context.jwtRoleHint?.platformRole === 'PLATFORM_ADMIN') return null;
    if (context.jwtRoleHint?.orgRole === 'ORG_ADMIN') {
      // ORG_ADMIN of the project's own org sees everything unrestricted —
      // they don't need a projectMember row. Verify org match so an admin
      // of org A can't get an unrestricted view of org B's project (that
      // case falls through to the membership check, yielding [] for a
      // non-member). Without the early null, a non-member ORG_ADMIN got an
      // empty allowed list and every feature's run list came back empty —
      // which made the testing page show "Start session" while a run was
      // already active (only the env-unfiltered TopNav pill saw it).
      const project = await this.prisma.project.findUnique({
        where: { id: projectId },
        select: { orgId: true },
      });
      if (!project) throw new NotFoundException('Project not found');
      if (project.orgId === (context.orgId ?? project.orgId)) return null;
    }
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
    });
    if (!member) {
      // Non-members get an empty allowed list rather than an exception, so
      // list endpoints quietly return no rows. Callers that want a hard 403
      // for non-membership should call assertEnvAccess on a specific env.
      return [];
    }
    if (member.role === 'OWNER' || member.role === 'TECH_LEAD') return null;
    if (member.allowedEnvironmentIds.length === 0) return null;
    return member.allowedEnvironmentIds;
  }
}
