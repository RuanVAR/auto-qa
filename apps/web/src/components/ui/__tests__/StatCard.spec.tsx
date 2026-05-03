import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCard } from '../StatCard';
import { Activity } from 'lucide-react';

describe('StatCard', () => {
  it('renders label and numeric value', () => {
    render(<StatCard label="Total Runs" value={42} icon={Activity} />);
    expect(screen.getByText('Total Runs')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('renders string value', () => {
    render(<StatCard label="Pass Rate" value="85%" icon={Activity} />);
    expect(screen.getByText('Pass Rate')).toBeInTheDocument();
    expect(screen.getByText('85%')).toBeInTheDocument();
  });

  it('renders trend text when provided', () => {
    render(<StatCard label="Runs" value={10} icon={Activity} trend="+5 this week" />);
    expect(screen.getByText('+5 this week')).toBeInTheDocument();
  });

  it('does not render trend when not provided', () => {
    const { queryByText } = render(<StatCard label="Runs" value={10} icon={Activity} />);
    expect(queryByText(/this week/)).toBeNull();
  });
});
