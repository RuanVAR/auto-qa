import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtPayload } from '../decorators/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

export const ORG_ROLES_KEY = 'org_roles';
export const OrgRoles = (...roles: string[]) => SetMetadata(ORG_ROLES_KEY, roles);

/**
 * Authorises org-scoped endpoints.
 *
 * Two checks per request, both backed by Postgres so they reflect current
 * state (not the stale snapshot baked into the JWT):
 *
 *   1. The `:orgId` URL param maps to a real OrgMember row for the
 *      authenticated user — kicked-out users can't access an org just
 *      because their token still says they belong, and a multi-org user
 *      can't enumerate other orgs by guessing IDs.
 *   2. That membership's role is in the `@OrgRoles(...)` list (when set).
 *
 * PLATFORM_ADMIN bypasses both checks — they need to be able to operate
 * on any org for support/diagnostics.
 *
 * Endpoints with no `:orgId` param (e.g. invite-accept by token) and no
 * `@OrgRoles(...)` decorator pass through. If `@OrgRoles(...)` is set on
 * such an endpoint we reject — ambiguous configuration.
 */
@Injectable()
export class OrgRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.get<string[]>(ORG_ROLES_KEY, context.getHandler());
    const request = context.switchToHttp().getRequest<{ user: JwtPayload; params: Record<string, string> }>();
    const user = request.user;
    const orgId = request.params?.orgId;

    // PLATFORM_ADMIN bypasses all org role checks.
    if (user?.platformRole === 'PLATFORM_ADMIN') return true;

    // No orgId in URL → only run if there's also no role requirement (the
    // endpoint is not org-scoped). Otherwise it's a route bug.
    if (!orgId) {
      if (required && required.length > 0) {
        throw new ForbiddenException('Endpoint requires :orgId in path for role check');
      }
      return true;
    }

    // 1 — verify membership exists for THIS user in THIS org.
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.sub } },
      select: { role: true },
    });
    if (!membership) {
      throw new ForbiddenException('You are not a member of this organisation');
    }

    // Stash the live role on the request so handlers don't have to repeat
    // the lookup. (Note: this overwrites the JWT-baked orgRole when the
    // two diverge — by design.)
    (request as { user: JwtPayload }).user = { ...user, orgRole: membership.role };

    // 2 — check role meets the requirement, if any.
    if (!required || required.length === 0) return true;
    if (!required.includes(membership.role)) {
      throw new ForbiddenException('Insufficient organisation role.');
    }
    return true;
  }
}
