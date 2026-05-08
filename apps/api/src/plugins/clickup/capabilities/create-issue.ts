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

  const client = new ClickUpClient(ctx.http);

  // Resolve the *actual* list the new task will live in. In subtask mode
  // the new task inherits its parent's list — `defaultListId` from the
  // cascade may be a different list (the project-level fallback). The
  // write guard must check the real landing list, otherwise sandbox-only
  // installs incorrectly reject perfectly safe subtask writes.
  let actualListId = listId;
  if (cfg.targetMode === 'subtask') {
    if (!cfg.defaultParentTaskId) {
      throw new PluginPermanentError(
        'createIssue with targetMode=subtask requires defaultParentTaskId',
        'clickup',
      );
    }
    try {
      const parent = await client.getTask(cfg.defaultParentTaskId);
      actualListId = parent.list?.id ?? listId;
    } catch (err) {
      throw new PluginPermanentError(
        `Could not resolve parent task ${cfg.defaultParentTaskId}: ${(err as Error).message}`,
        'clickup',
      );
    }
  }

  ensureWriteAllowed('createIssue', actualListId);

  const body: Parameters<ClickUpClient['createTask']>[1] = {
    name: input.title,
    markdown_description: input.description ?? '',
    priority: SEVERITY_TO_PRIORITY[input.severity ?? 'medium'],
    tags: input.labels,
  };

  if (cfg.targetMode === 'subtask') {
    body.parent = cfg.defaultParentTaskId;
  }

  const task = await client.createTask(actualListId, body);
  return {
    externalId: task.id,
    externalUrl: task.url,
    externalTitle: task.name,
    externalStatus: task.status?.status,
  };
}
