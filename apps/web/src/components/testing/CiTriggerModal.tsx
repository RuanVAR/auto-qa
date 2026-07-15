/**
 * CiTriggerModal — self-service guide for triggering THIS feature's automated
 * run from CI (GitHub Actions or any HTTP caller). Generates a ready-to-copy
 * curl + workflow YAML pre-filled with the feature id and the chosen
 * environment, so the user never has to hunt for ids. The only secret the
 * user adds to GitHub is a PAT (minted in Settings → API tokens).
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Copy, KeyRound } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

interface Env { id: string; name: string; supportsAutomation?: boolean }

function CopyBlock({ label, code }: { label: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.10)' }}>
      <div className="flex items-center justify-between px-3 py-1.5" style={{ background: 'rgba(255,255,255,0.05)' }}>
        <span className="text-[11px] font-medium" style={{ color: 'rgba(238,238,248,0.55)' }}>{label}</span>
        <button
          type="button"
          onClick={copy}
          className="inline-flex items-center gap-1 text-[11px] font-medium"
          style={{ color: copied ? '#10b981' : 'var(--accent-400)' }}
        >
          {copied ? <><Check size={12} /> Copied</> : <><Copy size={12} /> Copy</>}
        </button>
      </div>
      <pre className="p-3 text-[11px] leading-relaxed overflow-x-auto m-0" style={{ background: '#0d0d17', color: 'rgba(238,238,248,0.85)' }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

export function CiTriggerModal({
  open, onClose, featureId, featureName, envs,
}: { open: boolean; onClose: () => void; featureId: string; featureName: string; envs: Env[] }) {
  const automationEnvs = useMemo(() => envs.filter(e => e.supportsAutomation), [envs]);
  // Empty until the user picks; fall back to the first automation env so the
  // snippet is filled in even before an explicit selection (envs load async).
  const [picked, setPicked] = useState('');
  const envId = picked || automationEnvs[0]?.id || '';
  const setEnvId = setPicked;
  // The platform's own origin is the API base the CI job calls.
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://your-advantage-host';

  const curl = `curl -sf -X POST "$QA_URL/api/v1/features/${featureId}/run" \\
  -H "Authorization: Bearer $QA_PAT" \\
  -H "Content-Type: application/json" \\
  -d '{"runMode":"AUTOMATED","environmentId":"${envId || '<ENV_ID>'}","trigger":"ci"}'`;

  const yaml = `# .github/workflows/qa-regression.yml
name: QA regression
on:
  release:
    types: [published]      # or: workflow_dispatch / push to main
jobs:
  regression:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger AdVantage automated run
        env:
          QA_URL: ${base}
          QA_PAT: \${{ secrets.QA_PAT }}
        run: |
          curl -sf -X POST "$QA_URL/api/v1/features/${featureId}/run" \\
            -H "Authorization: Bearer $QA_PAT" \\
            -H "Content-Type: application/json" \\
            -d '{"runMode":"AUTOMATED","environmentId":"${envId || '<ENV_ID>'}","trigger":"ci"}'`;

  if (!open) return null;

  return (
    <Modal open onClose={onClose} title="Trigger this feature from CI" size="lg">
      <div className="space-y-4">
        <p className="text-sm" style={{ color: 'rgba(238,238,248,0.65)' }}>
          Run <span className="font-semibold" style={{ color: 'rgba(238,238,248,0.9)' }}>{featureName}</span>’s
          automated tests from GitHub Actions (or any HTTP caller) — e.g. a regression check after a release build.
        </p>

        {automationEnvs.length === 0 ? (
          <div className="rounded-lg px-3 py-2 text-xs" style={{ background: 'rgba(251,191,36,0.12)', color: '#fbbf24' }}>
            No automation-enabled environment yet. Turn on “Supports automation” on an environment first.
          </div>
        ) : (
          <>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
                Environment to run against
              </label>
              <select
                value={envId}
                onChange={e => setEnvId(e.target.value)}
                className="w-full rounded-lg px-3 py-2 text-sm"
                style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.85)' }}
              >
                {automationEnvs.map(e => <option key={e.id} value={e.id} style={{ background: '#1a1a2e' }}>{e.name}</option>)}
              </select>
            </div>

            {/* Setup steps */}
            <ol className="space-y-2 text-sm" style={{ color: 'rgba(238,238,248,0.7)' }}>
              <li className="flex gap-2">
                <span className="font-semibold" style={{ color: 'var(--accent-400)' }}>1.</span>
                <span>
                  Create a Personal Access Token:{' '}
                  <Link to="/settings" className="inline-flex items-center gap-1 underline" style={{ color: 'var(--accent-400)' }}>
                    <KeyRound size={12} /> Settings → API tokens
                  </Link>{' '}
                  — copy the <code className="text-[11px]">qapt_…</code> value (shown once). It runs with your access, so use an account that can reach this environment.
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold" style={{ color: 'var(--accent-400)' }}>2.</span>
                <span>
                  In GitHub → <em>Settings → Secrets and variables → Actions</em>, add a secret{' '}
                  <code className="text-[11px]">QA_PAT</code> = that token. (The app’s test-account password is not needed —
                  it lives in the environment’s variables and is injected server-side.)
                </span>
              </li>
              <li className="flex gap-2">
                <span className="font-semibold" style={{ color: 'var(--accent-400)' }}>3.</span>
                <span>Add the workflow below (feature + environment ids are already filled in):</span>
              </li>
            </ol>

            <CopyBlock label="GitHub Actions workflow" code={yaml} />

            <details>
              <summary className="text-xs cursor-pointer" style={{ color: 'rgba(238,238,248,0.55)' }}>
                Just the curl (for any CI / script)
              </summary>
              <div className="mt-2">
                <CopyBlock label="curl (set QA_URL + QA_PAT)" code={curl} />
              </div>
            </details>

            <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
              The run appears in Test Runs with <code>trigger=ci</code>. Poll{' '}
              <code>GET /api/v1/feature-runs/&lt;runId&gt;</code> for the result, or set a project completion webhook to be
              notified when it finishes.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}
