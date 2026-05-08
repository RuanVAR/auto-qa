import type { PluginCtx } from '../../types';
import type { FetchDocInput, FetchDocOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * fetchDoc — pull a ClickUp Doc into platform markdown.
 *
 * Two modes:
 *   - whole-doc (default)        → stitches every page as `## <page name>` blocks
 *   - single-page (`pageId` set) → returns just that page's markdown
 *
 * The orchestration uses workspace-scoped v3 endpoints. Page content comes
 * back as text/md; we forward it verbatim. ClickUp's tree links between
 * pages aren't preserved — pages are flattened in `parent_page_id` order
 * (depth-first) so the output reads top-to-bottom.
 */
export async function fetchDoc(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<FetchDocOutput> {
  const input = (payload as FetchDocInput & { pageId?: string }) ?? { externalId: '' };
  if (!input.externalId) throw new PluginPermanentError('fetchDoc requires externalId', 'clickup');

  const client = new ClickUpClient(ctx.http);

  let workspaceId = ctx.config.workspaceId;
  if (!workspaceId) {
    const teams = await client.getTeams();
    if (teams.length === 0) throw new PluginPermanentError('No ClickUp workspaces accessible', 'clickup');
    workspaceId = teams[0].id;
  }

  const doc = await client.getDoc(workspaceId, input.externalId);

  // Single-page mode
  if (input.pageId) {
    const page = await client.getDocPage(workspaceId, input.externalId, input.pageId);
    return {
      externalId: doc.id,
      externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${doc.id}/${input.pageId}`,
      title: `${doc.name} — ${page.name}`,
      markdown: page.content || '',
      updatedAt: doc.date_updated ? new Date(Number(doc.date_updated)).toISOString() : new Date().toISOString(),
    };
  }

  // Whole-doc mode — stitch every page in tree order.
  const pages = await client.getDocPagesWithContent(workspaceId, input.externalId);
  const ordered = orderPagesDepthFirst(pages);
  const parts: string[] = [];
  for (const p of ordered) {
    parts.push(`## ${p.name}\n\n${p.content ?? ''}`);
  }

  return {
    externalId: doc.id,
    externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${doc.id}`,
    title: doc.name,
    markdown: parts.join('\n\n').trim(),
    updatedAt: doc.date_updated ? new Date(Number(doc.date_updated)).toISOString() : new Date().toISOString(),
  };
}

/** Sort pages depth-first so reading top-to-bottom matches the tree. */
function orderPagesDepthFirst(
  pages: Array<{ id: string; name: string; parent_page_id: string | null; content?: string }>,
): Array<{ id: string; name: string; parent_page_id: string | null; content?: string }> {
  const byParent = new Map<string | null, typeof pages>();
  for (const p of pages) {
    const key = p.parent_page_id ?? null;
    const existing = byParent.get(key) ?? [];
    existing.push(p);
    byParent.set(key, existing);
  }
  const out: typeof pages = [];
  const walk = (parentId: string | null) => {
    const children = byParent.get(parentId) ?? [];
    for (const c of children) {
      out.push(c);
      walk(c.id);
    }
  };
  walk(null);
  return out;
}
