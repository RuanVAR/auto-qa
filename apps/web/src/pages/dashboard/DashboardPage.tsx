import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  FolderOpen, CheckCircle, XCircle, Zap, Plus, ArrowRight,
  Play, Clock, ExternalLink, Sparkles, Users, Building2, ShieldCheck,
} from 'lucide-react';
import { projectsApi, runsApi, accessRequestsApi, orgsApi, adminApi, api } from '@/lib/api';
import { useAuthStore, useActiveOrg } from '@/stores/authStore';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { RunStatusBadge } from '@/components/ui/RunStatusBadge';
import { Modal } from '@/components/ui/Modal';
import { PageSpinner } from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';
import { LastActivityCard } from './LastActivityCard';

// ── Types ────────────────────────────────────────────────────────────────────

interface OrgMemberItem {
  userId: string;
  role: string;
  user: { id: string; name: string; email: string; avatarUrl?: string | null };
}

interface ProjectMember { userId: string }
interface LastRun { id: string; status: string; createdAt: string }
interface ProjectStats { passRate?: number; failed?: number; healCount?: number }
interface Project {
  id: string;
  name: string;
  isMember?: boolean;
  members?: ProjectMember[];
  lastRun?: LastRun | null;
  stats?: ProjectStats;
  _count?: Record<string, number>;
}

interface Run {
  id: string;
  status: string;
  createdAt: string;
  name?: string;
  project?: { id: string; name: string };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function timeAgo(dateStr?: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function borderColorForStatus(status?: string): string {
  if (!status) return 'rgba(255,255,255,0.07)';
  if (status === 'PASSED') return 'rgba(16,185,129,0.35)';
  if (status === 'FAILED') return 'rgba(239,68,68,0.35)';
  if (status === 'RUNNING') return 'rgba(139,92,246,0.50)';
  return 'rgba(255,255,255,0.07)';
}

function PassBar({ rate }: { rate?: number }) {
  const pct = rate ?? 0;
  const color = pct >= 80 ? '#34d399' : pct >= 60 ? '#fbbf24' : '#f87171';
  return (
    <div className="flex items-center gap-2 mt-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.08)' }}>
        <div style={{ width: `${pct}%`, background: color, height: '100%', borderRadius: '9999px', transition: 'width 0.4s' }} />
      </div>
      <span className="text-xs tabular-nums font-medium" style={{ color }}>{pct}%</span>
    </div>
  );
}

// ── Request Access Modal ──────────────────────────────────────────────────────

function RequestAccessModal({
  project,
  orgId,
  onClose,
}: {
  project: Project;
  orgId: string;
  onClose: () => void;
}) {
  const [message, setMessage] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      accessRequestsApi.createOrgRequest(orgId, { message: message || undefined }),
    onSuccess: () => setSubmitted(true),
  });

  return (
    <Modal open onClose={onClose} title={`Request Access — ${project.name}`} size="sm">
      {submitted ? (
        <div className="text-center py-4 space-y-3">
          <CheckCircle size={32} className="mx-auto" style={{ color: '#34d399' }} />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Your access request has been sent to the org admin.
          </p>
          <Button onClick={onClose} variant="secondary" size="sm">Close</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            You are not currently a member of <strong style={{ color: 'var(--text-primary)' }}>{project.name}</strong>. Send a request to join.
          </p>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
              Message (optional)
            </label>
            <textarea
              rows={3}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Why do you need access?"
              className="w-full resize-none text-sm rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              loading={mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Send Request
            </Button>
          </div>
          {mutation.isError && (
            <p className="text-xs" style={{ color: '#f87171' }}>Failed to send request. Please try again.</p>
          )}
        </div>
      )}
    </Modal>
  );
}

// ── Project Card ──────────────────────────────────────────────────────────────

function ProjectCard({
  project,
  orgId,
  userId,
  isPlatformAdmin,
  onRunNow,
}: {
  project: Project;
  orgId: string;
  userId: string;
  isPlatformAdmin: boolean;
  onRunNow: (projectId: string) => void;
}) {
  const [requestOpen, setRequestOpen] = useState(false);
  const navigate = useNavigate();

  const isMember =
    isPlatformAdmin ||
    project.isMember === true ||
    (project.members ?? []).some(m => m.userId === userId);

  const lastRunStatus = project.lastRun?.status;
  const isRunning = lastRunStatus === 'RUNNING';
  const borderColor = borderColorForStatus(lastRunStatus);

  const modules = project._count?.modules ?? 0;
  const features = project._count?.features ?? 0;

  return (
    <>
      <div
        className="rounded-2xl p-5 flex flex-col gap-3 transition-all duration-200"
        style={{
          background: 'rgba(255,255,255,0.03)',
          backdropFilter: 'blur(20px)',
          WebkitBackdropFilter: 'blur(20px)',
          border: `1px solid ${borderColor}`,
          boxShadow: isRunning
            ? '0 0 0 1px rgba(139,92,246,0.30), 0 4px 24px rgba(0,0,0,0.40)'
            : '0 4px 24px rgba(0,0,0,0.30)',
          animation: isRunning ? 'pulse-border 2s ease-in-out infinite' : undefined,
        }}
      >
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: 'rgba(139,92,246,0.18)' }}
            >
              <FolderOpen size={15} style={{ color: '#a78bfa' }} />
            </div>
            <div className="min-w-0">
              <h3
                className="font-semibold text-sm truncate"
                style={{ color: 'var(--text-primary)' }}
              >
                {project.name}
              </h3>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {modules} module{modules !== 1 ? 's' : ''} · {features} feature{features !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          {lastRunStatus && <RunStatusBadge status={lastRunStatus} />}
        </div>

        {/* Pass rate bar */}
        <PassBar rate={project.stats?.passRate} />

        {/* Last run */}
        <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
          <Clock size={11} />
          <span>Last run: {timeAgo(project.lastRun?.createdAt)}</span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 pt-1">
          {isMember ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => navigate(`/projects/${project.id}`)}
              >
                Open
                <ArrowRight size={12} />
              </Button>
              {lastRunStatus === 'FAILED' && (
                <Button
                  size="sm"
                  onClick={() => onRunNow(project.id)}
                >
                  <Play size={12} />
                  Run Now
                </Button>
              )}
            </>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRequestOpen(true)}
            >
              Request Access
            </Button>
          )}
        </div>
      </div>

      {requestOpen && (
        <RequestAccessModal
          project={project}
          orgId={orgId}
          onClose={() => setRequestOpen(false)}
        />
      )}
    </>
  );
}

// ── Empty / Onboarding state ──────────────────────────────────────────────────

function OnboardingEmpty({ orgName }: { orgName: string }) {
  const navigate = useNavigate();
  return (
    <div
      className="rounded-2xl p-10 flex flex-col items-center gap-5 text-center"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div
        className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.25)' }}
      >
        <Sparkles size={28} style={{ color: '#a78bfa' }} />
      </div>
      <div>
        <h3 className="text-lg font-bold mb-2" style={{ color: 'var(--text-primary)' }}>
          Welcome to {orgName}!
        </h3>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Get started by creating your first project
        </p>
      </div>
      <Button onClick={() => navigate('/projects')}>
        <Plus size={14} />
        Create First Project
      </Button>
    </div>
  );
}

// ── Team preview strip (ORG_ADMIN only) ──────────────────────────────────────

function TeamStrip({ orgId }: { orgId: string }) {
  const { data: members = [] } = useQuery<OrgMemberItem[]>({
    queryKey: ['org-members-dashboard', orgId],
    queryFn: () => orgsApi.getMembers(orgId),
    enabled: !!orgId,
  });

  const list = (members as OrgMemberItem[]).slice(0, 3);
  if (!list.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Team
        </h3>
        <Link
          to="/org/team"
          className="flex items-center gap-1 text-xs font-medium transition-colors"
          style={{ color: '#a78bfa' }}
        >
          Manage Team <ArrowRight size={12} />
        </Link>
      </div>
      <div
        className="rounded-2xl overflow-hidden"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border: '1px solid rgba(255,255,255,0.07)',
          backdropFilter: 'blur(20px)',
        }}
      >
        {list.map((m, idx) => (
          <div
            key={m.userId}
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: idx < list.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
          >
            <div className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: 'rgba(139,92,246,0.20)', color: '#c4b5fd' }}
              >
                {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
              </div>
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.user.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.user.email}</p>
              </div>
            </div>
            <Badge variant={m.role === 'ORG_ADMIN' ? 'info' : 'default'}>{m.role}</Badge>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Pending Access Requests (Platform Admin) ──────────────────────────────────

interface AccessRequestItem {
  id: string;
  type: string;
  status: string;
  message?: string | null;
  createdAt: string;
  user?: { id: string; name: string; email: string };
}

function PlatformPendingRequests({ orgId }: { orgId: string }) {
  const { data: requests = [], isLoading } = useQuery<AccessRequestItem[]>({
    queryKey: ['admin-access-requests', orgId],
    queryFn: () => accessRequestsApi.listOrgRequests(orgId),
    enabled: !!orgId,
  });

  const pending = (requests as AccessRequestItem[])
    .filter(r => r.status === 'PENDING')
    .slice(0, 5);

  if (isLoading) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Pending Access Requests
        </h3>
        <Link
          to="/admin?tab=approvals"
          className="flex items-center gap-1 text-xs font-medium transition-colors"
          style={{ color: '#a78bfa' }}
        >
          View all <ArrowRight size={12} />
        </Link>
      </div>

      {pending.length === 0 ? (
        <div
          className="rounded-2xl px-5 py-5 flex items-center gap-3"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
          }}
        >
          <CheckCircle size={16} style={{ color: '#34d399' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            All caught up — no pending access requests
          </span>
        </div>
      ) : (
        <div
          className="rounded-2xl overflow-hidden"
          style={{
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.07)',
            backdropFilter: 'blur(20px)',
          }}
        >
          {pending.map((req, idx) => (
            <div
              key={req.id}
              className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: idx < pending.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined }}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                  style={{ background: 'rgba(139,92,246,0.20)', color: '#c4b5fd' }}
                >
                  {req.user?.name?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {req.user?.name ?? 'Unknown'}
                  </p>
                  <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>
                    {req.user?.email ?? '—'} · {req.type} · {formatDate(req.createdAt)}
                  </p>
                </div>
              </div>
              <Link
                to="/admin?tab=approvals"
                className="flex items-center gap-1 text-xs font-medium shrink-0 ml-3 transition-opacity hover:opacity-80"
                style={{ color: '#a78bfa' }}
              >
                Review <ArrowRight size={11} />
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Dashboard ────────────────────────────────────────────────────────────

interface PlatformStats {
  totalOrgs: number;
  totalProjects: number;
  totalUsers: number;
  activeUsers: number;
  pendingApproval: number;
}

export function DashboardPage() {
  const { user, activeOrgId, orgRole } = useAuthStore();
  const activeOrg = useActiveOrg();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isOrgAdmin = orgRole === 'ORG_ADMIN' || orgRole === 'ORG_OWNER';
  const isPlatformAdmin = user?.platformRole === 'PLATFORM_ADMIN';

  const { data: projects = [], isLoading } = useQuery<Project[]>({
    queryKey: ['projects'],
    queryFn: projectsApi.list,
  });

  // Platform-wide stats for PLATFORM_ADMIN
  const { data: platformStats } = useQuery<PlatformStats>({
    queryKey: ['admin-stats'],
    queryFn: adminApi.getStats,
    enabled: isPlatformAdmin,
  });

  // Fetch per-project stats in parallel (up to first 6 projects)
  const projectIds = (projects as Project[]).slice(0, 6).map(p => p.id);

  // Fetch member count for ORG_ADMIN (not needed for PLATFORM_ADMIN — use platform stats instead)
  const { data: orgMembers = [] } = useQuery<OrgMemberItem[]>({
    queryKey: ['org-members', activeOrgId],
    queryFn: () => orgsApi.getMembers(activeOrgId!),
    enabled: !!activeOrgId && isOrgAdmin && !isPlatformAdmin,
  });

  // Fetch last runs across all projects for activity feed
  const { data: allRuns = [] } = useQuery<Run[]>({
    queryKey: ['dashboard-runs', projectIds],
    queryFn: async () => {
      if (!projectIds.length) return [];
      const results = await Promise.all(
        projectIds.map(id =>
          runsApi.list(id).then((runs: Run[]) =>
            runs.map((r: Run) => ({
              ...r,
              project: projects.find(p => p.id === id),
            }))
          ).catch(() => [])
        )
      );
      return results.flat().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ).slice(0, 10);
    },
    enabled: projectIds.length > 0,
  });

  // Aggregate org stats from projects
  const totalProjects = (projects as Project[]).length;
  const projectsWithRun = (projects as Project[]).filter(p => p.lastRun);
  const passedCount = projectsWithRun.filter(p => p.lastRun?.status === 'PASSED').length;
  const failingCount = projectsWithRun.filter(p => p.lastRun?.status === 'FAILED').length;
  const overallPassRate = projectsWithRun.length
    ? Math.round((passedCount / projectsWithRun.length) * 100)
    : null;

  const triggerMutation = useMutation({
    mutationFn: (projectId: string) =>
      runsApi.trigger(projectId, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });

  if (isLoading) return <PageSpinner />;

  const firstName = user?.name?.split(' ')[0] ?? 'there';
  const orgName = activeOrg?.org?.name ?? 'Your Organisation';
  const orgId = activeOrgId ?? '';
  const userId = user?.id ?? '';

  return (
    <div className="space-y-7">
      {/* ── Header greeting ─────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
            {getGreeting()}, {firstName} 👋
          </h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Here's what's happening across <span className="font-medium" style={{ color: '#a78bfa' }}>{orgName}</span>
          </p>
        </div>
        {(isOrgAdmin || isPlatformAdmin) && (
          <Button onClick={() => navigate('/projects')} size="sm">
            <Plus size={13} />
            New Project
          </Button>
        )}
      </div>

      {/* ── Last activity card (if user has a prior ended session) ── */}
      <LastActivityCard />

      {/* ── Stat cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isPlatformAdmin ? (
          <>
            <StatCard
              label="Organisations"
              value={platformStats?.totalOrgs ?? '—'}
              icon={Building2}
              color="sky"
              action={{ label: 'View Organisations', to: '/admin/organisations' }}
            />
            <StatCard
              label="Total Projects"
              value={platformStats?.totalProjects ?? '—'}
              icon={FolderOpen}
              color="green"
              action={{ label: 'View Projects', to: '/projects' }}
            />
            <StatCard
              label="Total Users"
              value={platformStats?.totalUsers ?? '—'}
              icon={Users}
              color="violet"
              trend={platformStats?.pendingApproval ? `${platformStats.pendingApproval} pending approval` : `${platformStats?.activeUsers ?? 0} active`}
              action={{ label: 'Manage Users', to: '/admin?tab=users' }}
            />
            <StatCard
              label="Role"
              value="Platform Admin"
              icon={ShieldCheck}
              color="red"
              trend="Full platform access"
              action={{ label: 'Open Admin Panel', to: '/admin' }}
            />
          </>
        ) : (
          <>
            <StatCard
              label="Projects"
              value={totalProjects}
              icon={FolderOpen}
              color="sky"
            />
            <StatCard
              label="Pass Rate (7d)"
              value={overallPassRate !== null ? `${overallPassRate}%` : '—'}
              icon={CheckCircle}
              color="green"
            />
            <StatCard
              label="Currently Failing"
              value={failingCount}
              icon={XCircle}
              color="red"
            />
            {isOrgAdmin ? (
              <StatCard
                label="Members"
                value={(orgMembers as OrgMemberItem[]).length}
                icon={Users}
                color="violet"
                trend="Team members"
              />
            ) : (
              <StatCard
                label="Heals Today"
                value={0}
                icon={Zap}
                color="violet"
                trend="Selector auto-heals"
              />
            )}
          </>
        )}
      </div>

      {/* ── Pending Access Requests (PLATFORM_ADMIN only) ───── */}
      {isPlatformAdmin && orgId && <PlatformPendingRequests orgId={orgId} />}

      {/* ── Projects grid / Onboarding ───────────────────────── */}
      {!isPlatformAdmin && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
              Projects
            </h3>
            <Link
              to="/projects"
              className="flex items-center gap-1 text-xs font-medium transition-colors"
              style={{ color: '#a78bfa' }}
            >
              View all <ArrowRight size={12} />
            </Link>
          </div>

          {totalProjects === 0 ? (
            <OnboardingEmpty orgName={orgName} />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {(projects as Project[]).map(project => (
                <ProjectCard
                  key={project.id}
                  project={project}
                  orgId={orgId}
                  userId={userId}
                  isPlatformAdmin={isPlatformAdmin}
                  onRunNow={(id) => triggerMutation.mutate(id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Team section (ORG_ADMIN only, not PLATFORM_ADMIN) ── */}
      {!isPlatformAdmin && isOrgAdmin && activeOrgId && <TeamStrip orgId={activeOrgId} />}

      {/* ── Recent Activity ──────────────────────────────────── */}
      {(allRuns as Run[]).length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest mb-4" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Recent Activity
          </h3>
          <div
            className="rounded-2xl overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              backdropFilter: 'blur(20px)',
            }}
          >
            {(allRuns as Run[]).map((run, idx) => (
              <div
                key={run.id}
                className="flex items-center justify-between px-5 py-3.5"
                style={{
                  borderBottom: idx < allRuns.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <RunStatusBadge status={run.status} />
                  <div className="min-w-0">
                    <span className="text-sm font-medium truncate block" style={{ color: 'var(--text-primary)' }}>
                      {run.name ?? 'Test Run'}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {run.project?.name ?? '—'} · {timeAgo(run.createdAt)}
                    </span>
                  </div>
                </div>
                <Link
                  to={`/runs/${run.id}`}
                  className="flex items-center gap-1 text-xs font-medium shrink-0 ml-3 transition-opacity hover:opacity-80"
                  style={{ color: '#a78bfa' }}
                >
                  View Run <ExternalLink size={11} />
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
