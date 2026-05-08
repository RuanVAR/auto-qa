import type { PluginCtx } from '../../types';
import type { ListDocsInput, ListDocsOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * listDocs — `GET /api/v3/workspaces/{wsId}/docs`.
 *
 * Workspace id resolves from the install config when set, otherwise we look
 * it up via getTeams() (cached lightly per dispatch). v3 is documented as
 * volatile — extraction stays tightly scoped to the fields we use.
 */
export async function listDocs(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<ListDocsOutput> {
  const input = (payload as ListDocsInput) ?? {};
  const client = new ClickUpClient(ctx.http);

  let workspaceId = ctx.config.workspaceId;
  if (!workspaceId) {
    const teams = await client.getTeams();
    if (teams.length === 0) {
      throw new PluginPermanentError('No ClickUp workspaces accessible to this token', 'clickup');
    }
    workspaceId = teams[0].id;
  }

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
      updatedAt: d.date_updated ? new Date(Number(d.date_updated)).toISOString() : undefined,
    })),
    nextCursor: result.next_cursor,
  };
}
