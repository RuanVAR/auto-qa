/**
 * webhookListener — declarative marker capability.
 *
 * Plugins that opt into `webhookListener` MUST also implement:
 *   - manifest.verifyWebhook
 *   - manifest.handleWebhook
 *   - (optionally) manifest.registerWebhook + manifest.deregisterWebhook
 *
 * Capability handlers map does NOT need a handler entry — the receiver
 * controller dispatches via the manifest hooks directly.
 */
export type WebhookListenerInput = never;
export type WebhookListenerOutput = never;
