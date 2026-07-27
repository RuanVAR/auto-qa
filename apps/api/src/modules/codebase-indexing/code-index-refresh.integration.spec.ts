import { ConfigService } from '@nestjs/config';
import {
  AccountStatus,
  GitAuthKind,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import Redis from 'ioredis';
import { _setCronLockRedisForTests } from '../../common/cron-lock';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CodeIndexRefreshCron } from './code-index-refresh.cron';
import { CodeIndexRequestService } from './code-index-request.service';

const runIntegration = process.env.CODE_INDEX_DB_TEST === '1'
  ? describe
  : describe.skip;

runIntegration('CodeIndexRefreshCron integration', () => {
  const prisma = new PrismaService();
  const requests = { request: jest.fn().mockResolvedValue({ id: 'queued' }) };
  const config = {
    get: jest.fn((name: string) => ({
      CODE_INDEX_ENABLED: 'true',
      CODE_INDEX_STALE_HOURS: '24',
      CODE_INDEX_CRON_BATCH_SIZE: '25',
    })[name]),
  };
  const ids = {
    user: 'refresh-integration-user',
    org: 'refresh-integration-org',
    project: 'refresh-integration-project',
    credential: 'refresh-integration-credential',
    repo: 'refresh-integration-repo',
  };
  let cron: CodeIndexRefreshCron;
  let lockRedis: Redis;

  beforeAll(async () => {
    lockRedis = new Redis(process.env.REDIS_URL ?? '', {
      maxRetriesPerRequest: 1,
    });
    _setCronLockRedisForTests(lockRedis);
    await prisma.$connect();
    cron = new CodeIndexRefreshCron(
      prisma,
      requests as unknown as CodeIndexRequestService,
      config as unknown as ConfigService,
    );
    await prisma.user.create({
      data: {
        id: ids.user,
        email: 'refresh-integration@example.invalid',
        name: 'Refresh Integration',
        accountStatus: AccountStatus.ACTIVE,
      },
    });
    await prisma.organisation.create({
      data: {
        id: ids.org,
        name: 'Refresh Integration',
        slug: 'refresh-integration',
        ownerId: ids.user,
      },
    });
    await prisma.project.create({
      data: {
        id: ids.project,
        name: 'Refresh Integration',
        slug: 'refresh-integration',
        ownerId: ids.user,
        orgId: ids.org,
      },
    });
    await prisma.orgGitCredential.create({
      data: {
        id: ids.credential,
        orgId: ids.org,
        authKind: GitAuthKind.PAT,
        secretsCiphertext: Buffer.from('fixture'),
        secretsKeyId: 'fixture-v1',
        lastHealthOk: true,
      },
    });
    await prisma.projectRepo.create({
      data: {
        id: ids.repo,
        orgId: ids.org,
        projectId: ids.project,
        credentialId: ids.credential,
        repoOwner: 'fixture',
        repoName: 'refresh',
        defaultBranch: 'main',
      },
    });
    const stale = new Date(Date.now() - 30 * 60 * 60 * 1_000);
    const fresh = new Date(Date.now() - 60 * 60 * 1_000);
    await prisma.repoBranchIndex.createMany({
      data: [
        indexData('refresh-stale-ready', 'stale-ready', RepoIndexStatus.READY, stale),
        indexData('refresh-fresh-ready', 'fresh-ready', RepoIndexStatus.READY, fresh),
        indexData('refresh-stale-failed', 'stale-failed', RepoIndexStatus.FAILED, stale),
        indexData('refresh-fresh-failed', 'fresh-failed', RepoIndexStatus.FAILED, fresh),
        indexData('refresh-old-blocked', 'old-blocked', RepoIndexStatus.BLOCKED, stale),
      ],
    });
  });

  afterAll(async () => {
    await prisma.project.deleteMany({ where: { id: ids.project } });
    await prisma.organisation.deleteMany({ where: { id: ids.org } });
    await prisma.user.deleteMany({ where: { id: ids.user } });
    await prisma.$disconnect();
    await lockRedis.quit();
    _setCronLockRedisForTests(null);
  });

  it('queues only stale READY and FAILED branches', async () => {
    await cron.tick();

    expect(requests.request).toHaveBeenCalledTimes(2);
    expect(requests.request).toHaveBeenCalledWith({
      projectId: ids.project,
      repoId: ids.repo,
      branch: 'stale-ready',
      force: false,
      trigger: 'SCHEDULED',
    });
    expect(requests.request).toHaveBeenCalledWith({
      projectId: ids.project,
      repoId: ids.repo,
      branch: 'stale-failed',
      force: false,
      trigger: 'SCHEDULED',
    });
  });

  function indexData(
    id: string,
    branch: string,
    status: RepoIndexStatus,
    timestamp: Date,
  ) {
    return {
      id,
      orgId: ids.org,
      projectId: ids.project,
      projectRepoId: ids.repo,
      branch,
      status,
      stage: status === RepoIndexStatus.READY
        ? RepoIndexStage.COMPLETE
        : RepoIndexStage.EMBEDDING,
      activeGeneration: status === RepoIndexStatus.READY ? 1 : null,
      requestedGeneration: 1,
      lastIndexedAt: status === RepoIndexStatus.READY ? timestamp : null,
      lastRequestedAt: timestamp,
      progressPercent: status === RepoIndexStatus.READY ? 100 : 50,
    };
  }
});
