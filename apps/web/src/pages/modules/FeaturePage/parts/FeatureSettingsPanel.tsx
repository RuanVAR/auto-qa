import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Zap, Lock, Shield, Loader2, Tag, User } from 'lucide-react';
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
  automatedTestingEnabled: boolean;
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
  automatedTestingEnabled,
  canManage,
  featureName,
  tags,
  developer,
}: Props) {
  const qc = useQueryClient();
  // Local mirror so the switch feels responsive — the mutation is the
  // source of truth and snaps the value back on error.
  const [optimistic, setOptimistic] = useState(automatedTestingEnabled);
  useEffect(() => {
    setOptimistic(automatedTestingEnabled);
  }, [automatedTestingEnabled]);

  const updateMut = useMutation({
    mutationFn: (next: boolean) =>
      featuresApi.update(featureId, { automatedTestingEnabled: next }),
    onSuccess: (_d, next) => {
      toast.success(
        next ? 'Automated testing enabled' : 'Automated testing disabled',
        next
          ? `“${featureName}” can now run Preview, automated solo runs, and automated feature runs.`
          : `“${featureName}” will only allow manual testing until re-enabled.`,
      );
      // Refresh anything that displays this flag — feature detail, the
      // module-level list (for an at-a-glance badge), and any test
      // editor pages that gate their Run modal on it.
      qc.invalidateQueries({
        predicate: (q) =>
          Array.isArray(q.queryKey) &&
          ['feature', 'features', 'features-by-project', 'tests-for-feature']
            .includes(q.queryKey[0] as string),
      });
    },
    onError: (err, next) => {
      // Snap back on failure — the optimistic flip was a lie.
      setOptimistic(!next);
      const msg =
        (err as { response?: { data?: { message?: string } }; message?: string })
          ?.response?.data?.message
        ?? (err as Error).message
        ?? 'Update failed';
      toast.error(msg);
    },
  });

  const onToggle = () => {
    if (!canManage || updateMut.isPending) return;
    const next = !optimistic;
    setOptimistic(next);
    updateMut.mutate(next);
  };

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

      {/* Automated testing toggle ---------------------------------------- */}
      <div
        className="rounded-xl p-4"
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="w-9 h-9 rounded-lg shrink-0 flex items-center justify-center"
            style={{
              background: optimistic ? 'rgba(var(--accent-rgb),0.20)' : 'rgba(148,163,184,0.12)',
            }}
          >
            {optimistic ? (
              <Zap size={16} style={{ color: 'var(--accent-300)' }} />
            ) : (
              <Lock size={16} style={{ color: '#94a3b8' }} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-semibold" style={{ color: 'rgba(238,238,248,0.90)' }}>
                Automation
              </h4>
              <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider"
                style={{
                  background: optimistic ? 'rgba(52,211,153,0.12)' : 'rgba(148,163,184,0.12)',
                  color: optimistic ? '#34d399' : '#94a3b8',
                  border: `1px solid ${optimistic ? 'rgba(52,211,153,0.28)' : 'rgba(148,163,184,0.24)'}`,
                }}
              >
                {optimistic ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(238,238,248,0.55)' }}>
              When enabled, this feature can run Preview, automated solo runs,
              and automated feature runs. Tests can specify Playwright steps,
              selectors, and assertions. Live execution streams to the live
              browser canvas as it happens.
            </p>
            <p className="text-xs mt-1.5 leading-relaxed" style={{ color: 'rgba(238,238,248,0.45)' }}>
              When disabled, the Test mode picker defaults to <strong>Manual</strong>
              and the Automated option is hidden — testers walk through steps
              by hand. Existing automated runs already in flight continue
              uninterrupted.
            </p>
            <p className="text-xs mt-2 leading-relaxed flex items-start gap-1.5" style={{ color: 'rgba(238,238,248,0.45)' }}>
              <Shield size={12} style={{ flexShrink: 0, marginTop: 2, color: '#94a3b8' }} />
              <span>
                Automated runs also need an <strong>automation-enabled environment</strong> —
                turn on “Supports automation” for the target env in Environment settings. Both
                gates must be on for a feature to run automated tests.
              </span>
            </p>
            {!canManage && (
              <p className="text-[11px] mt-2 italic" style={{ color: 'rgba(238,238,248,0.4)' }}>
                Only an organisation admin can change this setting.
              </p>
            )}
          </div>

          {/* Toggle switch — disabled (visually + functionally) for non-admins. */}
          <button
            type="button"
            role="switch"
            aria-checked={optimistic}
            disabled={!canManage || updateMut.isPending}
            onClick={onToggle}
            className="relative rounded-full transition-colors shrink-0 self-start mt-0.5"
            style={{
              width: 44,
              height: 24,
              background: optimistic ? 'var(--accent)' : 'rgba(255,255,255,0.10)',
              border: `1px solid ${optimistic ? 'rgba(var(--accent-rgb),0.45)' : 'rgba(255,255,255,0.10)'}`,
              cursor: canManage && !updateMut.isPending ? 'pointer' : 'not-allowed',
              opacity: canManage ? 1 : 0.55,
            }}
          >
            <div
              className="absolute top-0.5 rounded-full bg-white transition-all"
              style={{
                width: 18,
                height: 18,
                left: optimistic ? 22 : 2,
                boxShadow: '0 2px 4px rgba(0,0,0,0.30)',
              }}
            />
            {updateMut.isPending && (
              <Loader2
                size={11}
                className="animate-spin absolute"
                style={{
                  top: 5.5,
                  left: optimistic ? 6 : 26,
                  color: optimistic ? '#fff' : '#94a3b8',
                }}
              />
            )}
          </button>
        </div>
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
