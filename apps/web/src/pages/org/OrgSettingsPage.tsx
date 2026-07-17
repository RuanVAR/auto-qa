import { Link } from 'react-router-dom';
import { PLATFORM_NAME } from '@/hooks/useOrgBranding';
import { Users, ShieldCheck, Plug, ArrowRight, Building2, Sparkles, FileText, Activity, BarChart3, Image as ImageIcon, Github, ScrollText, ArrowRightLeft } from 'lucide-react';
import { useActiveOrg } from '@/stores/authStore';
import { Card, CardContent } from '@/components/ui/Card';

/**
 * Landing page for org-level configuration.
 *
 * The platform has three org-scoped surfaces today (team, access requests,
 * plugins) with no shared chrome. This page is the hub — it gives ORG_ADMINs
 * one URL (`/org`) that links to all three, and is also the natural home
 * for future settings like SSO config / branding / billing when those land.
 *
 * Visible to anyone authenticated; ORG_ADMIN-only sub-pages still enforce
 * their own RBAC server-side.
 */
export default function OrgSettingsPage() {
  const org = useActiveOrg();

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Building2 className="w-5 h-5 text-purple-300" />
            <h1 className="text-2xl font-semibold text-white">Organisation</h1>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Manage your team, review access requests, and configure plugins for
            {org?.org?.name ? <> <strong className="text-slate-200">{org.org.name}</strong></> : ' your organisation'}.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        <SectionCard
          to="/org/general"
          icon={Building2}
          title="General"
          description="Edit your organisation's name, website, and description. These appear across the app and on reports."
          actionLabel="Edit details"
        />
        <SectionCard
          to="/org/team"
          icon={Users}
          title="Team"
          description="Invite and manage members. Assign project roles and per-environment access."
          actionLabel="Manage team"
        />
        <SectionCard
          to="/org/access-requests"
          icon={ShieldCheck}
          title="Access requests"
          description="Approve or deny user requests to join your organisation or specific projects."
          actionLabel="View requests"
        />
        <SectionCard
          to="/org/transfers"
          icon={ArrowRightLeft}
          title="Project transfers"
          description="Accept or decline projects other organisations hand over to you, and see what each move would change before you commit."
          actionLabel="Review transfers"
        />
        <SectionCard
          to="/org/plugins"
          icon={Plug}
          title="Plugins"
          description="Install ClickUp, Jira, Slack and other integrations. Configure project bindings + status mappings."
          actionLabel="Manage plugins"
        />
        <SectionCard
          to="/org/branding"
          icon={ImageIcon}
          title="Branding"
          description={`Upload your organisation's logo. Members see it instead of the ${PLATFORM_NAME} mark — in the app, on report PDFs, in emails, and on your branded login link.`}
          actionLabel="Customise branding"
        />
        <SectionCard
          to="/org/ai-settings"
          icon={Sparkles}
          title="AI"
          description="Pick a provider, paste your API key, and set a monthly spend cap. Required before AI generation works for projects in this org."
          actionLabel="Configure AI"
        />
        <SectionCard
          to="/org/github"
          icon={Github}
          title="GitHub"
          description="Connect one GitHub credential for the org. Projects then link their repos for deploy automation and codebase-aware AI test generation."
          actionLabel="Configure GitHub"
        />
        <SectionCard
          to="/org/audit"
          icon={ScrollText}
          title="Audit log"
          description="Who did what, from where — web, API tokens, and MCP. Filter by user, action, source, and date; expand a row to see exactly what changed."
          actionLabel="View audit log"
        />
        <SectionCard
          to="/org/ai-audit"
          icon={FileText}
          title="AI audit"
          description="Every AI call the org has made — generation surfaces, AC extraction, run summaries. Shows model, tokens, cost, prompt + response previews."
          actionLabel="View audit log"
        />
        <SectionCard
          to="/org/active-sessions"
          icon={Activity}
          title="Active sessions"
          description="See every open manual test session across the org and force-end ones that are stuck — the fix when a lingering session blocks a tester from starting a new one."
          actionLabel="Manage sessions"
        />
        <SectionCard
          to="/org/analytics"
          icon={BarChart3}
          title="Analytics"
          description="Org-level BI dashboard — runs/day, top failing features & modules, failure reasons, bug categories, resolution times, per-user productivity. Filterable by project/module/feature/user."
          actionLabel="Open dashboard"
        />
      </div>
    </div>
  );
}

function SectionCard({
  to,
  icon: Icon,
  title,
  description,
  actionLabel,
}: {
  to: string;
  icon: typeof Users;
  title: string;
  description: string;
  actionLabel: string;
}) {
  return (
    <Link to={to} className="block group">
      <Card className="h-full transition-colors group-hover:border-purple-500/40">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-start justify-between">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: 'rgba(var(--accent-rgb),0.14)', border: '1px solid rgba(var(--accent-rgb),0.30)' }}>
              <Icon className="w-4 h-4 text-purple-200" />
            </div>
            <ArrowRight className="w-4 h-4 text-slate-500 group-hover:text-purple-300 group-hover:translate-x-0.5 transition-all" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{description}</p>
          </div>
          <div className="text-[11px] text-purple-300/80 group-hover:text-purple-200 font-medium">
            {actionLabel} →
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
