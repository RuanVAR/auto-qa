import type { PluginCtx } from '../../types';
import type { ListDocsInput, ListDocsOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * listDocs — `GET /api/v3/workspaces/{wsId}/docs`.
 *
 * Quirks of the v3 endpoint, learned the hard way:
 *   - The `q` / `name` query parameters are silently ignored. Filtering by
 *     name has to happen client-side after the response lands.
 *   - The `parent_id` + `parent_type` filters DO work — pass them via the
 *     extended payload (parent.spaceId / parent.folderId / parent.listId)
 *     to scope the result set to a meaningful subset (the user's bound
 *     space, in particular, makes the difference between 1 result and
 *     50 unrelated CS-Processes docs).
 *
 * Best-effort behaviour:
 *   - Caller passes `parent.spaceId` (resolved by the frontend from the
 *     project's cascade) → we filter to that space (parent_type=4).
 *   - Caller passes `parent.folderId` (parent_type=2) — same idea, narrower.
 *   - Caller types in a search box → query string is applied client-side
 *     against `name` after the v3 endpoint returns.
 *   - With no scope hints we fetch a default page and rely on client-side
 *     query — works but slow on large workspaces.
 */
export async function listDocs(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<ListDocsOutput> {
  const input = (payload as ListDocsInput & {
    parent?: { spaceId?: string; folderId?: string; listId?: string };
  }) ?? {};
  const client = new ClickUpClient(ctx.http);

  let workspaceId = ctx.config.workspaceId;
  if (!workspaceId) {
    const teams = await client.getTeams();
    if (teams.length === 0) {
      throw new PluginPermanentError('No ClickUp workspaces accessible to this token', 'clickup');
    }
    workspaceId = teams[0].id;
  }

  // Resolve parent filter from the most specific scope provided.
  let parentId: string | undefined;
  let parentType: number | undefined;
  if (input.parent?.listId) { parentId = input.parent.listId; parentType = 1; }
  else if (input.parent?.folderId) { parentId = input.parent.folderId; parentType = 2; }
  else if (input.parent?.spaceId) { parentId = input.parent.spaceId; parentType = 4; }

  // Larger limit since query-side filtering is client-side.
  const fetchLimit = input.limit ?? (parentId ? 50 : 100);
  const result = await client.listDocs(workspaceId, {
    limit: fetchLimit,
    cursor: input.cursor,
    parentId,
    parentType,
  });

  // Client-side name filter — case-insensitive substring match.
  const q = (input.query ?? '').trim().toLowerCase();
  const filtered = q
    ? (result.docs ?? []).filter((d) => (d.name ?? '').toLowerCase().includes(q))
    : (result.docs ?? []);

  // Sort by recency so the latest docs surface first.
  filtered.sort((a, b) => Number(b.date_updated ?? 0) - Number(a.date_updated ?? 0));

  return {
    items: filtered.map((d) => ({
      externalId: d.id,
      externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${d.id}`,
      title: d.name,
      summary: d.description,
      updatedAt: d.date_updated ? new Date(Number(d.date_updated)).toISOString() : undefined,
    })),
    nextCursor: q ? undefined : result.next_cursor,  // cursor only meaningful for unfiltered pulls
  };
}
