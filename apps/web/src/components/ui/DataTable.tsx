import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronsUpDown, ChevronUp, ChevronDown,
  MoreHorizontal, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';

// ── Public interfaces ─────────────────────────────────────────────────────────

export interface DataTableColumn<T> {
  key: string;
  header: string;
  sortable?: boolean;
  width?: string;
  className?: string;
  cell: (row: T, index: number) => React.ReactNode;
}

export interface DataTableRowAction<T> {
  label: string;
  icon?: React.ElementType;
  onClick: (row: T) => void;
  variant?: 'default' | 'danger';
  hidden?: (row: T) => boolean;
}

export interface DataTablePagination {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];
}

export interface DataTableSort {
  field: string | null;
  direction: 'asc' | 'desc';
  onChange: (field: string, direction: 'asc' | 'desc') => void;
}

export interface DataTableSearch {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  data: T[];
  keyField: keyof T;
  rowActions?: DataTableRowAction<T>[];
  pagination?: DataTablePagination;
  sort?: DataTableSort;
  search?: DataTableSearch;
  loading?: boolean;
  emptyState?: React.ReactNode;
  toolbar?: React.ReactNode;
  className?: string;
}

// ── Sort icon ─────────────────────────────────────────────────────────────────

function SortIcon({ active, direction }: { active: boolean; direction: 'asc' | 'desc' }) {
  if (!active) return <ChevronsUpDown size={13} style={{ color: 'rgba(238,238,248,0.30)' }} />;
  if (direction === 'asc') return <ChevronUp size={13} style={{ color: 'var(--accent-400)' }} />;
  return <ChevronDown size={13} style={{ color: 'var(--accent-400)' }} />;
}

// ── Kebab row action menu ─────────────────────────────────────────────────────

function RowActionsMenu<T>({ row, actions }: { row: T; actions: DataTableRowAction<T>[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const visible = actions.filter(a => !a.hidden?.(row));
  if (visible.length === 0) return null;

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  return (
    <div ref={ref} className="relative flex justify-end">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
        style={{
          background: open ? 'rgba(255,255,255,0.08)' : 'transparent',
          color: 'rgba(238,238,248,0.50)',
        }}
      >
        <MoreHorizontal size={15} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-8 z-50 min-w-[160px] py-1.5"
          style={{
            background: 'rgba(20,20,35,0.95)',
            border: '1px solid rgba(255,255,255,0.10)',
            borderRadius: '12px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}
        >
          {visible.map((action, i) => {
            const Icon = action.icon;
            const isDanger = action.variant === 'danger';
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(false);
                  action.onClick(row);
                }}
                className="w-full flex items-center gap-2.5 text-sm px-3 py-2 transition-colors"
                style={{
                  color: isDanger ? '#f87171' : 'rgba(238,238,248,0.80)',
                  background: 'transparent',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = isDanger
                    ? 'rgba(239,68,68,0.12)'
                    : 'rgba(255,255,255,0.06)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                }}
              >
                {Icon && <Icon size={13} />}
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Skeleton rows ─────────────────────────────────────────────────────────────

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className="animate-pulse h-4 rounded"
            style={{
              background: 'rgba(255,255,255,0.05)',
              width: i === 0 ? '60%' : i === colCount - 1 ? '40%' : '80%',
            }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Pagination row ────────────────────────────────────────────────────────────

function PaginationRow({ pagination }: { pagination: DataTablePagination }) {
  const { page, pageSize, total, onPageChange, onPageSizeChange, pageSizeOptions } = pagination;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const from = Math.min((page - 1) * pageSize + 1, total);
  const to = Math.min(page * pageSize, total);
  const sizeOptions = pageSizeOptions ?? [10, 20, 50];

  // Build page numbers (max 5 with ellipsis)
  function pageNumbers(): (number | '...')[] {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1);
    if (page <= 3) return [1, 2, 3, 4, '...', totalPages];
    if (page >= totalPages - 2) return [1, '...', totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    return [1, '...', page - 1, page, page + 1, '...', totalPages];
  }

  const btnBase: React.CSSProperties = {
    minWidth: 32,
    height: 32,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    fontSize: 13,
    cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.08)',
    background: 'rgba(255,255,255,0.03)',
    color: 'rgba(238,238,248,0.60)',
    transition: 'all 0.15s',
    padding: '0 6px',
  };

  const activeBtnStyle: React.CSSProperties = {
    ...btnBase,
    background: 'rgba(var(--accent-rgb),0.25)',
    border: '1px solid rgba(var(--accent-rgb),0.40)',
    color: 'var(--accent-400)',
    fontWeight: 600,
  };

  return (
    <div
      className="flex items-center justify-between flex-wrap gap-3 px-4 py-3"
      style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}
    >
      {/* Left: count + page size */}
      <div className="flex items-center gap-3">
        <span className="text-xs" style={{ color: 'rgba(238,238,248,0.40)' }}>
          Showing {total === 0 ? 0 : from}–{to} of {total} results
        </span>
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={e => onPageSizeChange(Number(e.target.value))}
            className="text-xs rounded-lg px-2 py-1"
            style={{
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.10)',
              color: 'rgba(238,238,248,0.70)',
              outline: 'none',
            }}
          >
            {sizeOptions.map(s => (
              <option key={s} value={s}>{s} / page</option>
            ))}
          </select>
        )}
      </div>

      {/* Right: page buttons */}
      <div className="flex items-center gap-1">
        <button
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          style={{ ...btnBase, opacity: page <= 1 ? 0.35 : 1 }}
        >
          <ChevronLeft size={14} />
        </button>

        {pageNumbers().map((n, i) =>
          n === '...' ? (
            <span key={`ellipsis-${i}`} className="text-xs px-1" style={{ color: 'rgba(238,238,248,0.30)' }}>…</span>
          ) : (
            <button
              key={n}
              onClick={() => onPageChange(n as number)}
              style={n === page ? activeBtnStyle : btnBase}
            >
              {n}
            </button>
          )
        )}

        <button
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          style={{ ...btnBase, opacity: page >= totalPages ? 0.35 : 1 }}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Main DataTable ────────────────────────────────────────────────────────────

export function DataTable<T>({
  columns,
  data,
  keyField,
  rowActions,
  pagination,
  sort,
  search,
  loading = false,
  emptyState,
  toolbar,
  className,
}: DataTableProps<T>) {
  const hasActions = !!rowActions && rowActions.length > 0;
  const colCount = columns.length + (hasActions ? 1 : 0);

  function handleSortClick(col: DataTableColumn<T>) {
    if (!col.sortable || !sort) return;
    if (sort.field !== col.key) {
      sort.onChange(col.key, 'asc');
    } else if (sort.direction === 'asc') {
      sort.onChange(col.key, 'desc');
    } else {
      // desc → clear: pass empty string to signal "no sort"
      sort.onChange('', 'asc');
    }
  }

  const showToolbar = search || toolbar;

  return (
    <div
      className={`rounded-2xl overflow-hidden ${className ?? ''}`}
      style={{
        background: 'rgba(255,255,255,0.03)',
        border: '1px solid rgba(255,255,255,0.07)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────── */}
      {showToolbar && (
        <div
          className="flex items-center justify-between gap-3 px-4 py-3 flex-wrap"
          style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}
        >
          {/* Search */}
          {search ? (
            <div className="relative flex-1 min-w-[180px] max-w-xs">
              <Search
                size={13}
                className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                style={{ color: 'rgba(238,238,248,0.35)' }}
              />
              <input
                type="text"
                value={search.value}
                onChange={e => search.onChange(e.target.value)}
                placeholder={search.placeholder ?? 'Search…'}
                className="w-full pl-8 pr-3 py-1.5 text-sm rounded-xl outline-none"
                style={{
                  background: 'rgba(255,255,255,0.04)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
          ) : <div />}

          {/* Custom toolbar slot */}
          {toolbar && <div className="flex items-center gap-2">{toolbar}</div>}
        </div>
      )}

      {/* ── Table ─────────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          {/* Header */}
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
              {columns.map(col => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-left ${col.className ?? ''}`}
                  style={{ width: col.width }}
                >
                  {col.sortable && sort ? (
                    <button
                      onClick={() => handleSortClick(col)}
                      className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider select-none"
                      style={{ color: 'rgba(238,238,248,0.35)' }}
                    >
                      {col.header}
                      <SortIcon
                        active={sort.field === col.key}
                        direction={sort.direction}
                      />
                    </button>
                  ) : (
                    <span
                      className="text-xs font-semibold uppercase tracking-wider"
                      style={{ color: 'rgba(238,238,248,0.35)' }}
                    >
                      {col.header}
                    </span>
                  )}
                </th>
              ))}
              {hasActions && (
                <th className="px-4 py-3 w-12" />
              )}
            </tr>
          </thead>

          {/* Body */}
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} colCount={colCount} />
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount}>
                  {emptyState ?? (
                    <div className="flex flex-col items-center justify-center py-14 gap-2">
                      <span className="text-sm" style={{ color: 'rgba(238,238,248,0.35)' }}>
                        No results found
                      </span>
                    </div>
                  )}
                </td>
              </tr>
            ) : (
              data.map((row, idx) => (
                <tr
                  key={String(row[keyField])}
                  className="transition-colors"
                  style={{
                    borderBottom: idx < data.length - 1 ? '1px solid rgba(255,255,255,0.05)' : undefined,
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'rgba(255,255,255,0.02)';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLTableRowElement).style.background = 'transparent';
                  }}
                >
                  {columns.map(col => (
                    <td key={col.key} className={`px-4 py-3 ${col.className ?? ''}`}>
                      {col.cell(row, idx)}
                    </td>
                  ))}
                  {hasActions && (
                    <td className="px-4 py-3 w-12">
                      <RowActionsMenu row={row} actions={rowActions!} />
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {pagination && <PaginationRow pagination={pagination} />}
    </div>
  );
}
