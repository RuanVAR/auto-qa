import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

// Same-origin Socket.IO (default namespace) — Vite proxy in dev, nginx in
// prod both forward `/socket.io/` to the RunsGateway on api:3002.

let sharedSocket: Socket | null = null;
let socketRefCount = 0;

function getSocket(): Socket {
  // Only create when there's NO socket. Don't recreate on a transient
  // `!connected` — socket.io auto-reconnects, and recreating would abandon
  // the old socket (with all its still-attached listeners + closures)
  // instead of disconnecting it → leak.
  if (!sharedSocket) {
    sharedSocket = io({ transports: ['websocket', 'polling'] });
  }
  return sharedSocket;
}

/** Subscribe to live updates for a specific run */
export function useRunSocket(runId: string | undefined, projectId?: string) {
  const qc = useQueryClient();
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!runId) return;

    socketRefCount++;
    const socket = getSocket();
    socketRef.current = socket;

    socket.emit('watch:run', runId);
    if (projectId) socket.emit('watch:project', projectId);

    const handleRunUpdated = (data: Record<string, unknown>) => {
      if (data.id === runId) {
        qc.invalidateQueries({ queryKey: ['run', runId] });
        if (projectId) {
          qc.invalidateQueries({ queryKey: ['runs', projectId] });
          qc.invalidateQueries({ queryKey: ['run-stats', projectId] });
        }
      }
    };

    const handleStepCompleted = (data: Record<string, unknown>) => {
      if (data.runId === runId) {
        qc.invalidateQueries({ queryKey: ['run', runId] });
      }
    };

    socket.on('run:updated', handleRunUpdated);
    socket.on('step:completed', handleStepCompleted);

    return () => {
      socket.emit('unwatch:run', runId);
      if (projectId) socket.emit('unwatch:project', projectId);
      socket.off('run:updated', handleRunUpdated);
      socket.off('step:completed', handleStepCompleted);

      socketRefCount--;
      if (socketRefCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        socketRefCount = 0;
      }
    };
  }, [runId, projectId, qc]);

  return socketRef.current;
}

/**
 * Subscribe to project-level run list updates.
 *
 * Beyond the obvious /runs page invalidation, this also nudges any cached
 * query that surfaces a per-test status (test list, feature expanded tests,
 * active-runs map). React Query batches the cascade — the actual refetches
 * fire once per visible query, not once per event.
 */
export function useProjectRunSocket(projectId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    socketRefCount++;
    const socket = getSocket();

    socket.emit('watch:project', projectId);

    const handleRunUpdated = () => {
      // /runs page + stats widgets.
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      qc.invalidateQueries({ queryKey: ['run-stats', projectId] });
      // TestsPage browse (paginated test list with latestStatus + activeRun).
      // Predicate match — the query key contains a filter object, so a single
      // exact-match wouldn't work. Hits every page/filter variant in cache.
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'tests-browse' || q.queryKey[0] === 'tests-summary') &&
          q.queryKey[1] === projectId,
      });
      // FeaturesPage per-feature test status + active runs (keyed by featureId,
      // not projectId — invalidate them all; cheap and correct).
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          (q.queryKey[0] === 'test-statuses' || q.queryKey[0] === 'test-active-runs'),
      });
    };

    socket.on('run:updated', handleRunUpdated);

    return () => {
      socket.emit('unwatch:project', projectId);
      socket.off('run:updated', handleRunUpdated);

      socketRefCount--;
      if (socketRefCount <= 0 && sharedSocket) {
        sharedSocket.disconnect();
        sharedSocket = null;
        socketRefCount = 0;
      }
    };
  }, [projectId, qc]);
}
