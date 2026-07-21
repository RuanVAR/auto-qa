export type DiagnosticEvent = {
  at?: string;
  type?: string;
  text?: string;
  url?: string;
  status?: number;
};

export type DiagnosticSuggestion = DiagnosticEvent & {
  source: 'console' | 'network';
  occurredAt: string;
};

type StepWindow = { startedAt?: string | null; completedAt?: string | null; errorMessage?: string | null };

const WINDOW_LEEWAY_MS = 1_000;

function parseEvents(text: string | undefined): DiagnosticEvent[] {
  if (!text) return [];
  try {
    const value: unknown = JSON.parse(text);
    return Array.isArray(value) ? value as DiagnosticEvent[] : [];
  } catch {
    return [];
  }
}

function isActionable(event: DiagnosticEvent, source: 'console' | 'network'): boolean {
  if (source === 'console') return event.type === 'error' || event.type === 'pageerror';
  return event.type === 'requestfailed' || (event.status ?? 0) >= 400;
}

/**
 * Select only evidence emitted while a failed step was active. Ranking prefers
 * hard browser failures, then events nearest to the step completion time.
 */
export function correlateDiagnostic(
  step: StepWindow,
  consoleText?: string,
  networkText?: string,
): DiagnosticSuggestion | null {
  const start = step.startedAt ? Date.parse(step.startedAt) : Number.NaN;
  const end = step.completedAt ? Date.parse(step.completedAt) : Number.NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;

  const error = step.errorMessage?.toLowerCase() ?? '';
  const candidates = [
    ...parseEvents(consoleText).map(event => ({ ...event, source: 'console' as const })),
    ...parseEvents(networkText).map(event => ({ ...event, source: 'network' as const })),
  ].flatMap(event => {
    const timestamp = event.at ? Date.parse(event.at) : Number.NaN;
    if (!Number.isFinite(timestamp) || timestamp < start - WINDOW_LEEWAY_MS || timestamp > end + WINDOW_LEEWAY_MS) return [];
    if (!isActionable(event, event.source)) return [];

    const content = `${event.text ?? ''} ${event.url ?? ''}`.toLowerCase();
    const severity = event.type === 'pageerror' || event.type === 'requestfailed' || (event.status ?? 0) >= 500 ? 40 : 20;
    const overlap = error && content && (error.includes(content) || content.includes(error)) ? 50 : 0;
    const proximity = Math.max(0, 20 - Math.floor(Math.abs(end - timestamp) / 1_000));
    return [{ event, score: severity + overlap + proximity, timestamp }];
  });

  candidates.sort((a, b) => b.score - a.score || b.timestamp - a.timestamp);
  const best = candidates[0]?.event;
  return best?.at ? { ...best, occurredAt: best.at } : null;
}
