import { useState } from 'react';
import { Download, Camera, Film, FileText, FileArchive, FileQuestion, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { ArtifactImage, ArtifactVideo, downloadArtifact } from './ArtifactImage';

/**
 * ArtifactGallery
 * ---------------
 * Renders the artifacts attached to a run — screenshots inline as
 * thumbnails (clickable lightbox), everything else as a download chip.
 *
 * Both paths go through ArtifactImage / downloadArtifact, which fetch via
 * axios + blob URL because the artifact endpoints are JWT-guarded — a raw
 * <img src> or <a href> would silently 401.
 */

export type Artifact = {
  id: string;
  type: string;
  filename: string;
  mimeType: string | null;
  sizeBytes: number | null;
};

interface Props {
  artifacts: Artifact[];
}

function formatBytes(n: number | null | undefined): string {
  if (n == null) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function iconForType(type: string) {
  switch (type) {
    case 'SCREENSHOT':
      return <Camera size={13} />;
    case 'VIDEO':
      return <Film size={13} />;
    case 'TRACE':
      return <FileArchive size={13} />;
    case 'HAR':
    case 'LOG':
    case 'REPORT':
      return <FileText size={13} />;
    default:
      return <FileQuestion size={13} />;
  }
}

export function ArtifactGallery({ artifacts }: Props) {
  const [lightbox, setLightbox] = useState<Artifact | null>(null);

  // Split into screenshots (rendered inline) and "other" (download chips).
  // Screenshots are the failure-debugging signal you actually want to see;
  // everything else is a click-to-download.
  const screenshots = artifacts.filter((a) => a.type === 'SCREENSHOT');
  const videos = artifacts.filter((a) => a.type === 'VIDEO');
  const others = artifacts.filter((a) => a.type !== 'SCREENSHOT' && a.type !== 'VIDEO');

  if (artifacts.length === 0) return null;

  return (
    <>
      <div>
        <h3
          className="text-[11px] font-semibold uppercase tracking-wider mb-2"
          style={{ color: 'rgba(238,238,248,0.55)' }}
        >
          Artifacts ({artifacts.length})
        </h3>

        {/* Full-run video recording(s) — inline player for post-run review. */}
        {videos.length > 0 && (
          <div className="flex flex-col gap-2 mb-3">
            {videos.map((a) => (
              <div key={a.id}>
                <ArtifactVideo
                  artifactId={a.id}
                  className="w-full rounded-lg"
                  style={{ background: '#000', maxHeight: 360, border: '1px solid rgba(255,255,255,0.08)' }}
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.4)' }}>{a.filename}{a.sizeBytes != null ? ` · ${formatBytes(a.sizeBytes)}` : ''}</span>
                  <button
                    type="button"
                    onClick={() => downloadArtifact(a.id, a.filename)}
                    className="inline-flex items-center gap-1 text-[10px] underline"
                    style={{ color: 'var(--accent-300)' }}
                  >
                    <Download size={10} /> Download
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Screenshot grid */}
        {screenshots.length > 0 && (
          <div className="grid grid-cols-3 gap-2 mb-3">
            {screenshots.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setLightbox(a)}
                className="relative aspect-video rounded-lg overflow-hidden group"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
                title={a.filename}
              >
                <ArtifactImage
                  artifactId={a.id}
                  alt={a.filename}
                  className="w-full h-full object-cover transition-transform group-hover:scale-105"
                />
                {/* Filename overlay on hover */}
                <div
                  className="absolute inset-x-0 bottom-0 px-2 py-1 text-[10px] truncate opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    background: 'linear-gradient(to top, rgba(0,0,0,0.85), transparent)',
                    color: 'rgba(238,238,248,0.85)',
                  }}
                >
                  {a.filename}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Non-screenshot artifacts as download chips. Plain <a download>
            wouldn't work — the API requires the Bearer token. downloadArtifact
            does an authenticated fetch + blob URL + synthetic <a> click. */}
        {others.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {others.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => downloadArtifact(a.id, a.filename)}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs transition-colors hover:bg-white/[0.06]"
                  style={{
                    background: 'rgba(255,255,255,0.03)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    color: 'rgba(238,238,248,0.80)',
                  }}
                >
                  <span style={{ color: 'var(--accent-400)' }}>{iconForType(a.type)}</span>
                  <span
                    className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                    style={{
                      background: 'rgba(255,255,255,0.05)',
                      color: 'rgba(238,238,248,0.55)',
                    }}
                  >
                    {a.type}
                  </span>
                  <span className="truncate flex-1 text-left">{a.filename}</span>
                  {a.sizeBytes != null && (
                    <span
                      className="text-[10px] tabular-nums"
                      style={{ color: 'rgba(238,238,248,0.40)' }}
                    >
                      {formatBytes(a.sizeBytes)}
                    </span>
                  )}
                  <Download size={11} style={{ color: 'rgba(238,238,248,0.40)' }} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Lightbox — click a screenshot thumb to view it at full size. */}
      {lightbox &&
        createPortal(
          <div
            className="fixed inset-0 z-[10070] flex items-center justify-center p-6 animate-fade-in"
            onClick={() => setLightbox(null)}
          >
            <div
              className="absolute inset-0"
              style={{ background: 'rgba(0,0,0,0.85)' }}
            />
            <div className="relative max-w-[95vw] max-h-[95vh] flex flex-col items-center gap-3">
              <div onClick={(e) => e.stopPropagation()}>
                <ArtifactImage
                  artifactId={lightbox.id}
                  alt={lightbox.filename}
                  className="max-w-full max-h-[85vh] rounded-lg"
                  style={{ boxShadow: '0 24px 64px rgba(0,0,0,0.6)' }}
                />
              </div>
              <div className="flex items-center gap-3 text-xs" style={{ color: 'rgba(255,255,255,0.8)' }}>
                <span className="font-mono">{lightbox.filename}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void downloadArtifact(lightbox.id, lightbox.filename);
                  }}
                  className="inline-flex items-center gap-1 underline"
                  style={{ color: 'var(--accent-300)' }}
                >
                  <Download size={11} /> Download
                </button>
              </div>
              <button
                type="button"
                onClick={() => setLightbox(null)}
                className="absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center"
                style={{
                  background: 'rgba(255,255,255,0.10)',
                  color: 'rgba(255,255,255,0.85)',
                }}
              >
                <X size={14} />
              </button>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
