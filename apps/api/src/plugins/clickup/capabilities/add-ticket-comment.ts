import type { PluginCtx } from '../../types';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import type { AddTicketCommentInput, AddTicketCommentOutput } from '../../capabilities/add-ticket-comment.types';
import { ClickUpClient } from '../clickup.client';
import { PluginPermanentError } from '../../plugin.errors';
import { ensureWriteAllowed } from '../write-guard';

/**
 * addTicketComment — POST a free-text comment onto a ClickUp task. Used to
 * record a QA failure reason on the linked task. Best-effort: the caller
 * swallows errors so a CU hiccup never blocks the QA verdict.
 */
/**
 * Build ClickUp structured comment blocks from text + resolved mentions so the
 * tagged users are actually notified. Returns null when there's nothing to tag
 * (caller then posts plain comment_text). A `tag` block carries the user id.
 */
function buildMentionBlocks(
  text: string,
  mentions: { externalUserId: number; token: string }[],
): unknown[] | null {
  if (!mentions.length) return null;
  const byToken = new Map(mentions.map((m) => [m.token.toLowerCase(), m.externalUserId]));
  const re = /(^|[^a-z0-9_])@([a-z0-9_.-]+)/gi;
  const blocks: unknown[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let tagged = false;
  while ((m = re.exec(text)) !== null) {
    const slug = m[2].toLowerCase();
    const userId = byToken.get(slug);
    if (userId == null) continue;
    const at = m.index + m[1].length; // index of the '@'
    if (at > lastIndex) blocks.push({ text: text.slice(lastIndex, at) });
    blocks.push({ text: `@${m[2]}`, type: 'tag', user: { id: userId } });
    lastIndex = at + 1 + m[2].length;
    tagged = true;
  }
  if (!tagged) return null;
  if (lastIndex < text.length) blocks.push({ text: text.slice(lastIndex) });
  return blocks;
}

export async function addTicketComment(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<AddTicketCommentOutput> {
  const { externalId, comment, mentions } = (payload as Partial<AddTicketCommentInput>) ?? {};
  if (!externalId) throw new PluginPermanentError('addTicketComment requires externalId', 'clickup');
  if (!comment?.trim()) throw new PluginPermanentError('addTicketComment requires a non-empty comment', 'clickup');
  ensureWriteAllowed('addTicketComment', null);
  const client = new ClickUpClient(ctx.http);

  const blocks = buildMentionBlocks(comment, mentions ?? []);
  try {
    const res = await client.createTaskComment(externalId, blocks ? { comment: blocks } : { comment_text: comment });
    return { ok: true, commentId: res.id };
  } catch (err) {
    // If the structured (mention) payload was rejected, still land the comment
    // as plain text so the failure record isn't lost.
    if (blocks) {
      const res = await client.createTaskComment(externalId, { comment_text: comment });
      return { ok: true, commentId: res.id };
    }
    throw err;
  }
}
