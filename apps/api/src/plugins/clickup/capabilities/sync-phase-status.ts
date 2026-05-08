import type { PluginCtx } from '../../types';
import type { SyncPhaseStatusInput, SyncPhaseStatusOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { ensureWriteAllowed } from '../write-guard';

/**
 * syncPhaseStatus — PUT /task/{taskId} to push a platform phase transition
 * out to the linked ClickUp task.
 *
 * Best-effort by design: failures here are logged + persisted on
 * TicketLink.lastOutboundSyncError but never block the platform-side phase
 * transition. The InboundSyncService keeps the loop closed by re-pulling
 * after webhook events.
 */
export async function syncPhaseStatus(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<SyncPhaseStatusOutput> {
  const input = payload as SyncPhaseStatusInput;
  const client = new ClickUpClient(ctx.http);

  // We do best-effort listId resolution from the task itself for the
  // sandbox-mode write check. If the task fetch is the failure mode we
  // surface it directly — no point updating something we can't read.
  const task = await client.getTask(input.externalId);
  ensureWriteAllowed('syncPhaseStatus', task.list?.id ?? null);

  const updated = await client.updateTask(input.externalId, { status: input.targetExternalStatus });
  return {
    externalStatus: updated.status?.status ?? input.targetExternalStatus,
    syncedAt: new Date().toISOString(),
  };
}
