import { useRef, useEffect, useState, useCallback } from 'react';
import { Eraser } from 'lucide-react';

/**
 * Lightweight hand-drawn signature pad on a native <canvas>. Emits a PNG
 * data-URL via onChange (or null when cleared). No external dependency.
 */
export function SignaturePad({ onChange, height = 140 }: { onChange: (dataUrl: string | null) => void; height?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Size the canvas to its container with devicePixelRatio for crisp strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#0f172a';
    }
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    drawing.current = true;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvasRef.current!.getContext('2d')!;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    dirty.current = true;
  };
  const end = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (dirty.current) {
      setEmpty(false);
      onChange(canvasRef.current!.toDataURL('image/png'));
    }
  }, [onChange]);

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext('2d')!.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div>
      <div className="relative rounded-lg border border-dashed border-slate-300 bg-white">
        <canvas
          ref={canvasRef}
          style={{ width: '100%', height, touchAction: 'none', cursor: 'crosshair' }}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {empty && (
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-400">
            Sign here (optional)
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
      >
        <Eraser className="h-3 w-3" /> Clear
      </button>
    </div>
  );
}
