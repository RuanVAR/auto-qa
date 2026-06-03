import { useQuery } from '@tanstack/react-query';
import { pluginsApi } from '@/lib/api';

// ─── Shared ClickUp feature-status helpers ───────────────────────────────────
// One source of truth for "what statuses can this feature's linked ClickUp task
// move to, and what is it on now". The available options are read live from the
// task's own list, so they reflect each space/list's custom status set.

export interface ClickUpStatusOption {
  status: string;
  color?: string;
  type?: string;
}

export interface FeatureClickUpStatus {
  linked: boolean;
  externalId: string;
  externalUrl: string;
  externalTitle: string | null;
  currentStatus: string;
  currentStatusColor?: string;
  statuses: ClickUpStatusOption[];
  epic: { name: string; color?: string } | null;
}

const FALLBACK_COLOR = '#94a3b8';

/**
 * Live status + available transitions for a feature's linked ClickUp task.
 * 404 (no linked task) is expected — the query just resolves to `linked:false`
 * via the error path, so callers should treat `isError` / `!data?.linked` as
 * "no ClickUp control to show".
 */
export function useFeatureClickUpStatus(featureId?: string | null, enabled = true) {
  return useQuery<FeatureClickUpStatus>({
    queryKey: ['feature-clickup-status', featureId],
    queryFn: () => pluginsApi.getFeatureClickUpStatus(featureId!),
    enabled: !!featureId && enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/**
 * Best-effort guess of the list's "QA failed" status so the test-fail flow can
 * pre-select it. Matches common namings without assuming any single list has
 * it — returns null when nothing fits and the caller leaves the picker blank.
 */
export function findQaFailedStatus(statuses: ClickUpStatusOption[]): ClickUpStatusOption | null {
  const lc = (s: ClickUpStatusOption) => s.status.toLowerCase();
  return (
    statuses.find((s) => /qa.*fail|fail.*qa/.test(lc(s))) ??
    statuses.find((s) => lc(s).includes('failed')) ??
    statuses.find((s) => lc(s).includes('reject')) ??
    null
  );
}

/**
 * Inline labelled `<select>` of a feature's ClickUp statuses. `value === ''`
 * means "leave the ticket unchanged". Renders nothing when the feature has no
 * linked task (or while the link probe is still resolving).
 */
export function ClickUpStatusSelect({
  data,
  value,
  onChange,
  label = 'Update ClickUp status',
  hint,
  disabled,
}: {
  data: FeatureClickUpStatus | undefined;
  value: string;
  onChange: (status: string) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
}) {
  if (!data?.linked) return null;
  const selectedColor =
    data.statuses.find((s) => s.status === value)?.color ??
    (value ? FALLBACK_COLOR : data.currentStatusColor ?? FALLBACK_COLOR);

  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.65)' }}>
        {label}
      </label>
      <div className="flex items-center gap-2">
        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: selectedColor }} />
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-100 capitalize focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50"
        >
          <option value="">Leave unchanged ({data.currentStatus || 'unknown'})</option>
          {data.statuses.map((s) => {
            const isCurrent = s.status.toLowerCase() === data.currentStatus.toLowerCase();
            return (
              <option key={s.status} value={s.status}>
                {s.status}
                {isCurrent ? ' (current)' : ''}
              </option>
            );
          })}
        </select>
      </div>
      <p className="text-[11px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
        {hint ?? 'Writes to the linked ClickUp task on submit.'}
      </p>
    </div>
  );
}
