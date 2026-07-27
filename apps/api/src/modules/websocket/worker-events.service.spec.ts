import { WorkerEventsService } from './worker-events.service';

describe('WorkerEventsService code-index forwarding', () => {
  it('forwards progress and notifies only for terminal states', async () => {
    const gateway = { emitRepoIndexProgress: jest.fn() };
    const notifications = { notifyCodeIndex: jest.fn().mockResolvedValue(undefined) };
    const service = new WorkerEventsService(
      gateway as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      notifications as never,
    );
    const progress = {
      orgId: 'org-1',
      projectId: 'project-1',
      repoId: 'repo-1',
      branchIndexId: 'index-1',
      branch: 'main',
      status: 'INDEXING',
      stage: 'EMBEDDING',
      progressPercent: 60,
      filesProcessed: 3,
      chunkCount: 20,
    };

    service.handleWorkerEventMessage(JSON.stringify({
      type: 'repo:index-progress',
      payload: progress,
    }));
    expect(gateway.emitRepoIndexProgress).toHaveBeenCalledWith(progress);
    expect(notifications.notifyCodeIndex).not.toHaveBeenCalled();

    const terminal = { ...progress, status: 'READY', stage: 'COMPLETE' };
    service.handleWorkerEventMessage(JSON.stringify({
      type: 'repo:index-progress',
      payload: terminal,
    }));
    await Promise.resolve();

    expect(gateway.emitRepoIndexProgress).toHaveBeenLastCalledWith(terminal);
    expect(notifications.notifyCodeIndex).toHaveBeenCalledWith(terminal);
  });
});
