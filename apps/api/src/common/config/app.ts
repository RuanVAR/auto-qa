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
