import { NotFoundException } from '@nestjs/common';
import { EmbeddingProvider, RepoIndexStatus } from '@prisma/client';
import { EmbeddingClient } from '@qa-platform/shared';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { CodebaseRetrievalService } from './codebase-retrieval.service';

describe('CodebaseRetrievalService', () => {
  const prisma = {
    project: { findUnique: jest.fn() },
    environment: { findFirst: jest.fn() },
    projectRepo: { findMany: jest.fn() },
    repoEnvBinding: { findMany: jest.fn() },
    repoBranchIndex: { findMany: jest.fn() },
    orgEmbeddingCredential: { findFirst: jest.fn() },
    $queryRaw: jest.fn(),
  };
  const envAccess = {
    assertProjectAccess: jest.fn(),
    assertEnvAccess: jest.fn(),
  };
  const secrets = { decrypt: jest.fn().mockReturnValue({ apiKey: 'secret' }) };
  let service: CodebaseRetrievalService;

  beforeEach(() => {
    jest.clearAllMocks();
    envAccess.assertProjectAccess.mockResolvedValue(undefined);
    envAccess.assertEnvAccess.mockResolvedValue(undefined);
    prisma.project.findUnique.mockResolvedValue({ orgId: 'org-1' });
    prisma.environment.findFirst.mockResolvedValue({ id: 'env-1' });
    prisma.projectRepo.findMany.mockResolvedValue([
      {
        id: 'repo-1',
        repoOwner: 'owner',
        repoName: 'app',
        defaultBranch: 'main',
      },
    ]);
    prisma.repoEnvBinding.findMany.mockResolvedValue([
      { projectRepoId: 'repo-1', branch: 'release' },
    ]);
    prisma.repoBranchIndex.findMany.mockResolvedValue([
      {
        id: 'index-main',
        projectRepoId: 'repo-1',
        branch: 'main',
        activeGeneration: 2,
        embeddingFingerprint: 'fingerprint',
        embeddingDimension: 3,
      },
      {
        id: 'index-release',
        projectRepoId: 'repo-1',
        branch: 'release',
        activeGeneration: 4,
        embeddingFingerprint: 'fingerprint',
        embeddingDimension: 3,
      },
    ]);
    prisma.orgEmbeddingCredential.findFirst.mockResolvedValue({
      provider: EmbeddingProvider.OPENAI,
      model: 'fixture',
      baseUrl: null,
      azureDeployment: null,
      azureApiVersion: null,
      secretsCiphertext: Buffer.from('ciphertext'),
      secretsKeyId: 'v1',
      dimension: 3,
      configFingerprint: 'fingerprint',
    });
    prisma.$queryRaw.mockResolvedValue([{
      repoId: 'repo-1',
      repoOwner: 'owner',
      repoName: 'app',
      branch: 'release',
      commitSha: 'release-sha',
      filePath: 'src/login.ts',
      symbol: 'login',
      content: 'release login',
      selectors: ['data-testid=login'],
      routes: ['/login'],
      score: 1,
      indexStatus: RepoIndexStatus.INDEXING,
    }]);
    jest.spyOn(EmbeddingClient.prototype, 'embedQuery').mockResolvedValue([0, 1, 0]);
    service = new CodebaseRetrievalService(
      prisma as unknown as PrismaService,
      envAccess as unknown as EnvAccessService,
      secrets as unknown as SecretsService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('selects the environment branch generation and marks active in-progress data stale', async () => {
    const result = await service.retrieveChunks('user-1', {
      projectId: 'project-1',
      environmentId: 'env-1',
      query: 'login selector',
    });

    expect(envAccess.assertProjectAccess).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      { jwtRoleHint: {} },
    );
    expect(envAccess.assertEnvAccess).toHaveBeenCalledWith(
      'user-1',
      'project-1',
      'env-1',
      { jwtRoleHint: {} },
    );
    expect(result).toEqual([
      expect.objectContaining({
        branch: 'release',
        stale: true,
        score: 1,
      }),
    ]);
    const query = prisma.$queryRaw.mock.calls[0][0] as { values: unknown[] };
    expect(query.values).toContain('index-release');
    expect(query.values).not.toContain('index-main');
    expect(query.values).toContain('org-1');
    expect(query.values).toContain('project-1');
  });

  it('does not query vectors when the active generation has an incompatible fingerprint', async () => {
    prisma.repoBranchIndex.findMany.mockResolvedValue([{
      id: 'index-release',
      projectRepoId: 'repo-1',
      branch: 'release',
      activeGeneration: 4,
      embeddingFingerprint: 'old-fingerprint',
      embeddingDimension: 3,
    }]);

    await expect(service.retrieveChunks('user-1', {
      projectId: 'project-1',
      environmentId: 'env-1',
      query: 'login selector',
    })).resolves.toEqual([]);

    expect(EmbeddingClient.prototype.embedQuery).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('rejects a supplied repo id outside the project before embedding or SQL', async () => {
    prisma.projectRepo.findMany.mockResolvedValue([]);

    await expect(service.retrieveChunks('user-1', {
      projectId: 'project-1',
      repoIds: ['repo-from-project-2'],
      query: 'login selector',
    })).rejects.toThrow(NotFoundException);

    expect(EmbeddingClient.prototype.embedQuery).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
