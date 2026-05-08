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
      markdown: normalizeClickUpMarkdown(page.content || '', page.name),
      updatedAt: doc.date_updated ? new Date(Number(doc.date_updated)).toISOString() : new Date().toISOString(),
    };
  }

  // Whole-doc mode — stitch every page in tree order.
  const pages = await client.getDocPagesWithContent(workspaceId, input.externalId);
  const ordered = orderPagesDepthFirst(pages);
  const parts: string[] = [];
  for (const p of ordered) {
    parts.push(`## ${p.name}\n\n${normalizeClickUpMarkdown(p.content ?? '', p.name)}`);
  }

  return {
    externalId: doc.id,
    externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${doc.id}`,
    title: doc.name,
    markdown: parts.join('\n\n').trim(),
    updatedAt: doc.date_updated ? new Date(Number(doc.date_updated)).toISOString() : new Date().toISOString(),
  };
}

/**
 * ClickUp's `text/md` export is technically markdown but missing the blank
 * lines CommonMark needs to separate blocks — without normalisation,
 * react-markdown squashes a whole page into one paragraph. Two passes:
 *
 *   1. Promote bold-only lines (`**Permissions**`) to H3 headings — that's
 *      ClickUp's convention for section labels.
 *   2. Insert blank lines around block boundaries (headings, list items,
 *      numbered items) so the renderer sees discrete blocks.
 *
 * Also strips a leading line that just repeats the page title.
 */
function normalizeClickUpMarkdown(raw: string, pageName?: string): string {
  if (!raw.trim()) return '';
  const lines = raw.replace(/\r\n/g, '\n').split('\n');

  // Drop the very first line if it's a duplicate of the page name (ClickUp
  // includes the page heading in the body for some pages but not others).
  if (pageName && lines[0]?.trim() === pageName.trim()) lines.shift();

  // Pass 1: promote bold-only lines to H3.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*\*\*(.+?)\*\*\s*:?\s*$/);
    if (m) lines[i] = `### ${m[1].trim()}`;
  }

  // Pass 2: rebuild with blank lines between block kinds.
  const out: string[] = [];
  const blockKind = (s: string): 'heading' | 'list' | 'olist' | 'blank' | 'para' => {
    if (!s.trim()) return 'blank';
    if (/^#{1,6}\s/.test(s)) return 'heading';
    if (/^\s*[*\-+]\s/.test(s)) return 'list';
    if (/^\s*\d+\.\s/.test(s)) return 'olist';
    return 'para';
  };
  let prev: ReturnType<typeof blockKind> = 'blank';
  for (const line of lines) {
    const kind = blockKind(line);
    // Insert a blank line on transitions between non-blank block kinds, and
    // always before headings.
    if (kind !== 'blank' && prev !== 'blank') {
      const transition =
        kind === 'heading' ||
        prev === 'heading' ||
        (kind === 'para' && (prev === 'list' || prev === 'olist')) ||
        (prev === 'para' && (kind === 'list' || kind === 'olist'));
      if (transition) out.push('');
    }
    out.push(line);
    prev = kind;
  }
  return out.join('\n').trim();
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
