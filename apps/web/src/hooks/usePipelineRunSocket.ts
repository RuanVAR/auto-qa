import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

// Ref-counted singleton socket, same pattern as useFeatureRunSocket — one
// connection shared across consumers, torn down when the last unmounts.
let _socket: Socket | null = null;
let _refCount = 0;

function acquireSocket(): Socket {
  if (!_socket || !_socket.connected) {
    _socket = io({
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

/**
 * Live pipeline-run progress: watches the `pipelineRun:{id}` room and
 * invalidates the pipelines + run queries on every stage transition
 * (throttled to 1500ms, mirroring useFeatureRunSocket).
 */
export function usePipelineRunSocket(projectId: string | undefined, pipelineRunId: string | null | undefined) {
  const qc = useQueryClient();
  const lastInvalidate = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!pipelineRunId) return;
    const socket = acquireSocket();

    const invalidate = () => {
      const now = Date.now();
      const doIt = () => {
        lastInvalidate.current = Date.now();
        qc.invalidateQueries({ queryKey: ['pipelines', projectId] });
        qc.invalidateQueries({ queryKey: ['pipeline-run', pipelineRunId] });
        qc.invalidateQueries({ queryKey: ['pipeline-history'] });
      };
      if (now - lastInvalidate.current >= 1500) {
        doIt();
      } else if (!pending.current) {
        pending.current = setTimeout(() => { pending.current = null; doIt(); }, 1500 - (now - lastInvalidate.current));
      }
    };

    const onUpdated = () => invalidate();
    socket.emit('watch:pipelineRun', pipelineRunId);
    socket.on('pipelineRun:updated', onUpdated);

    return () => {
      socket.emit('unwatch:pipelineRun', pipelineRunId);
      socket.off('pipelineRun:updated', onUpdated);
      if (pending.current) { clearTimeout(pending.current); pending.current = null; }
      releaseSocket();
    };
  }, [projectId, pipelineRunId, qc]);
}
