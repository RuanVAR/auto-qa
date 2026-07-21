import * as Sentry from '@sentry/react';

const SENSITIVE_KEY = /authorization|cookie|password|secret|token|api[_-]?key/i;

function scrub(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/(bearer\s+|password=|token=|api[_-]?key=)[^\s&]+/gi, '$1[REDACTED]');
  }
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SENSITIVE_KEY.test(key) ? '[REDACTED]' : scrub(item)]));
  }
  return value;
}

/** Browser error reporting is opt-in and never sends credentials or API bodies. */
export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_GIT_SHA as string | undefined,
    tracesSampleRate: Number(import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        event.request.headers = scrub(event.request.headers) as typeof event.request.headers;
        event.request.data = scrub(event.request.data);
        delete event.request.cookies;
      }
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts;
      if (event.message) event.message = scrub(event.message) as string;
      return event;
    },
  });
}
