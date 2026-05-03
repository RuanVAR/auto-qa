import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Building2, Users, FolderOpen, ChevronLeft, AlertTriangle,
  CheckCircle, Eye, ShieldOff, ShieldCheck, Trash2,
} from 'lucide-react';
import { adminApi } from '@/lib/api';
import { StatCard } from '@/components/ui/StatCard';
import { DataTable, DataTableColumn, DataTableRowAction, DataTableSort, DataTablePagination } from '@/components/ui/DataTable';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { formatDate } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

interface OrgRow {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
  _count: {
    members: number;
    projects: number;
  };
}

// ── Confirm Delete Modal ──────────────────────────────────────────────────────

function ConfirmDeleteModal({
  org,
  onClose,
  onConfirm,
  loading,
}: {
  org: OrgRow;
  onClose: () => void;
  onConfirm: () => void;
  loading: boolean;
}) {
  return (
    <Modal open onClose={onClose} title="Delete Organisation" size="sm">
      <div className="space-y-4">
        <div
          className="flex items-start gap-3 rounded-xl p-3"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.20)' }}
        >
          <AlertTriangle size={16} style={{ color: '#f87171', flexShrink: 0, marginTop: 2 }} />
          <p className="text-sm" style={{ color: 'rgba(238,238,248,0.80)' }}>
            This action will soft-delete <strong style={{ color: 'var(--text-primary)' }}>{org.name}</strong> and cannot be easily undone.
            All projects and members will lose access.
          </p>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="danger" loading={loading} onClick={onConfirm}>
            <Trash2 size={13} />
            Delete Organisation
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function AdminOrgsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DataTableSort>({ field: 'createdAt', direction: 'desc', onChange: handleSortChange });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [deleteTarget, setDeleteTarget] = useState<OrgRow | null>(null);

  function handleSortChange(field: string, direction: 'asc' | 'desc') {
    setSort(s => ({ ...s, field: field || null, direction }));
    setPage(1);
  }

  // Fetch all orgs (client-side filter/sort/paginate)
  const { data: rawData, isLoading } = useQuery({
    queryKey: ['admin-orgs-list'],
    queryFn: () => adminApi.listOrgs(1, 1000),
  });

  const allOrgs = useMemo<OrgRow[]>(() => {
    const items = (rawData as { items?: OrgRow[] })?.items ?? (Array.isArray(rawData) ? (rawData as OrgRow[]) : []);
    return items;
  }, [rawData]);

  // Client-side search
  const filtered = useMemo(() => {
    if (!search.trim()) return allOrgs;
    const q = search.toLowerCase();
    return allOrgs.filter(o => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q));
  }, [allOrgs, search]);

  // Client-side sort
  const sorted = useMemo(() => {
    if (!sort.field) return filtered;
    return [...filtered].sort((a, b) => {
      let av: string | number = '';
      let bv: string | number = '';
      if (sort.field === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (sort.field === 'members') { av = a._count?.members ?? 0; bv = b._count?.members ?? 0; }
      else if (sort.field === 'projects') { av = a._count?.projects ?? 0; bv = b._count?.projects ?? 0; }
      else if (sort.field === 'createdAt') { av = a.createdAt; bv = b.createdAt; }
      if (av < bv) return sort.direction === 'asc' ? -1 : 1;
      if (av > bv) return sort.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filtered, sort.field, sort.direction]);

  // Client-side pagination
  const total = sorted.length;
  const pageData = useMemo(() => sorted.slice((page - 1) * pageSize, page * pageSize), [sorted, page, pageSize]);

  // Stat counts
  const totalCount = allOrgs.length;
  const activeCount = allOrgs.filter(o => o.isActive !== false).length;
  const blockedCount = allOrgs.filter(o => o.isActive === false).length;
  const totalMembers = allOrgs.reduce((s, o) => s + (o._count?.members ?? 0), 0);

  // Mutations
  const statusMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      adminApi.updateOrgStatus(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs-list'] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => adminApi.deleteOrg(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orgs-list'] });
      setDeleteTarget(null);
    },
  });

  // Columns
  const columns: DataTableColumn<OrgRow>[] = [
    {
      key: 'name',
      header: 'Organisation',
      sortable: true,
      cell: (row) => (
        <div>
          <Link
            to={`/admin/orgs/${row.id}`}
            className="font-semibold text-sm transition-colors hover:underline"
            style={{ color: 'var(--text-primary)' }}
          >
            {row.name}
          </Link>
          <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {row.slug}
          </p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge variant={row.isActive !== false ? 'success' : 'danger'}>
          {row.isActive !== false ? 'Active' : 'Blocked'}
        </Badge>
      ),
    },
    {
      key: 'members',
      header: 'Members',
      sortable: true,
      cell: (row) => (
        <span className="tabular-nums text-sm" style={{ color: 'var(--text-muted)' }}>
          {row._count?.members ?? 0}
        </span>
      ),
    },
    {
      key: 'projects',
      header: 'Projects',
      sortable: true,
      cell: (row) => (
        <span className="tabular-nums text-sm" style={{ color: 'var(--text-muted)' }}>
          {row._count?.projects ?? 0}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      sortable: true,
      cell: (row) => (
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {formatDate(row.createdAt)}
        </span>
      ),
    },
  ];

  const rowActions: DataTableRowAction<OrgRow>[] = [
    {
      label: 'View',
      icon: Eye,
      onClick: (row) => navigate(`/admin/orgs/${row.id}`),
    },
    {
      label: 'Suspend',
      icon: ShieldOff,
      hidden: (row) => row.isActive === false,
      onClick: (row) => statusMutation.mutate({ id: row.id, isActive: false }),
    },
    {
      label: 'Activate',
      icon: ShieldCheck,
      hidden: (row) => row.isActive !== false,
      onClick: (row) => statusMutation.mutate({ id: row.id, isActive: true }),
    },
    {
      label: 'Delete',
      icon: Trash2,
      variant: 'danger',
      onClick: (row) => setDeleteTarget(row),
    },
  ];

  const pagination: DataTablePagination = {
    page,
    pageSize,
    total,
    onPageChange: (p) => setPage(p),
    onPageSizeChange: (s) => { setPageSize(s); setPage(1); },
    pageSizeOptions: [10, 20, 50],
  };

  const sortProp: DataTableSort = {
    field: sort.field,
    direction: sort.direction,
    onChange: handleSortChange,
  };

  return (
    <div className="space-y-6">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <Link
          to="/admin"
          className="flex items-center gap-1.5 text-sm transition-opacity hover:opacity-70"
          style={{ color: 'rgba(238,238,248,0.50)' }}
        >
          <ChevronLeft size={15} />
          Back to Admin
        </Link>
        <span style={{ color: 'rgba(255,255,255,0.15)' }}>/</span>
        <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
          Organisations
        </h2>
      </div>

      {/* ── Stat cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total"
          value={totalCount}
          icon={Building2}
          color="sky"
          action={{ label: 'All Organisations', to: '/admin/organisations' }}
        />
        <StatCard
          label="Active"
          value={activeCount}
          icon={CheckCircle}
          color="green"
        />
        <StatCard
          label="Blocked"
          value={blockedCount}
          icon={ShieldOff}
          color="red"
        />
        <StatCard
          label="Total Members"
          value={totalMembers}
          icon={Users}
          color="violet"
          action={{ label: 'Manage Users', to: '/admin?tab=users' }}
        />
      </div>

      {/* ── DataTable ──────────────────────────────────────────── */}
      <DataTable<OrgRow>
        columns={columns}
        data={pageData}
        keyField="id"
        rowActions={rowActions}
        loading={isLoading}
        pagination={pagination}
        sort={sortProp}
        search={{
          value: search,
          onChange: (v) => { setSearch(v); setPage(1); },
          placeholder: 'Search organisations…',
        }}
        toolbar={
          <Link to="/admin/orgs" style={{ display: 'none' }} />
        }
        emptyState={
          <div className="flex flex-col items-center justify-center py-14 gap-2">
            <Building2 size={28} style={{ color: 'rgba(238,238,248,0.20)' }} />
            <span className="text-sm" style={{ color: 'rgba(238,238,248,0.35)' }}>
              {search ? 'No organisations match your search' : 'No organisations yet'}
            </span>
          </div>
        }
      />

      {/* ── Delete confirm modal ────────────────────────────────── */}
      {deleteTarget && (
        <ConfirmDeleteModal
          org={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
          loading={deleteMutation.isPending}
        />
      )}
    </div>
  );
}
