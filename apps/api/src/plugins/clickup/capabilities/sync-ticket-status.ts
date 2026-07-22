import type { PluginCtx } from '../../types';
import type { SyncTicketStatusInput, SyncTicketStatusOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { ensureWriteAllowed } from '../write-guard';

/** Generic status writer for mapped non-phase lifecycle entities. */
export async function syncTicketStatus(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<SyncTicketStatusOutput> {
  const input = payload as SyncTicketStatusInput;
  const client = new ClickUpClient(ctx.http);
  const task = await client.getTask(input.externalId);
  ensureWriteAllowed('syncTicketStatus', task.list?.id ?? null);
  const updated = await client.updateTask(input.externalId, { status: input.targetExternalStatus });
  return {
    externalStatus: updated.status?.status ?? input.targetExternalStatus,
    syncedAt: new Date().toISOString(),
  };
}
