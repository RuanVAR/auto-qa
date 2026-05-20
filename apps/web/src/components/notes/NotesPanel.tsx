import { useEffect, useRef, useState, useCallback } from 'react';
import { X, StickyNote, Save } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../../lib/api';

interface NotesPanelProps {
  projectId: string;
  onClose: () => void;
}

export function NotesPanel({ projectId, onClose }: NotesPanelProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery({
    queryKey: ['project-note', projectId],
    queryFn: () => notesApi.get(projectId),
    staleTime: 60_000,
  });

  const save = useMutation({
    mutationFn: (content: string) => notesApi.save(projectId, content),
    onSuccess: (res) => {
      qc.setQueryData(['project-note', projectId], res);
    },
  });

  // Initialise draft from server once loaded
  useEffect(() => {
    if (data !== undefined && draft === null) {
      setDraft(data.content);
    }
  }, [data, draft]);

  // Cancel any pending debounced save when the panel unmounts.
  useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  }, []);

  const scheduleSave = useCallback((content: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => save.mutate(content), 1500);
  }, [save]);

  const handleChange = (value: string) => {
    setDraft(value);
    scheduleSave(value);
  };

  const handleManualSave = () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (draft !== null) save.mutate(draft);
  };

  const isDirty = draft !== null && draft !== (data?.content ?? '');

  return (
    <div
      className="absolute right-0 top-0 h-full z-40 flex flex-col"
      style={{
        width: 360,
        background: 'rgba(14,14,22,0.97)',
        backdropFilter: 'blur(20px)',
        borderLeft: '1px solid rgba(251,191,36,0.25)',
        boxShadow: '-8px 0 40px rgba(0,0,0,0.5)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: 'rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-2">
          <StickyNote size={14} style={{ color: '#fbbf24' }} />
          <span className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>
            My Notes
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.70)' }}>
            private
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {isDirty && (
            <button
              onClick={handleManualSave}
              title="Save now"
              className="flex items-center gap-1 px-2 py-1 rounded text-[11px] transition-colors"
              style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)' }}
            >
              <Save size={11} /> Save
            </button>
          )}
          {!isDirty && save.isSuccess && (
            <span className="text-[10px]" style={{ color: 'rgba(74,222,128,0.70)' }}>Saved</span>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            style={{ color: 'rgba(238,238,248,0.50)', background: 'rgba(255,255,255,0.05)' }}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex flex-col p-3 gap-2">
        <p className="text-[10px]" style={{ color: 'rgba(238,238,248,0.35)' }}>
          Notes are personal — only you can see them. Autosaves as you type.
        </p>
        <textarea
          className="flex-1 w-full resize-none rounded-lg p-3 text-xs leading-relaxed outline-none transition-colors"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'rgba(238,238,248,0.88)',
            fontFamily: 'inherit',
          }}
          placeholder="Store login credentials, test notes, or anything useful…"
          value={draft ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,191,36,0.40)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
          spellCheck={false}
        />
      </div>
    </div>
  );
}
