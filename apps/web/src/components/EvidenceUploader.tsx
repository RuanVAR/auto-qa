import React, { useRef, useState } from 'react';
import { uploadsApi } from '../lib/api';
import { Button } from './ui/Button';

export interface UploadedEvidence {
  token: string;
  url: string;
  filename: string;
  mimeType: string;
  notes: string;
  /** Local blob URL for immediate display — avoids dependency on API_URL being configured. */
  objectUrl?: string;
}

interface PendingEvidence {
  file: File;
  objectUrl: string;
  notes: string;
  uploading: boolean;
  error?: string;
}

interface EvidenceUploaderProps {
  value: UploadedEvidence[];
  onChange: (items: UploadedEvidence[]) => void;
  maxFiles?: number;
  /** Separate per-type caps. When set, override the combined maxFiles gate. */
  maxImages?: number;
  maxVideos?: number;
  accept?: string;
  label?: string;
  testName?: string;
}

export function EvidenceUploader({
  value,
  onChange,
  maxFiles = 5,
  maxImages,
  maxVideos,
  accept = 'image/png,image/jpeg,image/webp,image/gif,video/webm,video/mp4,video/quicktime',
  label = 'Add Evidence',
  testName,
}: EvidenceUploaderProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingEvidence | null>(null);
  const [selectError, setSelectError] = useState<string | null>(null);
  const [batchUploading, setBatchUploading] = useState(false);

  const perType = maxImages != null || maxVideos != null;
  const imageCount = value.filter(v => v.mimeType.startsWith('image/')).length;
  const videoCount = value.filter(v => v.mimeType.startsWith('video/')).length;
  const canAddImage = maxImages == null || imageCount < maxImages;
  const canAddVideo = maxVideos == null || videoCount < maxVideos;
  const totalAttached = value.length + (pending ? 1 : 0);
  const canAddMore = perType ? (!pending && (canAddImage || canAddVideo)) : totalAttached < maxFiles;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    // Reset input so the same file(s) can be re-selected
    e.target.value = '';
    setSelectError(null);
    if (files.length === 0) return;

    // Single file → keep the preview + note confirmation flow.
    if (files.length === 1) {
      const file = files[0];
      if (perType) {
        if (file.type.startsWith('image/') && !canAddImage) {
          setSelectError(`Up to ${maxImages} screenshot${maxImages === 1 ? '' : 's'}.`); return;
        }
        if (file.type.startsWith('video/') && !canAddVideo) {
          setSelectError(`Up to ${maxVideos} recording${maxVideos === 1 ? '' : 's'}.`); return;
        }
      }
      setPending({ file, objectUrl: URL.createObjectURL(file), notes: '', uploading: false });
      return;
    }

    // Multiple files → upload them all directly (no per-file note), respecting
    // the per-type caps; anything over the limit (or that fails) is skipped.
    setBatchUploading(true);
    let imgLeft = maxImages != null ? maxImages - imageCount : Number.POSITIVE_INFINITY;
    let vidLeft = maxVideos != null ? maxVideos - videoCount : Number.POSITIVE_INFINITY;
    const accepted: UploadedEvidence[] = [];
    let dropped = 0;
    for (const file of files) {
      const isImg = file.type.startsWith('image/');
      const isVid = file.type.startsWith('video/');
      if ((isImg && imgLeft <= 0) || (isVid && vidLeft <= 0)) { dropped++; continue; }
      try {
        const r = await uploadsApi.upload(file);
        accepted.push({ token: r.token, url: r.url, filename: r.filename, mimeType: r.mimeType, notes: '' });
        if (isImg) imgLeft--;
        if (isVid) vidLeft--;
      } catch {
        dropped++;
      }
    }
    if (accepted.length > 0) onChange([...value, ...accepted]);
    setBatchUploading(false);
    if (dropped > 0) setSelectError(`${dropped} file${dropped === 1 ? '' : 's'} skipped (over the limit or failed to upload).`);
  };

  const handleAttach = async () => {
    if (!pending) return;
    setPending(prev => prev ? { ...prev, uploading: true, error: undefined } : null);
    try {
      const result = await uploadsApi.upload(pending.file);
      const item: UploadedEvidence = {
        token: result.token,
        url: result.url,
        filename: result.filename,
        mimeType: result.mimeType,
        notes: pending.notes,
      };
      onChange([...value, item]);
      URL.revokeObjectURL(pending.objectUrl);
      setPending(null);
    } catch {
      setPending(prev => prev ? { ...prev, uploading: false, error: 'Upload failed. Please try again.' } : null);
    }
  };

  const handleSaveToPc = () => {
    if (!pending) return;
    const a = document.createElement('a');
    a.href = pending.objectUrl;
    a.download = pending.file.name;
    a.click();
  };

  const handleDiscard = () => {
    if (!pending) return;
    URL.revokeObjectURL(pending.objectUrl);
    setPending(null);
  };

  const handleRemoveAttached = (token: string) => {
    onChange(value.filter(v => v.token !== token));
  };

  const isImage = (mimeType: string) => mimeType.startsWith('image/');
  const isVideo = (mimeType: string) => mimeType.startsWith('video/');

  return (
    <div className="space-y-3">
      {/* Attached items */}
      {value.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {value.map(item => (
            <div
              key={item.token}
              className="relative rounded-lg overflow-hidden border border-white/10 group"
              style={{ background: 'rgba(255,255,255,0.04)' }}
            >
              {isImage(item.mimeType) && (
                <img
                  src={item.objectUrl ?? item.url}
                  alt={item.filename}
                  className="w-20 h-20 object-cover"
                />
              )}
              {isVideo(item.mimeType) && (
                <div className="w-20 h-20 flex flex-col items-center justify-center text-slate-400 gap-1">
                  <span className="text-2xl">🎥</span>
                  <span className="text-xs text-center px-1 truncate w-full text-slate-500">{item.filename}</span>
                </div>
              )}
              {!isImage(item.mimeType) && !isVideo(item.mimeType) && (
                <div className="w-20 h-20 flex flex-col items-center justify-center text-slate-400 gap-1">
                  <span className="text-2xl">📎</span>
                  <span className="text-xs text-center px-1 truncate w-full text-slate-500">{item.filename}</span>
                </div>
              )}
              {/* Overlay on hover */}
              <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-1 p-1">
                <span className="text-xs text-white text-center truncate w-full px-1">{item.filename}</span>
                {item.notes && (
                  <span className="text-xs text-slate-300 text-center truncate w-full px-1 italic">{item.notes}</span>
                )}
                <button
                  onClick={() => handleRemoveAttached(item.token)}
                  className="text-xs text-red-400 hover:text-red-300 mt-1"
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending confirmation UI */}
      {pending && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(var(--accent-rgb),0.08)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
          <p className="text-xs font-medium text-purple-300">Pending attachment</p>

          {/* Preview */}
          <div className="flex gap-3 items-start">
            {isImage(pending.file.type) && (
              <img
                src={pending.objectUrl}
                alt={pending.file.name}
                className="w-24 h-24 object-cover rounded-lg border border-white/10 shrink-0"
              />
            )}
            {isVideo(pending.file.type) && (
              <video
                src={pending.objectUrl}
                controls
                className="w-48 h-28 rounded-lg border border-white/10 shrink-0"
              />
            )}
            {!isImage(pending.file.type) && !isVideo(pending.file.type) && (
              <div className="w-24 h-24 flex items-center justify-center rounded-lg border border-white/10 text-slate-400 shrink-0"
                style={{ background: 'rgba(255,255,255,0.04)' }}>
                <span className="text-3xl">📎</span>
              </div>
            )}
            <div className="flex-1 min-w-0 space-y-2">
              <p className="text-xs text-slate-300 truncate">{pending.file.name}</p>
              <p className="text-xs text-slate-500">
                {(pending.file.size / 1024).toFixed(0)} KB
              </p>
              {testName && (
                <p className="text-xs text-slate-400">
                  Will attach to: <span className="text-purple-300">{testName}</span>
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs text-slate-400 mb-1">Notes (optional)</label>
            <input
              value={pending.notes}
              onChange={e => setPending(prev => prev ? { ...prev, notes: e.target.value } : null)}
              placeholder="Describe what this shows..."
              className="w-full px-3 py-1.5 rounded-lg text-xs text-slate-100 placeholder:text-slate-500 border border-white/10 focus:border-purple-500 focus:outline-none"
              style={{ background: 'rgba(255,255,255,0.05)' }}
            />
          </div>

          {pending.error && (
            <p className="text-xs text-red-400">{pending.error}</p>
          )}

          {/* Actions */}
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={handleAttach}
              loading={pending.uploading}
              disabled={pending.uploading}
            >
              Attach
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleSaveToPc}
              disabled={pending.uploading}
            >
              Save to PC
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleDiscard}
              disabled={pending.uploading}
            >
              Discard
            </Button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!pending && canAddMore && (
        <>
          <input
            ref={fileRef}
            type="file"
            accept={accept}
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
          <button
            disabled={batchUploading}
            onClick={() => fileRef.current?.click()}
            className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-dashed border-white/20 text-slate-400 hover:border-purple-500/50 hover:text-purple-300 transition-colors w-full justify-center"
            style={{ background: 'rgba(255,255,255,0.02)' }}
          >
            <span>+</span>
            <span>{batchUploading ? 'Uploading…' : label}</span>
            {perType ? (
              <span className="text-slate-600">
                ({imageCount}/{maxImages ?? '∞'} img · {videoCount}/{maxVideos ?? '∞'} rec)
              </span>
            ) : maxFiles > 1 && (
              <span className="text-slate-600">({value.length}/{maxFiles})</span>
            )}
          </button>
        </>
      )}

      {perType && (
        <p className="text-[11px] text-slate-500">
          Recordings .mov / .mp4 / .webm{maxVideos != null ? ` (max ${maxVideos})` : ''} · Images .png / .jpeg{maxImages != null ? ` (max ${maxImages})` : ''}. You can select several at once.
        </p>
      )}
      {selectError && <p className="text-[11px] text-amber-400">{selectError}</p>}

      {!canAddMore && !pending && (
        <p className="text-xs text-slate-500">{perType ? 'Attachment limits reached.' : `Maximum ${maxFiles} files attached.`}</p>
      )}
    </div>
  );
}
