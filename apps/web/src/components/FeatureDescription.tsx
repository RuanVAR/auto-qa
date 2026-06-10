import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Pencil, Check, X, ChevronDown, ChevronUp } from 'lucide-react';
import { featuresApi } from '@/lib/api';

const LABEL = 'text-[10px] font-semibold uppercase tracking-widest';
// Collapse anything longer than this (chars) behind a "Show more" toggle.
const COLLAPSE_LEN = 320;
const COLLAPSED_MAX_H = 132;
const PANEL_BG = '20,20,28';

/**
 * Feature description: markdown-rendered, expandable when long, inline-editable
 * by users who can manage the feature. Saves through PUT /features/:id.
 */
export function FeatureDescription({
  featureId,
  description,
  canManage,
}: {
  featureId: string;
  description: string | null | undefined;
  canManage: boolean;
}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(description ?? '');
  }, [description, editing]);

  const save = useMutation({
    mutationFn: (content: string) =>
      featuresApi.update(featureId, { description: content.trim() || null }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feature', featureId] });
      setEditing(false);
    },
  });

  const text = (description ?? '').trim();
  const isLong = text.length > COLLAPSE_LEN;

  if (editing) {
    return (
      <div className="space-y-1.5">
        <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
          Description
        </p>
        {/** biome-ignore lint/a11y/noAutofocus: editor opens on explicit user click */}
        <textarea
          autoFocus
          rows={8}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Describe this feature… Markdown supported (**bold**, lists, `code`, tables)."
          className="w-full rounded-xl px-3 py-2.5 text-xs leading-relaxed resize-y outline-none"
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
                setDraft(description ?? '');
                setEditing(false);
              }}
              disabled={save.isPending}
              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg"
              style={{ color: 'rgba(238,238,248,0.5)' }}
            >
              <X size={12} /> Cancel
            </button>
            <button
              type="button"
              onClick={() => save.mutate(draft)}
              disabled={save.isPending}
              className="flex items-center gap-1 text-[11px] px-2.5 py-1 rounded-lg font-medium"
              style={{
                background: 'rgba(var(--accent-rgb),0.18)',
                color: 'var(--accent-300)',
                border: '1px solid rgba(var(--accent-rgb),0.3)',
              }}
            >
              <Check size={12} /> {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
        {save.isError && (
          <p className="text-[10px]" style={{ color: '#f87171' }}>
            Couldn’t save the description. Try again.
          </p>
        )}
      </div>
    );
  }

  if (!text) {
    if (!canManage) return null;
    return (
      <div className="space-y-1.5">
        <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
          Description
        </p>
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
          <Pencil size={12} /> Add a description…
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 group">
      <div className="flex items-center justify-between">
        <p className={LABEL} style={{ color: 'rgba(238,238,248,0.3)' }}>
          Description
        </p>
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
          className="prose prose-invert prose-sm max-w-none text-xs leading-relaxed"
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
              background: `linear-gradient(to bottom, rgba(${PANEL_BG},0), rgba(${PANEL_BG},0.97))`,
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
