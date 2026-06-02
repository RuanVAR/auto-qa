import type { PluginCtx } from '../../types';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';
import { ensureWriteAllowed } from '../write-guard';

/**
 * updateAssignees — PUT add/remove assignees on an existing ClickUp task.
 * Used to mirror a QA issue reassignment onto its linked task. Best-effort:
 * the caller swallows errors so a CU hiccup never blocks the QA update.
 */
export async function updateAssignees(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<{ ok: true }> {
  const { taskId, add, rem } = (payload as { taskId?: string; add?: number[]; rem?: number[] }) ?? {};
  if (!taskId) throw new PluginPermanentError('updateAssignees requires taskId', 'clickup');
  ensureWriteAllowed('updateAssignees', null);
  const client = new ClickUpClient(ctx.http);
  await client.setTaskAssignees(taskId, {
    add: (add ?? []).filter((n) => Number.isFinite(n)),
    rem: (rem ?? []).filter((n) => Number.isFinite(n)),
  });
  return { ok: true };
}
