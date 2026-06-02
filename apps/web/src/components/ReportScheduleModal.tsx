import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calendar, Clock, Mail, Sparkles, X, UserPlus } from 'lucide-react';
import { reportSchedulesApi, reportsApi, modulesApi, featuresApi } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toast';

/**
 * ReportScheduleModal
 * -------------------
 * Create / edit a scheduled report. Single modal for both flows — when
 * `schedule` prop is passed it pre-fills + sends a PATCH; otherwise it
 * sends a POST. The frequency picker reveals the appropriate day field
 * (dayOfWeek for WEEKLY, dayOfMonth for MONTHLY) and the scope picker
 * reveals a feature/module dropdown when scope != PROJECT.
 *
 * The recipients chip input mirrors GenerateReportButton's: Enter / comma
 * adds, Backspace on empty removes the last. Pre-fills from the project's
 * default-recipients roster (ORG_ADMIN + project OWNER/TECH_LEAD/MANAGER)
 * on first open, same UX as the ad-hoc generate modal.
 */

type ReportScope = 'PROJECT' | 'MODULE' | 'FEATURE';
type ReportFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface ScheduleRow {
  id: string;
  name: string;
  scope: ReportScope;
  scopeId: string | null;
  phaseId?: string | null;
  frequency: ReportFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  sendTime: string;
  recipients: string[];
  includeCharts: boolean;
  lastSentAt: string | null;
  createdAt: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  projectId: string;
  /** When present, modal is in edit mode and pre-fills from this row. */
  schedule?: ScheduleRow | null;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ReportScheduleModal({ open, onClose, projectId, schedule }: Props) {
  const qc = useQueryClient();
  const isEdit = !!schedule;

  // ── Form state ──────────────────────────────────────────────────────────
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ReportScope>('PROJECT');
  const [scopeId, setScopeId] = useState<string>('');
  const [frequency, setFrequency] = useState<ReportFrequency>('WEEKLY');
  const [dayOfWeek, setDayOfWeek] = useState<number>(1); // Monday
  const [dayOfMonth, setDayOfMonth] = useState<number>(1);
  const [sendTime, setSendTime] = useState<string>('09:00');
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [emailInputError, setEmailInputError] = useState<string | null>(null);
  const [includeCharts, setIncludeCharts] = useState(true);

  // ── Pickers data ────────────────────────────────────────────────────────
  const { data: modules = [] } = useQuery<Array<{ id: string; name: string }>>({
    queryKey: ['modules', projectId],
    queryFn: () => modulesApi.list(projectId),
    enabled: open && !!projectId,
    staleTime: 60_000,
  });
  const { data: features = [] } = useQuery<Array<{ id: string; name: string; moduleId: string }>>({
    queryKey: ['features-by-project', projectId],
    queryFn: () => featuresApi.listByProject(projectId),
    enabled: open && !!projectId,
    staleTime: 60_000,
  });
  const { data: defaultRecipientsData } = useQuery({
    queryKey: ['report-default-recipients', projectId],
    queryFn: () => reportsApi.defaultRecipients(projectId),
    enabled: open && !!projectId,
    staleTime: 5 * 60_000,
  });

  // Auto-populate recipients from the default roster the first time the
  // modal opens for a NEW schedule. Don't overwrite an edit's recipients
  // (those are the user's previous choice) or a user's in-flight edits.
  const [hasAutoPopulated, setHasAutoPopulated] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (isEdit || hasAutoPopulated) return;
    if (recipients.length > 0) return;
    if (defaultRecipientsData && defaultRecipientsData.length > 0) {
      setRecipients(defaultRecipientsData.map((r) => r.email));
      setHasAutoPopulated(true);
    }
  }, [open, isEdit, hasAutoPopulated, defaultRecipientsData, recipients.length]);

  // ── Pre-fill on edit / reset on close ───────────────────────────────────
  useEffect(() => {
    if (!open) {
      setEmailInput('');
      setEmailInputError(null);
      setHasAutoPopulated(false);
      return;
    }
    if (schedule) {
      setName(schedule.name);
      setScope(schedule.scope);
      setScopeId(schedule.scopeId ?? '');
      setFrequency(schedule.frequency);
      setDayOfWeek(schedule.dayOfWeek ?? 1);
      setDayOfMonth(schedule.dayOfMonth ?? 1);
      setSendTime(schedule.sendTime);
      setRecipients(schedule.recipients);
      setIncludeCharts(schedule.includeCharts);
    } else {
      // Fresh form — sensible defaults that match the most common
      // "Monday morning digest" pattern.
      setName('');
      setScope('PROJECT');
      setScopeId('');
      setFrequency('WEEKLY');
      setDayOfWeek(1);
      setDayOfMonth(1);
      setSendTime('09:00');
      setRecipients([]);
      setIncludeCharts(true);
    }
  }, [open, schedule]);

  // ── Mutations ───────────────────────────────────────────────────────────
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {
        name: name.trim(),
        scope,
        scopeId: scope === 'PROJECT' ? null : scopeId || null,
        frequency,
        sendTime,
        recipients,
        includeCharts,
      };
      // Only send dayOfWeek/dayOfMonth for the frequency that needs them —
      // the API's validator rejects WEEKLY without dayOfWeek and MONTHLY
      // without dayOfMonth, and ignores them otherwise.
      if (frequency === 'WEEKLY') body.dayOfWeek = dayOfWeek;
      if (frequency === 'MONTHLY') body.dayOfMonth = dayOfMonth;

      return isEdit
        ? reportSchedulesApi.update(schedule!.id, body)
        : reportSchedulesApi.create(projectId, body);
    },
    onSuccess: () => {
      toast.success(
        isEdit ? 'Schedule updated' : 'Schedule created',
        isEdit
          ? `“${name.trim()}” will use the new settings on its next tick.`
          : `“${name.trim()}” will send at ${sendTime} — first run on the next matching ${frequency.toLowerCase()} day.`,
      );
      qc.invalidateQueries({ queryKey: ['report-schedules', projectId] });
      onClose();
    },
    onError: (err: unknown) => {
      const data = (err as { response?: { data?: { message?: string | string[] } } })?.response?.data;
      const raw = data?.message;
      const msg = Array.isArray(raw) ? raw.join(' · ') : raw ?? 'Try again.';
      toast.error(isEdit ? 'Update failed' : 'Create failed', msg);
    },
  });

  // ── Helpers ─────────────────────────────────────────────────────────────
  function tryAddEmail() {
    const candidate = emailInput.trim().toLowerCase();
    if (!candidate) return;
    if (!EMAIL_REGEX.test(candidate)) {
      setEmailInputError('Not a valid email');
      return;
    }
    if (recipients.includes(candidate)) {
      setEmailInputError('Already added');
      return;
    }
    setRecipients([...recipients, candidate]);
    setEmailInput('');
    setEmailInputError(null);
  }
  function removeRecipient(email: string) {
    setRecipients(recipients.filter((e) => e !== email));
  }

  // Feature dropdown shows every feature in the project — scope picker
  // only activates FEATURE mode when the user explicitly wants per-feature,
  // so flooding them with the full list is the expected UX.
  const featureOptions = features;

  // ── Validation: derive whether submit is allowed ────────────────────────
  const needsScopeId = scope !== 'PROJECT';
  const invalidTime = !/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime);
  const noName = !name.trim();
  const noRecipients = recipients.length === 0;
  const noScopeId = needsScopeId && !scopeId;
  const submitDisabled = noName || noRecipients || invalidTime || noScopeId;

  return (
    <Modal open={open} onClose={onClose} title={isEdit ? 'Edit schedule' : 'New schedule'}>
      <div className="space-y-4">
        {/* ── Name ── */}
        <div>
          <Label>Name</Label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Weekly QA digest"
            maxLength={80}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.90)',
            }}
          />
        </div>

        {/* ── Scope ── */}
        <div>
          <Label>Scope</Label>
          <div className="flex gap-2">
            {(['PROJECT', 'MODULE', 'FEATURE'] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => { setScope(s); setScopeId(''); }}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all"
                style={scope === s ? {
                  background: 'rgba(var(--accent-rgb),0.18)',
                  border: '1px solid rgba(var(--accent-rgb),0.40)',
                  color: 'var(--accent-300)',
                } : {
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(238,238,248,0.55)',
                }}
              >
                {s.charAt(0) + s.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {scope === 'MODULE' && (
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm mt-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: scopeId ? 'rgba(238,238,248,0.90)' : 'rgba(238,238,248,0.45)',
              }}
            >
              <option value="">Select a module…</option>
              {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          )}
          {scope === 'FEATURE' && (
            <select
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm mt-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: scopeId ? 'rgba(238,238,248,0.90)' : 'rgba(238,238,248,0.45)',
              }}
            >
              <option value="">Select a feature…</option>
              {featureOptions.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          )}
        </div>

        {/* ── Frequency + day ── */}
        <div>
          <Label>Cadence</Label>
          <div className="flex gap-2 mb-2">
            {(['DAILY', 'WEEKLY', 'MONTHLY'] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFrequency(f)}
                className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-all"
                style={frequency === f ? {
                  background: 'rgba(56,189,248,0.18)',
                  border: '1px solid rgba(56,189,248,0.40)',
                  color: '#7dd3fc',
                } : {
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(238,238,248,0.55)',
                }}
              >
                <Calendar size={11} className="inline mr-1" /> {f.charAt(0) + f.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          {frequency === 'WEEKLY' && (
            <div className="flex gap-1 mb-2">
              {DAY_NAMES.map((d, i) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDayOfWeek(i)}
                  className="flex-1 rounded-lg px-2 py-1.5 text-[11px] font-medium transition-all"
                  style={dayOfWeek === i ? {
                    background: 'rgba(var(--accent-rgb),0.16)',
                    border: '1px solid rgba(var(--accent-rgb),0.38)',
                    color: 'var(--accent-300)',
                  } : {
                    background: 'rgba(255,255,255,0.04)',
                    border: '1px solid rgba(255,255,255,0.10)',
                    color: 'rgba(238,238,248,0.55)',
                  }}
                >
                  {d}
                </button>
              ))}
            </div>
          )}
          {frequency === 'MONTHLY' && (
            <div className="flex items-center gap-2 mb-2">
              <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>Day of month</span>
              <input
                type="number"
                min={1}
                max={28}
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Math.min(28, Math.max(1, parseInt(e.target.value || '1', 10))))}
                className="w-20 rounded-lg px-2 py-1.5 text-sm"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'rgba(238,238,248,0.90)',
                }}
              />
              <span className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
                (1–28 so it works in every month)
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Clock size={12} style={{ color: 'rgba(238,238,248,0.55)' }} />
            <span className="text-xs" style={{ color: 'rgba(238,238,248,0.65)' }}>at</span>
            <input
              type="text"
              placeholder="09:00"
              value={sendTime}
              onChange={(e) => setSendTime(e.target.value)}
              className="w-24 rounded-lg px-2 py-1.5 text-sm font-mono"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: `1px solid ${invalidTime ? 'rgba(239,68,68,0.40)' : 'rgba(255,255,255,0.10)'}`,
                color: 'rgba(238,238,248,0.90)',
              }}
            />
            <span className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              24-hour (HH:mm)
            </span>
          </div>
        </div>

        {/* ── Recipients ── */}
        <div>
          <Label>
            <Mail size={11} className="inline mr-1" />
            Recipients
            {defaultRecipientsData && hasAutoPopulated && (
              <span className="ml-2 normal-case" style={{ color: 'rgba(238,238,248,0.55)' }}>
                (pre-filled from project roles)
              </span>
            )}
          </Label>
          <div
            className="flex flex-wrap gap-1.5 p-2 rounded-md min-h-[42px]"
            style={{
              background: 'rgba(0,0,0,0.20)',
              border: '1px solid rgba(255,255,255,0.10)',
            }}
          >
            {recipients.map((email) => (
              <span
                key={email}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px]"
                style={{
                  background: 'rgba(var(--accent-rgb),0.18)',
                  border: '1px solid rgba(var(--accent-rgb),0.32)',
                  color: 'var(--accent-200)',
                }}
              >
                {email}
                <button
                  type="button"
                  onClick={() => removeRecipient(email)}
                  title={`Remove ${email}`}
                  className="opacity-70 hover:opacity-100"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
            <input
              type="email"
              value={emailInput}
              onChange={(e) => { setEmailInput(e.target.value); setEmailInputError(null); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  tryAddEmail();
                } else if (e.key === 'Backspace' && emailInput === '' && recipients.length > 0) {
                  removeRecipient(recipients[recipients.length - 1]);
                }
              }}
              onBlur={() => { if (emailInput.trim()) tryAddEmail(); }}
              placeholder={recipients.length === 0 ? 'Add an email and press Enter' : 'Add another…'}
              className="flex-1 min-w-[140px] bg-transparent outline-none text-xs"
              style={{ color: 'rgba(238,238,248,0.92)' }}
            />
          </div>
          {emailInputError && (
            <div className="text-[10px] mt-1" style={{ color: '#fca5a5' }}>{emailInputError}</div>
          )}
          {defaultRecipientsData && defaultRecipientsData.length > 0 && (
            <details className="text-[10px] mt-1.5" style={{ color: 'rgba(238,238,248,0.55)' }}>
              <summary className="cursor-pointer flex items-center gap-1">
                <UserPlus size={10} /> Default recipients ({defaultRecipientsData.length})
              </summary>
              <ul className="mt-1.5 pl-4 space-y-0.5">
                {defaultRecipientsData.map((r) => (
                  <li key={r.email}>
                    <span style={{ color: 'rgba(238,238,248,0.80)' }}>{r.email}</span>
                    <span className="ml-1.5">— {r.role}{r.name ? ` · ${r.name}` : ''}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>

        {/* ── Charts toggle ── */}
        <button
          type="button"
          onClick={() => setIncludeCharts((v) => !v)}
          className="w-full flex items-center gap-2 rounded-lg p-3 text-left"
          style={{
            background: includeCharts ? 'rgba(var(--accent-rgb),0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${includeCharts ? 'rgba(var(--accent-rgb),0.28)' : 'rgba(255,255,255,0.07)'}`,
          }}
        >
          <div
            className="w-4 h-4 rounded shrink-0 flex items-center justify-center text-[10px]"
            style={{
              background: includeCharts ? '#a855f7' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${includeCharts ? '#a855f7' : 'rgba(255,255,255,0.14)'}`,
              color: 'white',
            }}
          >
            {includeCharts ? '✓' : ''}
          </div>
          <div>
            <div className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>Include charts</div>
            <div className="text-[10px]" style={{ color: 'rgba(238,238,248,0.50)' }}>
              Pass-rate donut + trend graphs. Disable for a faster, text-only report.
            </div>
          </div>
        </button>

        {/* ── Actions ── */}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={save.isPending}
            disabled={submitDisabled}
            onClick={() => save.mutate()}
            title={
              noName ? 'Pick a name'
              : noScopeId ? `Select a ${scope.toLowerCase()}`
              : invalidTime ? 'Time must be HH:mm'
              : noRecipients ? 'Add at least one recipient'
              : undefined
            }
          >
            <Sparkles size={12} /> {isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <label
      className="text-[10px] uppercase tracking-wider mb-1.5 block"
      style={{ color: 'rgba(238,238,248,0.45)' }}
    >
      {children}
    </label>
  );
}
