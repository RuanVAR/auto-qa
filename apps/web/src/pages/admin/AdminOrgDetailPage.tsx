import { useState, useRef, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ChevronLeft, Users, FolderOpen, Layers, CheckSquare,
  Play, UserCog, Trash2, AlertCircle, Image as ImageIcon, Upload, Save, UserPlus,
  KeyRound, Ban, UserCheck,
} from 'lucide-react';
import { adminApi, orgsApi, uploadsApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { Modal } from '@/components/ui/Modal';
import { toast } from '@/components/ui/Toast';
import { formatDate, errMsg } from '@/lib/utils';

const SHIELD = '/brand/shield-256.png';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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
  website?: string | null;
  description?: string | null;
  logoUrl?: string | null;
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

// ── Org settings editor (name / website / description / logo) ─────────────────

function OrgSettingsCard({ org }: { org: OrgDetail }) {
  const qc = useQueryClient();
  const orgId = org.id;
  const inputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(org.name);
  const [website, setWebsite] = useState(org.website ?? '');
  const [description, setDescription] = useState(org.description ?? '');
  const [pending, setPending] = useState<{ file: File; objectUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed when the loaded org changes.
  useEffect(() => {
    setName(org.name); setWebsite(org.website ?? ''); setDescription(org.description ?? '');
  }, [org.id, org.name, org.website, org.description]);

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-org', orgId] });

  const saveDetails = useMutation({
    mutationFn: () => orgsApi.update(orgId, { name: name.trim(), website: website.trim(), description: description.trim() }),
    onSuccess: () => { refresh(); toast.success('Settings saved'); },
    onError: () => toast.error('Save failed'),
  });

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) { toast.error('Unsupported file', 'Choose a PNG, JPG, WebP or SVG image.'); return; }
    if (file.size > LOGO_MAX_BYTES) { toast.error('File too large', 'Logo must be 2 MB or smaller.'); return; }
    setPending({ file, objectUrl: URL.createObjectURL(file) });
  };

  const saveLogo = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const uploaded = await uploadsApi.upload(pending.file);
      await orgsApi.update(orgId, { logoUrl: uploaded.url });
      URL.revokeObjectURL(pending.objectUrl);
      setPending(null);
      refresh();
      toast.success('Logo updated');
    } catch { toast.error('Logo upload failed'); }
    finally { setBusy(false); }
  };

  const removeLogo = async () => {
    setBusy(true);
    try { await orgsApi.update(orgId, { logoUrl: null }); refresh(); toast.success('Logo removed'); }
    catch { toast.error('Remove failed'); }
    finally { setBusy(false); }
  };

  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 border border-white/10 focus:border-purple-500 focus:outline-none';

  return (
    <div>
      <h3 className="text-sm font-semibold uppercase tracking-widest mb-3" style={{ color: 'rgba(238,238,248,0.40)' }}>Settings</h3>
      <Card>
        <CardContent className="p-5 space-y-5">
          {/* Logo */}
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-xl flex items-center justify-center overflow-hidden border border-white/10" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <img src={pending?.objectUrl ?? org.logoUrl ?? SHIELD} alt={org.name} className="w-full h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).src = SHIELD; }} />
            </div>
            <div className="flex items-center gap-2">
              <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="hidden" onChange={pickFile} />
              {pending ? (
                <>
                  <Button size="sm" onClick={saveLogo} loading={busy} disabled={busy}>Save logo</Button>
                  <Button size="sm" variant="ghost" onClick={() => { URL.revokeObjectURL(pending.objectUrl); setPending(null); }} disabled={busy}>Discard</Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" onClick={() => inputRef.current?.click()}><Upload size={13} /> Change logo</Button>
                  {org.logoUrl && <Button size="sm" variant="ghost" onClick={removeLogo} disabled={busy}><Trash2 size={13} /> Remove</Button>}
                </>
              )}
            </div>
          </div>

          {/* Text fields */}
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Name</label>
              <input className={inputCls} style={{ background: 'rgba(255,255,255,0.05)' }} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Website</label>
              <input className={inputCls} style={{ background: 'rgba(255,255,255,0.05)' }} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="https://…" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Description</label>
            <input className={inputCls} style={{ background: 'rgba(255,255,255,0.05)' }} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What this org is for" />
          </div>
          <div className="flex justify-end">
            <Button size="sm" onClick={() => saveDetails.mutate()} loading={saveDetails.isPending} disabled={!name.trim()}>
              <Save size={13} /> Save settings
            </Button>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>The slug (<span className="font-mono">{org.slug}</span>) is fixed and can't be changed.</p>
        </CardContent>
      </Card>
    </div>
  );
}

// ── Invite member modal ───────────────────────────────────────────────────────

function InviteMemberModal({ orgId, onClose }: { orgId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('ORG_MEMBER');

  const invite = useMutation({
    mutationFn: () => orgsApi.inviteMember(orgId, { email: email.trim(), role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-org', orgId] });
      toast.success('Invite sent', `${email.trim()} has been invited.`);
      onClose();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Invite failed', typeof msg === 'string' ? msg : 'Could not send the invite.');
    },
  });

  const valid = /\S+@\S+\.\S+/.test(email.trim());
  const inputCls = 'w-full px-3 py-2 rounded-lg text-sm text-slate-100 placeholder:text-slate-500 border border-white/10 focus:border-purple-500 focus:outline-none';

  return (
    <Modal open onClose={onClose} title="Invite member" size="sm">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Email</label>
          <input className={inputCls} style={{ background: 'rgba(255,255,255,0.05)' }} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="person@company.com" type="email" autoFocus />
        </div>
        <div>
          <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>Role</label>
          <select className={inputCls} style={{ background: 'rgba(255,255,255,0.05)' }} value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="ORG_MEMBER">Member</option>
            <option value="ORG_ADMIN">Org Admin</option>
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={invite.isPending} disabled={!valid} onClick={() => invite.mutate()}>Send invite</Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminOrgDetailPage() {
  const { orgId } = useParams<{ orgId: string }>();
  const qc = useQueryClient();
  const [removeTarget, setRemoveTarget] = useState<OrgMember | null>(null);
  const [showInvite, setShowInvite] = useState(false);

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

  // Account-status + reset use the GLOBAL admin endpoints (not the org-scoped
  // ones) — a platform admin has cross-org authority, so they must not be
  // caught by the org-scoped sole-org guard meant to restrain org admins.
  const suspendMember = useMutation({
    mutationFn: (userId: string) => adminApi.suspendUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-org', orgId] });
      toast.success('Member suspended', 'They can no longer sign in until reactivated.');
    },
    onError: (err) => toast.error('Failed to suspend member', errMsg(err, 'Please try again.')),
  });
  const reactivateMember = useMutation({
    mutationFn: (userId: string) => adminApi.reactivateUser(userId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-org', orgId] });
      toast.success('Member reactivated', 'They can sign in again.');
    },
    onError: (err) => toast.error('Failed to reactivate member', errMsg(err, 'Please try again.')),
  });
  const sendPasswordReset = useMutation({
    mutationFn: (userId: string) => adminApi.sendUserPasswordReset(userId),
    onSuccess: (res: unknown) => {
      const msg = (res as { message?: string })?.message;
      toast.success('Password reset sent', msg ?? 'The member will receive a reset link.');
    },
    onError: (err) => toast.error('Failed to send password reset', errMsg(err, 'Please try again.')),
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

      {/* ── Settings ─── */}
      <OrgSettingsCard org={org} />

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
                  background: 'rgba(var(--accent-rgb),0.08)',
                  border: '1px solid rgba(var(--accent-rgb),0.20)',
                }}
              >
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                  style={{ background: 'rgba(var(--accent-rgb),0.25)', color: 'var(--accent-300)' }}
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Members
          </h3>
          <Button size="sm" variant="secondary" onClick={() => setShowInvite(true)}>
            <UserPlus size={13} /> Invite member
          </Button>
        </div>
        <Card>
          {members.length === 0 ? (
            <CardContent>
              <EmptyState icon={Users} title="No members" description="This organisation has no members." />
            </CardContent>
          ) : (
            <Table cards>
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
                      <Td label="Name">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                            style={{ background: 'rgba(var(--accent-rgb),0.20)', color: 'var(--accent-300)' }}
                          >
                            {m.user.name?.charAt(0)?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{m.user.name}</span>
                        </div>
                      </Td>
                      <Td label="Email"><span style={{ color: 'var(--text-muted)' }}>{m.user.email}</span></Td>
                      <Td label="Role">
                        <Badge variant={m.role === 'ORG_ADMIN' ? 'info' : 'default'}>{m.role}</Badge>
                      </Td>
                      <Td label="Status">
                        <Badge variant={m.user.accountStatus === 'ACTIVE' ? 'success' : 'warning'}>
                          {m.user.accountStatus}
                        </Badge>
                      </Td>
                      <Td label="Joined"><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(m.createdAt)}</span></Td>
                      <Td label="Actions">
                        <div className="flex items-center gap-2">
                          <RoleDropdown
                            orgId={orgId!}
                            userId={m.userId}
                            currentRole={m.role}
                            disabled={isLastAdmin}
                          />
                          <button
                            className="p-1.5 rounded-lg transition-colors"
                            style={{ color: 'var(--text-muted)' }}
                            title="Send a password-reset email to this member"
                            onClick={() => sendPasswordReset.mutate(m.userId)}
                          >
                            <KeyRound size={13} />
                          </button>
                          {m.user.accountStatus === 'ACTIVE' ? (
                            <button
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: '#f59e0b' }}
                              title="Suspend account (blocks sign-in)"
                              onClick={() => suspendMember.mutate(m.userId)}
                            >
                              <Ban size={13} />
                            </button>
                          ) : (
                            <button
                              className="p-1.5 rounded-lg transition-colors"
                              style={{ color: '#34d399' }}
                              title="Reactivate account (restore sign-in)"
                              onClick={() => reactivateMember.mutate(m.userId)}
                            >
                              <UserCheck size={13} />
                            </button>
                          )}
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
                    style={{ background: 'rgba(var(--accent-rgb),0.15)' }}
                  >
                    <FolderOpen size={13} style={{ color: 'var(--accent-400)' }} />
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
                  style={{ color: 'var(--accent-400)' }}
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

      {/* ── Invite member modal ─── */}
      {showInvite && <InviteMemberModal orgId={orgId!} onClose={() => setShowInvite(false)} />}
    </div>
  );
}
