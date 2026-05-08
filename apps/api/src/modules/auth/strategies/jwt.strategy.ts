import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { TokenService } from '../token.service';
import type { JwtTokenPayload } from '../auth.service';

/**
 * Stateful JWT validation. Three checks per request:
 *
 *   1. The JWT signature + expiry (passport-jwt does this before validate()).
 *   2. The token's `jti` is not in the Redis revocation set (logout, password
 *      change, admin-suspend all push entries here).
 *   3. The user still exists, is ACTIVE, and the org membership baked into
 *      the token is still valid.
 *
 * Adds one Redis GET + one indexed Postgres SELECT per authed request. Both
 * are cached aggressively by their respective stores; in profiling this adds
 * <1 ms to a typical request.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {
    const secret = config.get<string>('JWT_SECRET');
    if (!secret || secret.trim().length < 16) {
      // The module factory already throws on missing secret, but we double-
      // check here in case someone instantiates the strategy without going
      // through the module (testing edge case).
      throw new Error('JWT_SECRET is missing or too short — refusing to start.');
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  async validate(payload: JwtTokenPayload & { jti?: string; exp?: number }) {
    // Guard 1 — token revoked? (logout, admin force-logout, password change)
    if (await this.tokens.isAccessTokenRevoked(payload.jti)) {
      throw new UnauthorizedException('Token revoked — please sign in again');
    }

    // Guard 2 — user still exists & is active? Fetches lean: just the fields
    // we need to gate access. (60-s cache is feasible if profiling shows
    // the SELECT becomes hot, but as of writing it's ~0.5 ms.)
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, email: true, platformRole: true, accountStatus: true },
    });
    if (!user) throw new UnauthorizedException('User no longer exists');
    if (user.accountStatus !== 'ACTIVE') {
      throw new UnauthorizedException(`Account ${user.accountStatus.toLowerCase()}`);
    }

    // Guard 3 — re-validate the org membership baked into the token. Two
    // failure modes covered:
    //
    //   1. User was removed from the org since the token was minted →
    //      they need to lose access immediately, not after the 15-min
    //      access-token expiry.
    //   2. The user's role changed (e.g. demoted ORG_ADMIN → ORG_MEMBER)
    //      → return the live role so OrgRoleGuard sees the current value
    //      rather than the stale snapshot in the JWT payload.
    //
    // We don't throw on missing membership — a user can legitimately have
    // an `activeOrgId` set without being in any org (just-removed,
    // pre-onboarding state). We just clear the org context for this
    // request and let the route's own auth fail with a meaningful 403.
    let liveOrgRole: string | null = payload.orgRole ?? null;
    let liveActiveOrgId: string | null = payload.activeOrgId ?? null;
    if (payload.activeOrgId) {
      const membership = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId: payload.activeOrgId, userId: payload.sub } },
        select: { role: true },
      });
      if (!membership) {
        liveOrgRole = null;
        liveActiveOrgId = null;
      } else {
        liveOrgRole = membership.role;
      }
    }

    return {
      sub: payload.sub,
      email: user.email, // canonical from DB, not the (potentially stale) JWT
      platformRole: user.platformRole, // ditto — handles platform role changes
      activeOrgId: liveActiveOrgId,
      orgRole: liveOrgRole,
      jti: payload.jti,
      exp: payload.exp,
      // legacy compat
      role: user.platformRole,
    };
  }
}
