import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RunStatusBadge } from '../RunStatusBadge';

describe('RunStatusBadge', () => {
  const cases: Array<[string, string]> = [
    ['PASSED', 'Passed'],
    ['FAILED', 'Failed'],
    ['RUNNING', 'Running'],
    ['PENDING', 'Pending'],
    ['CANCELLED', 'Cancelled'],
    ['ERROR', 'Needs testing'], // infra error surfaced as needs-testing, not a verdict
    ['TIMED_OUT', 'Timed out'],
    ['QUEUED', 'Queued'],
  ];

  cases.forEach(([status, label]) => {
    it(`renders label "${label}" for status "${status}"`, () => {
      render(<RunStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
    });
  });

  it('falls back to raw status for unknown values', () => {
    render(<RunStatusBadge status="UNKNOWN_STATUS" />);
    expect(screen.getByText('UNKNOWN_STATUS')).toBeInTheDocument();
  });
});
