import type { PluginCtx } from '../../types';
import type {
  FetchTicketContextInput,
  FetchTicketContextOutput,
} from '../../capabilities';
import type { ClickUpInstallConfig, ClickUpSecrets } from '../schemas';
import { ClickUpClient } from '../clickup.client';

/**
 * fetchTicketContext — full description + comments for AI prompts and
 * acceptance-criteria extraction.
 *
 * AC heuristic: scan the markdown body for any of these heading patterns
 * (case-insensitive) and capture the bullet/numbered list items that
 * follow until the next heading:
 *
 *   ## Acceptance Criteria
 *   ## ACs
 *   AC:
 *   Acceptance:
 *
 * The heuristic is intentionally conservative — false positives are worse
 * than misses, since AI prompt-builders consume these directly.
 */
const AC_HEADER = /^(?:#{1,4}\s*)?(?:Acceptance(?:\s+Criteria)?|ACs?)\s*:?\s*$/im;

export async function fetchTicketContext(
  ctx: PluginCtx<ClickUpInstallConfig, ClickUpSecrets>,
  payload: unknown,
): Promise<FetchTicketContextOutput> {
  const input = (payload as FetchTicketContextInput) ?? { externalId: '' };
  const client = new ClickUpClient(ctx.http);

  const task = await client.getTask(input.externalId, { includeMarkdown: true });
  const markdown = task.markdown_description ?? task.description ?? task.text_content ?? '';

  let comments;
  if (input.includeComments !== false) {
    try {
      const raw = await client.getTaskComments(input.externalId);
      comments = raw.map((c) => ({
        author: c.user?.username ?? 'unknown',
        body: c.comment_text,
        createdAt: new Date(Number(c.date)).toISOString(),
      }));
    } catch {
      // comments are best-effort; never block the main fetch
      comments = [];
    }
  }

  return {
    externalId: task.id,
    title: task.name,
    descriptionMarkdown: markdown,
    comments,
    acceptanceCriteria: extractAcceptanceCriteria(markdown),
  };
}

function extractAcceptanceCriteria(markdown: string): string[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let inAcBlock = false;
  for (const line of lines) {
    const headerHit = AC_HEADER.test(line);
    if (headerHit) {
      inAcBlock = true;
      continue;
    }
    if (!inAcBlock) continue;
    // Stop at next heading
    if (/^#{1,6}\s/.test(line.trim())) {
      inAcBlock = false;
      continue;
    }
    // Capture bullet/numbered list items only — skip prose and blank lines.
    const item = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (item && item[1].trim()) out.push(item[1].trim());
  }
  return out;
}
