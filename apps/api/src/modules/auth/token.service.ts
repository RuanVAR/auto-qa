import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import * as crypto from 'crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { JwtTokenPayload } from './auth.service';

/**
 * TokenService — owns JWT issuance, refresh-token lifecycle, and access-token
 * revocation. Splits responsibilities cleanly:
 *
 *   - issuePair():   creates an access token (15 min, JWT with `jti`) AND a
 *                    refresh token (7 d, sha256 hash stored in DB).
 *   - rotate():      atomically revokes the old refresh token, issues a new
 *                    pair, and detects replay (revoked → re-used = compromise).
 *   - revoke():      ends a single refresh-token row.
 *   - revokeAllForUser(): kills every active session for a user (used on
 *                    password change or admin-suspension).
 *   - blacklistAccessToken(): adds the access token's `jti` to a Redis SET
 *                    with TTL = remaining lifetime. JwtStrategy checks this
 *                    on every request.
 *   - isAccessTokenRevoked(): O(1) Redis lookup.
 *
 * Why two layers (refresh DB row + access blacklist):
 *   Access tokens are stateless JWTs. We can't "delete" them — only refuse
 *   to honor them. Rather than DB-look-up every request (expensive), we
 *   keep a Redis SET of revoked `jti`s — fast, and we let the SET entries
 *   auto-expire when the JWT itself would have expired anyway.
 */

const REFRESH_TTL_DAYS = 7;
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;
const ACCESS_TTL_SECONDS = 15 * 60; // matches JwtModule signOptions.expiresIn
const REVOKED_JTI_KEY_PREFIX = 'auth:revoked-jti:';

@Injectable()
export class TokenService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TokenService.name);
  private redis!: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.redis = new Redis(url, { lazyConnect: false });
    this.redis.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  // ─── Issuance ─────────────────────────────────────────────────────────────

  /**
   * Create a fresh (access, refresh) pair tied to a user. Stores the refresh
   * token's hash in DB so the plaintext we hand back is the only copy that
   * leaves the server. UA + IP are captured for the sessions UI.
   */
  async issuePair(
    payload: Omit<JwtTokenPayload, 'jti'>,
    metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<{ accessToken: string; refreshToken: string; refreshTokenId: string }> {
    const jti = crypto.randomUUID();
    const accessToken = this.jwt.sign({ ...payload, jti });

    const refreshPlaintext = crypto.randomBytes(48).toString('base64url');
    const tokenHash = this.hash(refreshPlaintext);

    const row = await this.prisma.userRefreshToken.create({
      data: {
        userId: payload.sub,
        tokenHash,
        userAgent: metadata.userAgent ?? null,
        ipAddress: metadata.ipAddress ?? null,
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
      },
    });

    return { accessToken, refreshToken: refreshPlaintext, refreshTokenId: row.id };
  }

  // ─── Rotation (the refresh flow) ──────────────────────────────────────────

  /**
   * Verify a refresh token, mark it revoked, and issue a fresh pair. If the
   * supplied token was already revoked, treat it as a replay attack and
   * revoke EVERY refresh token for that user — better to log them out
   * everywhere than let an attacker keep stealing pairs.
   *
   * Caller passes the *new* JWT payload (we re-derive activeOrgId/orgRole
   * here in case org membership changed since the original login).
   */
  async rotate(
    refreshTokenPlaintext: string,
    metadata: { userAgent?: string | null; ipAddress?: string | null } = {},
  ): Promise<{ accessToken: string; refreshToken: string; payload: JwtTokenPayload }> {
    const tokenHash = this.hash(refreshTokenPlaintext);
    const row = await this.prisma.userRefreshToken.findUnique({
      where: { tokenHash },
      include: { user: { include: { orgMemberships: { orderBy: { joinedAt: 'asc' } } } } },
    });
    if (!row) throw new ForbiddenException('Invalid refresh token');

    // Replay detection: refresh tokens are one-use. If we see a revoked one,
    // an attacker has it. Burn the whole user's refresh-token tree.
    if (row.revokedAt) {
      this.logger.warn(`Refresh token replay for user ${row.userId} — revoking all sessions`);
      await this.revokeAllForUser(row.userId, 'replay-detected');
      throw new ForbiddenException('Refresh token already used — all sessions revoked for safety');
    }
    if (row.expiresAt < new Date()) {
      throw new ForbiddenException('Refresh token expired');
    }
    if (row.user.accountStatus !== 'ACTIVE') {
      throw new ForbiddenException('Account is not active');
    }

    // Derive fresh JWT payload from the user's current org memberships —
    // ensures org switches / role changes since the original login are
    // reflected without needing a second login.
    const activeOrgId = row.user.lastActiveOrgId
      ?? row.user.orgMemberships[0]?.orgId
      ?? null;
    const orgRole = row.user.orgMemberships.find((m) => m.orgId === activeOrgId)?.role
      ?? row.user.orgMemberships[0]?.role
      ?? null;
    const payload: JwtTokenPayload = {
      sub: row.user.id,
      email: row.user.email,
      platformRole: row.user.platformRole,
      activeOrgId,
      orgRole,
    };

    // Issue the new pair, then atomically point the old row at it.
    const fresh = await this.issuePair(payload, metadata);
    await this.prisma.userRefreshToken.update({
      where: { id: row.id },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        replacedById: fresh.refreshTokenId,
      },
    });

    return { accessToken: fresh.accessToken, refreshToken: fresh.refreshToken, payload };
  }

  // ─── Revocation ───────────────────────────────────────────────────────────

  /** End one specific refresh-token row (logout from a single device). */
  async revoke(refreshTokenId: string, reason: string): Promise<void> {
    await this.prisma.userRefreshToken.updateMany({
      where: { id: refreshTokenId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  /** End every active refresh token for a user (logout everywhere). */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const r = await this.prisma.userRefreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
    return r.count;
  }

  /** Blacklist an access-token JTI for the remainder of its lifetime. */
  async blacklistAccessToken(jti: string | undefined | null, expSeconds?: number): Promise<void> {
    if (!jti) return;
    const ttl = expSeconds ? Math.max(1, expSeconds - Math.floor(Date.now() / 1000)) : ACCESS_TTL_SECONDS;
    if (ttl <= 0) return;
    await this.redis.set(`${REVOKED_JTI_KEY_PREFIX}${jti}`, '1', 'EX', ttl);
  }

  /** Hot-path check called by JwtStrategy on every request. O(1) Redis GET. */
  async isAccessTokenRevoked(jti?: string | null): Promise<boolean> {
    if (!jti) return false;
    const v = await this.redis.get(`${REVOKED_JTI_KEY_PREFIX}${jti}`);
    return v !== null;
  }

  // ─── Sessions UI helpers ──────────────────────────────────────────────────

  async listSessionsForUser(userId: string) {
    return this.prisma.userRefreshToken.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }
}
