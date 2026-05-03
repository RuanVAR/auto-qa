import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3002';

// ─── Singleton socket for the default namespace (run status events) ───────────
//
// One socket is shared across all hook instances to avoid multiple connections.
// We track active users with a ref count so we disconnect cleanly when the last
// consumer unmounts, preventing memory / connection leaks.

let _socket: Socket | null = null;
let _refCount = 0;

function acquireSocket(): Socket {
  if (!_socket || !_socket.connected) {
    _socket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });
  }
  _refCount++;
  return _socket;
}

function releaseSocket() {
  _refCount--;
  if (_refCount <= 0 && _socket) {
    _socket.disconnect();
    _socket = null;
    _refCount = 0;
  }
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Subscribe to real-time FeatureRun events from the API WebSocket server.
 *
 * - Watches the `featureRun:{featureRunId}` room for per-TestRun status updates
 *   (`featureRun:testRunUpdated`) and overall FeatureRun status changes
 *   (`featureRun:updated`). Both events invalidate the `feature-runs` React Query
 *   cache so the UI re-fetches fresh data immediately.
 *
 * - Memory-safe: uses a ref-counted singleton socket. The socket is only
 *   disconnected when the last consumer unmounts.
 *
 * @param featureId  - the Feature ID (used as the React Query cache key)
 * @param featureRunId - the active FeatureRun ID to watch (null = no active run)
 */
export function useFeatureRunSocket(
  featureId: string | undefined,
  featureRunId: string | null | undefined,
  // Fires when the worker confirms a cancelled run's browser is fully torn
  // down. The web UI uses this to gate "switch to manual mode".
  onAbortCompleted?: (payload: { runId: string; featureRunId: string | null }) => void,
) {
  const qc = useQueryClient();
  // Keep stable ref to qc — QueryClient identity is stable, but we use a ref
  // to avoid listing it as an effect dependency (it never changes in practice).
  const qcRef = useRef(qc);
  qcRef.current = qc;
  const onAbortRef = useRef(onAbortCompleted);
  onAbortRef.current = onAbortCompleted;

  useEffect(() => {
    if (!featureId) return;

    const sock = acquireSocket();

    // Subscribe to the featureRun room if we have an active run
    if (featureRunId) {
      sock.emit('watch:featureRun', featureRunId);
    }

    // Throttle invalidations: during an active run, sockets may fire many events
    // per second (each step status change). Invalidating the whole feature-runs
    // query refetches all test runs + definitions — expensive, and at 500ms it
    // blows through the global 100 req/min rate limit on bursty runs. 1500ms is
    // still visually smooth (each test takes seconds) and roughly 3× less load.
    let pendingInvalidation: ReturnType<typeof setTimeout> | null = null;
    let pendingSteps = false;
    const scheduleInvalidation = (includeSteps: boolean) => {
      if (includeSteps) pendingSteps = true;
      if (pendingInvalidation) return;
      pendingInvalidation = setTimeout(() => {
        qcRef.current.invalidateQueries({ queryKey: ['feature-runs', featureId] });
        // `run-steps` key has the testRunId in it — if the backend emits
        // step updates, we need to invalidate those keys too. Use predicate
        // to match any run-steps query rather than refetching all of them
        // up-front.
        if (pendingSteps) {
          qcRef.current.invalidateQueries({
            predicate: (q) => q.queryKey[0] === 'run-steps',
          });
        }
        pendingInvalidation = null;
        pendingSteps = false;
      }, 1500);
    };

    const onTestRunUpdated = () => scheduleInvalidation(true);
    const onFeatureRunUpdated = () => scheduleInvalidation(false);

    const onAbort = (payload: { runId: string; featureRunId: string | null }) => {
      // Always invalidate so the UI sees the cancelled status; also forward
      // to the consumer-supplied callback for mode-switch gating.
      scheduleInvalidation(true);
      onAbortRef.current?.(payload);
    };

    sock.on('featureRun:testRunUpdated', onTestRunUpdated);
    sock.on('featureRun:updated', onFeatureRunUpdated);
    sock.on('run:abortCompleted', onAbort);

    return () => {
      if (pendingInvalidation) clearTimeout(pendingInvalidation);
      if (featureRunId) sock.emit('unwatch:featureRun', featureRunId);
      sock.off('featureRun:testRunUpdated', onTestRunUpdated);
      sock.off('featureRun:updated', onFeatureRunUpdated);
      sock.off('run:abortCompleted', onAbort);
      releaseSocket();
    };
  }, [featureId, featureRunId]); // qcRef is stable — intentionally omitted
}
