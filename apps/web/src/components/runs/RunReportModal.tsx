import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { X, Mail, Loader2, ExternalLink } from 'lucide-react';
import { reportsApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * In-app viewer for a generated run report: renders the stored HTML preview in
 * an isolated iframe and offers a one-click re-email to a fresh recipient list.
 */
export function RunReportModal({
  reportId,
  title,
  alreadyEmailed,
  onClose,
}: {
  reportId: string;
  title: string;
  alreadyEmailed?: boolean;
  onClose: () => void;
}) {
  const [emailsInput, setEmailsInput] = useState('');

  const { data: html, isLoading } = useQuery({
    queryKey: ['report-preview', reportId],
    queryFn: () => reportsApi.previewHtml(reportId),
  });

  const email = useMutation({
    mutationFn: (recipients: string[]) => reportsApi.email(reportId, recipients),
    onSuccess: (res: { recipients?: number }) => {
      toast.success('Report sent', `Emailed to ${res?.recipients ?? 0} recipient${res?.recipients === 1 ? '' : 's'}.`);
      setEmailsInput('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not send', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const recipients = emailsInput
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const allValid = recipients.length > 0 && recipients.every((e) => EMAIL_RE.test(e));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-2xl flex flex-col overflow-hidden"
        style={{ background: 'rgba(20,20,28,0.98)', border: '1px solid rgba(255,255,255,0.10)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-3.5 border-b" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold truncate" style={{ color: 'rgba(238,238,248,0.92)' }}>{title}</h3>
            <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              {alreadyEmailed ? 'Already emailed once · re-send below' : 'Generated report'}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={`/api/v1/reports/${reportId}/download?inline=1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
              style={{ color: 'rgba(238,238,248,0.6)', background: 'rgba(255,255,255,0.05)' }}
            >
              <ExternalLink size={12} /> PDF
            </a>
            <button type="button" onClick={onClose} className="p-1.5 rounded-lg" style={{ color: 'rgba(238,238,248,0.5)' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-hidden bg-white">
          {isLoading ? (
            <div className="h-full flex items-center justify-center" style={{ minHeight: 320 }}>
              <Loader2 className="animate-spin" size={20} style={{ color: '#888' }} />
            </div>
          ) : (
            <iframe
              title="Report preview"
              srcDoc={html ?? '<p style="padding:24px;font-family:sans-serif">Preview unavailable.</p>'}
              className="w-full h-[55vh]"
              // Renders our own trusted report HTML; no allow-scripts so nothing executes.
              sandbox="allow-same-origin"
            />
          )}
        </div>

        {/* Re-email */}
        <div className="px-5 py-3.5 border-t flex flex-col sm:flex-row sm:items-center gap-2" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
          <Mail size={14} style={{ color: 'rgba(238,238,248,0.45)' }} className="shrink-0" />
          <input
            type="text"
            value={emailsInput}
            onChange={(e) => setEmailsInput(e.target.value)}
            placeholder="Email this report to… (comma-separated)"
            className="flex-1 rounded-lg px-3 py-1.5 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
          />
          <button
            type="button"
            disabled={!allValid || email.isPending}
            onClick={() => email.mutate(recipients)}
            className="inline-flex items-center justify-center gap-1.5 text-sm px-3 py-1.5 rounded-lg font-medium disabled:opacity-40"
            style={{ background: 'rgba(var(--accent-rgb),0.18)', color: 'var(--accent-300)', border: '1px solid rgba(var(--accent-rgb),0.3)' }}
          >
            {email.isPending ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />} Send
          </button>
        </div>
      </div>
    </div>
  );
}
