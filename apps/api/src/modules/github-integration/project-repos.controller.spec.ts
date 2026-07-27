import { ForbiddenException } from '@nestjs/common';
import { JwtPayload } from '../../common/decorators/current-user.decorator';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectReposController } from './project-repos.controller';
import { ProjectReposService } from './project-repos.service';

describe('ProjectReposController', () => {
  const service = {
    list: jest.fn(),
    listAvailable: jest.fn(),
    link: jest.fn(),
    update: jest.fn(),
    unlink: jest.fn(),
    reindex: jest.fn(),
    reindexDefaultBranch: jest.fn(),
    listBranches: jest.fn(),
    replaceEnvBindings: jest.fn(),
    listEnvBindings: jest.fn(),
    listIndexes: jest.fn(),
    reindexBranch: jest.fn(),
    indexSummary: jest.fn(),
  };
  const envAccess = {
    assertProjectAccess: jest.fn(),
    assertElevatedProjectAccess: jest.fn(),
  };
  const user: JwtPayload = {
    sub: 'user-1',
    email: 'qa@example.com',
    platformRole: 'USER',
    activeOrgId: 'org-1',
    orgRole: 'ORG_MEMBER',
    role: 'USER',
  };
  let controller: ProjectReposController;

  beforeEach(() => {
    jest.clearAllMocks();
    envAccess.assertProjectAccess.mockResolvedValue(undefined);
    envAccess.assertElevatedProjectAccess.mockResolvedValue(undefined);
    controller = new ProjectReposController(
      service as unknown as ProjectReposService,
      envAccess as unknown as EnvAccessService,
    );
  });

  it('requires project access before listing repositories', async () => {
    service.list.mockResolvedValue([]);

    await controller.list('project-1', user);

    expect(envAccess.assertProjectAccess).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      {
        jwtRoleHint: { orgRole: 'ORG_MEMBER', platformRole: 'USER' },
        orgId: 'org-1',
      },
    );
    expect(service.list).toHaveBeenCalledWith('project-1');
  });

  it('requires elevated access before listing linkable repositories', async () => {
    service.listAvailable.mockResolvedValue([]);

    await controller.available('project-1', user);

    expect(envAccess.assertElevatedProjectAccess).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      {
        jwtRoleHint: { orgRole: 'ORG_MEMBER', platformRole: 'USER' },
        orgId: 'org-1',
      },
    );
    expect(service.listAvailable).toHaveBeenCalledWith('project-1');
  });

  it.each(['link', 'update', 'unlink', 'reindex'] as const)(
    'requires elevated project access before %s',
    async (method) => {
      service[method].mockResolvedValue(undefined);
      if (method === 'link') {
        await controller.link('project-1', { repoOwner: 'owner', repoName: 'repo' }, user);
      } else if (method === 'update') {
        await controller.update('project-1', 'repo-1', { defaultBranch: 'develop' }, user);
      } else if (method === 'unlink') {
        await controller.unlink('project-1', 'repo-1', user);
      } else {
        await controller.reindex('project-1', 'repo-1', user);
      }

      expect(envAccess.assertElevatedProjectAccess).toHaveBeenCalledWith(
        'user-1',
        'project-1',
        {
          jwtRoleHint: { orgRole: 'ORG_MEMBER', platformRole: 'USER' },
          orgId: 'org-1',
        },
      );
    },
  );

  it('does not invoke the service when access is rejected', async () => {
    envAccess.assertElevatedProjectAccess.mockRejectedValue(new ForbiddenException());

    await expect(controller.reindex('project-2', 'repo-1', user))
      .rejects.toThrow(ForbiddenException);
    expect(service.reindexDefaultBranch).not.toHaveBeenCalled();
  });

  it('requires project access for environment bindings and index summaries', async () => {
    service.listEnvBindings.mockResolvedValue([]);
    service.indexSummary.mockResolvedValue({ repositories: [] });

    await controller.envBindings('project-1', 'repo-1', user);
    await controller.indexSummary('project-1', user);

    expect(envAccess.assertProjectAccess).toHaveBeenCalledTimes(2);
    expect(service.listEnvBindings).toHaveBeenCalledWith('project-1', 'repo-1');
    expect(service.indexSummary).toHaveBeenCalledWith('project-1');
  });

  it('requires elevated access before replacing bindings or forcing a branch generation', async () => {
    const dto = {
      bindings: [{
        environmentId: '11111111-1111-4111-8111-111111111111',
        branch: 'release',
      }],
    };

    await controller.putEnvBindings('project-1', 'repo-1', dto, user);
    await controller.reindexBranch('project-1', 'repo-1', 'index-1', user);

    expect(envAccess.assertElevatedProjectAccess).toHaveBeenCalledTimes(2);
    expect(service.replaceEnvBindings)
      .toHaveBeenCalledWith('project-1', 'repo-1', dto.bindings, 'user-1');
    expect(service.reindexBranch)
      .toHaveBeenCalledWith('project-1', 'repo-1', 'index-1', 'user-1');
  });
});

describe('ProjectReposController tenant isolation', () => {
  const service = {
    list: jest.fn(),
    listAvailable: jest.fn(),
    link: jest.fn(),
    update: jest.fn(),
    unlink: jest.fn(),
    reindex: jest.fn(),
    reindexDefaultBranch: jest.fn(),
    listBranches: jest.fn(),
    replaceEnvBindings: jest.fn(),
    listEnvBindings: jest.fn(),
    listIndexes: jest.fn(),
    reindexBranch: jest.fn(),
    indexSummary: jest.fn(),
  };
  const prisma = {
    project: { findUnique: jest.fn() },
    projectMember: { findUnique: jest.fn() },
  };
  const orgOneAdmin: JwtPayload = {
    sub: 'admin-1',
    email: 'admin@example.com',
    platformRole: 'USER',
    activeOrgId: 'org-1',
    orgRole: 'ORG_ADMIN',
    role: 'USER',
  };
  let controller: ProjectReposController;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.project.findUnique.mockResolvedValue({ orgId: 'org-2' });
    prisma.projectMember.findUnique.mockResolvedValue(null);
    controller = new ProjectReposController(
      service as unknown as ProjectReposService,
      new EnvAccessService(prisma as unknown as PrismaService),
    );
  });

  it('denies listing a project in another organisation', async () => {
    await expect(controller.list('project-2', orgOneAdmin)).rejects.toThrow(ForbiddenException);
    expect(service.list).not.toHaveBeenCalled();
  });

  it.each(['link', 'update', 'unlink', 'reindex'] as const)(
    'denies cross-organisation %s mutations',
    async (method) => {
      if (method === 'link') {
        await expect(controller.link(
          'project-2',
          { repoOwner: 'owner', repoName: 'repo' },
          orgOneAdmin,
        )).rejects.toThrow(ForbiddenException);
      } else if (method === 'update') {
        await expect(controller.update(
          'project-2',
          'repo-1',
          { defaultBranch: 'develop' },
          orgOneAdmin,
        )).rejects.toThrow(ForbiddenException);
      } else if (method === 'unlink') {
        await expect(controller.unlink('project-2', 'repo-1', orgOneAdmin))
          .rejects.toThrow(ForbiddenException);
      } else {
        await expect(controller.reindex('project-2', 'repo-1', orgOneAdmin))
          .rejects.toThrow(ForbiddenException);
      }
      if (method === 'reindex') {
        expect(service.reindexDefaultBranch).not.toHaveBeenCalled();
      } else {
        expect(service[method]).not.toHaveBeenCalled();
      }
    },
  );
});
