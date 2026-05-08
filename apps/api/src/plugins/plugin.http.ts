import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import type Redis from 'ioredis';
import {
  PluginAuthError,
  PluginPermanentError,
  PluginRateLimitError,
  PluginTransientError,
} from './plugin.errors';

/**
 * Build a per-dispatch axios instance with:
 *
 *   - Authorization header injected from secrets (redacted in any log of the
 *     outgoing config — Logger callers MUST NOT serialise headers themselves)
 *   - Exponential-backoff retry on 5xx + network errors (250ms → 1s → 4s; 3 retries)
 *   - 429 handling that honours Retry-After up to a cap, then throws
 *   - 401/403 → PluginAuthError (caller flips install to unhealthy)
 *   - Fixed-window rate-limit checked per request against a Redis counter scoped
 *     to (pluginId, orgId). Window = 60s. Ceiling sized 10% under the plugin
 *     manifest's declared rate to keep us out of upstream throttling.
 *
 * The returned instance has no caching or interceptors beyond what's wired
 * here; do not extend it from the call site.
 */
export type PluginHttpFactoryOpts = {
  baseURL?: string;
  authHeader: string;                            // e.g. "Bearer pk_xxx" or "pk_xxx" (ClickUp PAT)
  pluginId: string;
  orgId: string;
  rateLimitPerMinute?: number;                   // ceiling — undefined = no limiting
  redis?: Redis;                                 // optional — falls back to no-rate-limit if absent
  /** Override timeout in ms (default 30s). */
  timeoutMs?: number;
};

const MAX_RETRIES = 3;
const RETRY_BACKOFFS_MS = [250, 1000, 4000];
const MAX_RETRY_AFTER_MS = 30_000;

export function buildPluginHttp(opts: PluginHttpFactoryOpts): AxiosInstance {
  const instance = axios.create({
    baseURL: opts.baseURL,
    timeout: opts.timeoutMs ?? 30_000,
    headers: { Authorization: opts.authHeader },
    // Don't auto-throw on >=400 — interceptor decides per-status.
    validateStatus: () => true,
  });

  // ── Request: rate-limit gate ──────────────────────────────────────────────
  instance.interceptors.request.use(async (cfg) => {
    if (opts.redis && opts.rateLimitPerMinute && opts.rateLimitPerMinute > 0) {
      const ceiling = Math.floor(opts.rateLimitPerMinute * 0.9);
      const minute = Math.floor(Date.now() / 60_000);
      const key = `plugin:ratelimit:${opts.pluginId}:${opts.orgId}:${minute}`;
      const count = await opts.redis.incr(key);
      if (count === 1) await opts.redis.expire(key, 65);
      if (count > ceiling) {
        throw new PluginRateLimitError(
          `Local rate-limit ceiling reached (${ceiling}/min)`,
          opts.pluginId,
          (60 - (Date.now() % 60_000) / 1000) * 1000,
        );
      }
    }
    return cfg;
  });

  // ── Response: classify + retry ────────────────────────────────────────────
  instance.interceptors.response.use(async (res) => {
    const status = res.status;

    if (status >= 200 && status < 400) return res;

    const cfg = res.config as AxiosRequestConfig & { __retryAttempt?: number };
    const attempt = cfg.__retryAttempt ?? 0;

    if (status === 401 || status === 403) {
      throw new PluginAuthError(
        `Auth failure (${status}) on ${cfg.method?.toUpperCase()} ${cfg.url}`,
        opts.pluginId,
      );
    }

    if (status === 429) {
      const retryAfterMs = parseRetryAfterMs(res.headers['retry-after']);
      if (attempt >= MAX_RETRIES || retryAfterMs > MAX_RETRY_AFTER_MS) {
        throw new PluginRateLimitError(
          `Upstream 429 on ${cfg.method?.toUpperCase()} ${cfg.url}`,
          opts.pluginId,
          retryAfterMs,
        );
      }
      await sleep(retryAfterMs);
      cfg.__retryAttempt = attempt + 1;
      return instance.request(cfg);
    }

    if (status >= 500 && status < 600) {
      if (attempt >= MAX_RETRIES) {
        throw new PluginTransientError(
          `Upstream ${status} on ${cfg.method?.toUpperCase()} ${cfg.url} (after ${attempt} retries)`,
          opts.pluginId,
        );
      }
      await sleep(RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]);
      cfg.__retryAttempt = attempt + 1;
      return instance.request(cfg);
    }

    // 4xx other than 401/403/429 — caller mistake, do not retry.
    throw new PluginPermanentError(
      `Upstream ${status} on ${cfg.method?.toUpperCase()} ${cfg.url}`,
      opts.pluginId,
      summariseAxiosError(res),
    );
  });

  // Network-level failures + timeouts also flow here.
  instance.interceptors.response.use(undefined, async (err: AxiosError) => {
    const cfg = err.config as AxiosRequestConfig & { __retryAttempt?: number };
    const attempt = cfg?.__retryAttempt ?? 0;
    const retryable =
      err.code === 'ECONNABORTED' ||
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ENOTFOUND' ||
      err.code === 'EAI_AGAIN';
    if (retryable && attempt < MAX_RETRIES) {
      await sleep(RETRY_BACKOFFS_MS[Math.min(attempt, RETRY_BACKOFFS_MS.length - 1)]);
      (cfg as { __retryAttempt: number }).__retryAttempt = attempt + 1;
      return instance.request(cfg);
    }
    if (err instanceof PluginRateLimitError || err instanceof PluginAuthError) throw err;
    throw new PluginTransientError(
      `Network error on ${cfg?.method?.toUpperCase()} ${cfg?.url}: ${err.message}`,
      opts.pluginId,
      err,
    );
  });

  return instance;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.max(0, ms)));
}

function parseRetryAfterMs(header: string | string[] | undefined): number {
  if (!header) return RETRY_BACKOFFS_MS[0];
  const raw = Array.isArray(header) ? header[0] : header;
  const seconds = Number(raw);
  if (!Number.isNaN(seconds)) return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  // HTTP-date form — fall back to first backoff.
  const date = Date.parse(raw);
  if (!Number.isNaN(date)) return Math.max(0, Math.min(date - Date.now(), MAX_RETRY_AFTER_MS));
  return RETRY_BACKOFFS_MS[0];
}

function summariseAxiosError(res: { status: number; data?: unknown }): unknown {
  const body = typeof res.data === 'string' ? res.data.slice(0, 256) : res.data;
  return { status: res.status, body };
}
