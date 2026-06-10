import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { AuditService } from '../audit/audit.service';
import { ClickUpLinksService } from '../clickup-links/clickup-links.service';
import { buildPluginHttp } from '../../plugins/plugin.http';
import { ClickUpClient } from '../../plugins/clickup/clickup.client';

const CLICKUP_BASE_URL = 'https://api.clickup.com';

type AuditCtx = { ip?: string | null; userAgent?: string | null };

/**
 * A user's OWN ClickUp personal token, so their ClickUp actions are attributed
 * to them. Opt-in: with no token, actions fall back to the org token. The token
 * is encrypted at rest (SecretsService) — never hashed, never returned.
 */
@Injectable()
export class UserClickUpTokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly audit: AuditService,
    private readonly links: ClickUpLinksService,
  ) {}

  /** The org's ClickUp install (presence ≠ healthy). */
  private clickupInstall(orgId: string) {
    return this.prisma.orgPluginInstall.findFirst({
      where: { orgId, pluginId: 'clickup', deletedAt: null },
      select: { id: true, isEnabled: true, lastHealthOk: true },
    });
  }

  /** Status for the Settings UI + onboarding nudge — never returns the secret. */
  async status(userId: string, orgId: string | null) {
    if (!orgId) return { installed: false, healthy: false, hasToken: false };
    const install = await this.clickupInstall(orgId);
    if (!install) return { installed: false, healthy: false, hasToken: false };
    const tok = await this.prisma.userClickUpToken.findUnique({
      where: { userId_installId: { userId, installId: install.id } },
      select: { lastHealthOk: true, connectedAs: true, revokedAt: true, updatedAt: true },
    });
    const hasToken = !!tok && !tok.revokedAt;
    return {
      installed: true,
      healthy: install.isEnabled && install.lastHealthOk,
      hasToken,
      tokenHealthy: hasToken ? tok.lastHealthOk : false,
      connectedAs: hasToken ? tok.connectedAs : null,
      updatedAt: hasToken ? tok.updatedAt : null,
    };
  }

  /** Validate + store a user's ClickUp PAT; auto-link them as a CU assignee. */
  async set(userId: string, orgId: string | null, plaintext: string, ctx?: AuditCtx) {
    if (!orgId) throw new BadRequestException('No active organisation selected.');
    const token = (plaintext ?? '').trim();
    if (token.length < 20) throw new BadRequestException("That doesn't look like a ClickUp token.");

    const install = await this.clickupInstall(orgId);
    if (!install) throw new NotFoundException('ClickUp is not installed for this organisation.');

    // Validate the pasted token directly against ClickUp.
    const http = buildPluginHttp({
      baseURL: CLICKUP_BASE_URL,
      authHeader: token,
      pluginId: 'clickup',
      orgId,
    });
    let cu: { id: number; username: string; email: string };
    try {
      cu = await new ClickUpClient(http).getUser();
    } catch (err) {
      throw new BadRequestException(`ClickUp rejected that token: ${(err as Error).message}`);
    }

    const connectedAs = cu.username ? `${cu.username} (${cu.email})` : cu.email;
    const { ciphertext, keyId } = this.secrets.encrypt({ token });
    const now = new Date();
    const data = {
      secretsCiphertext: ciphertext,
      secretsKeyId: keyId,
      clickupUserId: cu.id,
      clickupUsername: cu.username ?? null,
      clickupEmail: cu.email ?? null,
      connectedAs,
      lastHealthOk: true,
      lastHealthAt: now,
      lastHealthError: null,
      revokedAt: null,
    };
    await this.prisma.userClickUpToken.upsert({
      where: { userId_installId: { userId, installId: install.id } },
      create: { userId, installId: install.id, ...data },
      update: data,
    });

    // Auto-link as a ClickUp assignee so attribution + assignment align.
    // Best-effort — never fail the save on it (e.g. org install not yet healthy).
    try {
      await this.links.link(orgId, {
        qaUserId: userId,
        clickupUserId: cu.id,
        clickupUsername: cu.username,
        clickupEmail: cu.email,
      });
    } catch {
      /* assignee linking is a nice-to-have */
    }

    this.audit.log(
      userId,
      'CLICKUP_TOKEN_SET',
      'UserClickUpToken',
      install.id,
      undefined,
      { connectedAs },
      { orgId, source: 'web', ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null },
    );
    return { hasToken: true, healthy: true, connectedAs };
  }

  /** Remove the user's token (leaves their assignee link intact). */
  async remove(userId: string, orgId: string | null, ctx?: AuditCtx) {
    if (!orgId) return { hasToken: false };
    const install = await this.clickupInstall(orgId);
    if (!install) return { hasToken: false };
    const { count } = await this.prisma.userClickUpToken.deleteMany({
      where: { userId, installId: install.id },
    });
    if (count > 0) {
      this.audit.log(userId, 'CLICKUP_TOKEN_REMOVED', 'UserClickUpToken', install.id, undefined, undefined, {
        orgId,
        source: 'web',
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent ?? null,
      });
    }
    return { hasToken: false };
  }
}
