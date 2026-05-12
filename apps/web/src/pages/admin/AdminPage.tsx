import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Settings, Users, ClipboardList, Plus, Pencil, Trash2,
  Eye, EyeOff, ChevronLeft, ChevronRight, ShieldCheck,
  CheckCircle, XCircle, Activity, Building2,
  RefreshCw, ArrowRight, UserPlus,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { Card, CardContent } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { PageSpinner } from '@/components/ui/Spinner';
import { StatCard } from '@/components/ui/StatCard';
import { Table, Thead, Tbody, Th, Td, Tr } from '@/components/ui/Table';
import { formatDate } from '@/lib/utils';
import { toast } from '@/components/ui/Toast';

function errMsg(err: unknown, fallback: string): string {
  const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
  return typeof msg === 'string' ? msg : fallback;
}

type Tab = 'overview' | 'orgs' | 'users' | 'config' | 'audit';

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview',  icon: Activity      },
  { id: 'orgs',     label: 'Organisations', icon: Building2 },
  { id: 'users',    label: 'Users',     icon: Users         },
  { id: 'config',   label: 'Config',    icon: Settings      },
  { id: 'audit',    label: 'Audit Log', icon: ClipboardList },
];

// ── Org status card ───────────────────────────────────────────────────────────

function OrgStatusCard({ orgs }: { orgs: { isActive?: boolean }[] }) {
  const active  = orgs.filter(o => o.isActive !== false).length;
  const blocked = orgs.filter(o => o.isActive === false).length;

  return (
    <div
      className="rounded-2xl p-5 relative overflow-hidden"
      style={{
        background: 'rgba(255,255,255,0.04)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        border: '1px solid rgba(255,255,255,0.08)',
        boxShadow: '0 4px 24px rgba(0,0,0,0.40), inset 0 1px 0 rgba(255,255,255,0.05)',
      }}
    >
      <span className="text-xs font-medium uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
        ORG STATUS
      </span>
      <div className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2" style={{ color: '#34d399' }}>
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#34d399' }} />
            Active
          </span>
          <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{active}</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2" style={{ color: '#f87171' }}>
            <span className="text-base leading-none">✕</span>
            Blocked
          </span>
          <span className="font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{blocked}</span>
        </div>
      </div>
    </div>
  );
}

// ── Config section ────────────────────────────────────────────────────────────
function ConfigSection() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ key: '', value: '', isSecret: false, category: '' });

  const { data: configs = [], isLoading } = useQuery({
    queryKey: ['admin-config'],
    queryFn: adminApi.listConfig,
  });

  const create = useMutation({
    mutationFn: () => adminApi.createConfig(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Config created', `${form.key} saved.`);
      setShowCreate(false);
      setForm({ key: '', value: '', isSecret: false, category: '' });
    },
    onError: (err) => toast.error('Failed to create config', errMsg(err, 'Please try again.')),
  });
  const update = useMutation({
    mutationFn: () => adminApi.updateConfig(editKey!, editVal),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Config updated');
      setEditKey(null);
    },
    onError: (err) => toast.error('Failed to update config', errMsg(err, 'Please try again.')),
  });
  const del = useMutation({
    mutationFn: (key: string) => adminApi.deleteConfig(key),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-config'] });
      toast.success('Config deleted');
    },
    onError: (err) => toast.error('Failed to delete config', errMsg(err, 'Please try again.')),
  });

  if (isLoading) return <PageSpinner />;
  const list = configs as { id: string; key: string; value: string; isSecret: boolean; category?: string }[];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}><Plus size={14} /> Add Config</Button>
      </div>
      <Card>
        {list.length === 0 ? (
          <CardContent><EmptyState icon={Settings} title="No config entries" description="Add platform config like API keys and webhook URLs." action={<Button onClick={() => setShowCreate(true)}><Plus size={14} /> Add Config</Button>} /></CardContent>
        ) : (
          <Table>
            <Thead><Tr><Th>Key</Th><Th>Category</Th><Th>Value</Th><Th></Th></Tr></Thead>
            <Tbody>
              {list.map(cfg => (
                <Tr key={cfg.id}>
                  <Td><span className="font-mono text-xs">{cfg.key}</span></Td>
                  <Td>{cfg.category && <Badge variant="default">{cfg.category}</Badge>}</Td>
                  <Td>
                    {editKey === cfg.key ? (
                      <div className="flex items-center gap-2">
                        <input className="flex-1 text-sm" value={editVal} onChange={e => setEditVal(e.target.value)} />
                        <Button size="sm" loading={update.isPending} onClick={() => update.mutate()}>Save</Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditKey(null)}>Cancel</Button>
                      </div>
                    ) : (
                      <span className="font-mono text-xs">
                        {cfg.isSecret
                          ? (revealed.has(cfg.key) ? cfg.value : '••••••••')
                          : cfg.value}
                      </span>
                    )}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      {cfg.isSecret && (
                        <button onClick={() => setRevealed(s => { const n = new Set(s); n.has(cfg.key) ? n.delete(cfg.key) : n.add(cfg.key); return n; })}
                          className="p-1 rounded" style={{ color: 'rgba(238,238,248,0.45)' }}>
                          {revealed.has(cfg.key) ? <EyeOff size={13} /> : <Eye size={13} />}
                        </button>
                      )}
                      <button onClick={() => { setEditKey(cfg.key); setEditVal(cfg.value); }}
                        className="p-1 rounded" style={{ color: 'rgba(238,238,248,0.45)' }}><Pencil size={13} /></button>
                      <button onClick={() => del.mutate(cfg.key)}
                        className="p-1 rounded hover:text-red-400" style={{ color: 'rgba(238,238,248,0.45)' }}><Trash2 size={13} /></button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Add Config Entry">
        <div className="space-y-4">
          <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Key</label><input className="w-full" value={form.key} onChange={e => setForm(p => ({ ...p, key: e.target.value }))} placeholder="JIRA_URL" /></div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Value</label><input className="w-full" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))} placeholder="https://..." /></div>
          <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Category</label><input className="w-full" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} placeholder="URL, CREDENTIAL..." /></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <input type="checkbox" checked={form.isSecret} onChange={e => setForm(p => ({ ...p, isSecret: e.target.checked }))} />
            Secret (mask value in UI)
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button loading={create.isPending} disabled={!form.key || !form.value} onClick={() => create.mutate()}><Plus size={14} /> Add</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Users section ─────────────────────────────────────────────────────────────
function UsersSection() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [showInviteAdmin, setShowInviteAdmin] = useState(false);
  const [inviteForm, setInviteForm] = useState({ email: '', name: '' });
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['admin-users', page],
    queryFn: () => adminApi.listUsers(page, limit),
  });

  const suspend = useMutation({
    mutationFn: (id: string) => adminApi.suspendUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User suspended');
    },
    onError: (err) => toast.error('Failed to suspend user', errMsg(err, 'Please try again.')),
  });
  const reactivate = useMutation({
    mutationFn: (id: string) => adminApi.reactivateUser(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      toast.success('User reactivated');
    },
    onError: (err) => toast.error('Failed to reactivate user', errMsg(err, 'Please try again.')),
  });
  const invitePlatformAdmin = useMutation({
    mutationFn: () => adminApi.invitePlatformAdmin({
      email: inviteForm.email,
      name: inviteForm.name || undefined,
    }),
    onSuccess: (res: unknown) => {
      qc.invalidateQueries({ queryKey: ['admin-users'] });
      const mode = (res as { mode?: string })?.mode;
      const title = mode === 'PROMOTED_EXISTING_USER' ? 'Platform admin promoted' : 'Platform admin invited';
      toast.success(title, inviteForm.email);
      setShowInviteAdmin(false);
      setInviteForm({ email: '', name: '' });
    },
    onError: (err) => toast.error('Failed to invite platform admin', errMsg(err, 'Please try again.')),
  });

  if (isLoading) return <PageSpinner />;

  const users = (data as { items: Record<string, unknown>[], total: number })?.items ?? [];
  const total = (data as { total: number })?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  const statusVariant = (s: string) => {
    if (s === 'ACTIVE') return 'success' as const;
    if (s === 'SUSPENDED' || s === 'DEACTIVATED') return 'danger' as const;
    if (s === 'PENDING_APPROVAL' || s === 'PENDING_ACTIVATION') return 'warning' as const;
    return 'default' as const;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{total} total users</p>
        <Button size="sm" onClick={() => setShowInviteAdmin(true)}>
          <UserPlus size={13} /> Invite Platform Admin
        </Button>
      </div>
      <Card>
        <Table>
          <Thead><Tr><Th>Name</Th><Th>Email</Th><Th>Platform Role</Th><Th>Status</Th><Th>Joined</Th><Th>Actions</Th></Tr></Thead>
          <Tbody>
            {users.map(u => (
              <Tr key={u.id as string}>
                <Td><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name as string}</span></Td>
                <Td><span style={{ color: 'var(--text-muted)' }}>{u.email as string}</span></Td>
                <Td>
                  <Badge variant={u.platformRole === 'PLATFORM_ADMIN' ? 'info' : 'default'}>
                    {u.platformRole as string}
                  </Badge>
                </Td>
                <Td><Badge variant={statusVariant(u.accountStatus as string)}>{u.accountStatus as string}</Badge></Td>
                <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(u.createdAt as string)}</span></Td>
                <Td>
                  {u.accountStatus === 'ACTIVE' || u.accountStatus === 'PENDING_APPROVAL' ? (
                    <Button size="sm" variant="secondary" onClick={() => suspend.mutate(u.id as string)}>Suspend</Button>
                  ) : u.accountStatus === 'SUSPENDED' || u.accountStatus === 'DEACTIVATED' ? (
                    <Button size="sm" variant="secondary" onClick={() => reactivate.mutate(u.id as string)}>Reactivate</Button>
                  ) : null}
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      </Card>
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm" style={{ color: 'var(--text-muted)' }}>
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /> Prev</Button>
            <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>Next <ChevronRight size={14} /></Button>
          </div>
        </div>
      )}

      <Modal open={showInviteAdmin} onClose={() => setShowInviteAdmin(false)} title="Invite Platform Admin" size="sm">
        <div className="space-y-4">
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Existing user: promoted to PLATFORM_ADMIN. New email: account is created and user can set password via Forgot Password.
          </p>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Email *</label>
            <input
              type="email"
              value={inviteForm.email}
              onChange={e => setInviteForm(prev => ({ ...prev, email: e.target.value }))}
              placeholder="admin@company.com"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Name (optional)</label>
            <input
              type="text"
              value={inviteForm.name}
              onChange={e => setInviteForm(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Full name"
              className="w-full"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowInviteAdmin(false)}>Cancel</Button>
            <Button
              loading={invitePlatformAdmin.isPending}
              disabled={!inviteForm.email.trim()}
              onClick={() => invitePlatformAdmin.mutate()}
            >
              Send invite
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Orgs section ──────────────────────────────────────────────────────────────
interface OrgRow {
  id: string;
  name: string;
  slug: string;
  isActive?: boolean;
  createdAt: string;
  _count?: { members?: number; projects?: number };
}

function OrgsSection() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => adminApi.listOrgs(),
  });

  if (isLoading) return <PageSpinner />;
  const orgs = ((data as { items?: OrgRow[] })?.items ?? (Array.isArray(data) ? data : [])) as OrgRow[];

  return (
    <Card>
      {orgs.length === 0 ? (
        <CardContent><EmptyState icon={Building2} title="No organisations" description="Organisations are created during user registration." /></CardContent>
      ) : (
        <Table>
          <Thead>
            <Tr>
              <Th>Name</Th><Th>Slug</Th><Th>Members</Th><Th>Projects</Th><Th>Created</Th><Th></Th>
            </Tr>
          </Thead>
          <Tbody>
            {orgs.map(org => (
              <Tr key={org.id}>
                <Td>
                  <div className="flex items-center gap-2">
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{org.name}</span>
                    {org.isActive === false && <Badge variant="danger">Suspended</Badge>}
                  </div>
                </Td>
                <Td><span className="font-mono text-xs" style={{ color: 'var(--text-muted)' }}>{org.slug}</span></Td>
                <Td><span style={{ color: 'var(--text-muted)' }}>{org._count?.members ?? 0}</span></Td>
                <Td><span style={{ color: 'var(--text-muted)' }}>{org._count?.projects ?? 0}</span></Td>
                <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(org.createdAt)}</span></Td>
                <Td>
                  <Link
                    to={`/admin/orgs/${org.id}`}
                    className="flex items-center gap-1 text-xs font-medium transition-opacity hover:opacity-80"
                    style={{ color: '#a78bfa' }}
                  >
                    View <ArrowRight size={12} />
                  </Link>
                </Td>
              </Tr>
            ))}
          </Tbody>
        </Table>
      )}
    </Card>
  );
}

// ── Audit log section ─────────────────────────────────────────────────────────
function AuditSection() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit', page],
    queryFn: () => adminApi.listAuditLogs(page),
  });

  if (isLoading) return <PageSpinner />;
  const logs = (data as { items: Record<string, unknown>[] })?.items ?? (Array.isArray(data) ? data : []);
  const total = (data as { total: number })?.total ?? logs.length;
  const totalPages = Math.ceil(total / 50);

  return (
    <div className="space-y-4">
      <Card>
        {logs.length === 0 ? (
          <CardContent><EmptyState icon={ClipboardList} title="No audit logs" description="Actions performed by users will appear here." /></CardContent>
        ) : (
          <Table>
            <Thead><Tr><Th>Action</Th><Th>Entity</Th><Th>User</Th><Th>Time</Th></Tr></Thead>
            <Tbody>
              {logs.map(l => (
                <Tr key={l.id as string}>
                  <Td><Badge variant="info">{l.action as string}</Badge></Td>
                  <Td><span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>{l.entity as string}</span></Td>
                  <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{(l.user as { email: string } | null)?.email ?? '—'}</span></Td>
                  <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(l.createdAt as string)}</span></Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </Card>
      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}><ChevronLeft size={14} /></Button>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Page {page} of {totalPages}</span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}><ChevronRight size={14} /></Button>
        </div>
      )}
    </div>
  );
}

// ── Pending Approvals (inline) ────────────────────────────────────────────────
interface PendingUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
  orgMemberships: { org: { name: string } }[];
}

function PendingApprovalsSection() {
  const qc = useQueryClient();
  const [noteModal, setNoteModal] = useState<{ userId: string; action: 'approve' | 'reject' } | null>(null);
  const [note, setNote] = useState('');

  const { data: pending = [], isLoading, refetch } = useQuery({
    queryKey: ['admin-approvals'],
    queryFn: adminApi.listPendingApprovals,
  });

  const approve = useMutation({
    mutationFn: ({ userId, note }: { userId: string; note?: string }) => adminApi.approveUser(userId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-approvals'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Registration approved', 'User can now log in.');
      setNoteModal(null);
      setNote('');
    },
    onError: (err) => toast.error('Failed to approve', errMsg(err, 'Please try again.')),
  });
  const reject = useMutation({
    mutationFn: ({ userId, note }: { userId: string; note?: string }) => adminApi.rejectUser(userId, note),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-approvals'] });
      qc.invalidateQueries({ queryKey: ['admin-stats'] });
      toast.success('Registration rejected');
      setNoteModal(null);
      setNote('');
    },
    onError: (err) => toast.error('Failed to reject', errMsg(err, 'Please try again.')),
  });

  if (isLoading) return <PageSpinner />;
  const list = pending as PendingUser[];

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold uppercase tracking-widest" style={{ color: 'rgba(238,238,248,0.40)' }}>
            Pending Approvals
          </h3>
          {list.length > 0 && (
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
              style={{ background: '#ef4444', color: 'white', fontSize: '10px' }}
            >
              {list.length}
            </span>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => refetch()}><RefreshCw size={13} /></Button>
      </div>

      {list.length === 0 ? (
        <div
          className="rounded-2xl px-5 py-6 flex items-center gap-3"
          style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
        >
          <CheckCircle size={18} style={{ color: '#34d399' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No pending registrations — all caught up
          </span>
        </div>
      ) : (
        <Card>
          <Table>
            <Thead><Tr><Th>Name</Th><Th>Email</Th><Th>Requested</Th><Th>Actions</Th></Tr></Thead>
            <Tbody>
              {list.map(u => (
                <Tr key={u.id} data-testid={`approval-row-${u.email}`}>
                  <Td><span className="font-medium" style={{ color: 'var(--text-primary)' }}>{u.name}</span></Td>
                  <Td><span style={{ color: 'var(--text-muted)' }}>{u.email}</span></Td>
                  <Td><span className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDate(u.createdAt)}</span></Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <Button data-testid={`approval-open-approve-${u.email}`} size="sm" onClick={() => setNoteModal({ userId: u.id, action: 'approve' })}>
                        <CheckCircle size={13} /> Approve
                      </Button>
                      <Button size="sm" variant="danger" onClick={() => setNoteModal({ userId: u.id, action: 'reject' })}>
                        <XCircle size={13} /> Reject
                      </Button>
                    </div>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Card>
      )}

      <Modal
        open={!!noteModal}
        onClose={() => { setNoteModal(null); setNote(''); }}
        title={noteModal?.action === 'approve' ? 'Approve Registration' : 'Reject Registration'}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>Note (optional)</label>
            <textarea data-testid="approval-note" className="w-full h-20 resize-none" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note for this decision..." />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => { setNoteModal(null); setNote(''); }}>Cancel</Button>
            {noteModal?.action === 'approve' ? (
              <Button data-testid="approval-confirm-approve" loading={approve.isPending} onClick={() => approve.mutate({ userId: noteModal!.userId, note: note || undefined })}>
                <CheckCircle size={14} /> Approve
              </Button>
            ) : (
              <Button variant="danger" loading={reject.isPending} onClick={() => reject.mutate({ userId: noteModal!.userId, note: note || undefined })}>
                <XCircle size={14} /> Reject
              </Button>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ── Main AdminPage ────────────────────────────────────────────────────────────
export function AdminPage() {
  const [tab, setTab] = useState<Tab>('overview');

  const { data: stats } = useQuery({
    queryKey: ['admin-stats'],
    queryFn: adminApi.getStats,
  });

  const { data: orgsData } = useQuery({
    queryKey: ['admin-orgs'],
    queryFn: () => adminApi.listOrgs(),
  });

  const s = stats as { totalUsers?: number; activeUsers?: number; pendingApproval?: number; totalOrgs?: number; totalProjects?: number } | undefined;

  const orgs = ((orgsData as { items?: { isActive?: boolean }[] })?.items ?? (Array.isArray(orgsData) ? orgsData : [])) as { isActive?: boolean }[];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Platform Administration</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Manage users, organisations, config and platform settings
        </p>
      </div>

      {/* ROW 1 — Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Organisations" value={s?.totalOrgs ?? 0}    icon={Building2}   color="violet" />
        <StatCard label="Total Projects"      value={s?.totalProjects ?? 0} icon={ShieldCheck} color="sky"    />
        <StatCard label="Total Users"         value={s?.totalUsers ?? 0}   icon={Users}       color="sky"    />
        <OrgStatusCard orgs={orgs} />
      </div>

      {/* ROW 2 — Pending Approvals (always visible) */}
      <PendingApprovalsSection />

      {/* ROW 3 — Tabs */}
      <div
        className="flex items-center gap-1 rounded-xl p-1"
        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
      >
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
            style={{
              background: tab === id ? 'rgba(124,58,237,0.30)' : 'transparent',
              color: tab === id ? '#c4b5fd' : 'rgba(238,238,248,0.50)',
              border: tab === id ? '1px solid rgba(124,58,237,0.40)' : '1px solid transparent',
            }}
          >
            <Icon size={13} />
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && <OverviewSection stats={s} setTab={setTab} />}
      {tab === 'orgs'     && <OrgsSection />}
      {tab === 'users'    && <UsersSection />}
      {tab === 'config'   && <ConfigSection />}
      {tab === 'audit'    && <AuditSection />}
    </div>
  );
}

function OverviewSection({
  stats,
  setTab,
}: {
  stats?: { totalUsers?: number; activeUsers?: number; pendingApproval?: number; totalOrgs?: number; totalProjects?: number };
  setTab: (t: Tab) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardContent>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Platform Summary</h3>
            <div className="space-y-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <div className="flex justify-between"><span>Total users</span><span style={{ color: 'var(--text-primary)' }}>{stats?.totalUsers ?? 0}</span></div>
              <div className="flex justify-between"><span>Active users</span><span style={{ color: '#34d399' }}>{stats?.activeUsers ?? 0}</span></div>
              <div className="flex justify-between"><span>Pending approval</span><span style={{ color: '#fbbf24' }}>{stats?.pendingApproval ?? 0}</span></div>
              <div className="flex justify-between"><span>Organisations</span><span style={{ color: 'var(--text-primary)' }}>{stats?.totalOrgs ?? 0}</span></div>
              <div className="flex justify-between"><span>Projects</span><span style={{ color: 'var(--text-primary)' }}>{stats?.totalProjects ?? 0}</span></div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>Quick Actions</h3>
            <div className="space-y-2">
              <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('users')}>
                <Users size={14} /> Manage Users
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('orgs')}>
                <Building2 size={14} /> View Organisations
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('config')}>
                <Settings size={14} /> Platform Config
              </Button>
              <Button variant="secondary" className="w-full justify-start" onClick={() => setTab('audit')}>
                <ClipboardList size={14} /> Audit Log
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
