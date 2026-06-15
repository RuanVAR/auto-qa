import { PluginPermanentError } from '../plugin.errors';
import type { GdriveInstallConfig } from './schemas';
import { GoogleDriveClient } from './gdrive.client';

/**
 * Server-side enforcement of the install's access scope. This is the security
 * boundary — never trust the client's claim that a file/folder is allowed.
 *
 * 'entire' mode: everything the connected account can see is in scope.
 *
 * 'folders' mode: the target must BE an allowed folder, or live UNDER one.
 * Drive only exposes direct `parents`, so we walk the parent chain upward
 * (bounded) until we hit an allowed id or run out. Bounded at MAX_DEPTH to
 * cap the round-trips and stop a pathological/cyclic chain.
 */
const MAX_DEPTH = 25;

export async function assertInScope(
  client: GoogleDriveClient,
  config: GdriveInstallConfig,
  fileId: string,
): Promise<void> {
  if (config.accessMode === 'entire') return;
  const allowed = new Set(config.allowedFolderIds);
  if (allowed.has(fileId)) return; // the target is itself an allowed root

  // Walk up via the first parent at each level until we reach an allowed
  // folder. (Files with multiple parents are rare in modern Drive; following
  // the first is sufficient for the common single-home case.)
  let current = fileId;
  const seen = new Set<string>();
  for (let depth = 0; depth < MAX_DEPTH; depth++) {
    if (seen.has(current)) break; // cycle guard
    seen.add(current);
    const meta = await client.getFile(current).catch(() => null);
    const parents = meta?.parents ?? [];
    if (parents.length === 0) break;
    if (parents.some((p) => allowed.has(p))) return;
    current = parents[0];
  }
  throw new PluginPermanentError(
    'Requested Drive item is outside the folders this organisation may access.',
    'gdrive',
  );
}

/**
 * A Drive `q` fragment that constrains a listing to the allowed folders'
 * direct children. Used by list-docs/list-entities in 'folders' mode when no
 * explicit parent is supplied, so a top-level search can't leak files outside
 * the allow-list. Returns '' in 'entire' mode (no constraint).
 */
export function allowedParentsQuery(config: GdriveInstallConfig): string {
  if (config.accessMode === 'entire' || config.allowedFolderIds.length === 0) return '';
  const clauses = config.allowedFolderIds.map((id) => `'${id.replace(/'/g, "\\'")}' in parents`);
  return `(${clauses.join(' or ')})`;
}
