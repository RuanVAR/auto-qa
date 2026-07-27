import {
  AccountStatus,
  EmbeddingProvider,
  GitAuthKind,
  Prisma,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import { EmbeddingClient } from '@qa-platform/shared';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { CodebaseRetrievalService } from './codebase-retrieval.service';

const runIntegration = process.env.CODE_INDEX_DB_TEST === '1' ? describe : describe.skip;

runIntegration('CodebaseRetrievalService integration', () => {
  const prisma = new PrismaService();
  const secrets = new SecretsService();
  const envAccess = {
    assertProjectAccess: jest.fn().mockResolvedValue(undefined),
    assertEnvAccess: jest.fn().mockResolvedValue(undefined),
  };
  const ids = {
    user: 'retrieval-integration-user',
    org: 'retrieval-integration-org',
    otherOrg: 'retrieval-integration-other-org',
    project: 'retrieval-integration-project',
    otherProject: 'retrieval-integration-other-project',
    credential: 'retrieval-integration-git',
    otherCredential: 'retrieval-integration-other-git',
    repo: 'retrieval-integration-repo',
    otherRepo: 'retrieval-integration-other-repo',
    embedding: 'retrieval-integration-embedding',
    otherEmbedding: 'retrieval-integration-other-embedding',
    mainIndex: 'retrieval-integration-main-index',
    releaseIndex: 'retrieval-integration-release-index',
    otherIndex: 'retrieval-integration-other-index',
    staging: 'retrieval-integration-staging',
    production: 'retrieval-integration-production',
  };
  let service: CodebaseRetrievalService;

  beforeAll(async () => {
    await prisma.$connect();
    secrets.onModuleInit();
    service = new CodebaseRetrievalService(
      prisma,
      envAccess as unknown as EnvAccessService,
      secrets,
    );
    jest.spyOn(EmbeddingClient.prototype, 'embedQuery')
      .mockImplementation(async (_config, input) =>
        input.includes('release') ? [0, 1, 0] : [1, 0, 0]);

    await prisma.user.create({
      data: {
        id: ids.user,
        email: 'retrieval-integration@example.invalid',
        name: 'Retrieval Integration',
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    await prisma.organisation.createMany({
      data: [
        {
          id: ids.org,
          name: 'Retrieval Integration',
          slug: 'retrieval-integration',
          ownerId: ids.user,
        },
        {
          id: ids.otherOrg,
          name: 'Retrieval Integration Other',
          slug: 'retrieval-integration-other',
          ownerId: ids.user,
        },
      ],
    });
    await prisma.project.createMany({
      data: [
        {
          id: ids.project,
          name: 'Retrieval Integration',
          slug: 'retrieval-integration',
          ownerId: ids.user,
          orgId: ids.org,
        },
        {
          id: ids.otherProject,
          name: 'Retrieval Integration Other',
          slug: 'retrieval-integration-other',
          ownerId: ids.user,
          orgId: ids.otherOrg,
        },
      ],
    });
    const gitSecret = secrets.encrypt({ token: 'fixture-token' });
    await prisma.orgGitCredential.createMany({
      data: [
        {
          id: ids.credential,
          orgId: ids.org,
          authKind: GitAuthKind.PAT,
          secretsCiphertext: gitSecret.ciphertext,
          secretsKeyId: gitSecret.keyId,
          lastHealthOk: true,
        },
        {
          id: ids.otherCredential,
          orgId: ids.otherOrg,
          authKind: GitAuthKind.PAT,
          secretsCiphertext: gitSecret.ciphertext,
          secretsKeyId: gitSecret.keyId,
          lastHealthOk: true,
        },
      ],
    });
    await prisma.projectRepo.createMany({
      data: [
        {
          id: ids.repo,
          orgId: ids.org,
          projectId: ids.project,
          credentialId: ids.credential,
          repoOwner: 'fixture',
          repoName: 'app',
          defaultBranch: 'main',
        },
        {
          id: ids.otherRepo,
          orgId: ids.otherOrg,
          projectId: ids.otherProject,
          credentialId: ids.otherCredential,
          repoOwner: 'other',
          repoName: 'secret-app',
          defaultBranch: 'main',
        },
      ],
    });
    const embeddingSecret = secrets.encrypt({ apiKey: 'fixture-embedding-key' });
    await prisma.orgEmbeddingCredential.createMany({
      data: [
        {
          id: ids.embedding,
          orgId: ids.org,
          provider: EmbeddingProvider.OPENAI,
          model: 'fixture',
          secretsCiphertext: embeddingSecret.ciphertext,
          secretsKeyId: embeddingSecret.keyId,
          dimension: 3,
          configFingerprint: 'fixture-fingerprint',
        },
        {
          id: ids.otherEmbedding,
          orgId: ids.otherOrg,
          provider: EmbeddingProvider.OPENAI,
          model: 'fixture',
          secretsCiphertext: embeddingSecret.ciphertext,
          secretsKeyId: embeddingSecret.keyId,
          dimension: 3,
          configFingerprint: 'fixture-fingerprint',
        },
      ],
    });
    await prisma.environment.createMany({
      data: [
        {
          id: ids.staging,
          name: 'Staging',
          baseUrl: 'https://staging.example.invalid',
          projectId: ids.project,
        },
        {
          id: ids.production,
          name: 'Production',
          baseUrl: 'https://example.invalid',
          projectId: ids.project,
        },
      ],
    });
    await prisma.repoEnvBinding.createMany({
      data: [
        {
          orgId: ids.org,
          projectId: ids.project,
          projectRepoId: ids.repo,
          environmentId: ids.staging,
          branch: 'release',
        },
        {
          orgId: ids.org,
          projectId: ids.project,
          projectRepoId: ids.repo,
          environmentId: ids.production,
          branch: 'main',
        },
      ],
    });
    await prisma.repoBranchIndex.createMany({
      data: [
        indexData(ids.mainIndex, ids.org, ids.project, ids.repo, 'main', 'main-sha'),
        indexData(ids.releaseIndex, ids.org, ids.project, ids.repo, 'release', 'release-sha'),
        indexData(ids.otherIndex, ids.otherOrg, ids.otherProject, ids.otherRepo, 'main', 'other-sha'),
      ],
    });
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "code_chunks" (
        "id", "orgId", "projectId", "branchIndexId", "generation",
        "filePath", "chunkIndex", "content", "symbol", "selectors", "routes",
        "embedding", "createdAt"
      ) VALUES
        ('retrieval-main-chunk', ${ids.org}, ${ids.project}, ${ids.mainIndex}, 1,
         'src/main-login.ts', 0, 'main login selector', 'mainLogin',
         ARRAY['data-testid=main-login']::text[], ARRAY['/login']::text[],
         '[1,0,0]'::vector, CURRENT_TIMESTAMP),
        ('retrieval-release-chunk', ${ids.org}, ${ids.project}, ${ids.releaseIndex}, 1,
         'src/release-login.ts', 0, 'release login selector', 'releaseLogin',
         ARRAY['data-testid=release-login']::text[], ARRAY['/login']::text[],
         '[0,1,0]'::vector, CURRENT_TIMESTAMP),
        ('retrieval-other-chunk', ${ids.otherOrg}, ${ids.otherProject}, ${ids.otherIndex}, 1,
         'src/secret.ts', 0, 'other tenant secret selector', 'secret',
         ARRAY['data-testid=secret']::text[], ARRAY['/secret']::text[],
         '[0,1,0]'::vector, CURRENT_TIMESTAMP)
    `);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.project.deleteMany({
      where: { id: { in: [ids.project, ids.otherProject] } },
    });
    await prisma.organisation.deleteMany({
      where: { id: { in: [ids.org, ids.otherOrg] } },
    });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  });

  it('resolves staging and production to independent active generations', async () => {
    const staging = await service.retrieveChunks('user-1', {
      projectId: ids.project,
      environmentId: ids.staging,
      query: 'release login',
    });
    const production = await service.retrieveChunks('user-1', {
      projectId: ids.project,
      environmentId: ids.production,
      query: 'main login',
    });

    expect(staging.map((chunk) => chunk.branch)).toEqual(['release']);
    expect(staging.map((chunk) => chunk.filePath)).toEqual(['src/release-login.ts']);
    expect(production.map((chunk) => chunk.branch)).toEqual(['main']);
    expect(production.map((chunk) => chunk.filePath)).toEqual(['src/main-login.ts']);
  });

  it('never returns another organisation even when its vector is equally relevant', async () => {
    const result = await service.retrieveChunks('user-1', {
      projectId: ids.project,
      environmentId: ids.staging,
      query: 'release login',
      minScore: -1,
      limit: 20,
    });

    expect(result).toHaveLength(1);
    expect(result[0].repo.id).toBe(ids.repo);
    expect(result.some((chunk) => chunk.content.includes('other tenant'))).toBe(false);
  });

  it('rejects an explicit repo id owned by another project', async () => {
    await expect(service.retrieveChunks('user-1', {
      projectId: ids.project,
      repoIds: [ids.otherRepo],
      query: 'secret',
    })).rejects.toThrow('One or more repos were not found in this project');
  });
});

function indexData(
  id: string,
  orgId: string,
  projectId: string,
  projectRepoId: string,
  branch: string,
  commitSha: string,
) {
  return {
    id,
    orgId,
    projectId,
    projectRepoId,
    branch,
    status: RepoIndexStatus.READY,
    stage: RepoIndexStage.COMPLETE,
    progressPercent: 100,
    chunkCount: 1,
    activeGeneration: 1,
    requestedGeneration: 1,
    commitSha,
    embeddingFingerprint: 'fixture-fingerprint',
    embeddingDimension: 3,
    lastIndexedAt: new Date(),
  };
}
