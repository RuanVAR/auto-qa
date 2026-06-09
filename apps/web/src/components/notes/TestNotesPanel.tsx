import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { StickyNote, Eye, Pencil, Loader, Check, X } from 'lucide-react';
import { testNotesApi, notesApi } from '../../lib/api';
import { cn } from '../../lib/utils';

/**
 * Per-test notes. Two tabs:
 *  - "Test notes"  — one shared markdown note on the test (everyone with project
 *    access reads + edits; "last edited by" tracked). Autosaves.
 *  - "Personal notes" — the caller's private per-project scratchpad
 *    (UserProjectNote). Rendered inline (NOT the standalone NotesPanel drawer,
 *    which is absolute-positioned and would overlay these tabs).
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
      <div className="flex items-center justify-between gap-2 px-3 pt-3 pb-2 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <StickyNote size={14} className="text-amber-300 shrink-0" />
          <span className="text-sm font-semibold text-slate-100 truncate">{testName ?? 'Notes'}</span>
        </div>
        {onClose && (
          <button onClick={onClose} title="Close" className="shrink-0 w-7 h-7 flex items-center justify-center rounded-md text-slate-400 hover:text-white hover:bg-white/10">
            <X size={15} />
          </button>
        )}
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
          <PersonalNote projectId={projectId} />
        )}
      </div>
      {onClose && (
        <div className="shrink-0 border-t border-white/10 p-2 flex justify-end">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded-md border border-white/10 text-slate-300 hover:text-white hover:bg-white/5 transition-colors">
            Close
          </button>
        </div>
      )}
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

function PersonalNote({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['project-note', projectId], queryFn: () => notesApi.get(projectId), staleTime: 60_000 });
  const [draft, setDraft] = useState('');
  const [ready, setReady] = useState(false);
  const lastSaved = useRef<string>('');

  useEffect(() => {
    if (data && !ready) { setDraft(data.content); lastSaved.current = data.content; setReady(true); }
  }, [data, ready]);

  const save = useMutation({
    mutationFn: (content: string) => notesApi.save(projectId, content),
    onSuccess: (res) => { lastSaved.current = res.content; qc.setQueryData(['project-note', projectId], res); },
  });

  useEffect(() => {
    if (!ready) return;
    if (draft === lastSaved.current) return;
    const id = setTimeout(() => save.mutate(draft), 800);
    return () => clearTimeout(id);
  }, [draft, ready]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <Empty><Loader size={14} className="animate-spin" /></Empty>;

  return (
    <div className="flex flex-col h-full min-h-0 p-3">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] text-slate-500">Private to you · autosaves · shared across this project</span>
        <span className="text-[10px] text-slate-500">{save.isPending ? 'Saving…' : draft !== lastSaved.current ? 'Unsaved' : <span className="inline-flex items-center gap-0.5 text-emerald-400"><Check size={11} /> Saved</span>}</span>
      </div>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Store login credentials, scratch notes, anything useful…"
        className="flex-1 w-full resize-none rounded-md bg-slate-950/60 border border-white/10 p-2.5 text-xs text-slate-200 leading-relaxed focus:outline-none focus:border-amber-400/40"
      />
    </div>
  );
}
