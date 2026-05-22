import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Sparkles, X, Mail, UserPlus } from 'lucide-react';
import { reportsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { useActiveEnv } from '@/stores/activeEnvStore';

type ReportType = 'FEATURE' | 'MODULE' | 'PROJECT' | 'PHASE' | 'SESSION';

type Scope =
  | { type: 'PROJECT' }
  | { type: 'MODULE'; moduleId: string }
  | { type: 'FEATURE'; featureId: string; moduleId?: string }
  | { type: 'PHASE'; phaseId: string }
  | { type: 'SESSION'; workSessionId: string };

interface Props {
  projectId: string;
  /** What scope this button generates a report for. Drives which entity ID
   *  goes into the API call AND which sections default to ON in the modal. */
  scope: Scope;
  /** Optional human-readable scope title shown in the modal header chip. */
  scopeTitle?: string;
  /** Visual style of the trigger button. */
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  label?: string;
  /** Called after successful generation with the new report id. Useful for
   *  navigation or refreshing list queries beyond the default invalidation. */
  onGenerated?: (reportId: string) => void;
}

/**
 * Scope-aware "Generate Report" trigger.
 *
 * Lives in the page header at every level (project / module / feature). The
 * dropdown / modal opens with sensible section defaults based on scope:
 *   - PROJECT scope → Project summary ON
 *   - MODULE  scope → Feature + Project summary ON
 *   - FEATURE scope → Session + Feature summary ON
 *
 * Replaces the previous pattern of bundling generate UX inside the full
 * ReportsCard. Lets module/feature pages drop the table entirely (per the
 * UX simplification: "report viewing is project-only; generate from anywhere").
 */
export function GenerateReportButton({
  projectId,
  scope,
  scopeTitle,
  variant = 'primary',
  size = 'sm',
  label = 'Generate Report',
  onGenerated,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant={variant} size={size} onClick={() => setOpen(true)}>
        <FileText size={12} /> {label}
      </Button>
      {open && (
        <GenerateReportModal
          open={open}
          onClose={() => setOpen(false)}
          projectId={projectId}
          scope={scope}
          scopeTitle={scopeTitle}
          initialEmailEnabled={false}
          onGenerated={(id) => {
            setOpen(false);
            onGenerated?.(id);
          }}
        />
      )}
    </>
  );
}

// ─── Modal ──────────────────────────────────────────────────────────────────

function GenerateReportModal({
  open, onClose, projectId, scope, scopeTitle, initialEmailEnabled = false, onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  scope: Scope;
  scopeTitle?: string;
  /** When true (e.g. WorkSessionBadge "Generate and email"), recipients UI starts open. */
  initialEmailEnabled?: boolean;
  onGenerated: (reportId: string) => void;
}) {
  const qc = useQueryClient();
  const activeEnvId = useActiveEnv(projectId);
  const isSessionScope = scope.type === 'SESSION';
  // The per-test list only applies to scopes that render one.
  const showTestListToggle =
    scope.type === 'FEATURE' || scope.type === 'MODULE' || scope.type === 'SESSION';

  // Section defaults driven by scope — what users typically want.
  const [includeSession, setIncludeSession] = useState(
    scope.type === 'FEATURE' || scope.type === 'SESSION',
  );
  const [includeFeature, setIncludeFeature] = useState(
    scope.type !== 'PROJECT' && scope.type !== 'SESSION',
  );
  const [includeProject, setIncludeProject] = useState(
    scope.type === 'PROJECT' || scope.type === 'MODULE',
  );
  // Per-test pass/fail/bug list — on by default.
  const [includeTests, setIncludeTests] = useState(true);

  // Email-on-generate state. Off by default — user opts in. Enabling fetches
  // ORG_ADMIN + project MANAGER/OWNER/TECH_LEAD as a starting roster.
  const [emailEnabled, setEmailEnabled] = useState(initialEmailEnabled);
  const [recipients, setRecipients] = useState<string[]>([]);
  const [emailInput, setEmailInput] = useState('');
  const [emailInputError, setEmailInputError] = useState<string | null>(null);
  const [additionalText, setAdditionalText] = useState('');

  const { data: defaultRecipientsData } = useQuery({
    queryKey: ['report-default-recipients', projectId],
    queryFn: () => reportsApi.defaultRecipients(projectId),
    enabled: emailEnabled && !!projectId,
    staleTime: 5 * 60_000, // recipients don't change often
  });

  // Auto-populate recipients the FIRST time the toggle is flipped on.
  // Don't clobber the user's edits if they toggle off then back on.
  const [hasAutoPopulated, setHasAutoPopulated] = useState(false);
  useEffect(() => {
    if (emailEnabled && defaultRecipientsData && !hasAutoPopulated) {
      setRecipients(defaultRecipientsData.map((r) => r.email));
      setHasAutoPopulated(true);
    }
  }, [emailEnabled, defaultRecipientsData, hasAutoPopulated]);

  useEffect(() => {
    if (!open) {
      setEmailInput('');
      setEmailInputError(null);
      setHasAutoPopulated(false);
      setRecipients([]);
      setIncludeTests(true);
      setAdditionalText('');
      return;
    }
    setEmailEnabled(initialEmailEnabled);
  }, [open, initialEmailEnabled]);

  const reportType: ReportType = scope.type;

  const gen = useMutation({
    mutationFn: () => {
      if (scope.type === 'SESSION') {
        return reportsApi.generate(projectId, {
          type: 'SESSION',
          workSessionId: scope.workSessionId,
          includeSession: true,
          includeFeature: false,
          includeProject: false,
          includeTests,
          recipientEmails: emailEnabled ? recipients : undefined,
          additionalText: additionalText.trim() || undefined,
        });
      }
      return reportsApi.generate(projectId, {
        type: reportType,
        featureId: scope.type === 'FEATURE' ? scope.featureId : undefined,
        moduleId:  scope.type === 'MODULE'  ? scope.moduleId
                   : scope.type === 'FEATURE' ? scope.moduleId
                   : undefined,
        phaseId:   scope.type === 'PHASE' ? scope.phaseId : undefined,
        environmentId: activeEnvId ?? undefined,
        includeSession,
        includeFeature,
        includeProject,
        includeTests,
        recipientEmails: emailEnabled ? recipients : undefined,
        additionalText: additionalText.trim() || undefined,
      });
    },
    onSuccess: (data: { report: { id: string; title: string } }) => {
      const wasEmailed = emailEnabled && recipients.length > 0;
      toast.success(
        wasEmailed ? 'Report generated and sent' : 'Report generated',
        wasEmailed ? `${data.report.title} · sent to ${recipients.length} recipient${recipients.length === 1 ? '' : 's'}` : data.report.title,
      );
      // Refresh both the project Reports tab AND any LatestReportCard mounted nearby.
      qc.invalidateQueries({ queryKey: ['reports', projectId] });
      qc.invalidateQueries({ queryKey: ['report-latest', projectId] });
      onGenerated(data.report.id);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Generation failed', typeof msg === 'string' ? msg : 'Try again in a moment.');
    },
  });

  const noSectionsSelected = isSessionScope
    ? false
    : !includeSession && !includeFeature && !includeProject;
  const emailModeButNoRecipients = emailEnabled && recipients.length === 0;
  const submitLabel = emailEnabled && recipients.length > 0 ? 'Generate & Send' : 'Generate';

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

  return (
    <Modal open={open} onClose={onClose} title="Generate report">
      <div className="space-y-4">
        <div className="rounded-lg p-3 text-xs"
             style={{ background: 'rgba(168,85,247,0.10)', border: '1px solid rgba(168,85,247,0.30)', color: '#c4b5fd' }}>
          <strong>Scope:</strong> {reportType}
          {scopeTitle ? ` · ${scopeTitle}` : ''}
          {isSessionScope
            ? ' · Current QA work session'
            : activeEnvId ? ' · Filtered by active env' : ' · All environments'}
        </div>

        {!isSessionScope && (
          <div>
            <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                   style={{ color: 'rgba(238,238,248,0.45)' }}>
              Sections
            </label>
            <div className="space-y-1.5">
              <CheckRow checked={includeSession} onChange={setIncludeSession}
                        label="Session testing stats"
                        hint="Steps executed in current session, pass/fail, duration" />
              <CheckRow checked={includeFeature} onChange={setIncludeFeature}
                        label="Feature summary"
                        hint="Phase pipeline + recent runs" />
              <CheckRow checked={includeProject} onChange={setIncludeProject}
                        label="Project summary"
                        hint="Overall pass rate + pipeline overview" />
            </div>
          </div>
        )}

        {isSessionScope && (
          <p className="text-xs" style={{ color: 'rgba(238,238,248,0.60)' }}>
            Includes everything logged in this session: tests run, passes, failures, and issues linked to your work.
          </p>
        )}

        <div>
          <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                 style={{ color: 'rgba(238,238,248,0.45)' }}>
            Additional notes (optional)
          </label>
          <textarea
            value={additionalText}
            onChange={(e) => setAdditionalText(e.target.value)}
            rows={4}
            maxLength={5000}
            placeholder="Add context, release notes, or any custom narrative you want included in the report."
            className="w-full rounded-lg px-3 py-2 text-xs resize-y"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.90)',
            }}
          />
          <div className="text-[10px] mt-1" style={{ color: 'rgba(238,238,248,0.45)' }}>
            {additionalText.length}/5000
          </div>
        </div>

        {showTestListToggle && (
          <div>
            <label className="text-[10px] uppercase tracking-wider mb-1.5 block"
                   style={{ color: 'rgba(238,238,248,0.45)' }}>
              Test list
            </label>
            <CheckRow checked={includeTests} onChange={setIncludeTests}
                      label="Include the list of tests"
                      hint="Every test with its pass / fail status and bug count" />
          </div>
        )}

        <p className="text-[10px]" style={{ color: 'rgba(238,238,248,0.40)' }}>
          The report is delivered as a PDF (download &amp; email). Use Preview to view it in-app.
        </p>

        {/* ── Email this report ───────────────────────────────────────────
            Toggle + tag-style recipients input. When the toggle is OFF the
            modal generates only (download link in toast). When ON it fetches
            ORG_ADMIN + project MANAGER/TECH_LEAD/OWNER members and chips them
            into the input — user can remove individual chips and add their
            own (chip on Enter / comma). Sends to the full chip list on
            submit; submit button label morphs to "Generate & Send". */}
        <div
          className="rounded-lg p-3"
          style={{
            background: emailEnabled ? 'rgba(168,85,247,0.06)' : 'rgba(255,255,255,0.02)',
            border: `1px solid ${emailEnabled ? 'rgba(168,85,247,0.30)' : 'rgba(255,255,255,0.07)'}`,
          }}
        >
          <button
            type="button"
            onClick={() => setEmailEnabled(!emailEnabled)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <span className="flex items-center gap-2 text-xs font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>
              <Mail size={13} style={{ color: emailEnabled ? '#c4b5fd' : 'rgba(238,238,248,0.45)' }} />
              Email this report after generating
            </span>
            <span
              className="relative w-9 h-5 rounded-full transition-colors"
              style={{ background: emailEnabled ? '#a855f7' : 'rgba(255,255,255,0.10)' }}
            >
              <span
                className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
                style={{ transform: emailEnabled ? 'translateX(18px)' : 'translateX(2px)' }}
              />
            </span>
          </button>

          {emailEnabled && (
            <div className="mt-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider" style={{ color: 'rgba(238,238,248,0.45)' }}>
                Recipients
                {defaultRecipientsData && hasAutoPopulated && (
                  <span className="ml-2 normal-case" style={{ color: 'rgba(238,238,248,0.55)' }}>
                    (pre-filled from project roles)
                  </span>
                )}
              </div>

              {/* Chip area */}
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
                      background: 'rgba(168,85,247,0.18)',
                      border: '1px solid rgba(168,85,247,0.32)',
                      color: '#e9d5ff',
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
                <div className="text-[10px]" style={{ color: '#fca5a5' }}>
                  {emailInputError}
                </div>
              )}

              {/* Roster reference — show role beside each pre-filled email so
                  the user knows why each address is there. */}
              {defaultRecipientsData && defaultRecipientsData.length > 0 && (
                <details className="text-[10px]" style={{ color: 'rgba(238,238,248,0.55)' }}>
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
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            loading={gen.isPending}
            disabled={noSectionsSelected || emailModeButNoRecipients}
            onClick={() => gen.mutate()}
            title={emailModeButNoRecipients ? 'Add at least one recipient or disable email' : undefined}
          >
            <Sparkles size={12} /> {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function CheckRow({
  checked, onChange, label, hint,
}: { checked: boolean; onChange: (v: boolean) => void; label: string; hint: string }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="w-full flex items-start gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-white/[0.03]"
      style={{
        background: checked ? 'rgba(168,85,247,0.08)' : 'rgba(255,255,255,0.02)',
        border: `1px solid ${checked ? 'rgba(168,85,247,0.32)' : 'rgba(255,255,255,0.07)'}`,
      }}
    >
      <div
        className="w-4 h-4 rounded shrink-0 mt-0.5 flex items-center justify-center text-[10px]"
        style={{
          background: checked ? '#a855f7' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${checked ? '#a855f7' : 'rgba(255,255,255,0.14)'}`,
          color: 'white',
        }}
      >
        {checked ? '✓' : ''}
      </div>
      <div className="flex-1">
        <div className="text-xs font-medium" style={{ color: 'rgba(238,238,248,0.90)' }}>{label}</div>
        <div className="text-[10px]" style={{ color: 'rgba(238,238,248,0.50)' }}>{hint}</div>
      </div>
    </button>
  );
}

/** Session-scoped report modal (shared generate + email UI). Used by WorkSessionBadge quick actions. */
export function SessionReportModal({
  open,
  onClose,
  projectId,
  workSessionId,
  emailFirst = false,
  onGenerated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  workSessionId: string;
  emailFirst?: boolean;
  onGenerated?: (reportId: string) => void;
}) {
  return (
    <GenerateReportModal
      open={open}
      onClose={onClose}
      projectId={projectId}
      scope={{ type: 'SESSION', workSessionId }}
      scopeTitle="Active QA session"
      initialEmailEnabled={emailFirst}
      onGenerated={(id) => {
        onGenerated?.(id);
        onClose();
      }}
    />
  );
}
