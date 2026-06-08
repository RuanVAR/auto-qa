/**
 * Turn a platform Issue into the body shape ClickUp's `POST /list/{id}/task`
 * expects. Pure function — no I/O. The dispatch path calls this once and
 * forwards the result to `createIssue`.
 *
 * The markdown_description bundles every field the user filled in plus a
 * deep-link back to the QA platform's issue page. Evidence URLs are listed
 * as a markdown section AND attempted as proper file attachments by the
 * caller via attachArtifacts (see push-issue endpoint).
 */
export type IssueLikeForBuilder = {
  id: string;
  type: 'BUG' | 'SNAG' | 'QUERY' | string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | string;
  title: string;
  description?: string | null;
  stepsToReproduce?: string | null;
  expectedBehaviour?: string | null;
  actualBehaviour?: string | null;
  screenshotUrls?: string[];
  recordingUrl?: string | null;
  reportedBy?: { name?: string | null; email?: string | null } | null;
  feature?: { name?: string | null } | null;
  module?: { name?: string | null } | null;
};

export type BuildBodyOpts = {
  /** Public-facing URL to the issue page (https://platform.acme.com/issues/<id>). */
  publicIssueUrl: string;
  /** Tags to drop on the ClickUp task (defaults below). */
  extraTags?: string[];
};

const SEVERITY_TO_PRIORITY: Record<string, 1 | 2 | 3 | 4> = {
  CRITICAL: 1,
  HIGH: 2,
  MEDIUM: 3,
  LOW: 4,
};

const TYPE_EMOJI: Record<string, string> = {
  BUG: '🐛',
  SNAG: '⚠️',
  QUERY: '❓',
};

export type ClickUpIssueBody = {
  name: string;
  markdown_description: string;
  priority: 1 | 2 | 3 | 4;
  tags: string[];
};

export function buildClickUpIssueBody(
  issue: IssueLikeForBuilder,
  opts: BuildBodyOpts,
): ClickUpIssueBody {
  const lines: string[] = [];

  // Header: type + severity + reporter
  const reporter = issue.reportedBy?.name || issue.reportedBy?.email || 'unknown';
  const emoji = TYPE_EMOJI[issue.type] ?? '';
  lines.push(`${emoji} **${issue.type}** · severity **${issue.severity}** · reported by **${reporter}**`);

  if (issue.module?.name || issue.feature?.name) {
    const scope = [issue.module?.name, issue.feature?.name].filter(Boolean).join(' / ');
    lines.push(`Scope: _${scope}_`);
  }

  // Body sections
  if (issue.description?.trim()) {
    lines.push('', '## Description', '', issue.description.trim());
  }

  if (issue.stepsToReproduce?.trim()) {
    lines.push('', '## Steps to reproduce', '', issue.stepsToReproduce.trim());
  }

  if (issue.expectedBehaviour?.trim() || issue.actualBehaviour?.trim()) {
    if (issue.expectedBehaviour?.trim()) {
      lines.push('', '## Expected', '', issue.expectedBehaviour.trim());
    }
    if (issue.actualBehaviour?.trim()) {
      lines.push('', '## Actual', '', issue.actualBehaviour.trim());
    }
  }

  // Evidence (always render the markdown section, even if attachments
  // succeed — gives the assignee deep links if they prefer those over the
  // ClickUp attachments view).
  const allEvidence = [
    ...(issue.screenshotUrls ?? []).map((url, i) => ({ kind: 'screenshot' as const, url, label: `Screenshot ${i + 1}` })),
    ...(issue.recordingUrl ? [{ kind: 'recording' as const, url: issue.recordingUrl, label: 'Recording' }] : []),
  ];
  if (allEvidence.length > 0) {
    lines.push('', '## Evidence', '');
    for (const e of allEvidence) {
      if (e.kind === 'screenshot') {
        lines.push(`- ![${e.label}](${e.url})`);
      } else {
        lines.push(`- 📹 [${e.label}](${e.url})`);
      }
    }
  }

  // Always — back-link to the platform.
  lines.push('', '---', '', `🔗 [View in AdVantage](${opts.publicIssueUrl})`);

  return {
    name: issue.title,
    markdown_description: lines.join('\n'),
    priority: SEVERITY_TO_PRIORITY[issue.severity] ?? 3,
    tags: ['qa-platform', 'platform-issue', issue.type.toLowerCase(), ...(opts.extraTags ?? [])],
  };
}
