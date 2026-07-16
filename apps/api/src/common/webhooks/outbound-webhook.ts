import { createHmac } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decryptSecret } from '@qa-platform/shared';

export interface ProjectWebhookConfig {
  webhookUrl: string | null;
  webhookSecretCiphertext: Uint8Array | Buffer | null;
  webhookSecretKeyId: string | null;
}

/**
 * Signed, best-effort outbound project webhook — shared by
 * feature_run.completed and pipeline_run.completed so the transport (SSRF
 * hygiene, HMAC x-signature, 5s timeout, 2 attempts) can't diverge.
 * Never throws; failures are warn-logged and swallowed.
 */
export async function sendProjectWebhook(
  project: ProjectWebhookConfig,
  payload: Record<string, unknown>,
  logger: Logger,
  logRef: string,
): Promise<void> {
  if (!project.webhookUrl) return;
  let url: URL;
  try { url = new URL(project.webhookUrl); } catch { return; }
  // Outbound SSRF hygiene: http(s) only, never cloud-metadata/link-local.
  if (!/^https?:$/.test(url.protocol)) return;
  const host = url.hostname.toLowerCase();
  if (host === 'metadata.google.internal' || host.startsWith('169.254.') || host === '[fe80::1]') return;

  const body = JSON.stringify(payload);
  let secret: string | null = null;
  if (project.webhookSecretCiphertext && project.webhookSecretKeyId) {
    try {
      secret = decryptSecret(Buffer.from(project.webhookSecretCiphertext), project.webhookSecretKeyId).secret ?? null;
    } catch { secret = null; }
  }
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) headers['x-signature'] = createHmac('sha256', secret).update(body).digest('hex');

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(project.webhookUrl, {
        method: 'POST', headers, body, signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return;
      logger.warn(`webhook ${res.status} for ${logRef} (attempt ${attempt + 1})`);
    } catch (err) {
      logger.warn(`webhook failed for ${logRef}: ${(err as Error).message} (attempt ${attempt + 1})`);
    }
  }
}
