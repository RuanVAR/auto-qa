import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { UserApiToken } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const TOKEN_PREFIX = 'qapt_';

export interface PublicApiToken {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  lastUsedIp: string | null;
  revokedAt: Date | null;
  createdAt: Date;
  status: 'active' | 'expired' | 'revoked';
}

/** Request context for auditing token-management actions. */
export interface ActorCtx {
  orgId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Personal access tokens (PATs). Mirrors the refresh-token hashing pattern
 * (`token.service.ts`): generate `qapt_<32 random bytes>`, store only the
 * SHA-256 hash, return the plaintext once. The token carries the owner's full
 * RBAC — enforced live by the API on every call, not here.
 */
@Injectable()
export class ApiTokensService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(userId: string): Promise<PublicApiToken[]> {
    const rows = await this.prisma.userApiToken.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toPublic);
  }

  /** Create a new token. Returns the plaintext ONCE alongside the public row. */
  async issue(
    userId: string,
    input: { name: string; expiresInDays?: number | null },
    ctx: ActorCtx = {},
  ): Promise<{ token: string; record: PublicApiToken }> {
    const name = input.name?.trim();
    if (!name) throw new ForbiddenException('Token name is required');
    const { plaintext, tokenHash, prefix } = this.mint();
    const row = await this.prisma.userApiToken.create({
      data: { userId, name, tokenHash, prefix, expiresAt: expiryFromDays(input.expiresInDays) },
    });
    await this.audit.log(userId, 'API_TOKEN_ISSUED', 'UserApiToken', row.id, undefined,
      { name: row.name, expiresAt: row.expiresAt }, { ...auditMeta(ctx) });
    return { token: plaintext, record: toPublic(row) };
  }

  /** Rotate in place — same row identity, fresh secret; old secret stops working. */
  async regenerate(userId: string, id: string, ctx: ActorCtx = {}): Promise<{ token: string; record: PublicApiToken }> {
    await this.owned(userId, id);
    const { plaintext, tokenHash, prefix } = this.mint();
    const row = await this.prisma.userApiToken.update({
      where: { id },
      data: { tokenHash, prefix, revokedAt: null, lastUsedAt: null, lastUsedIp: null },
    });
    await this.audit.log(userId, 'API_TOKEN_REGENERATED', 'UserApiToken', id, undefined,
      { name: row.name }, { ...auditMeta(ctx) });
    return { token: plaintext, record: toPublic(row) };
  }

  async revoke(userId: string, id: string, ctx: ActorCtx = {}): Promise<void> {
    const row = await this.owned(userId, id);
    if (row.revokedAt) return;
    await this.prisma.userApiToken.update({ where: { id }, data: { revokedAt: new Date() } });
    await this.audit.log(userId, 'API_TOKEN_REVOKED', 'UserApiToken', id, { name: row.name }, undefined,
      { ...auditMeta(ctx) });
  }

  /**
   * Validate a plaintext PAT for the auth strategy. Returns the owning userId
   * (and stamps lastUsedAt/IP, best-effort) or null if the token is unknown,
   * revoked, or expired.
   */
  async validate(plaintext: string, ip?: string | null): Promise<{ userId: string; tokenId: string } | null> {
    if (!plaintext || !plaintext.startsWith(TOKEN_PREFIX)) return null;
    const tokenHash = this.hash(plaintext);
    const row = await this.prisma.userApiToken.findUnique({ where: { tokenHash } });
    if (!row || row.revokedAt) return null;
    if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
    // Best-effort touch — never block auth on this write.
    void this.prisma.userApiToken
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date(), lastUsedIp: ip ?? null } })
      .catch(() => undefined);
    return { userId: row.userId, tokenId: row.id };
  }

  /**
   * Build the same `req.user` shape the JWT strategy returns, for a PAT-resolved
   * user. activeOrg/orgRole come from the user's memberships (a PAT has no org
   * context baked in). Returns null if the user is gone or not ACTIVE.
   */
  async resolveUserContext(userId: string): Promise<{
    sub: string; email: string; platformRole: string;
    activeOrgId: string | null; orgRole: string | null; role: string; authSource: 'api-token';
  } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, platformRole: true, accountStatus: true, lastActiveOrgId: true,
        orgMemberships: { select: { orgId: true, role: true }, orderBy: { joinedAt: 'asc' } },
      },
    });
    if (!user || user.accountStatus !== 'ACTIVE') return null;
    const activeOrgId = user.lastActiveOrgId ?? user.orgMemberships[0]?.orgId ?? null;
    const orgRole = user.orgMemberships.find((m) => m.orgId === activeOrgId)?.role ?? null;
    return {
      sub: user.id,
      email: user.email,
      platformRole: user.platformRole,
      activeOrgId,
      orgRole,
      role: user.platformRole,
      authSource: 'api-token',
    };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private mint(): { plaintext: string; tokenHash: string; prefix: string } {
    const plaintext = TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
    return { plaintext, tokenHash: this.hash(plaintext), prefix: plaintext.slice(0, 12) };
  }

  private hash(plaintext: string): string {
    return crypto.createHash('sha256').update(plaintext).digest('hex');
  }

  private async owned(userId: string, id: string): Promise<UserApiToken> {
    const row = await this.prisma.userApiToken.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('Token not found');
    if (row.userId !== userId) throw new ForbiddenException('Not your token');
    return row;
  }
}

function toPublic(row: UserApiToken): PublicApiToken {
  const status: PublicApiToken['status'] = row.revokedAt
    ? 'revoked'
    : row.expiresAt && row.expiresAt.getTime() < Date.now()
      ? 'expired'
      : 'active';
  return {
    id: row.id,
    name: row.name,
    prefix: row.prefix,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    lastUsedIp: row.lastUsedIp,
    revokedAt: row.revokedAt,
    createdAt: row.createdAt,
    status,
  };
}

function expiryFromDays(days?: number | null): Date | null {
  if (!days || days <= 0) return null;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function auditMeta(ctx: ActorCtx) {
  return { orgId: ctx.orgId ?? null, ip: ctx.ip ?? null, userAgent: ctx.userAgent ?? null, source: 'web' };
}
