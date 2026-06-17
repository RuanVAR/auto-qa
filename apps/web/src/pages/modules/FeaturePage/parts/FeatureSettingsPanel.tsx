import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Shield, Loader2, Tag, User } from 'lucide-react';
import { featuresApi, projectsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

/**
 * FeatureSettingsPanel
 * --------------------
 * Per-feature settings tab on FeaturePage. Currently scoped to the new
 * automated-testing toggle, but built as a panel so additional feature-
 * level toggles can drop in without restructuring.
 *
 * Why automated is opt-in: many features describe behaviour that only a
 * human can verify (UX flows, exploratory checks, accessibility). Allowing
 * AUTOMATED on those by default would surface false-positive Playwright
 * "errors" to QA when the test never had a chance of working. Per product
 * spec, automated testing is OFF for every feature until an ORG_ADMIN
 * explicitly turns it on here.
 *
 * The toggle calls featuresApi.update, then invalidates feature queries
 * so the Run-modal gating on TestEditorPage + FeaturePage reflects the
 * new state immediately.
 */

interface Props {
  featureId: string;
  projectId: string;
  canManage: boolean;
  /** Name shown in toast messages. */
  featureName: string;
  /** Current feature tags (user-editable labels for filtering). */
  tags: string[];
  /** Currently assigned developer (null when unassigned). */
  developer: { id: string; name: string | null; email: string } | null;
}

type ProjectMemberRow = { userId: string; role: string; user: { id: string; name: string | null; email: string } };

export function FeatureSettingsPanel({
  featureId,
  projectId,
  canManage,
  featureName,
  tags,
  developer,
}: Props) {
  const qc = useQueryClient();

  // ── Tags ──────────────────────────────────────────────────────────────
  const [tagsInput, setTagsInput] = useState(tags.join(', '));
  useEffect(() => { setTagsInput(tags.join(', ')); }, [tags]);
  const parsedTags = () =>
    Array.from(new Set(tagsInput.split(',').map((t) => t.trim()).filter(Boolean))).slice(0, 10);
  const tagsDirty = parsedTags().join(',') !== [...tags].join(',');

  const tagsMut = useMutation({
    mutationFn: (next: string[]) => featuresApi.update(featureId, { tags: next }),
    onSuccess: () => {
      toast.success('Tags updated', `“${featureName}” tags saved.`);
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          ['feature', 'features', 'features-by-project', 'features-browse', 'feature-tags']
            .includes(q.queryKey[0] as string),
      });
    },
    onError: (err) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Update failed';
      toast.error('Could not save tags', msg);
    },
  });

  // ── Assigned developer ─────────────────────────────────────────────────
  const { data: members = [] } = useQuery<ProjectMemberRow[]>({
    queryKey: ['project-members', projectId],
    queryFn: () => projectsApi.listMembers(projectId),
    enabled: !!projectId && canManage,
    staleTime: 60_000,
  });
  const devMut = useMutation({
    mutationFn: (developerId: string | null) => featuresApi.update(featureId, { developerId }),
    onSuccess: (_d, developerId) => {
      toast.success(developerId ? 'Developer assigned' : 'Developer unassigned');
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          ['feature', 'features', 'features-by-project', 'features-browse'].includes(q.queryKey[0] as string),
      });
    },
    onError: (err) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Update failed';
      toast.error('Could not assign developer', msg);
    },
  });
  const devLabel = (m: ProjectMemberRow) => m.user.name?.trim() || m.user.email;

  return (
    <div
      className="rounded-2xl p-5 space-y-5"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
      }}
    >
      <div className="flex items-center gap-2">
        <Shield size={16} style={{ color: 'var(--accent-400)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.92)' }}>
          Feature settings
        </h3>
      </div>

      {/* Tags ------------------------------------------------------------- */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          <Tag size={14} style={{ color: 'var(--accent-400)' }} />
          <h4 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Tags</h4>
        </div>
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
          Comma-separated labels for filtering this feature across the catalogue (max 10).
        </p>
        <input
          value={tagsInput}
          onChange={(e) => setTagsInput(e.target.value)}
          disabled={!canManage || tagsMut.isPending}
          placeholder="e.g. login, auth, smoke, regression"
          className="mt-2 w-full text-sm rounded-lg"
        />
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {tags.map((t) => (
              <span
                key={t}
                className="text-[11px] px-2 py-0.5 rounded-full"
                style={{ background: 'rgba(var(--accent-rgb),0.14)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.30)' }}
              >
                {t}
              </span>
            ))}
          </div>
        )}
        {canManage && (
          <button
            type="button"
            onClick={() => tagsMut.mutate(parsedTags())}
            disabled={!tagsDirty || tagsMut.isPending}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-40"
            style={{ background: 'rgba(var(--accent-rgb),0.20)', border: '1px solid rgba(var(--accent-rgb),0.45)', color: 'var(--accent-300)' }}
          >
            {tagsMut.isPending && <Loader2 size={11} className="animate-spin" />}
            Save tags
          </button>
        )}
      </div>

      {/* Assigned developer --------------------------------------------- */}
      <div
        className="rounded-xl p-4"
        style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="flex items-center gap-2">
          <User size={14} style={{ color: 'var(--accent-400)' }} />
          <h4 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>Assigned developer</h4>
          {devMut.isPending && <Loader2 size={12} className="animate-spin" style={{ color: 'rgba(238,238,248,0.5)' }} />}
        </div>
        <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
          The project member responsible for this feature. Drives per-developer analytics and ClickUp auto-assign.
        </p>
        {canManage ? (
          <select
            value={developer?.id ?? ''}
            disabled={devMut.isPending}
            onChange={(e) => devMut.mutate(e.target.value || null)}
            className="mt-2 w-full text-sm rounded-lg"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {devLabel(m)}{m.role ? ` · ${m.role}` : ''}
              </option>
            ))}
          </select>
        ) : (
          <div className="mt-2 text-sm" style={{ color: 'rgba(238,238,248,0.8)' }}>
            {developer ? (developer.name?.trim() || developer.email) : <span style={{ color: 'rgba(238,238,248,0.4)' }}>Unassigned</span>}
          </div>
        )}
      </div>
    </div>
  );
}
