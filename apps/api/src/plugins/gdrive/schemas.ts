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
    // PluginManifest.configSchema is ZodSchema<C> (input === output). The OAuth
    // callback always supplies these (accessMode:'entire', allowedFolderIds:[]).
    accessMode: z.enum(['entire', 'folders']),
    /** Drive folder ids the org may browse/link. Non-empty when
     *  accessMode === 'folders'; [] otherwise. */
    allowedFolderIds: z.array(z.string()),
    /** Cosmetic — the connected Google account email, for display only. */
    connectedEmail: z.string().optional(),
  })
  .strict()
  .refine(
    (c) => c.accessMode !== 'folders' || c.allowedFolderIds.length > 0,
    { message: "accessMode 'folders' requires at least one allowedFolderId", path: ['allowedFolderIds'] },
  );

export type GdriveInstallConfig = z.infer<typeof GdriveInstallConfigSchema>;

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
