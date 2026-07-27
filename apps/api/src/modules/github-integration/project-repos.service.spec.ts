import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ProjectRepo, RepoIndexStatus, RepoRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GitCredentialsService } from './git-credentials.service';
import { GitHubClient } from './github.client';
import { ProjectReposService } from './project-repos.service';
import { CodeIndexRequestService } from '../codebase-indexing/code-index-request.service';

const now = new Date('2026-07-24T10:00:00.000Z');

function repo(overrides: Partial<ProjectRepo> = {}): ProjectRepo {
  return {
    id: 'repo-1',
    orgId: 'org-1',
    projectId: 'project-1',
    credentialId: 'credential-1',
    role: RepoRole.BACKEND,
    repoOwner: 'OpenAI',
    repoName: 'qa-platform',
    defaultBranch: 'main',
    secretsCiphertext: null,
    secretsKeyId: null,
    includeGlobs: [],
    excludeGlobs: [],
    status: RepoIndexStatus.READY,
    chunkCount: 12,
    lastIndexedAt: now,
    webhookSecret: null,
    webhookExternalId: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('ProjectReposService', () => {
  const project = { findUnique: jest.fn() };
  const environment = { findMany: jest.fn() };
  const projectRepo = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
  };
  const repoEnvBinding = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const repoBranchIndex = {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
  };
  const transactionClient = { projectRepo, repoEnvBinding, repoBranchIndex };
  const prisma = {
    project,
    environment,
    projectRepo,
    repoEnvBinding,
    repoBranchIndex,
    $transaction: jest.fn(async (
      operations: Array<Promise<unknown>>
        | ((tx: typeof transactionClient) => Promise<unknown>),
    ): Promise<unknown> => typeof operations === 'function'
      ? operations(transactionClient)
      : Promise.all(operations)),
  };
  const credentials = { authForOrg: jest.fn() };
  const github = {
    repoReachable: jest.fn(),
    listRepositories: jest.fn(),
    listBranches: jest.fn(),
    getFileContent: jest.fn(),
  };
  const indexRequests = { request: jest.fn() };
  let service: ProjectReposService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.projectRepo.findMany.mockResolvedValue([]);
    prisma.repoEnvBinding.updateMany.mockResolvedValue({ count: 0 });
    prisma.repoEnvBinding.findMany.mockResolvedValue([]);
    prisma.repoEnvBinding.findFirst.mockResolvedValue(null);
    prisma.repoEnvBinding.create.mockResolvedValue({});
    prisma.repoEnvBinding.update.mockResolvedValue({});
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 0 });
    prisma.repoBranchIndex.findMany.mockResolvedValue([]);
    prisma.repoBranchIndex.findFirst.mockResolvedValue(null);
    indexRequests.request.mockResolvedValue({ status: RepoIndexStatus.PENDING });
    service = new ProjectReposService(
      prisma as unknown as PrismaService,
      credentials as unknown as GitCredentialsService,
      github as unknown as GitHubClient,
      indexRequests as unknown as CodeIndexRequestService,
    );
  });

  it('scopes repository listing to the requested project and active rows', async () => {
    prisma.projectRepo.findMany.mockResolvedValue([]);

    await service.list('project-1');

    expect(prisma.projectRepo.findMany).toHaveBeenCalledWith({
      where: { projectId: 'project-1', deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
  });

  it('lists credential-accessible repositories that are not already linked', async () => {
    prisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'APP', appId: '1', privateKey: 'key', installationId: '2' },
    });
    github.listRepositories.mockResolvedValue([
      {
        owner: 'owner',
        name: 'linked',
        fullName: 'owner/linked',
        defaultBranch: 'main',
        private: true,
        archived: false,
      },
      {
        owner: 'owner',
        name: 'available',
        fullName: 'owner/available',
        defaultBranch: 'develop',
        private: true,
        archived: false,
      },
    ]);
    prisma.projectRepo.findMany.mockResolvedValue([
      { repoOwner: 'OWNER', repoName: 'LINKED' },
    ]);

    await expect(service.listAvailable('project-1')).resolves.toEqual([
      expect.objectContaining({ fullName: 'owner/available', defaultBranch: 'develop' }),
    ]);
  });

  it('rejects updates when the repo belongs to another project', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(null);

    await expect(service.update('project-2', 'repo-1', {
      defaultBranch: 'release',
    })).rejects.toThrow(NotFoundException);
    expect(prisma.projectRepo.updateMany).not.toHaveBeenCalled();
  });

  it('queues a forced generation for the scoped repository default branch', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    indexRequests.request.mockResolvedValue({ status: RepoIndexStatus.PENDING });

    await expect(service.reindexDefaultBranch('project-1', 'repo-1', 'user-1'))
      .resolves.toEqual(expect.objectContaining({ status: RepoIndexStatus.PENDING }));
    expect(indexRequests.request).toHaveBeenCalledWith({
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      force: true,
      trigger: 'MANUAL',
      requestedById: 'user-1',
    });
  });

  it('soft-deletes a repo and clears its secret and webhook fields', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo({
      secretsCiphertext: Buffer.from('override-token'),
      secretsKeyId: 'v1',
      webhookSecret: 'webhook-secret',
      webhookExternalId: 'hook-1',
    }));
    prisma.projectRepo.updateMany.mockResolvedValue({ count: 1 });

    await service.unlink('project-1', 'repo-1');

    const update = prisma.projectRepo.updateMany.mock.calls[0][0];
    expect(update.where).toEqual({
      id: 'repo-1',
      projectId: 'project-1',
      orgId: 'org-1',
      deletedAt: null,
    });
    expect(update.data).toMatchObject({
      deletedAt: expect.any(Date),
      secretsKeyId: null,
      webhookSecret: null,
      webhookExternalId: null,
    });
    expect(update.data.secretsCiphertext.equals(Buffer.alloc('override-token'.length))).toBe(true);
  });

  it('links the canonical repository identity returned by GitHub', async () => {
    prisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'PAT', token: 'secret' },
    });
    github.repoReachable.mockResolvedValue({
      ok: true,
      connectedAs: 'CanonicalOwner/CanonicalRepo',
    });
    prisma.projectRepo.findFirst.mockResolvedValue(null);
    prisma.projectRepo.create.mockResolvedValue(repo({
      repoOwner: 'CanonicalOwner',
      repoName: 'CanonicalRepo',
      status: RepoIndexStatus.PENDING,
      chunkCount: 0,
      lastIndexedAt: null,
    }));

    await service.link('project-1', {
      repoOwner: 'canonicalowner',
      repoName: 'canonicalrepo',
      role: RepoRole.BACKEND,
      defaultBranch: 'develop',
    });

    expect(prisma.projectRepo.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orgId: 'org-1',
        projectId: 'project-1',
        credentialId: 'credential-1',
        repoOwner: 'CanonicalOwner',
        repoName: 'CanonicalRepo',
        defaultBranch: 'develop',
      }),
    });
  });

  it('revives a soft-deleted repository instead of creating a duplicate', async () => {
    const removed = repo({ deletedAt: now });
    prisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'PAT', token: 'secret' },
    });
    github.repoReachable.mockResolvedValue({ ok: true, connectedAs: 'OpenAI/qa-platform' });
    prisma.projectRepo.findFirst.mockResolvedValue(removed);
    prisma.projectRepo.update.mockResolvedValue(repo({
      status: RepoIndexStatus.PENDING,
      chunkCount: 0,
      lastIndexedAt: null,
    }));

    await service.link('project-1', {
      repoOwner: 'OpenAI',
      repoName: 'qa-platform',
    });

    expect(prisma.projectRepo.update).toHaveBeenCalledWith({
      where: { id: 'repo-1' },
      data: expect.objectContaining({
        deletedAt: null,
        status: RepoIndexStatus.PENDING,
        chunkCount: 0,
        webhookSecret: null,
      }),
    });
    expect(prisma.projectRepo.create).not.toHaveBeenCalled();
  });

  it('stores independent staging and production branches and queues each generation', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    prisma.environment.findMany.mockResolvedValue([
      { id: '11111111-1111-4111-8111-111111111111' },
      { id: '22222222-2222-4222-8222-222222222222' },
    ]);
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'PAT', token: 'secret' },
    });
    github.listBranches.mockResolvedValue([
      { name: 'develop', sha: 'dev-sha' },
      { name: 'main', sha: 'main-sha' },
    ]);
    prisma.repoEnvBinding.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.replaceEnvBindings('project-1', 'repo-1', [
      {
        environmentId: '11111111-1111-4111-8111-111111111111',
        branch: 'develop',
      },
      {
        environmentId: '22222222-2222-4222-8222-222222222222',
        branch: 'main',
      },
    ], 'user-1');

    expect(prisma.repoEnvBinding.create).toHaveBeenCalledTimes(2);
    expect(indexRequests.request.mock.calls.map(([request]) => request))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ branch: 'develop', trigger: 'BINDING_CHANGE' }),
        expect.objectContaining({ branch: 'main', trigger: 'BINDING_CHANGE' }),
      ]));
  });

  it('rejects an environment from another project before reading provider branches', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    prisma.environment.findMany.mockResolvedValue([]);

    await expect(service.replaceEnvBindings('project-1', 'repo-1', [{
      environmentId: '11111111-1111-4111-8111-111111111111',
      branch: 'main',
    }])).rejects.toThrow(BadRequestException);

    expect(github.listBranches).not.toHaveBeenCalled();
    expect(indexRequests.request).not.toHaveBeenCalled();
  });

  it('scopes branch index status to repo, project, organisation, and active rows', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    prisma.repoBranchIndex.findMany.mockResolvedValue([]);

    await service.listIndexes('project-1', 'repo-1');

    expect(prisma.repoBranchIndex.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectRepoId: 'repo-1',
          projectId: 'project-1',
          orgId: 'org-1',
          deletedAt: null,
        },
      }),
    );
  });

  it('rejects an index id attached to another repository', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    prisma.repoBranchIndex.findFirst.mockResolvedValue(null);

    await expect(service.reindexBranch(
      'project-1',
      'repo-1',
      'index-from-repo-2',
      'user-1',
    )).rejects.toThrow(NotFoundException);

    expect(indexRequests.request).not.toHaveBeenCalled();
  });

  it('reads a normalized safe file from the scoped repository default branch', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'PAT', token: 'secret' },
    });
    github.getFileContent.mockResolvedValue({
      path: 'src/login.ts',
      sha: 'file-sha',
      size: 29,
      content: 'export const route = "/login";',
    });

    const result = await service.readRepoFile(
      'project-1',
      'repo-1',
      String.raw`.\src\login.ts`,
    );

    expect(github.getFileContent).toHaveBeenCalledWith(
      { kind: 'PAT', token: 'secret' },
      'OpenAI',
      'qa-platform',
      'src/login.ts',
      'main',
    );
    expect(result).toEqual(expect.objectContaining({
      ref: 'main',
      path: 'src/login.ts',
      content: 'export const route = "/login";',
    }));
  });

  it.each([
    '../.env',
    '.env-production',
    'config/credentials.json',
    'certs/client.pem',
    '.git/config',
  ])('blocks unsafe file reads before any GitHub request: %s', async (filePath) => {
    await expect(service.readRepoFile(
      'project-1',
      'repo-1',
      filePath,
    )).rejects.toThrow(BadRequestException);

    expect(github.getFileContent).not.toHaveBeenCalled();
  });

  it('rejects binary content returned by the provider', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(repo());
    credentials.authForOrg.mockResolvedValue({
      credentialId: 'credential-1',
      auth: { kind: 'PAT', token: 'secret' },
    });
    github.getFileContent.mockResolvedValue({
      path: 'src/data.ts',
      sha: 'file-sha',
      size: 3,
      content: `a\0b`,
    });

    await expect(service.readRepoFile(
      'project-1',
      'repo-1',
      'src/data.ts',
      'release',
    )).rejects.toThrow('Binary repository files cannot be read');
  });

  it('rejects a repository from another project before resolving credentials', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(null);

    await expect(service.readRepoFile(
      'project-2',
      'repo-1',
      'src/login.ts',
    )).rejects.toThrow(NotFoundException);

    expect(credentials.authForOrg).not.toHaveBeenCalled();
    expect(github.getFileContent).not.toHaveBeenCalled();
  });
});
