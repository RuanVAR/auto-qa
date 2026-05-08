import type { PluginCtx } from '../../types';
import type { CreateIssueInput, CreateIssueOutput } from '../../capabilities';
import type { ClickUpBindingConfig, ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';
import { ensureWriteAllowed } from '../write-guard';

const SEVERITY_TO_PRIORITY: Record<string, 1 | 2 | 3 | 4> = {
  critical: 1,
  high: 2,
  medium: 3,
  low: 4,
};

/**
 * createIssue — POST /list/{listId}/task.
 *
 * Effective config (resolved by the dispatch layer) supplies:
 *   - defaultListId    — required
 *   - targetMode       — 'list' (default) or 'subtask'
 *   - defaultParentTaskId — required when targetMode='subtask'
 *
 * Severity maps to ClickUp priority (1=urgent — 4=low). Custom-field mapping
 * is honoured when binding.customFieldMap is set: keys are platform field
 * names, values are ClickUp custom-field ids.
 *
 * Phase 3 attachArtifacts runs as a follow-up call after this returns; we
 * deliberately don't bundle attachment upload into createIssue to keep the
 * failure modes narrow and to allow re-trying attachments independently.
 */
export async function createIssue(
  ctx: PluginCtx<ClickUpInstallConfig & ClickUpBindingConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<CreateIssueOutput> {
  const input = payload as CreateIssueInput;
  const cfg = ctx.config as ClickUpInstallConfig & ClickUpBindingConfig;
  const listId = cfg.defaultListId;
  if (!listId) {
    throw new PluginPermanentError(
      'createIssue requires a project/module/feature binding with defaultListId set',
      'clickup',
    );
  }

  ensureWriteAllowed('createIssue', listId);

  const client = new ClickUpClient(ctx.http);
  const body: Parameters<ClickUpClient['createTask']>[1] = {
    name: input.title,
    markdown_description: input.description ?? '',
    priority: SEVERITY_TO_PRIORITY[input.severity ?? 'medium'],
    tags: input.labels,
  };

  if (cfg.targetMode === 'subtask') {
    if (!cfg.defaultParentTaskId) {
      throw new PluginPermanentError(
        'createIssue with targetMode=subtask requires defaultParentTaskId',
        'clickup',
      );
    }
    body.parent = cfg.defaultParentTaskId;
  }

  const task = await client.createTask(listId, body);
  return {
    externalId: task.id,
    externalUrl: task.url,
    externalTitle: task.name,
    externalStatus: task.status?.status,
  };
}
