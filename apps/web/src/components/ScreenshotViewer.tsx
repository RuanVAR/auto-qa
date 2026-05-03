import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight, Download, ZoomIn } from 'lucide-react';

interface Screenshot {
  id: string;
  url: string;
  name?: string;
  stepIndex?: number;
}

interface ScreenshotViewerProps {
  screenshots: Screenshot[];
  initialIndex?: number;
  onClose: () => void;
}

export function ScreenshotViewer({ screenshots, initialIndex = 0, onClose }: ScreenshotViewerProps) {
  const [current, setCurrent] = useState(initialIndex);

  const prev = useCallback(() => setCurrent(i => Math.max(0, i - 1)), []);
  const next = useCallback(() => setCurrent(i => Math.min(screenshots.length - 1, i + 1)), [screenshots.length]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, prev, next]);

  if (screenshots.length === 0) return null;
  const shot = screenshots[current];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
      onClick={onClose}
    >
      <div
        className="relative max-w-5xl w-full mx-4 bg-gray-900 rounded-xl overflow-hidden shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
          <div className="text-sm text-gray-300">
            {shot.name ?? `Screenshot ${current + 1}`}
            {shot.stepIndex !== undefined && (
              <span className="ml-2 text-gray-500">· Step {shot.stepIndex + 1}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{current + 1} / {screenshots.length}</span>
            <a
              href={shot.url}
              download
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
              title="Download"
            >
              <Download size={14} />
            </a>
            <a
              href={shot.url}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
              title="Open full size"
            >
              <ZoomIn size={14} />
            </a>
            <button
              onClick={onClose}
              className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-gray-700"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Image */}
        <div className="relative bg-black flex items-center justify-center" style={{ minHeight: 400, maxHeight: '70vh' }}>
          <img
            src={shot.url}
            alt={shot.name ?? `Screenshot ${current + 1}`}
            className="max-w-full max-h-full object-contain"
            style={{ maxHeight: '70vh' }}
          />

          {/* Prev / Next */}
          {current > 0 && (
            <button
              onClick={prev}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronLeft size={20} />
            </button>
          )}
          {current < screenshots.length - 1 && (
            <button
              onClick={next}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            >
              <ChevronRight size={20} />
            </button>
          )}
        </div>

        {/* Thumbnail strip */}
        {screenshots.length > 1 && (
          <div className="flex gap-2 px-4 py-3 bg-gray-800 overflow-x-auto">
            {screenshots.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setCurrent(i)}
                className={`flex-shrink-0 w-14 h-10 rounded border-2 overflow-hidden ${
                  i === current ? 'border-sky-500' : 'border-gray-600 opacity-60 hover:opacity-100'
                }`}
              >
                <img src={s.url} alt="" className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** Inline thumbnail that opens the viewer on click */
interface ScreenshotThumbProps {
  screenshots: Screenshot[];
  index: number;
}

export function ScreenshotThumb({ screenshots, index }: ScreenshotThumbProps) {
  const [open, setOpen] = useState(false);

  if (!screenshots[index]) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-sky-600 hover:text-sky-700 underline"
      >
        <ZoomIn size={12} />
        Screenshot
      </button>
      {open && (
        <ScreenshotViewer
          screenshots={screenshots}
          initialIndex={index}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
