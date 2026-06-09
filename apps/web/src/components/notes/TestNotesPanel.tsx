import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StickyNote, Eye, Pencil, Loader, Check } from 'lucide-react';
import { testNotesApi } from '../../lib/api';
import { NotesPanel } from './NotesPanel';
import { cn } from '../../lib/utils';

/**
 * Per-test notes. Two tabs:
 *  - "Test notes"  — one shared markdown note on the test (everyone with project
 *    access reads + edits; "last edited by" tracked). Autosaves.
 *  - "Personal notes" — the caller's private per-project scratchpad (reuses the
 *    existing UserProjectNote via NotesPanel).
 */
export function TestNotesPanel({
  testId,
  testName,
  projectId,
  onClose,
}: {
  testId: string | null;
  testName?: string;
  projectId: string;
  onClose?: () => void;
}) {
  const [tab, setTab] = useState<'test' | 'personal'>('test');

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
        <StickyNote size={14} className="text-amber-300" />
        <span className="text-sm font-semibold text-slate-100 truncate">{testName ?? 'Notes'}</span>
      </div>
      <div className="flex gap-1 px-3 shrink-0">
        {(['test', 'personal'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1.5 text-xs font-medium rounded-t-md border-b-2 transition-colors',
              tab === t ? 'text-amber-200 border-amber-400' : 'text-slate-400 border-transparent hover:text-slate-200',
            )}
          >
            {t === 'test' ? 'Test notes' : 'Personal notes'}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 border-t border-white/10">
        {tab === 'test' ? (
          testId ? <SharedTestNote testId={testId} /> : <Empty>Select a test to view its notes.</Empty>
        ) : (
          <NotesPanel projectId={projectId} onClose={onClose ?? (() => undefined)} />
        )}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center justify-center h-full text-xs text-slate-500 px-4 text-center">{children}</div>;
}

function SharedTestNote({ testId }: { testId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['test-note', testId], queryFn: () => testNotesApi.get(testId) });
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const lastSaved = useRef<string>('');

  // Hydrate the editor when the note loads / the test changes.
  useEffect(() => {
    if (data) { setDraft(data.content); lastSaved.current = data.content; }
  }, [data, testId]);

  const save = useMutation({
    mutationFn: (content: string) => testNotesApi.save(testId, content),
    onSuccess: (res) => {
      lastSaved.current = res.content;
      qc.setQueryData(['test-note', testId], res);
      qc.invalidateQueries({ queryKey: ['test-notes-presence'] });
    },
  });

  // Debounced autosave on change.
  useEffect(() => {
    if (isLoading) return;
    if (draft === lastSaved.current) return;
    const id = setTimeout(() => save.mutate(draft), 800);
    return () => clearTimeout(id);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Empty><Loader size={14} className="animate-spin" /></Empty>;

  const dirty = draft !== lastSaved.current;
  const meta = data?.lastEditedBy
    ? `Last edited by ${data.lastEditedBy}${data.updatedAt ? ` · ${new Date(data.updatedAt).toLocaleString()}` : ''}`
    : 'Shared with everyone on this project';

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 shrink-0">
        <span className="text-[10px] text-slate-500 truncate">{meta}</span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500 w-12 text-right">
            {save.isPending ? 'Saving…' : dirty ? 'Unsaved' : <span className="inline-flex items-center gap-0.5 text-emerald-400"><Check size={11} /> Saved</span>}
          </span>
          <button
            onClick={() => setMode(m => (m === 'edit' ? 'preview' : 'edit'))}
            className="inline-flex items-center gap-1 text-[11px] text-slate-300 hover:text-white px-2 py-1 rounded border border-white/10"
          >
            {mode === 'edit' ? <><Eye size={12} /> Preview</> : <><Pencil size={12} /> Edit</>}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-3">
        {mode === 'edit' ? (
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a note for whoever tests this next — repro steps, gotchas, where you left off… (Markdown supported)"
            className="w-full h-full resize-none rounded-md bg-slate-950/60 border border-white/10 p-2.5 text-xs text-slate-200 font-mono leading-relaxed focus:outline-none focus:border-amber-400/40"
          />
        ) : (
          <div className="w-full h-full overflow-y-auto rounded-md bg-slate-950/40 border border-white/10 p-3 prose prose-invert prose-sm max-w-none text-xs text-slate-200">
            {draft.trim()
              ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{draft}</ReactMarkdown>
              : <span className="text-slate-500">Nothing yet.</span>}
          </div>
        )}
      </div>
    </div>
  );
}
