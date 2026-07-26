import { Test } from '@nestjs/testing';
import { EnvironmentReleaseSource, RunSessionStatus, RunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { EnvAccessService } from '../../common/access/env-access.service';
import { ReportsService } from '../reports/reports.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TestRunSessionsService } from './test-run-sessions.service';

describe('TestRunSessionsService release snapshots', () => {
  const prisma = {
    testRunSession: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findMany: jest.fn(),
      count: jest.fn(),
    },
    testRun: {
      findMany: jest.fn(),
      groupBy: jest.fn(),
    },
    issue: { findMany: jest.fn() },
    generatedReport: { findFirst: jest.fn() },
  };
  const envAccess = { assertProjectAccess: jest.fn() };
  let service: TestRunSessionsService;

  const user = {
    sub: 'user-1',
    email: 'qa@example.com',
    platformRole: 'USER',
    activeOrgId: 'org-1',
    orgRole: 'ORG_ADMIN',
    role: 'ORG_ADMIN',
  };
  const release = {
    id: 'release-1',
    version: '2026.07.26.4',
    source: EnvironmentReleaseSource.CI_API,
    deployedAt: new Date('2026-07-26T08:00:00Z'),
    components: [],
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        TestRunSessionsService,
        { provide: PrismaService, useValue: prisma },
        { provide: EnvAccessService, useValue: envAccess },
        { provide: ReportsService, useValue: {} },
        { provide: NotificationsService, useValue: {} },
      ],
    }).compile();
    service = module.get(TestRunSessionsService);
  });

  it('deduplicates the release shared by child runs in session detail', async () => {
    prisma.testRunSession.findUnique.mockResolvedValue({
      id: 'session-1',
      projectId: 'project-1',
      status: RunSessionStatus.COMPLETED,
      startedAt: new Date(),
    });
    prisma.testRunSession.findUniqueOrThrow.mockResolvedValue({
      id: 'session-1',
      projectId: 'project-1',
      status: RunSessionStatus.COMPLETED,
    });
    prisma.testRun.findMany.mockResolvedValue([
      testRun('run-1', release),
      testRun('run-2', release),
    ]);
    prisma.issue.findMany.mockResolvedValue([]);
    prisma.generatedReport.findFirst.mockResolvedValue(null);

    const result = await service.get('session-1', user);

    expect(result.testedReleases).toEqual([release]);
    expect(result.counts).toEqual({
      total: 2,
      passed: 2,
      failed: 0,
      other: 0,
    });
  });

  it('returns tested releases with each session list row', async () => {
    prisma.testRunSession.findMany.mockResolvedValue([{
      id: 'session-1',
      projectId: 'project-1',
      status: RunSessionStatus.COMPLETED,
    }]);
    prisma.testRunSession.count.mockResolvedValue(1);
    prisma.testRun.groupBy.mockResolvedValue([{
      testRunSessionId: 'session-1',
      status: RunStatus.PASSED,
      _count: { _all: 2 },
    }]);
    prisma.testRun.findMany.mockResolvedValue([{
      testRunSessionId: 'session-1',
      environmentRelease: release,
    }]);

    const result = await service.list('project-1', user, {});

    expect(result.items[0]).toEqual(expect.objectContaining({
      testedReleases: [release],
      results: { passed: 2, failed: 0, other: 0 },
    }));
  });
});

function testRun(
  id: string,
  environmentRelease: typeof releaseShape,
) {
  return {
    id,
    status: RunStatus.PASSED,
    testDefinitionId: `test-${id}`,
    testDefinition: {
      id: `test-${id}`,
      name: `Test ${id}`,
      feature: null,
    },
    environment: { id: 'env-1', name: 'Staging' },
    environmentRelease,
  };
}

const releaseShape = {
  id: 'release-shape',
  version: 'shape',
  source: EnvironmentReleaseSource.CI_API,
  deployedAt: new Date(),
  components: [] as never[],
};
