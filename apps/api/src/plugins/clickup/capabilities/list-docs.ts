import type { PluginCtx } from '../../types';
import type { ListDocsInput, ListDocsOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * listDocs — GET /api/v3/workspaces/{wsId}/docs.
 *
 * v3 is described as volatile in PM_INTEGRATIONS — Phase 4 gates on a manual
 * spike against live data before this is wired into the doc-link UI. The
 * shape we return here matches what we extract today; if v3 changes the
 * extraction lives entirely in this file.
 */
export async function listDocs(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<ListDocsOutput> {
  const input = (payload as ListDocsInput) ?? {};
  const workspaceId = ctx.config.workspaceId;
  if (!workspaceId) {
    throw new PluginPermanentError('listDocs requires workspaceId on the install config', 'clickup');
  }
  const client = new ClickUpClient(ctx.http);
  const result = await client.listDocs(workspaceId, {
    query: input.query,
    limit: input.limit,
    cursor: input.cursor,
  });
  return {
    items: (result.docs ?? []).map((d) => ({
      externalId: d.id,
      externalUrl: `https://app.clickup.com/${workspaceId}/v/dc/${d.id}`,
      title: d.name,
      summary: d.description,
      updatedAt: d.updated_at ? new Date(d.updated_at).toISOString() : undefined,
    })),
    nextCursor: result.next_cursor,
  };
}
