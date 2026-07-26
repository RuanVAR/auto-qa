import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { environmentsApi } from '@/lib/api';
import { EnvironmentsPage } from './EnvironmentsPage';

vi.mock('@/lib/api', () => ({
  API_BASE: 'http://localhost:3001',
  environmentsApi: {
    list: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    archive: vi.fn(),
    restore: vi.fn(),
    listReleases: vi.fn(),
    inferRelease: vi.fn(),
    listDeployTokens: vi.fn(),
    issueDeployToken: vi.fn(),
    revokeDeployToken: vi.fn(),
  },
}));

describe('EnvironmentsPage releases', () => {
  const release = {
    id: 'release-1',
    version: '2026.07.25.4',
    source: 'CI_API' as const,
    status: 'SUCCESS' as const,
    commitSha: 'abcdef1234567890',
    branch: 'main',
    artifactDigest: null,
    pipelineUrl: 'https://github.com/acme/service/actions/runs/84',
    deployedAt: '2026-07-25T10:00:00.000Z',
    differsFromIndex: false,
    components: [{
      id: 'component-1',
      componentName: 'API',
      version: '5.4.0',
      commitSha: 'abcdef1234567890',
      branch: 'main',
      artifactDigest: null,
      manifestPath: 'pyproject.toml',
      indexedCommitSha: 'abcdef1234567890',
      differsFromIndex: false,
      projectRepo: {
        id: 'repo-1',
        role: 'BACKEND' as const,
        repoOwner: 'acme',
        repoName: 'service',
      },
    }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(environmentsApi.list).mockResolvedValue([{
      id: 'env-1',
      name: 'Staging',
      type: 'STAGING',
      baseUrl: 'https://staging.example.com',
      description: 'Shared QA environment',
      embedAllowed: true,
      supportsAutomation: true,
      order: 0,
      isActive: true,
      currentRelease: release,
    }]);
    vi.mocked(environmentsApi.listReleases).mockResolvedValue([release]);
    vi.mocked(environmentsApi.listDeployTokens).mockResolvedValue([]);
  });

  it('shows the current version and its component-level release history', async () => {
    renderPage();

    expect(await screen.findByText('2026.07.25.4')).toBeInTheDocument();
    expect(screen.getByText('CI verified')).toBeInTheDocument();

    await userEvent.click(screen.getByTitle('View deployment history'));

    expect(await screen.findByRole('dialog', { name: 'Staging releases' }))
      .toBeInTheDocument();
    expect(environmentsApi.listReleases).toHaveBeenCalledWith(
      'project-1',
      'env-1',
    );
    expect(screen.getByText('API')).toBeInTheDocument();
    expect(screen.getByText('5.4.0')).toBeInTheDocument();
    expect(screen.getByText('acme/service')).toBeInTheDocument();
  });
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/projects/project-1/environments']}>
      <QueryClientProvider client={client}>
        <Routes>
          <Route
            path="/projects/:projectId/environments"
            element={<EnvironmentsPage />}
          />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}
