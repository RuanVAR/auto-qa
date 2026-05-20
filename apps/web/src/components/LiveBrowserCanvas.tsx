/**
 * LiveBrowserCanvas
 * -----------------
 * Connects to the /screencast Socket.io namespace (port 3002) and draws
 * JPEG frames onto a <canvas> element in real time.
 *
 * Protocol:
 *  – on mount:  emit 'watch:run', { runId }
 *  – incoming:  'screencast:frame' → { runId, frameBase64 }
 *  – on unmount: emit 'unwatch:run', { runId }
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Monitor, WifiOff } from 'lucide-react';

interface Props {
  runId: string;
  /** Set to false while run is not yet live to suppress the connection. */
  active?: boolean;
}

// Same-origin Socket.IO — the Vite dev proxy and prod nginx both forward
// `/socket.io/` to the screencast gateway on api:3002.

let socket: Socket | null = null;
let socketRefCount = 0;

function getSocket(): Socket {
  if (!socket) {
    socket = io('/screencast', {
      transports: ['websocket'],
      autoConnect: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
  }
  socketRefCount++;
  return socket;
}

function releaseSocket() {
  socketRefCount--;
  if (socketRefCount <= 0 && socket) {
    socket.disconnect();
    socket = null;
    socketRefCount = 0;
  }
}

type ConnectionState = 'connecting' | 'connected' | 'disconnected' | 'error';

export function LiveBrowserCanvas({ runId, active = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [connState, setConnState] = useState<ConnectionState>('connecting');
  const [frameCount, setFrameCount] = useState(0);
  const lastFrameTs = useRef<number>(0);

  useEffect(() => {
    if (!active) return;

    const sock = getSocket();

    const onConnect = () => {
      setConnState('connected');
      sock.emit('watch:run', { runId });
    };

    const onDisconnect = () => setConnState('disconnected');
    const onConnectError = () => setConnState('error');

    const onFrame = (data: { runId: string; frameBase64: string }) => {
      if (data.runId !== runId) return;
      const now = Date.now();
      // Throttle rendering: skip if last draw was < 50ms ago
      if (now - lastFrameTs.current < 50) return;
      lastFrameTs.current = now;

      const img = new Image();
      img.onload = () => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Resize canvas to match frame dimensions on first frame
        if (canvas.width !== img.naturalWidth || canvas.height !== img.naturalHeight) {
          canvas.width = img.naturalWidth || 1280;
          canvas.height = img.naturalHeight || 800;
        }
        ctx.drawImage(img, 0, 0);
        setFrameCount((n) => n + 1);
      };
      img.src = `data:image/jpeg;base64,${data.frameBase64}`;
    };

    if (sock.connected) {
      setConnState('connected');
      sock.emit('watch:run', { runId });
    }

    sock.on('connect', onConnect);
    sock.on('disconnect', onDisconnect);
    sock.on('connect_error', onConnectError);
    sock.on('screencast:frame', onFrame);

    return () => {
      sock.emit('unwatch:run', { runId });
      sock.off('connect', onConnect);
      sock.off('disconnect', onDisconnect);
      sock.off('connect_error', onConnectError);
      sock.off('screencast:frame', onFrame);
      releaseSocket();
    };
  }, [runId, active]);

  return (
    <div className="relative w-full bg-gray-950 rounded-xl overflow-hidden border border-gray-800 shadow-xl">
      {/* Canvas — hidden until first frame */}
      <canvas
        ref={canvasRef}
        className="w-full h-auto block"
        style={{ display: frameCount > 0 ? 'block' : 'none' }}
      />

      {/* Skeleton placeholder before first frame */}
      {frameCount === 0 && (
        <div className="flex flex-col items-center justify-center h-52 gap-3 text-gray-500">
          {connState === 'connected' ? (
            <>
              <Monitor size={28} className="animate-pulse" />
              <span className="text-sm">Waiting for browser frames…</span>
            </>
          ) : connState === 'error' || connState === 'disconnected' ? (
            <>
              <WifiOff size={28} />
              <span className="text-sm">Screencast unavailable</span>
              <span className="text-xs text-gray-600">
                {connState === 'error'
                  ? 'Could not connect to live preview service'
                  : 'Disconnected — reconnecting…'}
              </span>
            </>
          ) : (
            <>
              <Monitor size={28} className="animate-pulse" />
              <span className="text-sm">Connecting…</span>
            </>
          )}
        </div>
      )}

      {/* Live badge */}
      {connState === 'connected' && frameCount > 0 && (
        <div className="absolute top-2 left-2 flex items-center gap-1.5 bg-black/60 backdrop-blur-sm px-2 py-1 rounded-full">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-white text-xs font-medium">LIVE</span>
        </div>
      )}

      {/* Frame counter (dev info, bottom right) */}
      {frameCount > 0 && (
        <div className="absolute bottom-2 right-2 text-xs text-white/40 tabular-nums">
          {frameCount} frames
        </div>
      )}
    </div>
  );
}
