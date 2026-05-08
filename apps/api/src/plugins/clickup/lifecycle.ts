import type { PluginCtx } from '../types';
import type { ClickUpInstallConfig, ClickUpSecrets } from './schemas';
import { ClickUpClient } from './clickup.client';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * `GET /api/v2/user` doubles as the cheapest valid healthcheck — it returns the
 * authenticated user identity, so we get both "creds work" and a display-safe
 * `connectedAs` string in one call.
 */
export async function clickupHealthCheck(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
): Promise<{ ok: boolean; error?: string; connectedAs?: string }> {
  try {
    const client = new ClickUpClient(ctx.http);
    const user = await client.getUser();
    return { ok: true, connectedAs: `${user.username} (${user.email})` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

/**
 * HMAC-SHA256 verification of inbound webhooks.
 *
 * ClickUp sends `X-Signature: <hex>` where the body is the raw bytes from the
 * request. The signing secret is the one ClickUp returned when we registered
 * the webhook (stored in PluginWebhookEndpoint.signingSecret).
 *
 * Uses constant-time comparison via crypto.timingSafeEqual.
 */
export function clickupVerifyWebhook(
  rawBody: Buffer,
  headers: Record<string, string>,
  signingSecret: string,
): boolean {
  const sig = headers['x-signature'] ?? headers['X-Signature'];
  if (!sig || typeof sig !== 'string') return false;
  const expected = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
