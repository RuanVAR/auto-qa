/**
 * Error taxonomy thrown by plugin handlers and surfaced by PluginService.dispatch.
 *
 * Categorised so the dispatch layer can decide retry vs surface-to-user vs
 * disable-install. Plugins SHOULD throw the most specific subtype.
 */

export class PluginError extends Error {
  constructor(
    message: string,
    public readonly pluginId: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/** Network glitch, 5xx, timeout — safe to retry with backoff. */
export class PluginTransientError extends PluginError {}

/** 4xx other than 401/403/429 — caller mistake; do NOT retry. */
export class PluginPermanentError extends PluginError {}

/** Plugin returned a payload that didn't match the declared output shape. */
export class PluginProtocolError extends PluginError {}

/** 401/403 — credentials invalid; flip install to unhealthy + notify ORG_ADMIN. */
export class PluginAuthError extends PluginError {}

/** 429 — back off per Retry-After header; throws after retry budget exhausted. */
export class PluginRateLimitError extends PluginError {
  constructor(
    message: string,
    pluginId: string,
    public readonly retryAfterMs?: number,
    cause?: unknown,
  ) {
    super(message, pluginId, cause);
  }
}

/** The 4-level enablement gate said no — capability not available in this scope. */
export class PluginNotEnabledError extends PluginError {
  constructor(pluginId: string, capability: string, scope: string) {
    super(
      `Plugin ${pluginId} not enabled for capability ${capability} in scope ${scope}`,
      pluginId,
    );
  }
}
