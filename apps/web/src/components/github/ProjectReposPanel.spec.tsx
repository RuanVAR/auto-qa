import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  environmentsApi,
  githubApi,
  type ProjectRepoIndex,
} from '@/lib/api';
import { ProjectReposPanel } from './ProjectReposPanel';

vi.mock('@/hooks/useRepoIndexSocket', () => ({
  useRepoIndexSocket: vi.fn(),
}));
vi.mock('@/stores/authStore', () => ({
  useActiveOrg: () => ({
    orgId: 'org-1',
    role: 'ORG_ADMIN',
    org: { id: 'org-1', name: 'Org', slug: 'org' },
  }),
}));
vi.mock('@/lib/api', () => ({
  environmentsApi: { list: vi.fn() },
  githubApi: {
    getCredential: vi.fn(),
    listRepos: vi.fn(),
    listAvailableRepos: vi.fn(),
    linkRepo: vi.fn(),
    unlinkRepo: vi.fn(),
    listBranches: vi.fn(),
    listEnvBindings: vi.fn(),
    replaceEnvBindings: vi.fn(),
    listIndexes: vi.fn(),
    reindexRepo: vi.fn(),
    reindexBranch: vi.fn(),
  },
}));

describe('ProjectReposPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(githubApi.getCredential).mockResolvedValue({
      id: 'credential-1',
      provider: 'GITHUB',
      authKind: 'PAT',
      displayLabel: null,
      baseUrl: null,
      appInstallationId: null,
      connectedAs: 'owner',
      lastHealthOk: true,
      lastHealthAt: null,
      lastHealthError: null,
      isEnabled: true,
      hasSecret: true,
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
    });
    vi.mocked(githubApi.listRepos).mockResolvedValue([{
      id: 'repo-1',
      role: 'FRONTEND',
      repoOwner: 'owner',
      repoName: 'web',
      defaultBranch: 'main',
      status: 'INDEXING',
      chunkCount: 120,
      lastIndexedAt: '2026-07-24T00:00:00.000Z',
      createdAt: '2026-07-24T00:00:00.000Z',
    }]);
    vi.mocked(githubApi.listAvailableRepos).mockResolvedValue([
      {
        owner: 'owner',
        name: 'api',
        fullName: 'owner/api',
        defaultBranch: 'develop',
        private: true,
        archived: false,
      },
    ]);
    vi.mocked(environmentsApi.list).mockResolvedValue([
      { id: 'env-1', name: 'Staging', type: 'STAGING' },
    ]);
    vi.mocked(githubApi.listBranches).mockResolvedValue([
      { name: 'main', sha: 'sha-main', protected: true },
      { name: 'staging', sha: 'sha-staging', protected: false },
    ]);
    vi.mocked(githubApi.listEnvBindings).mockResolvedValue([{
      id: 'binding-1',
      environmentId: 'env-1',
      branch: 'staging',
      createdAt: '2026-07-25T00:00:00.000Z',
      updatedAt: '2026-07-25T00:00:00.000Z',
      environment: { name: 'Staging', type: 'STAGING' },
    }]);
    vi.mocked(githubApi.listIndexes).mockResolvedValue([indexState()]);
    vi.mocked(githubApi.replaceEnvBindings).mockResolvedValue([]);
    vi.mocked(githubApi.reindexBranch).mockResolvedValue(indexState({
      status: 'PENDING',
      stage: 'QUEUED',
    }));
  });

  it('shows live branch progress and stale-refreshing state', async () => {
    renderPanel();
    await userEvent.click(await screen.findByLabelText('Expand repository'));

    expect(await screen.findByText('Generating embeddings')).toBeInTheDocument();
    expect(screen.getByText(/30 \/ 50 files · 120 chunks/)).toBeInTheDocument();
    expect(screen.getByText('Refreshing')).toBeInTheDocument();
    expect(screen.getByText('60%')).toBeInTheDocument();
  });

  it('links a repository selected from the installation and fills its default branch', async () => {
    vi.mocked(githubApi.listRepos).mockResolvedValue([]);
    vi.mocked(githubApi.linkRepo).mockResolvedValue({
      id: 'repo-2',
      role: 'BACKEND',
      repoOwner: 'owner',
      repoName: 'api',
      defaultBranch: 'develop',
      status: 'PENDING',
      chunkCount: 0,
      lastIndexedAt: null,
      createdAt: '2026-07-26T00:00:00.000Z',
    });

    renderPanel();
    await screen.findByRole('option', { name: 'owner/api (private)' });
    const repositoryPicker = await screen.findByRole('combobox', { name: 'Repository' });
    await userEvent.selectOptions(repositoryPicker, 'owner/api');
    expect(screen.getByPlaceholderText('main')).toHaveValue('develop');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Role' }), 'BACKEND');
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));

    expect(githubApi.linkRepo).toHaveBeenCalledWith('project-1', {
      repoOwner: 'owner',
      repoName: 'api',
      role: 'BACKEND',
      defaultBranch: 'develop',
    });
  });

  it('distinguishes repository discovery failure from an empty installation', async () => {
    vi.mocked(githubApi.listAvailableRepos)
      .mockRejectedValueOnce(new Error('GitHub unavailable'))
      .mockResolvedValueOnce([]);

    renderPanel();

    expect(await screen.findByRole('option', { name: 'Could not load repositories' }))
      .toBeInTheDocument();
    expect(screen.getByText('GitHub repository discovery failed.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('option', {
      name: 'No additional repositories available',
    })).toBeInTheDocument();
    expect(githubApi.listAvailableRepos).toHaveBeenCalledTimes(2);
  });

  it('saves environment-to-branch bindings from the live picker', async () => {
    renderPanel();
    await userEvent.click(await screen.findByLabelText('Expand repository'));
    const branchPicker = await screen.findByLabelText('Staging branch');
    await userEvent.selectOptions(branchPicker, 'main');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(githubApi.replaceEnvBindings).toHaveBeenCalledWith(
      'project-1',
      'repo-1',
      [{
        environmentId: 'env-1',
        branch: 'main',
        versionSource: 'AUTO',
        versionFileFormat: 'AUTO',
        versionFilePath: undefined,
        versionSelector: undefined,
        componentName: undefined,
      }],
    );
  });

  it('renders ready, failed, and blocked terminal actions and retries one branch', async () => {
    vi.mocked(githubApi.listIndexes).mockResolvedValue([
      indexState({
        id: 'index-ready',
        branch: 'main',
        status: 'READY',
        stage: 'COMPLETE',
        progressPercent: 100,
        activeGeneration: 2,
        requestedGeneration: 2,
      }),
      indexState({
        id: 'index-failed',
        branch: 'release',
        status: 'FAILED',
        stage: 'EMBEDDING',
        error: 'Embedding provider unavailable',
      }),
      indexState({
        id: 'index-blocked',
        branch: 'develop',
        status: 'BLOCKED',
        stage: 'QUEUED',
        error: 'Embedding credentials required',
      }),
    ]);

    renderPanel();
    await userEvent.click(await screen.findByLabelText('Expand repository'));

    expect(await screen.findByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Setup required')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Configure embeddings' }))
      .toHaveAttribute('href', '/org/ai-settings');
    expect(screen.getAllByText('Failure details')).toHaveLength(2);

    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(githubApi.reindexBranch).toHaveBeenCalledWith(
      'project-1',
      'repo-1',
      'index-failed',
    );
  });
});

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ProjectReposPanel projectId="project-1" />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

function indexState(overrides: Partial<ProjectRepoIndex> = {}): ProjectRepoIndex {
  return {
    id: 'index-1',
    branch: 'staging',
    status: 'INDEXING',
    stage: 'EMBEDDING',
    progressPercent: 60,
    filesProcessed: 30,
    totalFiles: 50,
    chunkCount: 120,
    activeGeneration: 1,
    requestedGeneration: 2,
    commitSha: 'abcdef1234567890',
    lastIndexedAt: '2026-07-24T00:00:00.000Z',
    lastRequestedAt: '2026-07-25T00:00:00.000Z',
    error: null,
    createdAt: '2026-07-24T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
    ...overrides,
  };
}
