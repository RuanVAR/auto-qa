import { PluginPermanentError } from '../plugin.errors';

/**
 * Runtime kill switch for ClickUp writes during development.
 *
 * Modes (env CLICKUP_DEV_WRITE_MODE):
 *   - "blocked"      → every write throws PluginPermanentError. Default.
 *   - "sandbox-only" → only writes targeting list ids in CLICKUP_DEV_SANDBOX_LIST_IDS
 *                      pass; everything else throws.
 *   - "live"         → writes go through unchecked. Requires opting-in twice
 *                      (mode AND removing the safety env to avoid accidental flips).
 *
 * NOT a security boundary — anyone with shell access can override env. It's a
 * developer guardrail to prevent accidental live writes during dev or while
 * the sandbox isn't ready. Production deployments should set
 * CLICKUP_DEV_WRITE_MODE=live or unset it (treated as "live" in production
 * NODE_ENV) once the operator has confirmed credential scope.
 */
export type ClickUpWriteMode = 'blocked' | 'sandbox-only' | 'live';

const SANDBOX_DELIM = /[\s,]+/;

export function getWriteMode(): ClickUpWriteMode {
  const raw = (process.env.CLICKUP_DEV_WRITE_MODE ?? '').toLowerCase().trim();
  if (raw === 'live') return 'live';
  if (raw === 'sandbox-only' || raw === 'sandbox_only' || raw === 'sandbox') return 'sandbox-only';
  if (process.env.NODE_ENV === 'production' && raw === '') return 'live';
  return 'blocked';
}

function getSandboxLists(): Set<string> {
  const raw = process.env.CLICKUP_DEV_SANDBOX_LIST_IDS ?? '';
  return new Set(raw.split(SANDBOX_DELIM).filter(Boolean));
}

/**
 * Throws if the current write mode disallows touching `listId`.
 * Pass null/undefined for writes that don't have a clear target list (e.g.
 * webhook registration); those require mode === "live".
 */
export function ensureWriteAllowed(operation: string, listId?: string | null): void {
  const mode = getWriteMode();
  if (mode === 'live') return;

  if (mode === 'blocked') {
    throw new PluginPermanentError(
      `ClickUp write blocked (CLICKUP_DEV_WRITE_MODE=blocked): ${operation}`,
      'clickup',
    );
  }

  // sandbox-only
  if (!listId) {
    throw new PluginPermanentError(
      `ClickUp write blocked (sandbox-only mode requires a list-scoped operation): ${operation}`,
      'clickup',
    );
  }
  const allowed = getSandboxLists();
  if (!allowed.has(listId)) {
    throw new PluginPermanentError(
      `ClickUp write blocked: list ${listId} is not in CLICKUP_DEV_SANDBOX_LIST_IDS`,
      'clickup',
    );
  }
}
