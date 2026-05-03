import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io, Socket } from 'socket.io-client';

const WS_URL = import.meta.env.VITE_WS_URL ?? 'http://localhost:3002';

let sharedSocket: Socket | null = null;
let socketRefCount = 0;

function getSocket(): Socket {
  if (!sharedSocket || !sharedSocket.connected) {
    sharedSocket = io(WS_URL, { transports: ['websocket', 'polling'] });
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

/** Subscribe to project-level run list updates */
export function useProjectRunSocket(projectId: string | undefined) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!projectId) return;

    socketRefCount++;
    const socket = getSocket();

    socket.emit('watch:project', projectId);

    const handleRunUpdated = () => {
      qc.invalidateQueries({ queryKey: ['runs', projectId] });
      qc.invalidateQueries({ queryKey: ['run-stats', projectId] });
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
