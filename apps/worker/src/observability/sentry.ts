import * as Sentry from '@sentry/node';
import { scrubDeep, scrubString } from '@qa-platform/shared';

/**
 * Error tracking.
 *
 * Before this, the platform had no error tracking, metrics or alerting of any
 * kind: a worker that died on a Friday evening was found on Monday, and a
 * silently failed run surfaced only when a human happened to open the UI.
 *
 * Two deliberate properties:
 *
 *  1. **No DSN means no-op.** Sentry is optional — nothing here may throw or
 *     slow startup when `SENTRY_DSN` is unset, because dev and CI run without it.
 *
 *  2. **Secrets are scrubbed before send**, using the shared scrubber so the
 *     API and worker cannot drift apart. This is not boilerplate: the worker
 *     interpolates real customer credentials into step inputs, so an unscrubbed
 *     payload would ship passwords to a third party. `beforeSend` is the last
 *     line of defence and applies to every event.
 */
export const initSentry = (serviceName: string): void => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? 'development',
    release: process.env.GIT_SHA,
    serverName: serviceName,
    // Sampled rather than 1.0: this runs on a 2 GB host where tracing overhead
    // competes with Chromium for memory.
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? '0.1'),
    // Never send request bodies wholesale — the auth routes carry credentials.
    sendDefaultPii: false,
    beforeSend(event) {
      if (event.request) {
        event.request.headers = scrubDeep(event.request.headers) as typeof event.request.headers;
        event.request.data = scrubDeep(event.request.data);
        delete event.request.cookies;
      }
      if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra;
      if (event.contexts) event.contexts = scrubDeep(event.contexts) as typeof event.contexts;
      for (const ex of event.exception?.values ?? []) {
        if (ex.value) ex.value = scrubString(ex.value);
      }
      if (event.message) event.message = scrubString(event.message);
      return event;
    },
  });
};

/** Report a handled error with context. No-op when Sentry is not configured. */
export const captureError = (
  error: unknown,
  context?: Record<string, unknown>,
): void => {
  if (!process.env.SENTRY_DSN) return;
  Sentry.withScope((scope) => {
    if (context) scope.setExtras(scrubDeep(context) as Record<string, unknown>);
    Sentry.captureException(error);
  });
};

export { Sentry };
