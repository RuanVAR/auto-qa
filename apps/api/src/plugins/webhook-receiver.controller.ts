import {
  Controller,
  Post,
  Param,
  Headers,
  Req,
  Logger,
  HttpCode,
  Body,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import Redis from 'ioredis';
import { PrismaService } from '../common/prisma/prisma.service';
import { pluginRegistry } from './registry';
import { InboundSyncService } from './inbound-sync.service';

/**
 * Generic webhook receiver — plugin-agnostic.
 *
 * Path: `/api/v1/webhooks/plugins/:orgId/:installId/:token`
 *
 * Pipeline:
 *   1. Resolve PluginWebhookEndpoint by token; bail (silently) if mismatch.
 *   2. Replay protection — same body digest seen in the last 5 min → ignore.
 *   3. Hand raw body + signing secret to manifest.verifyWebhook().
 *      Bad signature → INCR a 1h Redis counter; auto-disable endpoint at >=10.
 *   4. Audit (digest only by default; full payload when WEBHOOK_PAYLOAD_RETENTION=full).
 *   5. Extract affected external ids via manifest.extractAffectedExternalIds.
 *   6. For each id, look up the matching TicketLink and call
 *      InboundSyncService.refreshTicket(linkId, 'WEBHOOK').
 *
 * Always returns 2xx — returning 4xx leaks endpoint existence to attackers
 * probing for tokens, and many upstream systems will retry on 4xx which would
 * amplify abuse traffic. The audit row carries the actual outcome.
 */
@ApiTags('webhooks')
@Controller('webhooks/plugins')
export class WebhookReceiverController implements OnModuleDestroy {
  private readonly logger = new Logger(WebhookReceiverController.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly inbound: InboundSyncService,
    private readonly config: ConfigService,
  ) {
    const url = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    this.redis = new Redis(url, { lazyConnect: false });
    this.redis.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
  }

  async onModuleDestroy() {
    await this.redis?.quit().catch(() => undefined);
  }

  @Post(':orgId/:installId/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inbound webhook receiver (per-plugin HMAC verification + replay + auto-disable)' })
  async receive(
    @Param('orgId') orgId: string,
    @Param('installId') installId: string,
    @Param('token') token: string,
    @Headers() headers: Record<string, string>,
    @Req() req: { rawBody?: Buffer; body?: unknown },
    @Body() body: unknown,
  ) {
    const rawBody = req.rawBody ?? Buffer.from(JSON.stringify(body ?? {}));
    const payloadDigest = createHash('sha256').update(rawBody).digest('hex');
    const retainFull = (this.config.get<string>('WEBHOOK_PAYLOAD_RETENTION') ?? 'digest') === 'full';

    // 1) Resolve endpoint by token.
    const endpoint = await this.prisma.pluginWebhookEndpoint.findFirst({
      where: { isActive: true, path: { endsWith: `/${token}` } },
      include: { install: true },
    });
    if (!endpoint || endpoint.install.orgId !== orgId || endpoint.installId !== installId) {
      this.logger.warn(`Webhook rejected: token mismatch (token=${token.slice(0, 8)}…)`);
      return { ok: false };
    }

    // 2) Replay protection — same body in 5 min → drop. Prevents
    //    accidental + malicious double-processing of identical events.
    const replayKey = `webhook:seen:${installId}:${payloadDigest}`;
    const isFresh = await this.redis.set(replayKey, '1', 'EX', 300, 'NX');
    if (isFresh === null) {
      this.logger.log(`Webhook replay dropped (digest=${payloadDigest.slice(0, 12)}…)`);
      await this.audit(orgId, installId, headers['x-event-type'], true, payloadDigest, body, retainFull, 'replay');
      return { ok: true };
    }

    const manifest = pluginRegistry.get(endpoint.install.pluginId);
    if (!manifest || !manifest.verifyWebhook || !manifest.handleWebhook) {
      this.logger.warn(`Webhook plugin missing hooks: ${endpoint.install.pluginId}`);
      await this.audit(orgId, installId, headers['x-event-type'], false, payloadDigest, body, retainFull, 'plugin-missing-webhook-hooks');
      return { ok: false };
    }

    // 3) Verify signature.
    const valid = manifest.verifyWebhook(rawBody, headers, endpoint.signingSecret);
    if (!valid) {
      await this.handleInvalidSignature(endpoint.id, installId);
      this.logger.warn(`Webhook signature invalid for install ${installId}`);
      await this.audit(orgId, installId, headers['x-event-type'], false, payloadDigest, body, retainFull, 'invalid-signature');
      return { ok: false };
    }

    // 4) Audit verified delivery.
    await this.prisma.pluginWebhookEndpoint
      .update({ where: { id: endpoint.id }, data: { lastCalledAt: new Date() } })
      .catch(() => undefined);
    await this.audit(orgId, installId, headers['x-event-type'], true, payloadDigest, body, retainFull);

    // 5) Extract affected external ids and route each to InboundSyncService.
    if (manifest.extractAffectedExternalIds) {
      const ids = manifest.extractAffectedExternalIds(body);
      if (ids.length > 0) {
        const links = await this.prisma.ticketLink.findMany({
          where: { installId, externalId: { in: ids }, deletedAt: null },
          select: { id: true, externalId: true },
        });
        for (const link of links) {
          // Best-effort — never block the 200 response on inbound sync work.
          // Errors land on TicketLink.lastInboundSyncError via the service.
          this.inbound
            .refreshTicket(link.id, 'WEBHOOK')
            .catch((e) => this.logger.warn(`webhook → refreshTicket(${link.id}) failed: ${(e as Error).message}`));
        }
      }
    }

    return { ok: true };
  }

  private async handleInvalidSignature(endpointId: string, installId: string): Promise<void> {
    const counterKey = `webhook:invalid:${installId}`;
    const count = await this.redis.incr(counterKey);
    if (count === 1) await this.redis.expire(counterKey, 3600);
    if (count >= 10) {
      // Disable the endpoint to stop the abuse loop. Operator restores via
      // the rotation endpoint (re-issues token + re-registers upstream).
      await this.prisma.pluginWebhookEndpoint
        .update({ where: { id: endpointId }, data: { isActive: false } })
        .catch(() => undefined);
      this.logger.error(`Webhook endpoint ${endpointId} auto-disabled after ${count} invalid signatures in 1h`);
      // TODO(notifications): emit PLUGIN_WEBHOOK_DISABLED notification to ORG_ADMIN.
    }
  }

  private async audit(
    orgId: string,
    installId: string,
    eventType: string | undefined,
    signatureValid: boolean,
    payloadDigest: string,
    payload: unknown,
    retainFull: boolean,
    errorMessage?: string,
  ) {
    await this.prisma.webhookEvent
      .create({
        data: {
          orgId,
          installId,
          eventType: eventType ?? null,
          signatureValid,
          payloadDigest,
          payload: retainFull ? (payload as object) : undefined,
          responseStatus: 200,
          errorMessage: errorMessage ?? null,
        },
      })
      .catch((e) => this.logger.error(`audit insert failed: ${(e as Error).message}`));
  }
}
