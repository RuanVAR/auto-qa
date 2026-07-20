/**
 * Environment-level auth seed.
 *
 * Lets every test in a run boot ALREADY authenticated by injecting
 * `localStorage` (typically a JWT under `token`) into the browser context
 * before any app script runs — so tests don't each have to drive the UI login
 * (which is slow, repetitive, and causes a same-user session race under
 * parallel runs).
 *
 * Configured via the Environment's `__authSeed` variable (a JSON string). Two
 * modes:
 *
 *   // 1. Mint a fresh token per run from the app's login API:
 *   {"loginUrl":"http://host/api/auth/login","email":"u@x.com","password":"p",
 *    "tokenKey":"token","tokenPath":"data.token"}
 *
 *   // 2. Inject a static localStorage payload (e.g. a long-lived token):
 *   {"localStorage":{"token":"<jwt>"}}
 *
 * Returns the localStorage map to seed, or null when no auth is configured or
 * the mint fails (the run then proceeds unauthenticated — tests that need a
 * session will fail honestly rather than silently).
 */

import { assertSafeTargetUrl } from '../utils/ssrf-guard';

export const AUTH_SEED_VAR = '__authSeed';

export interface AuthSeedConfig {
  /** Static localStorage payload to inject verbatim. */
  localStorage?: Record<string, string>;
  /** App login endpoint to POST credentials to (mint mode). */
  loginUrl?: string;
  email?: string;
  password?: string;
  /** Override the POST body entirely (defaults to {email,password}). */
  body?: Record<string, unknown>;
  /** Extra headers for the login POST. */
  headers?: Record<string, string>;
  /** localStorage key to store the token under. Default: "token". */
  tokenKey?: string;
  /** Dot-path to the token in the login response. Default: "data.token". */
  tokenPath?: string;
}

const getByPath = (obj: unknown, path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>(
      (acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined),
      obj,
    );

export async function resolveAuthSeed(
  variables: Record<string, unknown> | null | undefined,
): Promise<Record<string, string> | null> {
  const raw = variables?.[AUTH_SEED_VAR];
  if (typeof raw !== 'string' || raw.trim() === '') return null;

  let cfg: AuthSeedConfig;
  try {
    cfg = JSON.parse(raw) as AuthSeedConfig;
  } catch {
    console.warn(`[auth-seed] ${AUTH_SEED_VAR} is not valid JSON — skipping`);
    return null;
  }

  // Mode 2: static localStorage payload.
  if (cfg.localStorage && typeof cfg.localStorage === 'object') {
    return Object.fromEntries(
      Object.entries(cfg.localStorage).map(([k, v]) => [k, String(v)]),
    );
  }

  // Mode 1: mint a token from the app's login API.
  if (cfg.loginUrl) {
    const tokenKey = cfg.tokenKey ?? 'token';
    const tokenPath = cfg.tokenPath ?? 'data.token';
    const payload = cfg.body ?? { email: cfg.email, password: cfg.password };
    try {
      // The same SSRF guard every other outbound path in the worker uses. This
      // was the one egress that skipped it, and it is the worst place to skip
      // it: the response is parsed for a token and injected into the browser,
      // so a loginUrl of http://169.254.169.254/... would have reached cloud
      // metadata and seeded whatever came back.
      await assertSafeTargetUrl(cfg.loginUrl);

      const res = await fetch(cfg.loginUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(cfg.headers ?? {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        console.warn(`[auth-seed] login POST ${cfg.loginUrl} -> ${res.status}; proceeding unauthenticated`);
        return null;
      }
      const json: unknown = await res.json().catch(() => null);
      const token = getByPath(json, tokenPath);
      if (typeof token !== 'string' || token === '') {
        console.warn(`[auth-seed] no string token at "${tokenPath}" in login response`);
        return null;
      }
      return { [tokenKey]: token };
    } catch (e) {
      console.warn('[auth-seed] login mint failed:', (e as Error).message);
      return null;
    }
  }

  return null;
}
