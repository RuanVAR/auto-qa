import { RunStatus } from '@prisma/client';

/**
 * Run status classification, in one place.
 *
 * These lists were previously inlined at each call site and had silently
 * drifted apart, with real consequences:
 *
 *   - `feature-runs.service` omitted TIMED_OUT from its terminal list, so a
 *     single timed-out test left its FeatureRun in RUNNING forever: sign-off
 *     never fired, the completion webhook never fired, and any parent pipeline
 *     never advanced. It was rescued 15–60 minutes later by the stuck-run cron,
 *     which *cancelled* it — silently converting a timeout into a cancellation.
 *
 *   - `runs.service.cancel` omitted both TIMED_OUT and ERROR, so a run that had
 *     already finished badly could be "cancelled", overwriting the honest record
 *     of what actually happened.
 *
 *   - `websocket/worker-events.service` had the correct list all along, which is
 *     precisely why the drift went unnoticed.
 *
 * Import from here. Do not inline a new literal.
 */

/**
 * A run has finished and will not change again by itself.
 *
 * Note TIMED_OUT and ERROR are terminal: they are *outcomes*, not transient
 * states. Anything asking "is this run done?" must include them.
 */
export const TERMINAL_RUN_STATUSES: readonly RunStatus[] = [
  RunStatus.PASSED,
  RunStatus.FAILED,
  RunStatus.CANCELLED,
  RunStatus.TIMED_OUT,
  RunStatus.ERROR,
] as const;

/**
 * Statuses that represent a *verdict about the software under test*.
 *
 * Deliberately narrower than terminal: a run that timed out or errored tells you
 * something broke in the harness or the environment, not whether the feature
 * works. Pass-rate maths must use this list, never TERMINAL_RUN_STATUSES —
 * counting infrastructure failures as product failures makes every quality
 * metric lie.
 */
export const VERDICT_RUN_STATUSES: readonly RunStatus[] = [
  RunStatus.PASSED,
  RunStatus.FAILED,
] as const;

/** Run is finished and will not change on its own. */
export const isTerminalRunStatus = (s: RunStatus): boolean =>
  TERMINAL_RUN_STATUSES.includes(s);

/** Run produced a verdict about the software (as opposed to about the harness). */
export const isVerdictRunStatus = (s: RunStatus): boolean =>
  VERDICT_RUN_STATUSES.includes(s);
