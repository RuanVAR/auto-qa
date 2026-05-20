import { useEffect, useRef, useState, useCallback } from 'react';
import { Save, StickyNote } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { notesApi } from '../../lib/api';

interface ProjectNotesPanelProps {
  projectId: string;
}

export function NotesPanel({ projectId }: ProjectNotesPanelProps) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery({
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
    <div className="p-6 space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StickyNote size={16} style={{ color: '#fbbf24' }} />
          <h3 className="font-semibold text-sm" style={{ color: 'rgba(238,238,248,0.90)' }}>My Notes</h3>
          <span
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ background: 'rgba(251,191,36,0.12)', color: 'rgba(251,191,36,0.70)' }}
          >
            private
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isDirty && save.isSuccess && (
            <span className="text-xs" style={{ color: 'rgba(74,222,128,0.70)' }}>Saved</span>
          )}
          {isDirty && (
            <button
              onClick={handleManualSave}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-colors"
              style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.35)' }}
            >
              <Save size={12} /> Save now
            </button>
          )}
        </div>
      </div>

      <p className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
        These notes are personal — only you can see them. Store login credentials, test notes, or anything useful.
        Autosaves as you type.
      </p>

      {isLoading ? (
        <div className="h-64 rounded-xl animate-pulse" style={{ background: 'rgba(255,255,255,0.04)' }} />
      ) : (
        <textarea
          className="w-full rounded-xl p-4 text-sm leading-relaxed outline-none transition-colors resize-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.10)',
            color: 'rgba(238,238,248,0.88)',
            fontFamily: 'inherit',
            minHeight: 320,
          }}
          placeholder="Store login credentials, test notes, or anything useful…"
          value={draft ?? ''}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'rgba(251,191,36,0.40)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.10)')}
          spellCheck={false}
        />
      )}
    </div>
  );
}
