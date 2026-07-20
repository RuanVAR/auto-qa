import { Test } from '@nestjs/testing';
import { ArtifactType, IssueStatus, IssueType } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { ArtifactRetentionService } from '../src/modules/artifacts/artifact-retention.service';
import { ARTIFACT_STORAGE } from '../src/modules/artifacts/artifacts.service';

/**
 * Artifact retention — integration test against a REAL database.
 *
 * This service deletes data permanently, and the exemptions are the whole
 * safety story: an artifact attached to an unresolved bug is the evidence
 * someone is using to fix it. A mocked-Prisma test would assert that the mocks
 * were called; only a real database proves the exemption query actually
 * excludes the right rows.
 *
 * Run with `pnpm test:e2e`. Boots only the retention provider, so it does not
 * collide with a running dev API.
 */

const storage = { delete: jest.fn().mockResolvedValue(undefined) };

describe('ArtifactRetentionService (integration)', () => {
  let prisma: PrismaService;
  let retention: ArtifactRetentionService;

  const tag = `ret-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const ids: { orgs: string[]; users: string[] } = { orgs: [], users: [] };

  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        ArtifactRetentionService,
        { provide: ARTIFACT_STORAGE, useValue: storage },
      ],
    }).compile();
    await moduleRef.init();
    prisma = moduleRef.get(PrismaService);
    retention = moduleRef.get(ArtifactRetentionService);
  });

  afterAll(async () => {
    // FK-safe order: runs and definitions reference the project, so they must go
    // first. Artifacts cascade from TestRun; issues do not (testRunId has no FK).
    for (const orgId of ids.orgs) {
      const projects = await prisma.project.findMany({
        where: { orgId },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);
      if (projectIds.length > 0) {
        await prisma.issue.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.testRun.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.testDefinition.deleteMany({ where: { projectId: { in: projectIds } } });
        await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      }
      await prisma.organisation.deleteMany({ where: { id: orgId } });
    }
    await prisma.user.deleteMany({ where: { id: { in: ids.users } } });
    await prisma.$disconnect();
  });

  /** Minimal org → project → test → run scaffold to hang artifacts off. */
  const scaffold = async (label: string) => {
    const user = await prisma.user.create({
      data: { email: `${tag}-${label}@test.local`, name: label, accountStatus: 'ACTIVE' },
    });
    ids.users.push(user.id);
    const org = await prisma.organisation.create({
      data: { name: `${label} org`, slug: `${tag}-${label}`, ownerId: user.id },
    });
    ids.orgs.push(org.id);
    const project = await prisma.project.create({
      data: { name: label, slug: `${tag}-${label}`, orgId: org.id, ownerId: user.id },
    });
    const test = await prisma.testDefinition.create({
      data: { name: `${label} test`, projectId: project.id, steps: [] },
    });
    const run = await prisma.testRun.create({
      data: { testDefinitionId: test.id, projectId: project.id, status: 'FAILED' },
    });
    return { user, org, project, test, run };
  };

  const artifact = async (runId: string, type: ArtifactType, ageDays: number) =>
    prisma.artifact.create({
      data: {
        runId,
        type,
        filename: `${type}-${ageDays}d`,
        path: `runs/${runId}/${type}-${ageDays}d`,
        sizeBytes: 1024,
        createdAt: daysAgo(ageDays),
      },
    });

  const exists = async (id: string) =>
    (await prisma.artifact.findUnique({ where: { id } })) !== null;

  beforeEach(() => storage.delete.mockClear());

  it('deletes videos past the retention window and keeps recent ones', async () => {
    const s = await scaffold('video');
    const old = await artifact(s.run.id, ArtifactType.VIDEO, 30); // > 14d default
    const fresh = await artifact(s.run.id, ArtifactType.VIDEO, 3);

    await retention.sweep();

    expect(await exists(old.id)).toBe(false);
    expect(await exists(fresh.id)).toBe(true);
    // Storage must be cleared too — a deleted row with a surviving blob is an
    // invisible leak that nothing will ever reclaim.
    expect(storage.delete).toHaveBeenCalledWith(old.path);
  });

  it('applies a longer window to screenshots than to videos', async () => {
    const s = await scaffold('perType');
    // 30 days: past the 14-day video window, inside the 90-day screenshot one.
    const video = await artifact(s.run.id, ArtifactType.VIDEO, 30);
    const shot = await artifact(s.run.id, ArtifactType.SCREENSHOT, 30);

    await retention.sweep();

    expect(await exists(video.id)).toBe(false);
    expect(await exists(shot.id)).toBe(true);
  });

  it('never sweeps REPORT artifacts, however old', async () => {
    const s = await scaffold('report');
    const report = await artifact(s.run.id, ArtifactType.REPORT, 3650);

    await retention.sweep();

    // A report is something a person deliberately generated and may have
    // circulated — age is not a reason to destroy it.
    expect(await exists(report.id)).toBe(true);
  });

  it('EXEMPTS artifacts whose run is linked to an unresolved issue', async () => {
    const s = await scaffold('openbug');
    const evidence = await artifact(s.run.id, ArtifactType.VIDEO, 365);

    await prisma.issue.create({
      data: {
        projectId: s.project.id,
        title: 'Checkout fails on card decline',
        type: IssueType.BUG,
        status: IssueStatus.OPEN,
        testRunId: s.run.id,
        reportedById: s.user.id,
      },
    });

    await retention.sweep();

    // This is the load-bearing case: deleting the recording attached to a bug
    // someone is still working on destroys the evidence they need.
    expect(await exists(evidence.id)).toBe(true);
    expect(storage.delete).not.toHaveBeenCalledWith(evidence.path);
  });

  it('resumes sweeping once the linked issue is closed', async () => {
    const s = await scaffold('closedbug');
    const evidence = await artifact(s.run.id, ArtifactType.VIDEO, 365);

    const issue = await prisma.issue.create({
      data: {
        projectId: s.project.id,
        title: 'Old resolved bug',
        type: IssueType.BUG,
        status: IssueStatus.OPEN,
        testRunId: s.run.id,
        reportedById: s.user.id,
      },
    });

    await retention.sweep();
    expect(await exists(evidence.id)).toBe(true);

    await prisma.issue.update({
      where: { id: issue.id },
      data: { status: IssueStatus.CLOSED },
    });

    await retention.sweep();
    expect(await exists(evidence.id)).toBe(false);
  });

  it('treats IN_PROGRESS and READY_FOR_QA as unresolved', async () => {
    for (const status of [IssueStatus.IN_PROGRESS, IssueStatus.READY_FOR_QA]) {
      const s = await scaffold(`status-${status}`);
      const evidence = await artifact(s.run.id, ArtifactType.VIDEO, 365);
      await prisma.issue.create({
        data: {
          projectId: s.project.id,
          title: `Bug in ${status}`,
          type: IssueType.BUG,
          status,
          testRunId: s.run.id,
          reportedById: s.user.id,
        },
      });

      await retention.sweep();
      expect(await exists(evidence.id)).toBe(true);
    }
  });

  it('can be disabled by environment', async () => {
    const s = await scaffold('disabled');
    const old = await artifact(s.run.id, ArtifactType.VIDEO, 365);

    process.env.ARTIFACT_RETENTION_ENABLED = 'false';
    await retention.sweep();
    delete process.env.ARTIFACT_RETENTION_ENABLED;

    expect(await exists(old.id)).toBe(true);
  });

  it('survives a storage failure without losing the sweep', async () => {
    const s = await scaffold('storagefail');
    const a = await artifact(s.run.id, ArtifactType.VIDEO, 365);
    const b = await artifact(s.run.id, ArtifactType.VIDEO, 366);

    storage.delete.mockRejectedValueOnce(new Error('object not found'));
    await retention.sweep();

    // One storage error must not abort the run — the second artifact still goes.
    expect(await exists(a.id)).toBe(false);
    expect(await exists(b.id)).toBe(false);
  });
});
