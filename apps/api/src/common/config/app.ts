/**
 * The platform / product display name.
 *
 * Single source of truth: the `APP_NAME` env var (with `EMAIL_APP_NAME` kept as
 * a back-compat alias), defaulting to "AdVantage". Per-org branding and the
 * platform-admin branding override this for org-scoped surfaces (emails,
 * reports, the web shell); this is the deployment-level default used everywhere
 * a name is otherwise hard-coded — certificates, MCP server name, AI export
 * headers, ClickUp footers, the email from-name, etc.
 *
 * The web reads the same value at runtime via the public platform-branding
 * endpoint, so one env var drives both the API and the UI.
 */
export function appName(env: NodeJS.ProcessEnv = process.env): string {
  return env.APP_NAME || env.EMAIL_APP_NAME || 'AdVantage';
}

/**
 * The "From" header for outgoing email. The display NAME always follows the
 * platform name ({@link appName}) so a re-brand (APP_NAME) updates every sender
 * line at once — the address is taken from EMAIL_FROM (parsed out of either
 * `"Name" <addr>` or a bare `addr`), or a no-reply default. Setting EMAIL_FROM's
 * own display name has no effect: the name is APP_NAME, by design.
 */
export function emailFrom(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.EMAIL_FROM?.trim();
  let address = 'no-reply@advantage.local';
  if (raw) {
    const angled = raw.match(/<([^>]+)>/);
    address = (angled ? angled[1] : raw.replace(/^"[^"]*"\s*/, '')).trim() || address;
  }
  return `"${appName(env)}" <${address}>`;
}

/** True when running in production (NODE_ENV=production). Consolidates the
 *  scattered inline `process.env.NODE_ENV === 'production'` checks. */
export function isProd(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.NODE_ENV ?? 'development') === 'production';
}

/** Redis connection URL (BullMQ + screencast pub/sub), with the dev default. */
export function redisUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.REDIS_URL ?? 'redis://localhost:6379';
}

/** Local-disk root for run artifacts / report PDFs / sign-off certificates. */
export function artifactStoragePath(env: NodeJS.ProcessEnv = process.env): string {
  return env.ARTIFACT_STORAGE_PATH ?? './artifacts';
}

/** Env vars the API cannot start without. */
const REQUIRED_ENV = ['DATABASE_URL', 'JWT_SECRET', 'SECRETS_KEK', 'REDIS_URL'] as const;

/**
 * Fail fast at boot if a critical env var is missing — one clear message instead
 * of an opaque downstream Prisma / Redis / JWT failure minutes later. Dep-free
 * (no joi); the format/entropy checks for JWT_SECRET + SECRETS_KEK in main.ts /
 * secrets.service still run on top of this.
 */
export function assertRequiredEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV.filter((k) => !env[k] || env[k]!.trim() === '');
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
      `Set them (see .env.example) before starting the API.`,
    );
  }
}
