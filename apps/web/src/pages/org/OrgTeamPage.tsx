import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  UserPlus, Trash2, UserCog, Users, Mail, Clock, ArrowRight, ChevronLeft,
} from 'lucide-react';
import { orgsApi, projectsApi, environmentsApi } from '@/lib/api';
import { useAuthStore, useActiveOrg } from '@/stores/authStore';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';
import { ClickUpUserLinkPanel } from '@/components/plugins/ClickUpUserLinkPanel';

// Extract a human-readable API error message from a thrown axios error.
function errMsg(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Member {
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

interface Invite {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt?: string;
}

// ── Role dropdown ─────────────────────────────────────────────────────────────

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
    onSuccess: (_data, role) => {
      qc.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Role updated', `Member is now ${role.replace('_', ' ').toLowerCase()}.`);
      setOpen(false);
    },
    onError: (err) => toast.error('Failed to update role', errMsg(err, 'Please try again.')),
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
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
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
                  color: role === currentRole ? 'var(--accent-400)' : 'var(--text-primary)',
                  background: role === currentRole ? 'rgba(var(--accent-rgb),0.12)' : 'transparent',
                }}
                onClick={() => mutation.mutate(role)}
                disabled={mutation.isPending}
              >
                {role === 'ORG_ADMIN' ? 'Org Admin' : 'Member'}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────

// ── Project + env assignments inside the invite modal ────────────────────────
//
// Lets an admin pre-scope which projects + environments the invitee will get
// when they accept. Each entry maps 1:1 to a ProjectMember row created server
// side (see organisations.service acceptInvite). Empty list = pure org invite.

const PROJECT_ROLES = ['OWNER', 'TECH_LEAD', 'DEVELOPER', 'QA_ENGINEER', 'MANAGER'] as const;

function ProjectAssignmentsEditor({
  orgProjects, assignments, setAssignments,
}: {
  orgProjects: { id: string; name: string }[];
  assignments: { projectId: string; role: string; allowedEnvironmentIds: string[] }[];
  setAssignments: React.Dispatch<React.SetStateAction<{ projectId: string; role: string; allowedEnvironmentIds: string[] }[]>>;
}) {
  const remainingProjects = orgProjects.filter(p => !assignments.find(a => a.projectId === p.id));

  const addRow = () => {
    if (remainingProjects.length === 0) return;
    setAssignments(prev => [...prev, {
      projectId: remainingProjects[0].id,
      role: 'QA_ENGINEER',
      allowedEnvironmentIds: [],
    }]);
  };
  const removeRow = (idx: number) => setAssignments(prev => prev.filter((_, i) => i !== idx));
  const updateRow = (idx: number, patch: Partial<typeof assignments[number]>) =>
    setAssignments(prev => prev.map((a, i) => i === idx ? { ...a, ...patch } : a));

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
          Project access (optional)
        </label>
        {orgProjects.length > 0 && remainingProjects.length > 0 && (
          <button
            onClick={addRow}
            className="text-[11px] px-2 py-0.5 rounded-md"
            style={{ background: 'rgba(var(--accent-rgb),0.15)', border: '1px solid rgba(var(--accent-rgb),0.35)', color: 'var(--accent-300)' }}
          >
            + Add project
          </button>
        )}
      </div>
      {assignments.length === 0 ? (
        <p className="text-[11px]" style={{ color: 'rgba(238,238,248,0.45)' }}>
          {orgProjects.length === 0
            ? 'No projects to assign yet.'
            : 'No projects assigned — invitee will land at the org level only.'}
        </p>
      ) : (
        <div className="space-y-2">
          {assignments.map((a, idx) => (
            <AssignmentRow
              key={idx}
              assignment={a}
              orgProjects={orgProjects}
              otherSelectedProjectIds={assignments.filter((_, i) => i !== idx).map(x => x.projectId)}
              onChange={patch => updateRow(idx, patch)}
              onRemove={() => removeRow(idx)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AssignmentRow({
  assignment, orgProjects, otherSelectedProjectIds, onChange, onRemove,
}: {
  assignment: { projectId: string; role: string; allowedEnvironmentIds: string[] };
  orgProjects: { id: string; name: string }[];
  otherSelectedProjectIds: string[];
  onChange: (patch: Partial<{ projectId: string; role: string; allowedEnvironmentIds: string[] }>) => void;
  onRemove: () => void;
}) {
  const { data: envs = [] } = useQuery<{ id: string; name: string; type: string }[]>({
    queryKey: ['envs-for-invite', assignment.projectId],
    queryFn: () => environmentsApi.list(assignment.projectId),
    enabled: !!assignment.projectId,
  });
  const allEnvs = assignment.allowedEnvironmentIds.length === 0;
  const toggleEnv = (id: string) => {
    const next = assignment.allowedEnvironmentIds.includes(id)
      ? assignment.allowedEnvironmentIds.filter(x => x !== id)
      : [...assignment.allowedEnvironmentIds, id];
    onChange({ allowedEnvironmentIds: next });
  };
  const projectOptions = orgProjects.filter(p => p.id === assignment.projectId || !otherSelectedProjectIds.includes(p.id));

  return (
    <div className="rounded-lg p-2 space-y-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}>
      <div className="flex gap-2">
        <select
          value={assignment.projectId}
          onChange={e => onChange({ projectId: e.target.value, allowedEnvironmentIds: [] })}
          className="flex-1 text-xs rounded px-2 py-1"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-primary)' }}
        >
          {projectOptions.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select
          value={assignment.role}
          onChange={e => onChange({ role: e.target.value })}
          className="text-xs rounded px-2 py-1"
          style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.10)', color: 'var(--text-primary)' }}
        >
          {PROJECT_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
        <button onClick={onRemove} className="text-xs px-2 rounded" style={{ color: '#f87171' }}>×</button>
      </div>
      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => onChange({ allowedEnvironmentIds: [] })}
          className="text-[10px] px-1.5 py-0.5 rounded"
          style={{
            background: allEnvs ? 'rgba(var(--accent-rgb),0.18)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${allEnvs ? 'rgba(var(--accent-rgb),0.40)' : 'rgba(255,255,255,0.10)'}`,
            color: allEnvs ? 'var(--accent-300)' : 'rgba(238,238,248,0.55)',
          }}
        >
          All envs
        </button>
        {envs.map(e => {
          const on = assignment.allowedEnvironmentIds.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => toggleEnv(e.id)}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{
                background: on ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${on ? 'rgba(56,189,248,0.40)' : 'rgba(255,255,255,0.10)'}`,
                color: on ? '#7dd3fc' : 'rgba(238,238,248,0.60)',
              }}
            >
              {e.name}{on && ' ✓'}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function InviteModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ email: '', role: 'ORG_MEMBER', name: '' });
  const [sent, setSent] = useState(false);

  // Optional pre-scoped project + env access. Empty array = org-only invite
  // (legacy behaviour). Each entry maps to one ProjectMember row created on
  // accept; allowedEnvironmentIds=[] means access to all envs in that project.
  type ProjectAssignment = { projectId: string; role: string; allowedEnvironmentIds: string[] };
  const [assignments, setAssignments] = useState<ProjectAssignment[]>([]);

  // Pull org's projects + their environments for the picker. We fetch envs
  // lazily per project to avoid N queries when the user isn't even using
  // the assignment UI.
  const { data: orgProjects = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['projects-for-invite', orgId],
    // projectsApi.list returns ALL projects in active org for this user
    queryFn: () => projectsApi.list(),
  });

  const mutation = useMutation({
    mutationFn: () => orgsApi.inviteMember(orgId, {
      email: form.email,
      role: form.role,
      name: form.name || undefined,
      ...(assignments.length > 0 ? { projectAssignments: assignments } : {}),
    }),
    onSuccess: (res: unknown) => {
      qc.invalidateQueries({ queryKey: ['org-invites', orgId] });
      const recipientType = (res as { recipientType?: 'EXISTING_USER' | 'NEW_USER' })?.recipientType;
      const detail = recipientType === 'EXISTING_USER'
        ? `${form.email} already has an account. Invite sent to join this organisation.`
        : `${form.email} will get an email to create/login and accept the invite.`;
      toast.success('Invite sent', detail);
      setSent(true);
    },
    onError: (err) => toast.error('Failed to send invite', errMsg(err, 'Please try again.')),
  });

  return (
    <Modal open onClose={onClose} title="Invite Member" size="sm">
      {sent ? (
        <div className="text-center py-4 space-y-3">
          <Mail size={28} className="mx-auto" style={{ color: '#34d399' }} />
          <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
            Invite sent to <strong>{form.email}</strong>
          </p>
          <Button onClick={onClose} variant="secondary" size="sm">Close</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Email *</label>
            <input
              type="email"
              value={form.email}
              onChange={e => setForm(p => ({ ...p, email: e.target.value }))}
              placeholder="colleague@company.com"
              className="w-full text-sm rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Name (optional)</label>
            <input
              type="text"
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="Their name"
              className="w-full text-sm rounded-xl px-3 py-2"
              style={{
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(255,255,255,0.10)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
            <div className="flex gap-2">
              {(['ORG_MEMBER', 'ORG_ADMIN'] as const).map(role => (
                <button
                  key={role}
                  onClick={() => setForm(p => ({ ...p, role }))}
                  className="flex-1 py-2 rounded-xl text-xs font-medium transition-all"
                  style={{
                    background: form.role === role ? 'rgba(var(--accent-rgb),0.30)' : 'rgba(255,255,255,0.04)',
                    border: form.role === role ? '1px solid rgba(var(--accent-rgb),0.40)' : '1px solid rgba(255,255,255,0.08)',
                    color: form.role === role ? 'var(--accent-300)' : 'rgba(238,238,248,0.50)',
                  }}
                >
                  {role === 'ORG_ADMIN' ? 'Org Admin' : 'Member'}
                </button>
              ))}
            </div>
          </div>
          {/* Optional project + env scoping — applied automatically on accept */}
          <ProjectAssignmentsEditor
            orgProjects={orgProjects}
            assignments={assignments}
            setAssignments={setAssignments}
          />

          {mutation.isError && (
            <p className="text-xs" style={{ color: '#f87171' }}>Failed to send invite. Please try again.</p>
          )}
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              size="sm"
              loading={mutation.isPending}
              disabled={!form.email}
              onClick={() => mutation.mutate()}
            >
              <Mail size={13} /> Send Invite
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function OrgTeamPage() {
  const { user, activeOrgId } = useAuthStore();
  const activeOrg = useActiveOrg();
  const qc = useQueryClient();
  const [showInvite, setShowInvite] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Member | null>(null);

  const orgId = activeOrgId ?? '';
  const orgName = activeOrg?.org?.name ?? 'Your Organisation';

  const { data: members = [], isLoading: loadingMembers } = useQuery<Member[]>({
    queryKey: ['org-members', orgId],
    queryFn: () => orgsApi.getMembers(orgId),
    enabled: !!orgId,
  });

  const { data: invites = [], isLoading: loadingInvites } = useQuery<Invite[]>({
    queryKey: ['org-invites', orgId],
    queryFn: () => orgsApi.listInvites(orgId),
    enabled: !!orgId,
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => orgsApi.removeMember(orgId, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members', orgId] });
      toast.success('Member removed');
      setRemoveTarget(null);
    },
    onError: (err) => toast.error('Failed to remove member', errMsg(err, 'Please try again.')),
  });

  const cancelInvite = useMutation({
    mutationFn: (inviteId: string) => orgsApi.cancelInvite(orgId, inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-invites', orgId] });
      toast.success('Invite cancelled');
    },
    onError: (err) => toast.error('Failed to cancel invite', errMsg(err, 'Please try again.')),
  });

  if (loadingMembers) return <PageSpinner />;

  const memberList = members as Member[];
  const inviteList = invites as Invite[];
  const adminCount = memberList.filter(m => m.role === 'ORG_ADMIN').length;

  // Pending access requests count (link to /org/access-requests)
  // We don't fetch it here — just show the link

  return (
    <div className="space-y-7">
      <Link to="/org" className="inline-flex items-center gap-1 text-xs hover:opacity-80" style={{ color: 'var(--text-muted)' }}>
        <ChevronLeft className="w-3.5 h-3.5" /> Back to Organisation
      </Link>
      {/* ── Header ─── */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Team</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            Your organisation · <span style={{ color: 'var(--accent-400)' }}>{orgName}</span>
          </p>
        </div>
        <Button onClick={() => setShowInvite(true)}>
          <UserPlus size={14} /> Invite Member
        </Button>
      </div>

      {/* ── Members Table ─── */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Members ({memberList.length})
          </h3>
        </div>
        <Card>
          {memberList.length === 0 ? (
            <CardContent>
              <EmptyState
                icon={Users}
                title="No members yet"
                description="Invite your team to get started."
                action={<Button onClick={() => setShowInvite(true)}><UserPlus size={14} /> Invite Member</Button>}
              />
            </CardContent>
          ) : (
            <Table cards>
              <Thead>
                <Tr>
                  <Th>Name</Th>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Joined</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {memberList.map(m => {
                  const isMe = m.userId === user?.id;
                  const isLastAdmin = m.role === 'ORG_ADMIN' && adminCount <= 1;
                  const canModify = !isMe && !isLastAdmin;

                  return (
                    <Tr key={m.userId}>
                      <Td label="Name">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'rgba(var(--accent-rgb),0.20)', color: 'var(--accent-300)' }}
                          >
                            {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{m.user.name}</span>
                          {isMe && (
                            <Badge variant="muted">You</Badge>
                          )}
                        </div>
                      </Td>
                      <Td label="Email"><span style={{ color: 'var(--text-muted)' }}>{m.user.email}</span></Td>
                      <Td label="Role">
                        <Badge variant={m.role === 'ORG_ADMIN' ? 'info' : 'default'}>{m.role}</Badge>
                      </Td>
                      <Td label="Joined">
                        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDate(m.createdAt)}
                        </span>
                      </Td>
                      <Td label="Actions">
                        <div className="flex items-center gap-2">
                          {!isMe && (
                            <>
                              <RoleDropdown
                                orgId={orgId}
                                userId={m.userId}
                                currentRole={m.role}
                                disabled={isLastAdmin}
                              />
                              <button
                                className="p-1.5 rounded-lg transition-colors"
                                style={{ color: canModify ? '#f87171' : 'rgba(239,68,68,0.25)' }}
                                disabled={!canModify}
                                title={
                                  isLastAdmin
                                    ? 'Cannot remove the last org admin'
                                    : 'Remove member'
                                }
                                onClick={() => canModify && setRemoveTarget(m)}
                              >
                                <Trash2 size={13} />
                              </button>
                            </>
                          )}
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

      {/* ── Pending Invites ─── */}
      {!loadingInvites && inviteList.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Pending Invites ({inviteList.length})
          </h3>
          <Card>
            <Table cards>
              <Thead>
                <Tr>
                  <Th>Email</Th>
                  <Th>Role</Th>
                  <Th>Invited</Th>
                  <Th>Actions</Th>
                </Tr>
              </Thead>
              <Tbody>
                {inviteList.map(inv => (
                  <Tr key={inv.id}>
                    <Td label="Email">
                      <div className="flex items-center gap-2">
                        <Mail size={13} style={{ color: 'rgba(238,238,248,0.40)' }} />
                        <span style={{ color: 'var(--text-primary)' }}>{inv.email}</span>
                      </div>
                    </Td>
                    <Td label="Role"><Badge variant="default">{inv.role}</Badge></Td>
                    <Td label="Invited">
                      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                        <Clock size={11} />
                        {formatDate(inv.createdAt)}
                      </div>
                    </Td>
                    <Td label="Actions">
                      <Button
                        size="sm"
                        variant="danger"
                        loading={cancelInvite.isPending}
                        onClick={() => cancelInvite.mutate(inv.id)}
                      >
                        Cancel
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          </Card>
        </div>
      )}

      {/* ── Access Requests link ─── */}
      <div
        className="flex items-center justify-between rounded-xl px-4 py-3"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
      >
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <Users size={14} />
          <span>Access requests from users wanting to join your organisation</span>
        </div>
        <Link
          to="/org/access-requests"
          className="flex items-center gap-1 text-xs font-medium shrink-0 transition-opacity hover:opacity-80"
          style={{ color: 'var(--accent-400)' }}
        >
          View Requests <ArrowRight size={12} />
        </Link>
      </div>

      {/* ClickUp ↔ QA user links — self-gates on a healthy ClickUp install. */}
      {orgId && <ClickUpUserLinkPanel orgId={orgId} />}

      {/* ── Modals ─── */}
      {showInvite && <InviteModal orgId={orgId} onClose={() => setShowInvite(false)} />}

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
              from <strong style={{ color: 'var(--text-primary)' }}>{orgName}</strong>? They will lose all access.
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
