import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Check, X, ChevronDown, ChevronUp } from 'lucide-react';

const LABEL = 'text-[10px] font-semibold uppercase tracking-widest';
const COLLAPSE_LEN = 320;
const COLLAPSED_MAX_H = 132;

export interface MarkdownDescriptionProps {
  value: string | null | undefined;
  /** Persist the new value (null = cleared). May be async; the editor shows a saving state until it resolves. */
  onSave: (next: string | null) => void | Promise<void>;
  canManage: boolean;
  label?: string;
  placeholder?: string;
  emptyHint?: string;
  collapseLen?: number;
  /** RGB triple used for the fade overlay over collapsed content — match the surrounding panel bg. */
  panelRgb?: string;
  /** Suppress the internal label (e.g. when the host already renders a section heading). */
  hideLabel?: boolean;
}

/**
 * A description block that renders Markdown (GFM: tables, strikethrough, code,
 * images, blockquotes), collapses long content behind a Show more/less toggle,
 * and offers an inline edit → textarea → save flow for users who can manage it.
 * Persistence is delegated to `onSave` so the same component serves features,
 * tests, or anything else.
 */
export function MarkdownDescription({
  value,
  onSave,
  canManage,
  label = 'Description',
  placeholder = 'Describe this… Markdown supported (**bold**, lists, `code`, tables).',
  emptyHint = 'Add a description…',
  collapseLen = COLLAPSE_LEN,
  panelRgb = '20,20,28',
  hideLabel = false,
}: MarkdownDescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [value, editing]);

  const text = (value ?? '').trim();
  const isLong = text.length > collapseLen;

  const handleSave = async () => {
    setSaving(true);
    setError(false);
    try {
      await onSave(draft.trim() || null);
      setEditing(false);
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="space-y-1.5">
        {!hideLabel && (
          <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
            {label}
          </p>
        )}
        {/** biome-ignore lint/a11y/noAutofocus: editor opens on explicit user click */}
        <textarea
          autoFocus
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-xl px-3 py-2.5 text-sm leading-relaxed resize-y outline-none"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(var(--accent-rgb),0.25)',
            color: 'rgba(238,238,248,0.85)',
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px]" style={{ color: 'rgba(238,238,248,0.3)' }}>
            Markdown supported
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setDraft(value ?? '');
                setEditing(false);
                setError(false);
              }}
              disabled={saving}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg"
              style={{ color: 'rgba(238,238,248,0.5)' }}
            >
              <X size={12} /> Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-medium"
              style={{
                background: 'rgba(var(--accent-rgb),0.18)',
                color: 'var(--accent-300)',
                border: '1px solid rgba(var(--accent-rgb),0.3)',
              }}
            >
              <Check size={12} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {error && (
          <p className="text-[10px]" style={{ color: '#f87171' }}>
            Couldn’t save. Try again.
          </p>
        )}
      </div>
    );
  }

  if (!text) {
    if (!canManage) return null;
    return (
      <div className="space-y-1.5">
        {!hideLabel && (
          <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
            {label}
          </p>
        )}
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl w-full transition-colors hover:bg-white/[0.04]"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px dashed rgba(255,255,255,0.12)',
            color: 'rgba(238,238,248,0.4)',
          }}
        >
          <Pencil size={12} /> {emptyHint}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 group">
      <div className="flex items-center justify-between">
        {!hideLabel && (
          <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
            {label}
          </p>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="flex items-center gap-1 text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'rgba(238,238,248,0.45)' }}
          >
            <Pencil size={10} /> Edit
          </button>
        )}
      </div>
      <div className="relative">
        <div
          className="prose prose-invert prose-sm max-w-none text-sm leading-relaxed prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:my-1.5"
          style={{
            color: 'rgba(238,238,248,0.6)',
            maxHeight: isLong && !expanded ? COLLAPSED_MAX_H : undefined,
            overflow: isLong && !expanded ? 'hidden' : undefined,
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
        </div>
        {isLong && !expanded && (
          <div
            className="absolute inset-x-0 bottom-0 h-10 pointer-events-none"
            style={{
              background: `linear-gradient(to bottom, rgba(${panelRgb},0), rgba(${panelRgb},0.97))`,
            }}
          />
        )}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-1 text-[10px] font-medium"
          style={{ color: 'var(--accent-300)' }}
        >
          {expanded ? (
            <>
              <ChevronUp size={11} /> Show less
            </>
          ) : (
            <>
              <ChevronDown size={11} /> Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}
