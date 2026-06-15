import { useState, type ReactNode } from 'react';
import { HelpCircle, ExternalLink } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';

/**
 * Per-plugin "how do I set this up?" guide. Renders a small (?) button on the
 * plugin card; clicking opens a modal with numbered steps. Content is keyed by
 * pluginId with a generic API-token fallback for plugins without a bespoke
 * guide, so adding a plugin doesn't require a guide to ship.
 */

type GuideStep = { title: string; body: ReactNode };
type Guide = { intro: string; docsUrl?: string; steps: GuideStep[] };

const GUIDES: Record<string, Guide> = {
  gdrive: {
    intro:
      'Connect Google Drive so anyone in the org can attach Drive files and link Drive folders to projects, modules, features and tests — and preview them in-app.',
    docsUrl: 'https://developers.google.com/workspace/guides/create-credentials',
    steps: [
      {
        title: 'Operator: configure Google credentials (one-time, per deployment)',
        body: (
          <>
            In a Google Cloud project, create an <strong>OAuth client (Web application)</strong> and set
            <code className="mx-1">GOOGLE_CLIENT_ID</code> / <code className="mx-1">GOOGLE_CLIENT_SECRET</code> on the API.
            These are the same credentials used for Google SSO — one client works for both.
            Allow-list this exact Drive callback redirect URI (fixed — the org is
            carried in the OAuth state, not the URL):
            <code className="block mt-1 break-all">{'<API_URL>/api/v1/gdrive/oauth/callback'}</code>
            and add the scope <code>https://www.googleapis.com/auth/drive.readonly</code>.
          </>
        ),
      },
      {
        title: 'Connect with Google',
        body: (
          <>Click <strong>Install</strong> → <strong>Connect with Google</strong> and authorise read-only Drive
            access for this organisation. We store an encrypted refresh token — never your password.</>
        ),
      },
      {
        title: 'Choose what the org can see (optional)',
        body: (
          <>By default everything the connected account can see is browsable. To restrict it, narrow the access
            scope to specific folders from the install — only those folders (and their contents) become linkable.</>
        ),
      },
      {
        title: 'Attach docs anywhere',
        body: (
          <>On any project / module / feature / test, open the <strong>Docs</strong> panel and click
            <strong> Google Drive</strong> to search files, browse folders, attach a file, or (on a project) link a
            whole folder for a browsable list. Google Docs render inline; PDFs and images preview in-app.</>
        ),
      },
    ],
  },
  clickup: {
    intro:
      'Connect ClickUp to push QA tickets, sync phase status, attach artefacts, import acceptance criteria, and link ClickUp Docs as feature specs.',
    docsUrl: 'https://help.clickup.com/hc/en-us/articles/6303426241687-Use-the-ClickUp-API',
    steps: [
      {
        title: 'Create a Personal Access Token',
        body: (
          <>In ClickUp, go to <strong>Settings → Apps</strong> and generate a Personal API token
            (starts with <code>pk_</code>).</>
        ),
      },
      {
        title: 'Install with the token',
        body: <>Click <strong>Install</strong>, paste the token, and we&apos;ll run a health check immediately to confirm it works.</>,
      },
      {
        title: 'Bind a project to ClickUp',
        body: (
          <>On a project, pick the ClickUp <strong>workspace → space → list</strong> where tickets should land.
            Modules and features inherit this, with per-scope overrides.</>
        ),
      },
    ],
  },
};

function genericGuide(name: string): Guide {
  return {
    intro: `Connect ${name} so the platform can integrate with it.`,
    steps: [
      { title: 'Get an API token', body: <>Create an API token in {name}&apos;s settings.</> },
      { title: 'Install', body: <>Click <strong>Install</strong>, paste the token, and we&apos;ll verify it with a health check.</> },
    ],
  };
}

export function PluginSetupGuide({ pluginId, name }: { pluginId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const guide = GUIDES[pluginId] ?? genericGuide(name);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={`How to set up ${name}`}
        className="shrink-0 text-slate-500 hover:text-purple-300 transition-colors"
        aria-label={`How to set up ${name}`}
      >
        <HelpCircle className="w-4 h-4" />
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title={`Set up ${name}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-300">{guide.intro}</p>
            <ol className="space-y-3">
              {guide.steps.map((s, i) => (
                <li key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-purple-500/15 border border-purple-500/30 text-purple-200 text-[11px] font-semibold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <div className="text-xs text-slate-300 leading-relaxed flex-1 min-w-0">
                    <div className="text-slate-100 font-medium mb-0.5">{s.title}</div>
                    <div className="[&_code]:text-[11px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:bg-white/5 [&_code]:text-purple-200">
                      {s.body}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {guide.docsUrl && (
              <a
                href={guide.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-purple-300 hover:text-purple-200"
              >
                Official setup docs <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}
