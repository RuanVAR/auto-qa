import { EnvAccessService } from '../../common/access/env-access.service';
import { TokenService } from '../auth/token.service';
import { RunsGateway } from './runs.gateway';

describe('RunsGateway project rooms', () => {
  const tokens = {
    authenticateAccessToken: jest.fn(),
  };
  const envAccess = {
    assertProjectAccess: jest.fn(),
  };
  const client = {
    join: jest.fn(),
    leave: jest.fn(),
    emit: jest.fn(),
    id: 'socket-1',
  };
  let gateway: RunsGateway;

  beforeEach(() => {
    jest.clearAllMocks();
    gateway = new RunsGateway(
      tokens as unknown as TokenService,
      envAccess as unknown as EnvAccessService,
    );
  });

  it('joins a project room only after live token and membership checks', async () => {
    tokens.authenticateAccessToken.mockResolvedValue({
      sub: 'user-1',
      email: 'user@example.com',
      platformRole: 'USER',
      activeOrgId: 'org-1',
      orgRole: 'ORG_MEMBER',
    });
    envAccess.assertProjectAccess.mockResolvedValue(undefined);

    await expect(gateway.handleWatchProject(
      { projectId: 'project-1', token: 'jwt' },
      client as never,
    )).resolves.toEqual({ ok: true });

    expect(envAccess.assertProjectAccess).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      expect.objectContaining({ orgId: 'org-1' }),
    );
    expect(client.join).toHaveBeenCalledWith('project:project-1');
  });

  it('denies another project without joining its room', async () => {
    tokens.authenticateAccessToken.mockResolvedValue({
      sub: 'user-1',
      platformRole: 'USER',
      activeOrgId: 'org-1',
      orgRole: 'ORG_MEMBER',
    });
    envAccess.assertProjectAccess.mockRejectedValue(new Error('forbidden'));

    await expect(gateway.handleWatchProject(
      { projectId: 'project-2', token: 'jwt' },
      client as never,
    )).resolves.toEqual({ ok: false });

    expect(client.join).not.toHaveBeenCalled();
    expect(client.emit).toHaveBeenCalledWith('project:watch-denied', {
      projectId: 'project-2',
      message: 'Project access denied',
    });
  });

  it('rejects legacy unauthenticated project-id payloads', async () => {
    await expect(gateway.handleWatchProject(
      'project-1' as never,
      client as never,
    )).resolves.toEqual({ ok: false });

    expect(tokens.authenticateAccessToken).not.toHaveBeenCalled();
    expect(client.join).not.toHaveBeenCalled();
  });

  it('emits index progress only to the project room', () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    gateway.server = { to } as never;
    const payload = {
      orgId: 'org-1',
      projectId: 'project-1',
      repoId: 'repo-1',
      branchIndexId: 'index-1',
      branch: 'main',
      status: 'INDEXING' as const,
      stage: 'EMBEDDING' as const,
      progressPercent: 60,
      filesProcessed: 30,
      totalFiles: 50,
      chunkCount: 120,
    };

    gateway.emitRepoIndexProgress(payload);

    expect(to).toHaveBeenCalledWith('project:project-1');
    expect(emit).toHaveBeenCalledWith('repo:index-progress', payload);
  });
});
