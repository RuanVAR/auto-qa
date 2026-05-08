import type { PluginCtx } from '../../types';
import type { FetchDocInput, FetchDocOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * fetchDoc — concatenate a ClickUp Doc's pages into a single markdown body.
 *
 * v3 returns pages as a sibling endpoint (`/docs/{id}/pages`); the doc itself
 * carries metadata only. We stitch page name + content with `## ` separators
 * so the structure survives caching in DocLink.cachedMarkdown.
 */
export async function fetchDoc(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<FetchDocOutput> {
  const { externalId } = (payload as FetchDocInput) ?? { externalId: '' };
  if (!externalId) throw new PluginPermanentError('fetchDoc requires externalId', 'clickup');

  const workspaceId = ctx.config.workspaceId;
  if (!workspaceId) throw new PluginPermanentError('fetchDoc requires workspaceId on install', 'clickup');

  const client = new ClickUpClient(ctx.http);
  const [doc, pages] = await Promise.all([client.getDoc(externalId), client.getDocPages(externalId)]);

  const parts: string[] = [];
  for (const p of pages) {
    parts.push(`## ${p.name}\n\n${p.markdown ?? p.content ?? ''}`);
  }

  return {
    externalId: doc.id,
    externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${doc.id}`,
    title: doc.name,
    markdown: parts.join('\n\n').trim(),
    updatedAt: new Date().toISOString(),       // v3 omits per-doc updated_at on detail
  };
}
