import { BadRequestException } from '@nestjs/common';
import {
  EnvironmentReleaseSource,
  EnvironmentReleaseStatus,
} from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ProjectReposService } from '../github-integration/project-repos.service';
import { EnvironmentReleasesService } from './environment-releases.service';
import { VersionResolverService } from './version-resolver.service';

describe('EnvironmentReleasesService', () => {
  const prisma = {
    environment: { findFirst: jest.fn() },
    environmentRelease: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    projectRepo: { findFirst: jest.fn(), update: jest.fn() },
    repoEnvBinding: { findFirst: jest.fn(), findMany: jest.fn() },
    repoBranchIndex: { findFirst: jest.fn() },
  };
  const repos = { listBranches: jest.fn() };
  const versions = { resolve: jest.fn() };
  let service: EnvironmentReleasesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        EnvironmentReleasesService,
        { provide: PrismaService, useValue: prisma },
        { provide: ProjectReposService, useValue: repos },
        { provide: VersionResolverService, useValue: versions },
      ],
    }).compile();
    service = module.get(EnvironmentReleasesService);
    prisma.environment.findFirst.mockResolvedValue({
      id: 'env-1',
      project: { id: 'project-1', orgId: 'org-1' },
    });
    prisma.repoBranchIndex.findFirst.mockResolvedValue(null);
  });

  it('records an idempotent stack-neutral release label', async () => {
    const stored = {
      id: 'release-1',
      orgId: 'org-1',
      projectId: 'project-1',
      environmentId: 'env-1',
      version: '2026.07.25.3',
      source: EnvironmentReleaseSource.CI_API,
      status: EnvironmentReleaseStatus.SUCCESS,
      deployedAt: new Date('2026-07-25T10:00:00Z'),
      components: [],
    };
    prisma.environmentRelease.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(stored);
    prisma.environmentRelease.create.mockResolvedValue(stored);

    const first = await service.recordDeployment(
      'project-1',
      'env-1',
      {
        status: EnvironmentReleaseStatus.SUCCESS,
        releaseVersion: '2026.07.25.3',
        deployedAt: '2026-07-25T10:00:00Z',
      },
      EnvironmentReleaseSource.CI_API,
      'pipeline-42',
    );
    const duplicate = await service.recordDeployment(
      'project-1',
      'env-1',
      {
        status: EnvironmentReleaseStatus.SUCCESS,
        releaseVersion: '2026.07.25.3',
        deployedAt: '2026-07-25T10:00:00Z',
      },
      EnvironmentReleaseSource.CI_API,
      'pipeline-42',
    );

    expect(first.version).toBe('2026.07.25.3');
    expect(duplicate.id).toBe('release-1');
    expect(prisma.environmentRelease.create).toHaveBeenCalledTimes(1);
    expect(prisma.environmentRelease.create.mock.calls[0][0].data.idempotencyKey)
      .toBe('client:pipeline-42');
  });

  it('rejects a component repository from another project', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(null);
    await expect(service.recordDeployment(
      'project-1',
      'env-1',
      {
        status: EnvironmentReleaseStatus.SUCCESS,
        components: [{
          repoId: '11111111-1111-4111-8111-111111111111',
          version: '1.0.0',
        }],
      },
      EnvironmentReleaseSource.CI_API,
    )).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not persist an inferred release when no manifest version resolves', async () => {
    prisma.repoEnvBinding.findMany.mockResolvedValue([{
      projectId: 'project-1',
      projectRepoId: 'repo-1',
      branch: 'main',
      componentName: 'API',
      projectRepo: { role: 'BACKEND', repoName: 'api' },
    }]);
    repos.listBranches.mockResolvedValue([{ name: 'main', sha: 'abc123' }]);
    versions.resolve.mockResolvedValue(null);

    await expect(
      service.inferFromRepository('project-1', 'env-1'),
    ).rejects.toThrow('No version was found');
    expect(prisma.environmentRelease.create).not.toHaveBeenCalled();
  });
});
