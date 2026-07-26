import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import {
  TestedVersion,
  TestedVersionPanel,
  TestedVersions,
} from './TestedVersion';

const release = {
  id: 'release-1',
  version: '2026.07.26.4',
  source: 'CI_API' as const,
  deployedAt: '2026-07-26T08:00:00.000Z',
};

describe('TestedVersion', () => {
  it('renders a captured release and provenance', () => {
    render(<TestedVersion release={release} />);
    expect(screen.getByText('2026.07.26.4')).toBeInTheDocument();
    expect(screen.getByTitle(/CI verified/)).toBeInTheDocument();
  });

  it('summarises sessions that span multiple releases', () => {
    render(
      <TestedVersions
        releases={[
          release,
          { ...release, id: 'release-2', version: '2026.07.26.5' },
        ]}
      />,
    );
    expect(screen.getByText('2 versions')).toBeInTheDocument();
  });

  it('shows component versions in the detail panel', () => {
    render(
      <TestedVersionPanel
        environmentName="Staging"
        release={{
          ...release,
          commitSha: 'abcdef1234567890',
          components: [{
            id: 'component-1',
            componentName: 'API',
            version: '5.4.0',
          }],
        }}
      />,
    );
    expect(screen.getByText('Staging')).toBeInTheDocument();
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('5.4.0')).toBeInTheDocument();
  });
});
