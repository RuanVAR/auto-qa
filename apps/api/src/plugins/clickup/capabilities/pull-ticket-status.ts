import type { PluginCtx } from '../../types';
import type { PullTicketStatusInput, PullTicketStatusOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';

/**
 * pullTicketStatus — GET /task/{taskId} (lean).
 *
 * Used by the InboundSyncService refresh button + bulk sync + post-webhook
 * confirmation. Read-only — no write guard needed.
 */
export async function pullTicketStatus(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<PullTicketStatusOutput> {
  const { externalId } = (payload as PullTicketStatusInput) ?? { externalId: '' };
  const client = new ClickUpClient(ctx.http);
  const task = await client.getTask(externalId);

  return {
    externalId: task.id,
    externalStatus: task.status?.status ?? '',
    externalStatusColor: task.status?.color,
    externalStatusType: task.status?.type,
    externalListId: task.list?.id,
    externalCustomFields: (task.custom_fields ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      value: f.value,
      typeConfig: f.type_config ? { options: f.type_config.options } : undefined,
    })),
    externalAssignees: (task.assignees ?? []).map((a) => ({
      externalId: String(a.id),
      displayName: a.username,
      avatarUrl: a.profilePicture ?? undefined,
    })),
    externalLastUpdatedAt: new Date(Number(task.date_updated)).toISOString(),
  };
}
