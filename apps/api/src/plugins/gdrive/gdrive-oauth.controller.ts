import {
  Controller,
  Get,
  Param,
  Query,
  Res,
  UseGuards,
  BadRequestException,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import Redis from 'ioredis';
import { randomBytes } from 'node:crypto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgRoleGuard, OrgRoles } from '../../common/guards/org-role.guard';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser, JwtPayload } from '../../common/decorators/current-user.decorator';
import { PluginService } from '../plugin.service';
import { redisUrl } from '../../common/config/app';
import { googleOAuthConfigured } from '../../common/config/app';
import { webUrl } from '../../common/config/urls';
import { buildConsentUrl, exchangeCode, getUserInfo } from './oauth';

/**
 * Google Drive OAuth2 connect flow.
 *
 *   start    → ORG_ADMIN gets a Google consent URL (state stashed in Redis).
 *   callback → Google redirects here (no JWT — trusted via the one-time state);
 *              we exchange the code for a refresh token and create the install.
 *
 * Connection lands the install in 'entire' access mode. The admin narrows the
 * scope (to specific folders) afterwards from the install card — that step
 * needs a live install to browse folders, so it can't happen pre-redirect.
 */
@ApiTags('plugins')
@Controller()
export class GdriveOAuthController implements OnModuleDestroy {
  private readonly logger = new Logger(GdriveOAuthController.name);
  private readonly redis: Redis;
  private static readonly STATE_TTL_S = 600; // 10 min to complete consent

  constructor(private readonly plugins: PluginService) {
    this.redis = new Redis(redisUrl(), { lazyConnect: false });
    this.redis.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  @Get('orgs/:orgId/gdrive/oauth/start')
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard, OrgRoleGuard)
  @OrgRoles('ORG_ADMIN')
  @ApiOperation({ summary: 'Begin the Google Drive connect flow — returns a consent URL' })
  async start(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Query('displayLabel') displayLabel?: string,
  ) {
    if (!googleOAuthConfigured()) {
      throw new BadRequestException(
        'Google Drive is not configured on this deployment. Ask your operator to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    const state = randomBytes(24).toString('base64url');
    await this.redis.set(
      `gdrive:oauthstate:${state}`,
      JSON.stringify({ orgId, userId: user.sub, displayLabel: displayLabel ?? null }),
      'EX',
      GdriveOAuthController.STATE_TTL_S,
    );
    return { url: buildConsentUrl(state) };
  }

  // FIXED callback path (no :orgId) — Google's redirect-URI allow-list is
  // exact-match, so the org is carried in `state`, not the URL.
  @Get('gdrive/oauth/callback')
  @Public()
  @ApiOperation({ summary: 'Google OAuth redirect target — completes the install' })
  async callback(
    @Res() reply: FastifyReply,
    @Query('code') code?: string,
    @Query('state') state?: string,
    @Query('error') error?: string,
  ) {
    // Explicit 302 + Location — Fastify's `reply.redirect(url)` left the status
    // at 200 under Nest's @Res() handling, which browsers don't follow.
    const redirect = (params: string) =>
      reply.status(302).header('location', `${webUrl()}/org/plugins?${params}`).send();

    if (error) return redirect(`gdrive=error&reason=${encodeURIComponent(error)}`);
    if (!code || !state) return redirect('gdrive=error&reason=missing_code');

    // Validate + consume the one-time state (CSRF + carries install context).
    const raw = await this.redis.get(`gdrive:oauthstate:${state}`).catch(() => null);
    if (!raw) return redirect('gdrive=error&reason=expired_state');
    await this.redis.del(`gdrive:oauthstate:${state}`).catch(() => undefined);

    let parsed: { orgId: string; userId: string; displayLabel: string | null };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return redirect('gdrive=error&reason=bad_state');
    }
    // The org this consent was started for — taken from the validated state,
    // since the callback URL no longer carries it.
    const orgId = parsed.orgId;
    if (!orgId) return redirect('gdrive=error&reason=bad_state');

    try {
      const tokens = await exchangeCode(code);
      if (!tokens.refresh_token) {
        // Happens when the account was previously consented without prompt=consent.
        return redirect('gdrive=error&reason=no_refresh_token');
      }
      let connectedEmail: string | undefined;
      try {
        connectedEmail = (await getUserInfo(tokens.access_token)).email;
      } catch {
        /* email is cosmetic — proceed without it */
      }

      await this.plugins.install({
        orgId,
        pluginId: 'gdrive',
        displayLabel: parsed.displayLabel ?? undefined,
        config: { accessMode: 'entire', allowedFolderIds: [], connectedEmail },
        secrets: { refreshToken: tokens.refresh_token },
        installedById: parsed.userId,
      });
      return redirect('gdrive=connected');
    } catch (err) {
      this.logger.warn(`gdrive callback failed: ${(err as Error).message}`);
      return redirect(`gdrive=error&reason=${encodeURIComponent('install_failed')}`);
    }
  }
}
