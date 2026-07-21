import { ArtifactType } from '@prisma/client';
import { ArtifactsDirectController } from './artifacts.controller';

describe('ArtifactsDirectController', () => {
  const artifacts = {
    getAccessScope: jest.fn(),
    findOne: jest.fn(),
    issueTraceViewerToken: jest.fn(),
  };
  const envAccess = {
    assertEnvAccess: jest.fn(),
    assertProjectAccess: jest.fn(),
    assertElevatedProjectAccess: jest.fn(),
  };
  const user = { sub: 'user-1', orgRole: 'ORG_MEMBER', platformRole: 'USER', activeOrgId: 'org-1', email: 'qa@example.test', role: 'USER' };

  beforeEach(() => {
    jest.clearAllMocks();
    artifacts.getAccessScope.mockResolvedValue({ projectId: 'project-1', environmentId: 'env-1' });
    artifacts.findOne.mockResolvedValue({ id: 'artifact-1', type: ArtifactType.TRACE });
    artifacts.issueTraceViewerToken.mockResolvedValue('short-lived-token');
  });

  it('requires elevated project access before issuing a trace viewer token', async () => {
    const controller = new ArtifactsDirectController(artifacts as never, envAccess as never);

    await expect(controller.traceViewerToken('artifact-1', user)).resolves.toEqual({ token: 'short-lived-token' });

    expect(envAccess.assertElevatedProjectAccess).toHaveBeenCalledWith(
      'user-1', 'project-1', expect.objectContaining({ orgId: 'org-1' }),
    );
    expect(envAccess.assertEnvAccess).not.toHaveBeenCalled();
  });

  it('keeps ordinary screenshots on environment-scoped access', async () => {
    artifacts.findOne.mockResolvedValue({ id: 'artifact-1', type: ArtifactType.SCREENSHOT });
    const controller = new ArtifactsDirectController(artifacts as never, envAccess as never);

    await controller.traceViewerToken('artifact-1', user).catch(() => undefined);

    // traceViewerToken rejects non-trace artefacts in the real service; this
    // unit test only exercises the controller's access branch before that call.
    expect(envAccess.assertEnvAccess).toHaveBeenCalledWith(
      'user-1', 'project-1', 'env-1', expect.objectContaining({ orgId: 'org-1' }),
    );
    expect(envAccess.assertElevatedProjectAccess).not.toHaveBeenCalled();
  });
});
