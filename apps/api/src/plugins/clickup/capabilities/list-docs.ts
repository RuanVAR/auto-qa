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

  // Resolve parent filter. ClickUp's v3 docs API only honours space-level
  // filtering (parent_type=4) reliably — folder (=2) and list (=1) parents
  // return 400. Prefer spaceId; only fall through to narrower scopes when
  // space isn't known.
  let parentId: string | undefined;
  let parentType: number | undefined;
  if (input.parent?.spaceId) { parentId = input.parent.spaceId; parentType = 4; }
  else if (input.parent?.folderId) { parentId = input.parent.folderId; parentType = 2; }
  else if (input.parent?.listId) { parentId = input.parent.listId; parentType = 1; }

  // Larger limit since query-side filtering is client-side.
  const fetchLimit = input.limit ?? (parentId ? 50 : 100);
  const result = await client.listDocs(workspaceId, {
    limit: fetchLimit,
    cursor: input.cursor,
    parentId,
    parentType,
  });

  const q = (input.query ?? '').trim().toLowerCase();

  // Sort by recency so the latest docs surface first.
  const allDocs = [...(result.docs ?? [])].sort(
    (a, b) => Number(b.date_updated ?? 0) - Number(a.date_updated ?? 0),
  );

  // Doc-level matches by name.
  const docMatches = q
    ? allDocs.filter((d) => (d.name ?? '').toLowerCase().includes(q))
    : allDocs;

  // Page-level matches: when the user typed a query, also walk page listings
  // for the in-scope docs and surface page hits. Pages are how teams really
  // organise content in ClickUp ("Reporting > Daily Report") — searching just
  // doc titles misses 90% of useful targets.
  //
  // Bound: only walk pages when scope filter narrows results to ≤25 docs;
  // otherwise the N+1 page fetch becomes too expensive. Without scope filter
  // we fall back to doc-level matches only.
  const pageMatches: Array<{
    docId: string;
    docTitle: string;
    docUrl: string;
    pageId: string;
    pageName: string;
  }> = [];
  if (q && allDocs.length <= 25) {
    for (const d of allDocs) {
      let pages: Array<{ id: string; name: string; parent_page_id: string | null }> = [];
      try {
        pages = await client.getDocPageListing(workspaceId, d.id);
      } catch {
        continue;  // best-effort — bad doc shouldn't kill the whole search
      }
      for (const p of pages) {
        if ((p.name ?? '').toLowerCase().includes(q)) {
          pageMatches.push({
            docId: d.id,
            docTitle: d.name,
            docUrl: `https://app.clickup.com/${workspaceId}/v/dc/${d.id}`,
            pageId: p.id,
            pageName: p.name,
          });
        }
      }
    }
  }

  // Merge: doc matches first, then page matches. Page items carry pageId so
  // the frontend can pre-select the page when the user clicks (skip the page
  // picker step). Title shows "<Doc> › <Page>" so context is obvious.
  const items: Array<{
    externalId: string;
    externalUrl: string;
    title: string;
    summary?: string;
    updatedAt?: string;
    pageId?: string;
  }> = [];

  for (const d of docMatches) {
    items.push({
      externalId: d.id,
      externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${d.id}`,
      title: d.name,
      summary: d.description,
      updatedAt: d.date_updated ? new Date(Number(d.date_updated)).toISOString() : undefined,
    });
  }
  for (const pm of pageMatches) {
    items.push({
      externalId: pm.docId,
      externalUrl: `${pm.docUrl}/${pm.pageId}`,
      title: `${pm.docTitle} › ${pm.pageName}`,
      summary: undefined,
      pageId: pm.pageId,
    });
  }

  return {
    items,
    nextCursor: q ? undefined : result.next_cursor,  // cursor only meaningful for unfiltered pulls
  };
}
