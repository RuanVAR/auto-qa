/**
 * Source → prompt-block formatter. Generation surfaces (G1/G2/G3) hand off
 * a heterogeneous bag of context (feature description, attached docs,
 * linked ticket markdown, free-text the user pasted in the modal). This
 * helper normalises them into one consistent "SOURCES" block with stable
 * priority order: free-text first (user intent wins), then ticket, then
 * docs, then existing test names (anti-dup hint).
 *
 * Cost-conscious by design: each section is truncated to its budget so
 * 32K-context models don't get blown out by a single oversized doc.
 *
 * @prompt-version: source-context@1.0
 */

const BUDGETS = {
  freeText: 4_000,    // user's most recent intent — favoured on conflicts
  ticket: 3_000,
  docs: 12_000,       // bulk of context, split across N docs
  existing: 2_000,
};

export interface SourceBundle {
  /** Free-text the user typed into the modal (highest priority). */
  freeText?: string;
  /** Linked ticket markdown (description + AC). */
  ticketMarkdown?: string;
  /** Attached docs as { title, markdown } pairs. Order kept. */
  docs?: Array<{ title: string; markdown: string }>;
  /** Names of existing tests in the same feature — model uses to dedupe. */
  existingTestNames?: string[];
  /** Optional project / module / feature hierarchy hint. */
  scope?: { project?: string; module?: string; feature?: string };
}

export function buildSourceContext(b: SourceBundle): string {
  const blocks: string[] = [];

  if (b.scope) {
    const parts: string[] = [];
    if (b.scope.project) parts.push(`Project: ${b.scope.project}`);
    if (b.scope.module) parts.push(`Module: ${b.scope.module}`);
    if (b.scope.feature) parts.push(`Feature: ${b.scope.feature}`);
    if (parts.length) blocks.push(`[SCOPE]\n${parts.join('\n')}`);
  }

  if (b.freeText && b.freeText.trim()) {
    blocks.push(`[USER NOTES — highest priority, wins on conflict]\n${trim(b.freeText, BUDGETS.freeText)}`);
  }

  if (b.ticketMarkdown && b.ticketMarkdown.trim()) {
    blocks.push(`[LINKED TICKET]\n${trim(b.ticketMarkdown, BUDGETS.ticket)}`);
  }

  if (b.docs && b.docs.length) {
    const perDoc = Math.max(500, Math.floor(BUDGETS.docs / b.docs.length));
    const docBlock = b.docs
      .map((d) => `--- ${d.title} ---\n${trim(d.markdown, perDoc)}`)
      .join('\n\n');
    blocks.push(`[ATTACHED DOCS]\n${docBlock}`);
  }

  if (b.existingTestNames && b.existingTestNames.length) {
    blocks.push(
      `[EXISTING TESTS IN THIS FEATURE — do not duplicate]\n` +
        trim(b.existingTestNames.map((n) => `- ${n}`).join('\n'), BUDGETS.existing),
    );
  }

  return blocks.length ? `SOURCES\n=======\n${blocks.join('\n\n')}` : 'SOURCES\n=======\n(none provided)';
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 30) + '\n…(truncated for token budget)';
}
