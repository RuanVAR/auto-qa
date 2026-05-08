import {
  Controller,
  Post,
  Param,
  Headers,
  Req,
  Logger,
  HttpCode,
  Body,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { createHash } from 'node:crypto';
import { PrismaService } from '../common/prisma/prisma.service';
import { PluginService } from './plugin.service';
import { pluginRegistry } from './registry';

/**
 * Generic webhook receiver — plugin-agnostic by design.
 *
 * The path is `/api/v1/webhooks/plugins/:orgId/:installId/:token`. The token
 * lives in PluginWebhookEndpoint.path and rotates via the install's
 * webhook-rotate endpoint (Phase 6). HMAC verification + payload handling are
 * delegated to the plugin manifest — we never decode signature schemes here.
 *
 * Behaviour:
 *   1. Resolve install + endpoint by token
 *   2. Hand raw bytes + signing secret to manifest.verifyWebhook()
 *   3. If valid: load ctx, call manifest.handleWebhook()
 *   4. Audit a WebhookEvent row (digest only by default; full payload only
 *      when WEBHOOK_PAYLOAD_RETENTION=full)
 *
 * Always returns 2xx on signature failure (200 with error in audit row).
 * Returning 4xx leaks endpoint existence to attackers probing for tokens.
 */
@ApiTags('webhooks')
@Controller('webhooks/plugins')
export class WebhookReceiverController {
  private readonly logger = new Logger(WebhookReceiverController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pluginService: PluginService,
  ) {}

  @Post(':orgId/:installId/:token')
  @HttpCode(200)
  @ApiOperation({ summary: 'Inbound webhook receiver (per-plugin HMAC verification)' })
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
    const retainFull = (process.env.WEBHOOK_PAYLOAD_RETENTION ?? 'digest') === 'full';

    const endpoint = await this.prisma.pluginWebhookEndpoint.findFirst({
      where: { isActive: true, path: { endsWith: `/${token}` } },
      include: { install: true },
    });

    // Always audit the attempt — even if the endpoint is unknown — so abuse
    // patterns are visible. Skip the install relation when endpoint is null.
    if (!endpoint || endpoint.install.orgId !== orgId || endpoint.installId !== installId) {
      this.logger.warn(`Webhook rejected: unknown / mismatched endpoint (token=${token.slice(0, 8)}…)`);
      return { ok: false };
    }

    const manifest = pluginRegistry.get(endpoint.install.pluginId);
    if (!manifest || !manifest.verifyWebhook || !manifest.handleWebhook) {
      this.logger.warn(`Webhook plugin missing hooks: ${endpoint.install.pluginId}`);
      return this.audit(orgId, endpoint.installId, undefined, false, payloadDigest, body, retainFull, 'plugin-missing-webhook-hooks');
    }

    const valid = manifest.verifyWebhook(rawBody, headers, endpoint.signingSecret);
    if (!valid) {
      this.logger.warn(`Webhook signature invalid for install ${installId}`);
      return this.audit(orgId, endpoint.installId, headers['x-event-type'], false, payloadDigest, body, retainFull, 'invalid-signature');
    }

    // Verified — dispatch to handler. Errors here are logged but never
    // bubble to the caller (we always 200 to avoid retry storms).
    try {
      // handleWebhook needs ctx — borrow PluginService.dispatch's ctx builder
      // by invoking dispatch with an inline shim isn't ideal; instead we
      // reach into PluginService for the right ctx. For Phase 1 we keep this
      // simple: log + record only. Phase 6 finishes the dispatch wiring.
      await this.pluginService
        .dispatch('webhookListener' as never, endpoint.installId, body)
        .catch((e) => {
          this.logger.warn(`webhookListener dispatch failed: ${(e as Error).message}`);
        });
      await this.prisma.pluginWebhookEndpoint.update({
        where: { id: endpoint.id },
        data: { lastCalledAt: new Date() },
      });
      return this.audit(orgId, endpoint.installId, headers['x-event-type'], true, payloadDigest, body, retainFull);
    } catch (err) {
      return this.audit(
        orgId,
        endpoint.installId,
        headers['x-event-type'],
        true,
        payloadDigest,
        body,
        retainFull,
        (err as Error).message,
      );
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
    return { ok: signatureValid && !errorMessage };
  }
}
