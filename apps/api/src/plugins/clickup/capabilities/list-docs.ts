import type { PluginCtx } from '../../types';
import type { ListDocsInput, ListDocsOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * In-memory caches collapse the two big costs of a doc search:
 *
 *   1. `PAGE_LISTING_CACHE` — per-doc page tree. Walked when the user
 *      searches for a page name. Heavy because it's N round-trips.
 *
 *   2. `WORKSPACE_DOCS_CACHE` — the full paginated doc list for a
 *      workspace+scope. Heavy because ClickUp caps each page at 100 docs
 *      and a workspace with hundreds of docs needs 4-8 page fetches.
 *
 * Both per-process (resets on API restart). 5-min TTL is short enough that
 * users see new docs without manual invalidation but long enough to make
 * repeat searches within a session feel instant. FIFO eviction caps memory.
 */
type PageListing = Array<{ id: string; name: string; parent_page_id: string | null }>;
type DocRow = { id: string; name: string; description?: string; date_updated?: string | number };
const PAGE_LISTING_CACHE = new Map<string, { pages: PageListing; expiresAt: number }>();
const WORKSPACE_DOCS_CACHE = new Map<string, { docs: DocRow[]; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_LISTING_MAX_SIZE = 500;
const WORKSPACE_DOCS_MAX_SIZE = 50;

function getCachedPages(workspaceId: string, docId: string): PageListing | null {
  const key = `${workspaceId}:${docId}`;
  const entry = PAGE_LISTING_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    PAGE_LISTING_CACHE.delete(key);
    return null;
  }
  return entry.pages;
}

function setCachedPages(workspaceId: string, docId: string, pages: PageListing): void {
  // FIFO eviction — Map preserves insertion order so `keys().next().value`
  // gives the oldest. Not strict LRU but cheap and bounded.
  if (PAGE_LISTING_CACHE.size >= PAGE_LISTING_MAX_SIZE) {
    const oldestKey = PAGE_LISTING_CACHE.keys().next().value;
    if (oldestKey) PAGE_LISTING_CACHE.delete(oldestKey);
  }
  PAGE_LISTING_CACHE.set(`${workspaceId}:${docId}`, {
    pages,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

function getCachedWorkspaceDocs(workspaceId: string, parentKey: string): DocRow[] | null {
  const key = `${workspaceId}:${parentKey}`;
  const entry = WORKSPACE_DOCS_CACHE.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    WORKSPACE_DOCS_CACHE.delete(key);
    return null;
  }
  return entry.docs;
}

function setCachedWorkspaceDocs(workspaceId: string, parentKey: string, docs: DocRow[]): void {
  if (WORKSPACE_DOCS_CACHE.size >= WORKSPACE_DOCS_MAX_SIZE) {
    const oldestKey = WORKSPACE_DOCS_CACHE.keys().next().value;
    if (oldestKey) WORKSPACE_DOCS_CACHE.delete(oldestKey);
  }
  WORKSPACE_DOCS_CACHE.set(`${workspaceId}:${parentKey}`, {
    docs,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

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
    parent?: { workspaceId?: string; spaceId?: string; folderId?: string; listId?: string };
  }) ?? {};
  const client = new ClickUpClient(ctx.http);

  // Resolve workspaceId in priority order:
  //   1. Caller-supplied parent.workspaceId — comes from the project's
  //      binding cascade (where it actually lives). Most reliable.
  //   2. Install config — usually empty `{}` for ClickUp installs, but kept
  //      as a fallback for installs that seeded it directly.
  //   3. getTeams()[0] — last-resort guess; only safe when the PAT has
  //      access to a single workspace. Multi-workspace PATs misroute here.
  let workspaceId = input.parent?.workspaceId || ctx.config.workspaceId;
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
  //
  // IMPORTANT: workspaces often place docs OUTSIDE the bound space (a
  // dedicated "Docs" space, a workspace-level wiki, folders in a sibling
  // space, etc). Scope-narrowing makes sense when BROWSING (without a
  // query, otherwise we'd dump 100s of unrelated CS-Process docs on the
  // user). For SEARCH (the user typed a query — they know what they want),
  // narrow scope hides legitimate matches. So:
  //
  //   - No query → narrow by space if known (preserves the original UX).
  //   - Has query → broaden to workspace-wide.
  const incomingQuery = (input.query ?? '').trim();
  let parentId: string | undefined;
  let parentType: number | undefined;
  if (!incomingQuery) {
    if (input.parent?.spaceId) { parentId = input.parent.spaceId; parentType = 4; }
    else if (input.parent?.folderId) { parentId = input.parent.folderId; parentType = 2; }
    else if (input.parent?.listId) { parentId = input.parent.listId; parentType = 1; }
  }

  // Larger limit since query-side filtering is client-side. Workspace-wide
  // search (no parentId) needs a higher ceiling because results aren't
  // pre-narrowed by the API.
  const fetchLimit = input.limit ?? (parentId ? 50 : 200);
  const q = (input.query ?? '').trim().toLowerCase();

  // Paginate when a query is set. ClickUp's listDocs returns 100 max per page;
  // a workspace with a long doc history easily spills past that. Without
  // pagination the user can't find anything created after the first 100
  // didn't catch it — exactly the MPOWA case (the doc they want is at
  // sequence #117495 but our first page caps at #115235). Walk pages until
  // we hit MAX_PAGES, a match-count threshold, or the cursor runs out.
  const MAX_PAGES = q ? 8 : 1; // ~800 docs scanned when searching, 1 page otherwise
  const MIN_MATCHES = q ? 25 : Infinity; // stop early once we have enough hits
  // Cache key for the workspace doc list — narrows by parent if the caller
  // supplied one. User-supplied `input.cursor` skips the cache (pagination
  // continuation is a separate request shape).
  const docsCacheKey = `${parentType ?? 'ws'}:${parentId ?? '-'}`;
  let allDocs: DocRow[];
  let lastNextCursor: string | undefined;
  const cached = !input.cursor ? getCachedWorkspaceDocs(workspaceId, docsCacheKey) : null;
  if (cached) {
    allDocs = cached;
    lastNextCursor = undefined;
  } else {
    allDocs = [];
    let cursor: string | undefined = input.cursor;
    let pagesFetched = 0;
    while (pagesFetched < MAX_PAGES) {
      const result = await client.listDocs(workspaceId, {
        limit: fetchLimit,
        cursor,
        parentId,
        parentType,
      });
      pagesFetched++;
      for (const d of (result.docs ?? [])) allDocs.push(d);
      lastNextCursor = result.next_cursor;

      // Early-exit if we've collected enough matches for the query.
      if (q) {
        const matched = allDocs.filter((d) => (d.name ?? '').toLowerCase().includes(q)).length;
        if (matched >= MIN_MATCHES) break;
      }

      if (!result.next_cursor) break;
      cursor = result.next_cursor;
    }
    // Only cache full-scope results (no user-supplied cursor) — partial
    // continuations don't represent the canonical state.
    if (!input.cursor) {
      setCachedWorkspaceDocs(workspaceId, docsCacheKey, allDocs);
    }
  }

  // Sort by recency so the latest docs surface first.
  allDocs.sort(
    (a, b) => Number(b.date_updated ?? 0) - Number(a.date_updated ?? 0),
  );

  // Doc-level matches by name.
  const docMatches = q
    ? allDocs.filter((d) => (d.name ?? '').toLowerCase().includes(q))
    : allDocs;

  // Page-level matches: when the user typed a query, walk page listings to
  // surface page hits. Pages are how teams actually organise ClickUp content
  // ("Reports Business Logic > Agreement Report") and searching just doc
  // titles misses 90% of useful targets.
  //
  // Strategy:
  //   - Walk pages of every DOC whose name matched the query — those are the
  //     most likely parents of the page the user wants.
  //   - Plus walk the top 25 most-recently-updated docs (caps cost at
  //     ~25 round trips per request).
  //   - Dedupe — a doc covered by both lists only gets walked once.
  //
  // The previous behaviour (only walk when total docs ≤ 25) silently broke
  // page search on workspaces with > 25 docs — which is most of them.
  const pageMatches: Array<{
    docId: string;
    docTitle: string;
    docUrl: string;
    pageId: string;
    pageName: string;
  }> = [];
  if (q) {
    const PAGE_WALK_CAP = 25;
    const docsToWalk = new Map<string, DocRow>();
    for (const d of docMatches) docsToWalk.set(d.id, d); // every name-matched doc
    for (const d of allDocs.slice(0, PAGE_WALK_CAP)) {
      if (!docsToWalk.has(d.id)) docsToWalk.set(d.id, d);  // top recent docs
      if (docsToWalk.size >= PAGE_WALK_CAP) break;
    }
    for (const d of docsToWalk.values()) {
      let pages: PageListing | null = getCachedPages(workspaceId, d.id);
      if (!pages) {
        try {
          pages = await client.getDocPageListing(workspaceId, d.id);
          setCachedPages(workspaceId, d.id, pages);
        } catch {
          continue;  // best-effort — bad doc shouldn't kill the whole search
        }
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
    nextCursor: q ? undefined : lastNextCursor,  // cursor only meaningful for unfiltered pulls
  };
}
