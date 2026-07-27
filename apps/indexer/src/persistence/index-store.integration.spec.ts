import {
  AccountStatus,
  EmbeddingProvider,
  GitAuthKind,
  PrismaClient,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import { encryptSecret } from '@qa-platform/shared';
import { PrismaIndexStore } from './index-store';

const runIntegration = process.env.CODE_INDEX_DB_TEST === '1' ? describe : describe.skip;

runIntegration('PrismaIndexStore integration', () => {
  const prisma = new PrismaClient();
  const ids = {
    user: 'indexer-integration-user',
    org: 'indexer-integration-org',
    project: 'indexer-integration-project',
    credential: 'indexer-integration-git',
    repo: 'indexer-integration-repo',
    embedding: 'indexer-integration-embedding',
    index: 'indexer-integration-index',
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.organisation.deleteMany({ where: { id: ids.org } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
  });

  it('persists vectors and activates the generation atomically', async () => {
    const gitSecret = encryptSecret({ token: 'fixture-token' });
    const embeddingSecret = encryptSecret({ apiKey: 'fixture-api-key' });
    await prisma.user.create({
      data: {
        id: ids.user,
        email: 'indexer-integration@example.invalid',
        name: 'Indexer Integration',
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    await prisma.organisation.create({
      data: {
        id: ids.org,
        name: 'Indexer Integration',
        slug: 'indexer-integration',
        ownerId: ids.user,
      },
    });
    await prisma.project.create({
      data: {
        id: ids.project,
        name: 'Indexer Integration',
        slug: 'indexer-integration',
        ownerId: ids.user,
        orgId: ids.org,
      },
    });
    await prisma.orgGitCredential.create({
      data: {
        id: ids.credential,
        orgId: ids.org,
        authKind: GitAuthKind.PAT,
        secretsCiphertext: gitSecret.ciphertext,
        secretsKeyId: gitSecret.keyId,
        lastHealthOk: true,
        isEnabled: true,
      },
    });
    await prisma.projectRepo.create({
      data: {
        id: ids.repo,
        orgId: ids.org,
        projectId: ids.project,
        credentialId: ids.credential,
        repoOwner: 'fixture',
        repoName: 'fixture',
      },
    });
    await prisma.orgEmbeddingCredential.create({
      data: {
        id: ids.embedding,
        orgId: ids.org,
        provider: EmbeddingProvider.OPENAI,
        model: 'fixture',
        secretsCiphertext: embeddingSecret.ciphertext,
        secretsKeyId: embeddingSecret.keyId,
        dimension: 3,
        configFingerprint: 'fixture-fingerprint',
        active: true,
      },
    });
    await prisma.repoBranchIndex.create({
      data: {
        id: ids.index,
        orgId: ids.org,
        projectId: ids.project,
        projectRepoId: ids.repo,
        branch: 'main',
        status: RepoIndexStatus.PENDING,
        stage: RepoIndexStage.QUEUED,
        requestedGeneration: 1,
      },
    });

    const store = new PrismaIndexStore(prisma, 10_000);
    const context = await store.claim({
      branchIndexId: ids.index,
      generation: 1,
      force: false,
      trigger: 'INITIAL',
      requestedById: ids.user,
    });
    await store.prepareGeneration(context);
    await store.saveChunks(context, [
      {
        filePath: 'src/login.tsx',
        chunkIndex: 0,
        content: 'export function Login() { return "/login"; }',
        symbol: 'Login',
        selectors: ['data-testid=login'],
        routes: ['/login'],
        embedding: [1, 0, 0],
      },
      {
        filePath: 'src/account.ts',
        chunkIndex: 0,
        content: 'export const account = "/api/account";',
        symbol: 'account',
        selectors: [],
        routes: ['/api/account'],
        embedding: [0, 1, 0],
      },
    ]);
    await store.activate({ context, commitSha: 'fixture-commit', chunkCount: 2 });

    const [index, repo, vectorRows] = await Promise.all([
      prisma.repoBranchIndex.findUniqueOrThrow({ where: { id: ids.index } }),
      prisma.projectRepo.findUniqueOrThrow({ where: { id: ids.repo } }),
      prisma.$queryRaw<Array<{ distance: number }>>`
        SELECT "embedding" <=> '[1,0,0]'::vector AS distance
        FROM "code_chunks"
        WHERE "branchIndexId" = ${ids.index}
        ORDER BY distance
      `,
    ]);
    expect(index).toMatchObject({
      status: RepoIndexStatus.READY,
      stage: RepoIndexStage.COMPLETE,
      activeGeneration: 1,
      chunkCount: 2,
      commitSha: 'fixture-commit',
    });
    expect(repo).toMatchObject({ status: RepoIndexStatus.READY, chunkCount: 2 });
    expect(vectorRows).toHaveLength(2);
    expect(Number(vectorRows[0].distance)).toBe(0);
  });
});
