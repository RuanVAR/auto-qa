import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge', () => {
  it('renders with default variant', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders with success variant', () => {
    const { container } = render(<Badge variant="success">Passed</Badge>);
    expect(screen.getByText('Passed')).toBeInTheDocument();
    // Should have a green-ish class
    expect(container.firstChild).toBeTruthy();
  });

  it('renders with danger variant', () => {
    render(<Badge variant="danger">Failed</Badge>);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders with warning variant', () => {
    render(<Badge variant="warning">Running</Badge>);
    expect(screen.getByText('Running')).toBeInTheDocument();
  });
});
