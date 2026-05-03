import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Users, FolderOpen, Layers, CheckSquare,
  Play, UserCog, Trash2, AlertCircle,
} from 'lucide-react';
import { adminApi, orgsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgMember {
  userId: string;
  role: string;
  createdAt: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string | null;
    accountStatus: string;
  };
}

interface OrgProject {
  id: string;
  name: string;
  slug: string;
  _count?: { modules?: number; features?: number; runs?: number };
}

interface OrgDetail {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  members: OrgMember[];
  projects: OrgProject[];
  _count?: {
    members?: number;
    projects?: number;
    modules?: number;
    testCases?: number;
    activeRuns?: number;
  };
}

// ── Role change dropdown ──────────────────────────────────────────────────────

function RoleDropdown({
  orgId,
  userId,
  currentRole,
  disabled,
}: {
  orgId: string;
  userId: string;
  currentRole: string;
  disabled?: boolean;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const mutation = useMutation({
    mutationFn: (role: string) => orgsApi.updateMemberRole(orgId, userId, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-org', orgId] });
      setOpen(false);
    },
  });

  const roles = ['ORG_ADMIN', 'ORG_MEMBER'];

  return (
    <div className="relative inline-block">
      <Button
        size="sm"
        variant="secondary"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
      >
        <UserCog size={12} />
        {currentRole === 'ORG_ADMIN' ? 'Admin' : 'Member'}
        <span style={{ fontSize: '10px' }}>▼</span>
      </Button>
      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 rounded-xl overflow-hidden min-w-[140px]"
          style={{
            background: 'rgba(20,20,35,0.98)',
            border: '1px solid rgba(255,255,255,0.12)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.60)',
          }}
        >
          {roles.map(role => (
            <button
              key={role}
              className="w-full text-left px-3 py-2 text-xs transition-colors"
              style={{
                color: role === currentRole ? '#a78bfa' : 'var(--text-primary)',
                background: role === currentRole ? 'rgba(139,92,246,0.12)' : 'transparent',
              }}
              onClick={() => mutation.mutate(role)}
              disabled={mutation.isPending}
            >
              {role === 'ORG_ADMIN' ? 'Org Admin' : 'Member'}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Stat mini card ────────────────────────────────────────────────────────────

function MiniStat({ label, value, icon: Icon }: { label: string; value: number; icon: React.ElementType }) {
  return (
    <div
      className="rounded-2xl p-4 flex flex-col gap-2"
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(20px)',
      }}
    >
      <div className="flex items-center gap-1.5" style={{ color: 'rgba(238,238,248,0.40)' }}>
        <Icon size={13} />
        <span className="text-xs uppercase tracking-widest font-medium">{label}</span>
      </div>
      <span className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin-org', orgId],
    queryFn: () => adminApi.getOrgDetail(orgId!),
    enabled: !!orgId,
  });

  const toggleActive = useMutation({
    mutationFn: (isActive: boolean) => orgsApi.update(orgId!, { isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-org', orgId] }),
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => orgsApi.removeMember(orgId!, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-org', orgId] });
      setRemoveTarget(null);
    },
  });

  if (isLoading) return <PageSpinner />;
  if (error || !data) {
    return (
      <div className="flex flex-col items-center gap-4 py-16">
        <AlertCircle size={32} style={{ color: '#f87171' }} />
        <p style={{ color: 'var(--text-muted)' }}>Failed to load organisation details.</p>
        <Link to="/admin"><Button variant="secondary">Back to Admin</Button></Link>
      </div>
    );
  }

  const org = data as OrgDetail;
  const members: OrgMember[] = org.members ?? [];
  const projects: OrgProject[] = org.projects ?? [];

  const adminMembers = members.filter(m => m.role === 'ORG_ADMIN');
  const adminCount = adminMembers.length;

  const memberCount  = org._count?.members  ?? members.length;
  const projectCount = org._count?.projects ?? projects.length;
  const moduleCount  = org._count?.modules  ?? 0;
  const testCount    = org._count?.testCases ?? 0;
  const activeRuns   = org._count?.activeRuns ?? 0;

  return (
    <div className="space-y-6">
      {/* ── Back link + Header ─── */}
      <div>
        <Link
          to="/admin"
          className="inline-flex items-center gap-1.5 text-xs font-medium mb-4 transition-opacity hover:opacity-80"
          style={{ color: 'rgba(238,238,248,0.50)' }}
        >
          <ChevronLeft size={14} /> Back to Admin
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>{org.name}</h2>
              <span
                className="font-mono text-xs px-2 py-1 rounded-md"
                style={{ background: 'rgba(255,255,255,0.07)', color: 'rgba(238,238,248,0.55)' }}
              >
                {org.slug}
              </span>
              <Badge variant={org.isActive ? 'success' : 'danger'}>
                {org.isActive ? 'Active' : 'Suspended'}
              </Badge>
            </div>
            <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
              Created {formatDate(org.createdAt)}
            </p>
          </div>

          <Button
            variant={org.isActive ? 'danger' : 'secondary'}
            size="sm"
            loading={toggleActive.isPending}
            onClick={() => toggleActive.mutate(!org.isActive)}
          >
            {org.isActive ? 'Suspend Org' : 'Reactivate Org'}
          </Button>
        </div>
      </div>

      {/* ── Stats row ─── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <MiniStat label="Members"    value={memberCount}  icon={Users}        />
        <MiniStat label="Projects"   value={projectCount} icon={FolderOpen}   />
        <MiniStat label="Modules"    value={moduleCount}  icon={Layers}       />
        <MiniStat label="Test Cases" value={testCount}    icon={CheckSquare}  />
        <MiniStat label="Active Runs" value={activeRuns}  icon={Play}         />
      </div>

      {/* ── Org Admin ─── */}
      {adminMembers.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Org Admin{adminMembers.length > 1 ? 's' : ''}
          </h3>
          <div className="flex flex-wrap gap-3">
            {adminMembers.map(m => (
              <div
                key={m.userId}
                className="flex items-center gap-3 rounded-xl px-4 py-3"
                style={{
                  background: 'rgba(139,92,246,0.08)',
                  border: '1px solid rgba(139,92,246,0.20)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'rgba(139,92,246,0.25)', color: '#c4b5fd' }}
                >
                  {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
                </div>
                <div>
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{m.user.name}</p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{m.user.email}</p>
                </div>
                <Badge variant="info">ORG_ADMIN</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Members Table ─── */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Members
        </h3>
        <Card>
          {members.length === 0 ? (
            <CardContent>
              <EmptyState icon={Users} title="No members" description="This organisation has no members." />
            </CardContent>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Joined</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {members.map(m => {
                  const isLastAdmin = m.role === 'ORG_ADMIN' && adminCount <= 1;
                  return (
                    <Tr key={m.userId}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'rgba(139,92,246,0.20)', color: '#c4b5fd' }}
                          >
                            {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{m.user.name}</span>
                        </div>
                      </Td>
                      <Td><span style={{ color: 'var(--text-muted)' }}>{m.user.email}</span></Td>
                      <Td>
                        <Badge variant={m.role === 'ORG_ADMIN' ? 'info' : 'default'}>{m.role}</Badge>
                      </Td>
                      <Td>
                        <Badge variant={m.user.accountStatus === 'ACTIVE' ? 'success' : 'warning'}>
                          {m.user.accountStatus}
                        </Badge>
                      </Td>
                      <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(m.createdAt)}</span></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <RoleDropdown
                            orgId={orgId!}
                            userId={m.userId}
                            currentRole={m.role}
                            disabled={isLastAdmin}
                          />
                          <button
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: isLastAdmin ? 'rgba(239,68,68,0.30)' : '#f87171' }}
                            disabled={isLastAdmin}
                            title={isLastAdmin ? 'Cannot remove the last org admin' : 'Remove member'}
                            onClick={() => !isLastAdmin && setRemoveTarget(m)}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </Card>
      </div>

      {/* ── Projects List ─── */}
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Projects
        </h3>
        {projects.length === 0 ? (
          <div
            className="rounded-2xl px-5 py-8 flex flex-col items-center gap-2 text-center"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            <FolderOpen size={24} style={{ color: 'rgba(238,238,248,0.25)' }} />
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No projects yet</p>
          </div>
        ) : (
          <div
            className="rounded-2xl overflow-hidden"
            style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
          >
            {projects.map((project, idx) => (
              <div
                key={project.id}
                className="flex items-center justify-between px-5 py-3.5"
                style={{
                  borderBottom: idx < projects.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div
                    className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(139,92,246,0.15)' }}
                  >
                    <FolderOpen size={13} style={{ color: '#a78bfa' }} />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{project.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {project._count?.modules ?? 0} modules · {project._count?.features ?? 0} features · {project._count?.runs ?? 0} runs
                    </p>
                  </div>
                </div>
                <Link
                  to={`/projects/${project.id}`}
                  className="text-xs font-medium shrink-0 ml-3 transition-opacity hover:opacity-80"
                  style={{ color: '#a78bfa' }}
                >
                  Open →
                </Link>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Remove confirm modal ─── */}
      <Modal
        open={!!removeTarget}
        onClose={() => setRemoveTarget(null)}
        title="Remove Member"
        size="sm"
      >
        {removeTarget && (
          <div className="space-y-4">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              Are you sure you want to remove{' '}
              <strong style={{ color: 'var(--text-primary)' }}>{removeTarget.user.name}</strong>{' '}
              from this organisation? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setRemoveTarget(null)}>Cancel</Button>
              <Button
                variant="danger"
                loading={removeMember.isPending}
                onClick={() => removeMember.mutate(removeTarget.userId)}
              >
                <Trash2 size={13} /> Remove
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
