import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, UserPlus, Trash2, Save, Shield } from 'lucide-react';
import { projectsApi, environmentsApi, orgsApi, projectsApi as p } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';

const ROLES = ['OWNER', 'TECH_LEAD', 'DEVELOPER', 'QA_ENGINEER', 'MANAGER'] as const;

type ProjectMemberRow = {
  id: string;
  role: typeof ROLES[number];
  allowedEnvironmentIds: string[];
  user: { id: string; name: string; email: string; accountStatus: string };
};

type Environment = { id: string; name: string; type: string; baseUrl: string };
type OrgMember = { user: { id: string; name: string; email: string }; role: string };

/**
 * Per-project access management. Implements the env-scoped RBAC model:
 *
 *   - Each row is a ProjectMember with a role (OWNER/TECH_LEAD/...)
 *   - Empty allowedEnvironmentIds = full access to every env
 *   - Non-empty = restricted to those env IDs only
 *
 * Org admins, project owners, and tech leads can manage. Everyone else gets
 * a read-only view (the API enforces the same rule, this is just to hide
 * mutation buttons).
 */
export function ProjectAccessPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => projectsApi.get(projectId!),
    enabled: !!projectId,
  });

  const { data: members = [] } = useQuery<ProjectMemberRow[]>({
    queryKey: ['project-members', projectId],
    queryFn: () => p.listMembers(projectId!),
    enabled: !!projectId,
  });

  const { data: envs = [] } = useQuery<Environment[]>({
    queryKey: ['environments', projectId],
    queryFn: () => environmentsApi.list(projectId!),
    enabled: !!projectId,
  });

  const orgId = (project as { orgId?: string } | undefined)?.orgId;
  const { data: orgMembers = [] } = useQuery<OrgMember[]>({
    queryKey: ['org-members', orgId],
    queryFn: () => orgsApi.getMembers(orgId!),
    enabled: !!orgId,
  });

  const updateMember = useMutation({
    mutationFn: (vars: { userId: string; role?: string; allowedEnvironmentIds?: string[] }) =>
      p.updateMember(projectId!, vars.userId, { role: vars.role, allowedEnvironmentIds: vars.allowedEnvironmentIds }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', projectId] });
      toast.success('Member updated', 'Access changes saved.');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Update failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const removeMember = useMutation({
    mutationFn: (userId: string) => p.removeMember(projectId!, userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', projectId] });
      toast.success('Member removed');
    },
  });

  const addMember = useMutation({
    mutationFn: (vars: { userId: string; role: string; allowedEnvironmentIds: string[] }) =>
      p.addMember(projectId!, vars),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['project-members', projectId] });
      setAddOpen(false);
      toast.success('Member added');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Add failed', typeof msg === 'string' ? msg : 'Try again.');
    },
  });

  const memberUserIds = new Set(members.map(m => m.user.id));
  const candidates = orgMembers.filter(om => !memberUserIds.has(om.user.id));

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <Link to={`/projects/${projectId}`}>
          <button className="p-2 rounded-lg text-gray-400 hover:bg-white/5"><ArrowLeft size={16} /></button>
        </Link>
        <div className="flex-1">
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: 'rgba(238,238,248,0.92)' }}>
            <Shield size={18} /> Access — {(project as { name?: string } | undefined)?.name ?? 'Project'}
          </h2>
          <p className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>
            Control who can run tests in this project, and which environments they can target.
          </p>
        </div>
        <Button onClick={() => setAddOpen(true)} disabled={candidates.length === 0}>
          <UserPlus size={14} /> Add member
        </Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Members ({members.length})</CardTitle></CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="text-sm text-center py-6" style={{ color: 'rgba(238,238,248,0.45)' }}>
              No members yet — add someone from your organisation.
            </div>
          ) : (
            <div className="space-y-2">
              {members.map(m => (
                <MemberRow
                  key={m.id}
                  member={m}
                  envs={envs}
                  onSave={(role, envIds) => updateMember.mutate({ userId: m.user.id, role, allowedEnvironmentIds: envIds })}
                  onRemove={() => {
                    if (confirm(`Remove ${m.user.name} from this project?`)) removeMember.mutate(m.user.id);
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add project member">
        <AddMemberForm
          candidates={candidates}
          envs={envs}
          onSubmit={(vars) => addMember.mutate(vars)}
          submitting={addMember.isPending}
        />
      </Modal>
    </div>
  );
}

// ─── Member row ──────────────────────────────────────────────────────────────

function MemberRow({
  member, envs, onSave, onRemove,
}: {
  member: ProjectMemberRow;
  envs: Environment[];
  onSave: (role: string, envIds: string[]) => void;
  onRemove: () => void;
}) {
  const [role, setRole] = useState(member.role as string);
  const [envIds, setEnvIds] = useState<string[]>(member.allowedEnvironmentIds);
  const dirty = role !== member.role || envIds.join(',') !== member.allowedEnvironmentIds.join(',');
  const allEnvs = envIds.length === 0;

  const toggleEnv = (id: string) => {
    setEnvIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  };

  return (
    <div
      className="rounded-xl p-3 space-y-3"
      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)' }}
    >
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium" style={{ color: 'rgba(238,238,248,0.92)' }}>
              {member.user.name}
            </p>
            <span className="text-xs" style={{ color: 'rgba(238,238,248,0.55)' }}>{member.user.email}</span>
            {member.user.accountStatus !== 'ACTIVE' && (
              <Badge variant="warning">{member.user.accountStatus}</Badge>
            )}
          </div>
        </div>
        <button
          onClick={onRemove}
          title="Remove from project"
          className="p-1.5 rounded text-red-400 hover:bg-red-500/10"
        >
          <Trash2 size={13} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Role</label>
          <select
            value={role}
            onChange={e => setRole(e.target.value)}
            className="w-full rounded-lg px-3 py-1.5 text-xs"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        <div className="md:col-span-2">
          <label className="text-[10px] uppercase tracking-wider mb-1 block flex items-center gap-2" style={{ color: 'rgba(238,238,248,0.45)' }}>
            Environments
            <span className="text-[10px] normal-case tracking-normal" style={{ color: 'rgba(238,238,248,0.40)' }}>
              ({allEnvs ? 'all' : `${envIds.length} of ${envs.length}`})
            </span>
          </label>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setEnvIds([])}
              className="text-[11px] px-2 py-1 rounded-md transition-all"
              style={{
                background: allEnvs ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${allEnvs ? 'rgba(168,85,247,0.40)' : 'rgba(255,255,255,0.10)'}`,
                color: allEnvs ? '#c4b5fd' : 'rgba(238,238,248,0.65)',
              }}
            >
              All envs
            </button>
            {envs.map(e => {
              const on = envIds.includes(e.id);
              return (
                <button
                  type="button"
                  key={e.id}
                  onClick={() => toggleEnv(e.id)}
                  className="text-[11px] px-2 py-1 rounded-md transition-all"
                  style={{
                    background: on ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${on ? 'rgba(56,189,248,0.40)' : 'rgba(255,255,255,0.10)'}`,
                    color: on ? '#7dd3fc' : 'rgba(238,238,248,0.65)',
                  }}
                  title={e.baseUrl}
                >
                  {e.name}
                  {on && ' ✓'}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {dirty && (
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={() => { setRole(member.role as string); setEnvIds(member.allowedEnvironmentIds); }}
            className="text-xs px-3 py-1.5 rounded-md"
            style={{ color: 'rgba(238,238,248,0.55)' }}
          >
            Cancel
          </button>
          <Button size="sm" onClick={() => onSave(role, envIds)}>
            <Save size={12} /> Save changes
          </Button>
        </div>
      )}
    </div>
  );
}

// ─── Add member form ─────────────────────────────────────────────────────────

function AddMemberForm({
  candidates, envs, onSubmit, submitting,
}: {
  candidates: OrgMember[];
  envs: Environment[];
  onSubmit: (vars: { userId: string; role: string; allowedEnvironmentIds: string[] }) => void;
  submitting: boolean;
}) {
  const [userId, setUserId] = useState(candidates[0]?.user.id ?? '');
  const [role, setRole] = useState<string>('QA_ENGINEER');
  const [envIds, setEnvIds] = useState<string[]>([]);
  const allEnvs = envIds.length === 0;
  const toggleEnv = (id: string) => setEnvIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>User</label>
        <select
          value={userId}
          onChange={e => setUserId(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
        >
          {candidates.map(om => (
            <option key={om.user.id} value={om.user.id}>{om.user.name} ({om.user.email})</option>
          ))}
        </select>
        {candidates.length === 0 && (
          <p className="text-xs mt-1" style={{ color: 'rgba(238,238,248,0.55)' }}>
            All organisation members are already in this project. Invite someone new from the Org Team page.
          </p>
        )}
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>Role</label>
        <select
          value={role}
          onChange={e => setRole(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: 'rgba(238,238,248,0.9)' }}
        >
          {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      <div>
        <label className="text-[10px] uppercase tracking-wider mb-1 block" style={{ color: 'rgba(238,238,248,0.45)' }}>
          Environments ({allEnvs ? 'all' : `${envIds.length} of ${envs.length}`})
        </label>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setEnvIds([])}
            className="text-[11px] px-2 py-1 rounded-md"
            style={{
              background: allEnvs ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.04)',
              border: `1px solid ${allEnvs ? 'rgba(168,85,247,0.40)' : 'rgba(255,255,255,0.10)'}`,
              color: allEnvs ? '#c4b5fd' : 'rgba(238,238,248,0.65)',
            }}
          >
            All envs
          </button>
          {envs.map(e => {
            const on = envIds.includes(e.id);
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => toggleEnv(e.id)}
                className="text-[11px] px-2 py-1 rounded-md"
                style={{
                  background: on ? 'rgba(56,189,248,0.18)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${on ? 'rgba(56,189,248,0.40)' : 'rgba(255,255,255,0.10)'}`,
                  color: on ? '#7dd3fc' : 'rgba(238,238,248,0.65)',
                }}
              >
                {e.name}{on && ' ✓'}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          loading={submitting}
          disabled={!userId}
          onClick={() => onSubmit({ userId, role, allowedEnvironmentIds: envIds })}
        >
          Add member
        </Button>
      </div>
    </div>
  );
}
