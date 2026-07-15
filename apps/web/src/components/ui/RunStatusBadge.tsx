import { Badge } from './Badge';

const MAP: Record<string, { label: string; variant: 'success' | 'danger' | 'warning' | 'info' | 'muted' | 'default' }> = {
  PASSED:    { label: 'Passed',    variant: 'success'  },
  COMPLETE:  { label: 'Complete',  variant: 'success'  },
  FAILED:    { label: 'Failed',    variant: 'danger'   },
  RUNNING:   { label: 'Running',   variant: 'info'     },
  PENDING:   { label: 'Pending',   variant: 'muted'    },
  QUEUED:    { label: 'Queued',    variant: 'muted'    },
  CANCELLED: { label: 'Cancelled', variant: 'muted'    },
  NOT_TESTED:{ label: 'Not tested', variant: 'muted'   },
  TIMED_OUT: { label: 'Timed out', variant: 'warning'  },
  // ERROR = an infra error (e.g. a reaped run), not a verdict — surface it as
  // "needs testing" (neutral), never as a failure.
  ERROR:     { label: 'Needs testing', variant: 'muted' },
  // NOTE: 'ABANDONED' is intentionally absent — it is not a value in the
  // RunStatus or FeatureRunStatus enums, so it can never arrive. (An
  // abandoned run resolves to CANCELLED.) The fallback below renders any
  // unexpected status as a default-variant chip rather than crashing.
};

export function RunStatusBadge({ status }: { status: string }) {
  const { label, variant } = MAP[status] ?? { label: status, variant: 'default' as const };
  return <Badge variant={variant}>{label}</Badge>;
}
