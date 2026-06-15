import { z } from 'zod';

/**
 * Zod schemas for the Google Drive plugin install config + secrets.
 *
 * Validation runs at install time (PluginService.install → parseOrThrow).
 *
 * ─── Access scope ───────────────────────────────────────────────────────────
 *
 * The org admin connects one Google account (OAuth2). The connected account's
 * own Drive visibility is the ceiling; `accessMode` narrows it:
 *
 *   • 'entire'  → everything the connected account can see is browsable/linkable.
 *   • 'folders' → only the curated `allowedFolderIds` (and their descendants)
 *                 are browsable/linkable. This allow-list is the SERVER-SIDE
 *                 security boundary — every capability handler re-validates a
 *                 requested file/folder is within scope before touching it.
 */
export const GdriveInstallConfigSchema = z
  .object({
    // Required (no zod .default) so the schema's input and output types match —
    // PluginManifest.configSchema is ZodSchema<C> (input === output).
    //
    // New installs land as 'folders' with an EMPTY allow-list — an "unconfigured"
    // state. The plugin is unusable (members see + can link NOTHING) until the
    // admin picks one or more base folders. This is the security model: the
    // plugin only ever exposes the admin-chosen base folders' subtrees, never
    // the rest of a (possibly personal) Drive. 'entire' remains in the enum for
    // a deliberate whole-Drive install (e.g. a dedicated bot account) but isn't
    // offered in the default UI.
    accessMode: z.enum(['entire', 'folders']),
    /** Base folders the org may browse/link within (My Drive or shared drives).
     *  Empty in 'folders' mode = unconfigured → no access. */
    allowedFolderIds: z.array(z.string()),
    /** Cosmetic — the connected Google account email, for display only. */
    connectedEmail: z.string().optional(),
  })
  .strict();

export type GdriveInstallConfig = z.infer<typeof GdriveInstallConfigSchema>;

/** True once at least one base folder is configured (or the install is the
 *  explicit whole-Drive 'entire' mode). An unconfigured install is unusable. */
export function isConfigured(config: GdriveInstallConfig): boolean {
  return config.accessMode === 'entire' || config.allowedFolderIds.length > 0;
}

/**
 * The only secret we persist is the OAuth2 refresh token. Access tokens are
 * short-lived and minted on demand (resolveAuthHeader), never stored.
 */
export const GdriveSecretsSchema = z
  .object({
    refreshToken: z.string().min(10),
  })
  .strict();

export type GdriveSecrets = z.infer<typeof GdriveSecretsSchema>;

/**
 * Returns true when a Drive file/folder with the given `parents` is in scope
 * for this install. In 'entire' mode everything the account sees is allowed;
 * in 'folders' mode the file must have at least one parent in the allow-list.
 *
 * NOTE: Drive's `parents` are only the DIRECT parents. A nested file's chain
 * up to an allowed root isn't visible from a single `files.get`, so deep
 * browsing must thread the allowed set down as it drills (see list-entities) —
 * this check is the leaf-level gate, not a full ancestry walk.
 */
export function isInScope(config: GdriveInstallConfig, parents: string[] | undefined): boolean {
  if (config.accessMode === 'entire') return true;
  if (!parents || parents.length === 0) return false;
  const allowed = new Set(config.allowedFolderIds);
  return parents.some((p) => allowed.has(p));
}
