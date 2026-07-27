import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RepoIndexStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CodeIndexRefreshCron } from './code-index-refresh.cron';
import { CodeIndexRequestService } from './code-index-request.service';

jest.mock('../../common/cron-lock', () => ({
  CronLock: () => (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => descriptor,
}));

describe('CodeIndexRefreshCron', () => {
  const repoBranchIndex = { findMany: jest.fn() };
  const prisma = { repoBranchIndex };
  const requests = { request: jest.fn() };
  const values: Record<string, string | undefined> = {};
  const config = {
    get: jest.fn((name: string) => values[name]),
  };
  let cron: CodeIndexRefreshCron;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-25T12:00:00.000Z'));
    for (const key of Object.keys(values)) delete values[key];
    requests.request.mockResolvedValue({ id: 'index-1' });
    repoBranchIndex.findMany.mockResolvedValue([]);
    cron = new CodeIndexRefreshCron(
      prisma as unknown as PrismaService,
      requests as unknown as CodeIndexRequestService,
      config as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('is inert unless production indexing is explicitly enabled', async () => {
    await cron.tick();

    expect(repoBranchIndex.findMany).not.toHaveBeenCalled();
    expect(requests.request).not.toHaveBeenCalled();
  });

  it('selects only bounded stale READY/FAILED rows and queues scheduled refreshes', async () => {
    values.CODE_INDEX_ENABLED = 'true';
    values.CODE_INDEX_STALE_HOURS = '48';
    values.CODE_INDEX_CRON_BATCH_SIZE = '500';
    repoBranchIndex.findMany.mockResolvedValue([
      {
        id: 'index-ready',
        projectId: 'project-1',
        projectRepoId: 'repo-1',
        branch: 'main',
      },
      {
        id: 'index-failed',
        projectId: 'project-2',
        projectRepoId: 'repo-2',
        branch: 'release/next',
      },
    ]);

    await cron.tick();

    const cutoff = new Date('2026-07-23T12:00:00.000Z');
    expect(repoBranchIndex.findMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        deletedAt: null,
        projectRepo: { deletedAt: null },
        OR: expect.arrayContaining([
          expect.objectContaining({
            status: RepoIndexStatus.READY,
          }),
          expect.objectContaining({
            status: RepoIndexStatus.FAILED,
          }),
        ]),
      }),
      orderBy: [
        { lastRequestedAt: 'asc' },
        { lastIndexedAt: 'asc' },
        { createdAt: 'asc' },
      ],
      take: 100,
      select: {
        id: true,
        projectId: true,
        projectRepoId: true,
        branch: true,
      },
    });
    expect(repoBranchIndex.findMany.mock.calls[0][0].where.OR)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          status: RepoIndexStatus.READY,
          OR: expect.arrayContaining([
            { lastIndexedAt: { lte: cutoff } },
          ]),
        }),
        expect.objectContaining({
          status: RepoIndexStatus.FAILED,
          OR: expect.arrayContaining([
            { lastRequestedAt: { lte: cutoff } },
          ]),
        }),
      ]));
    expect(requests.request).toHaveBeenNthCalledWith(1, {
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      force: false,
      trigger: 'SCHEDULED',
    });
    expect(requests.request).toHaveBeenNthCalledWith(2, {
      projectId: 'project-2',
      repoId: 'repo-2',
      branch: 'release/next',
      force: false,
      trigger: 'SCHEDULED',
    });
  });

  it('continues queueing after one candidate fails', async () => {
    values.CODE_INDEX_ENABLED = 'true';
    repoBranchIndex.findMany.mockResolvedValue([
      {
        id: 'index-1',
        projectId: 'project-1',
        projectRepoId: 'repo-1',
        branch: 'main',
      },
      {
        id: 'index-2',
        projectId: 'project-2',
        projectRepoId: 'repo-2',
        branch: 'main',
      },
    ]);
    requests.request
      .mockRejectedValueOnce(
        new Error(
          'queue unavailable for ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        ),
      )
      .mockResolvedValueOnce({ id: 'index-2' });
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();

    await expect(cron.tick()).resolves.toBeUndefined();

    expect(requests.request).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('[redacted]'),
    );
    expect(warn).not.toHaveBeenCalledWith(
      expect.stringContaining('ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    );
  });

  it('rejects invalid stale-hour configuration before querying', async () => {
    values.CODE_INDEX_ENABLED = 'true';
    values.CODE_INDEX_STALE_HOURS = '0';

    await expect(cron.tick()).rejects.toThrow(
      'CODE_INDEX_STALE_HOURS must be a positive integer',
    );
    expect(repoBranchIndex.findMany).not.toHaveBeenCalled();
  });
});
