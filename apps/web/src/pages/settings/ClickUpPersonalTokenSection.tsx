import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Check, ExternalLink, Loader2, Ticket } from 'lucide-react';
import { userClickupApi } from '@/lib/api';
import { toast } from '@/components/ui/Toast';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';

/**
 * Lets a user store their OWN ClickUp personal token so their ClickUp actions
 * (log bug, status change, comment) are attributed to them instead of the shared
 * org integration. Opt-in — with no token, actions fall back to the org token.
 * Hidden entirely when ClickUp isn't installed for the active org.
 */
export function ClickUpPersonalTokenSection() {
  const qc = useQueryClient();
  const [token, setToken] = useState('');
  const [guideOpen, setGuideOpen] = useState(false);

  const { data: status, isLoading } = useQuery({
    queryKey: ['user-clickup-token'],
    queryFn: () => userClickupApi.status(),
  });

  const save = useMutation({
    mutationFn: (t: string) => userClickupApi.set(t),
    onSuccess: (res) => {
      toast.success('ClickUp connected', res.connectedAs ? `Acting as ${res.connectedAs}.` : 'Token saved.');
      setToken('');
      qc.invalidateQueries({ queryKey: ['user-clickup-token'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not save token', typeof msg === 'string' ? msg : 'Check the token and try again.');
    },
  });

  const remove = useMutation({
    mutationFn: () => userClickupApi.remove(),
    onSuccess: () => {
      toast.success('ClickUp token removed', 'Your ClickUp actions will use the shared org connection.');
      qc.invalidateQueries({ queryKey: ['user-clickup-token'] });
    },
  });

  // Only relevant once the org's ClickUp plugin is installed.
  if (isLoading || !status?.installed) return null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Ticket size={14} className="text-gray-500" />
          <CardTitle>ClickUp personal token</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-gray-500">
          Add your <strong>own</strong> ClickUp token so the bugs, status changes and comments you push show up in
          ClickUp as <strong>you</strong> — not the shared integration. Optional; without it your actions use the
          org connection.
        </p>
        <button
          type="button"
          onClick={() => setGuideOpen(true)}
          className="shrink-0 inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:text-sky-700"
        >
          <BookOpen size={13} /> Where do I get this?
        </button>
      </div>

      {status.hasToken ? (
        <div
          className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5"
          style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}
        >
          <div className="flex items-center gap-2 min-w-0 text-sm">
            <Check size={15} className="text-emerald-500 shrink-0" />
            <span className="text-gray-700 truncate">
              Connected as <strong>{status.connectedAs ?? 'your ClickUp account'}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={() => remove.mutate()}
            disabled={remove.isPending}
            className="shrink-0 text-xs font-medium text-red-500 hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your ClickUp personal token (pk_…)"
            autoComplete="off"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.14)', color: 'rgba(238,238,248,0.9)' }}
          />
          <button
            type="button"
            disabled={token.trim().length < 20 || save.isPending}
            onClick={() => save.mutate(token.trim())}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', border: '1px solid rgba(var(--accent-rgb),0.5)' }}
          >
            {save.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Connect
          </button>
        </div>
      )}

          <ClickUpTokenGuideModal open={guideOpen} onClose={() => setGuideOpen(false)} />
        </div>
      </CardContent>
    </Card>
  );
}

const STEPS = [
  'In ClickUp, click your avatar (bottom-left) → Settings.',
  'Open the "Apps" tab in the settings sidebar.',
  'Under "API Token", click Generate (or Regenerate) to reveal your personal token — it starts with "pk_".',
  'Copy it, then paste it back here and press Connect.',
];

/** Step-by-step guide for finding a ClickUp personal API token. */
function ClickUpTokenGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Get your ClickUp personal token" size="md">
      <div className="space-y-3">
        <ol className="space-y-2.5">
          {STEPS.map((s, i) => (
            <li key={i} className="flex gap-2.5 text-sm" style={{ color: 'rgba(238,238,248,0.82)' }}>
              <span
                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold"
                style={{ background: 'rgba(var(--accent-rgb),0.2)', color: 'var(--accent-300)' }}
              >
                {i + 1}
              </span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <a
          href="https://app.clickup.com/settings/apps"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-sky-400 hover:text-sky-300"
        >
          <ExternalLink size={13} /> Open ClickUp → Settings → Apps
        </a>
        <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
          It's a <strong>personal</strong> token — actions will be attributed to you. We validate it, store it
          encrypted, and never show it again.
        </p>
      </div>
    </Modal>
  );
}
