import type { PluginCtx } from '../../types';
import type { LinkTicketInput, LinkTicketOutput } from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';

/**
 * linkTicket — resolve a user-supplied ClickUp reference (URL, plain id, or
 * custom-id) to a canonical task and return enough metadata to materialise
 * a TicketLink row.
 *
 * Read-only — no `ensureWriteAllowed` gate needed.
 *
 * Acceptable ticketRef forms:
 *   - Full URL:   https://app.clickup.com/t/abcd1234
 *   - Plain id:   abcd1234
 *   - Custom id:  ACME-142  (uses custom_task_ids=true&team_id=…)
 */
const URL_RE = /\/t\/([A-Za-z0-9_-]+)(?:\/|$|\?)/i;
const CUSTOM_ID_RE = /^[A-Z][A-Z0-9_]*-\d+$/i;

export async function linkTicket(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<LinkTicketOutput> {
  const { ticketRef } = (payload as LinkTicketInput) ?? { ticketRef: '' };
  const ref = (ticketRef ?? '').trim();
  if (!ref) throw new PluginPermanentError('linkTicket requires ticketRef', 'clickup');

  const client = new ClickUpClient(ctx.http);

  // 1. URL → extract id, fetch as plain task
  const urlMatch = ref.match(URL_RE);
  if (urlMatch) {
    const task = await client.getTask(urlMatch[1]);
    return toOutput(task);
  }

  // 2. Custom id pattern → enable custom_task_ids
  if (CUSTOM_ID_RE.test(ref)) {
    const teamId = ctx.config.workspaceId;
    if (!teamId) {
      throw new PluginPermanentError(
        'linkTicket via custom-id requires the install to have workspaceId resolved',
        'clickup',
      );
    }
    const task = await client.getTask(ref, { customTaskIds: true, teamId });
    return toOutput(task);
  }

  // 3. Plain id
  const task = await client.getTask(ref);
  return toOutput(task);
}

function toOutput(task: Awaited<ReturnType<ClickUpClient['getTask']>>): LinkTicketOutput {
  return {
    externalId: task.id,
    externalUrl: task.url,
    externalTitle: task.name,
    externalStatus: task.status?.status,
    externalStatusColor: task.status?.color,
    externalStatusType: task.status?.type,
  };
}
