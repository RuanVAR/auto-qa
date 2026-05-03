import { Badge } from './Badge';

const MAP: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'default' }> = {
  PASSED:    { label: 'Passed',    variant: 'success'  },
  COMPLETE:  { label: 'Complete',  variant: 'success'  },
  FAILED:    { label: 'Failed',    variant: 'danger'   },
  RUNNING:   { label: 'Running',   variant: 'info'     },
  PENDING:   { label: 'Pending',   variant: 'muted'    },
  QUEUED:    { label: 'Queued',    variant: 'muted'    },
  CANCELLED: { label: 'Cancelled', variant: 'muted'    },
  TIMED_OUT: { label: 'Timed out', variant: 'warning'  },
  ERROR:     { label: 'Error',     variant: 'danger'   },
  ABANDONED: { label: 'Abandoned', variant: 'warning'  },
};

export function RunStatusBadge({ status }: { status: string }) {
  const { label, variant } = MAP[status] ?? { label: status, variant: 'default' as const };
  return <Badge variant={variant}>{label}</Badge>;
}
