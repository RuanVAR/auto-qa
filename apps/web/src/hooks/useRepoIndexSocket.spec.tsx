import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFreshToken, type ProjectRepoIndex } from '@/lib/api';
import { useRepoIndexSocket } from './useRepoIndexSocket';

const socketHarness = vi.hoisted(() => {
  const handlers: Record<string, (payload?: unknown) => void> = {};
  const socket = {
    connected: false,
    emit: vi.fn(),
    on: vi.fn((event: string, handler: (payload?: unknown) => void) => {
      handlers[event] = handler;
    }),
    off: vi.fn(),
    disconnect: vi.fn(),
  };
  return { handlers, socket };
});

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => socketHarness.socket),
}));
vi.mock('@/lib/api', () => ({
  getFreshToken: vi.fn(),
}));

describe('useRepoIndexSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const event of Object.keys(socketHarness.handlers)) {
      delete socketHarness.handlers[event];
    }
    socketHarness.socket.connected = false;
    vi.mocked(getFreshToken).mockResolvedValue('fresh-jwt');
  });

  it('authenticates the project room and applies terminal progress to the cache', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined);
    client.setQueryData<ProjectRepoIndex[]>(
      ['repo-indexes', 'project-1', 'repo-1'],
      [indexState()],
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    const { unmount } = renderHook(
      () => useRepoIndexSocket('project-1'),
      { wrapper },
    );

    await act(async () => {
      socketHarness.handlers.connect();
      await Promise.resolve();
    });
    expect(socketHarness.socket.emit).toHaveBeenCalledWith('watch:project', {
      projectId: 'project-1',
      token: 'fresh-jwt',
    });

    act(() => {
      socketHarness.handlers['repo:index-progress']({
        projectId: 'project-1',
        repoId: 'repo-1',
        branchIndexId: 'index-1',
        branch: 'main',
        status: 'READY',
        stage: 'COMPLETE',
        progressPercent: 100,
        filesProcessed: 42,
        totalFiles: 42,
        chunkCount: 180,
        commitSha: 'new-commit',
      });
    });

    expect(client.getQueryData<ProjectRepoIndex[]>(
      ['repo-indexes', 'project-1', 'repo-1'],
    )).toEqual([
      expect.objectContaining({
        status: 'READY',
        stage: 'COMPLETE',
        progressPercent: 100,
        filesProcessed: 42,
        totalFiles: 42,
        chunkCount: 180,
        commitSha: 'new-commit',
      }),
    ]);
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['notifications-unread-count'],
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['notifications'],
      });
    });

    unmount();
    expect(socketHarness.socket.emit).toHaveBeenCalledWith(
      'unwatch:project',
      'project-1',
    );
    expect(socketHarness.socket.disconnect).toHaveBeenCalled();
  });

  it('ignores progress for another project', () => {
    const client = new QueryClient();
    client.setQueryData<ProjectRepoIndex[]>(
      ['repo-indexes', 'project-1', 'repo-1'],
      [indexState()],
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { unmount } = renderHook(
      () => useRepoIndexSocket('project-1'),
      { wrapper },
    );

    act(() => {
      socketHarness.handlers['repo:index-progress']({
        projectId: 'project-2',
        repoId: 'repo-1',
        branchIndexId: 'index-1',
        branch: 'main',
        status: 'FAILED',
        stage: 'EMBEDDING',
        progressPercent: 40,
        filesProcessed: 10,
        chunkCount: 30,
      });
    });

    expect(client.getQueryData<ProjectRepoIndex[]>(
      ['repo-indexes', 'project-1', 'repo-1'],
    )?.[0].status).toBe('INDEXING');
    unmount();
  });
});

function indexState(): ProjectRepoIndex {
  return {
    id: 'index-1',
    branch: 'main',
    status: 'INDEXING',
    stage: 'EMBEDDING',
    progressPercent: 50,
    filesProcessed: 20,
    totalFiles: 40,
    chunkCount: 100,
    activeGeneration: 1,
    requestedGeneration: 2,
    commitSha: 'old-commit',
    lastIndexedAt: null,
    lastRequestedAt: '2026-07-25T00:00:00.000Z',
    error: null,
    createdAt: '2026-07-25T00:00:00.000Z',
    updatedAt: '2026-07-25T00:00:00.000Z',
  };
}
