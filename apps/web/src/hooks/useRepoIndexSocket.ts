import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import {
  getFreshToken,
  type ProjectRepoIndex,
} from '@/lib/api';

interface RepoIndexProgressPayload {
  projectId: string;
  repoId: string;
  branchIndexId: string;
  branch: string;
  status: ProjectRepoIndex['status'];
  stage: ProjectRepoIndex['stage'];
  progressPercent: number;
  filesProcessed: number;
  totalFiles?: number;
  chunkCount: number;
  error?: string;
  commitSha?: string;
}

export function useRepoIndexSocket(projectId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!projectId) return;
    const socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1_000,
      reconnectionDelayMax: 5_000,
    });
    let active = true;

    const subscribe = async () => {
      const token = await getFreshToken();
      if (!active || !token) return;
      socket.emit('watch:project', { projectId, token });
    };
    const handleProgress = (event: RepoIndexProgressPayload) => {
      if (event.projectId !== projectId) return;
      queryClient.setQueryData<ProjectRepoIndex[]>(
        ['repo-indexes', projectId, event.repoId],
        (current) => current?.map((index) => index.id === event.branchIndexId
          ? {
            ...index,
            branch: event.branch,
            status: event.status,
            stage: event.stage,
            progressPercent: event.progressPercent,
            filesProcessed: event.filesProcessed,
            totalFiles: event.totalFiles ?? null,
            chunkCount: event.chunkCount,
            error: event.error ?? null,
            commitSha: event.commitSha ?? index.commitSha,
            updatedAt: new Date().toISOString(),
          }
          : index),
      );
      void queryClient.invalidateQueries({
        queryKey: ['project-repos', projectId],
      });
      if (event.status === 'READY' || event.status === 'FAILED' || event.status === 'BLOCKED') {
        void queryClient.invalidateQueries({
          queryKey: ['repo-indexes', projectId, event.repoId],
        });
        void queryClient.invalidateQueries({
          queryKey: ['notifications-unread-count'],
        });
        void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      }
    };

    socket.on('connect', subscribe);
    socket.on('repo:index-progress', handleProgress);
    if (socket.connected) void subscribe();

    return () => {
      active = false;
      socket.emit('unwatch:project', projectId);
      socket.off('connect', subscribe);
      socket.off('repo:index-progress', handleProgress);
      socket.disconnect();
    };
  }, [projectId, queryClient]);
}
