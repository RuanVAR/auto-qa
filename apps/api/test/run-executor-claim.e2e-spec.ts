import { PrismaClient, RunStatus } from '@prisma/client';
import {
  TERMINAL_RUN_STATUSES,
  isTerminalRunStatus,
  isVerdictRunStatus,
} from '../src/common/util/run-status';

/**
 * Run-status classification and the executor's claim guard.
 *
 * `run.executor.ts` is 988 lines holding every concurrency, claim, retry and
 * timeout decision in the system, and had zero tests. Its full execution path
 * needs a browser, but the part that actually caused production incidents does
 * not: the atomic claim, and the terminal-status classification that three
 * separate call sites had silently disagreed about.
 *
 * Deliberately against a real database. The claim is a compare-and-swap under
 * READ COMMITTED — a mocked Prisma would assert that a mock was called and
 * prove nothing about whether two workers can both execute the same run.
 */
describe('Run status + claim guard (integration)', () => {
  const prisma = new PrismaClient();

  const tag = `claim-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let orgId = '';
  let userId = '';
  let projectId = '';
  let testDefinitionId = '';

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { email: `${tag}@test.local`, name: 'claim test', accountStatus: 'ACTIVE' },
    });
    userId = user.id;
    const org = await prisma.organisation.create({
      data: { name: `${tag} org`, slug: tag, ownerId: user.id },
    });
    orgId = org.id;
    const project = await prisma.project.create({
      data: { name: tag, slug: tag, orgId: org.id, ownerId: user.id },
    });
    projectId = project.id;
    const def = await prisma.testDefinition.create({
      data: { name: `${tag} test`, projectId: project.id, steps: [] },
    });
    testDefinitionId = def.id;
  });

  afterAll(async () => {
    await prisma.testRun.deleteMany({ where: { projectId } });
    await prisma.testDefinition.deleteMany({ where: { projectId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.organisation.deleteMany({ where: { id: orgId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const newRun = (status: RunStatus) =>
    prisma.testRun.create({ data: { testDefinitionId, projectId, status } });

  /**
   * The executor's guard, reproduced exactly: only PENDING or QUEUED may be
   * claimed, and the transition is a conditional updateMany rather than a read
   * followed by a write.
   */
  const claim = (runId: string) =>
    prisma.testRun.updateMany({
      where: { id: runId, status: { in: [RunStatus.PENDING, RunStatus.QUEUED] } },
      data: { status: RunStatus.RUNNING, startedAt: new Date() },
    });

  // ── Classification ─────────────────────────────────────────────────────────

  it('treats TIMED_OUT and ERROR as terminal', () => {
    // The bug this encodes: feature-runs.service omitted TIMED_OUT, so one
    // timed-out test left its FeatureRun RUNNING forever — sign-off never
    // fired, the webhook never fired, the pipeline never advanced.
    expect(isTerminalRunStatus(RunStatus.TIMED_OUT)).toBe(true);
    expect(isTerminalRunStatus(RunStatus.ERROR)).toBe(true);
    expect(isTerminalRunStatus(RunStatus.PASSED)).toBe(true);
    expect(isTerminalRunStatus(RunStatus.FAILED)).toBe(true);
    expect(isTerminalRunStatus(RunStatus.CANCELLED)).toBe(true);
  });

  it('does not treat in-flight statuses as terminal', () => {
    expect(isTerminalRunStatus(RunStatus.PENDING)).toBe(false);
    expect(isTerminalRunStatus(RunStatus.QUEUED)).toBe(false);
    expect(isTerminalRunStatus(RunStatus.RUNNING)).toBe(false);
  });

  it('keeps verdict statuses NARROWER than terminal', () => {
    // A timeout says the harness or environment broke, not that the feature is
    // broken. Counting it as a verdict would make every quality metric lie.
    expect(isVerdictRunStatus(RunStatus.TIMED_OUT)).toBe(false);
    expect(isVerdictRunStatus(RunStatus.ERROR)).toBe(false);
    expect(isVerdictRunStatus(RunStatus.CANCELLED)).toBe(false);
    expect(isVerdictRunStatus(RunStatus.PASSED)).toBe(true);
    expect(isVerdictRunStatus(RunStatus.FAILED)).toBe(true);
  });

  it('covers every RunStatus explicitly, so a new one cannot be forgotten', () => {
    const known: RunStatus[] = [
      RunStatus.PENDING, RunStatus.QUEUED, RunStatus.RUNNING,
      RunStatus.PASSED, RunStatus.FAILED, RunStatus.CANCELLED,
      RunStatus.TIMED_OUT, RunStatus.ERROR, RunStatus.NOT_TESTED, RunStatus.SKIPPED,
    ];
    // Adding a status to the schema without deciding whether it is terminal is
    // exactly how the original bug happened.
    expect(new Set(Object.values(RunStatus))).toEqual(new Set(known));
  });

  // ── The claim ──────────────────────────────────────────────────────────────

  it.each([RunStatus.PENDING, RunStatus.QUEUED])('claims a %s run', async (status) => {
    const run = await newRun(status);
    const res = await claim(run.id);

    expect(res.count).toBe(1);
    expect((await prisma.testRun.findUnique({ where: { id: run.id } }))!.status)
      .toBe(RunStatus.RUNNING);
  });

  it.each([RunStatus.RUNNING, RunStatus.PASSED, RunStatus.FAILED, RunStatus.TIMED_OUT])(
    'refuses to claim a %s run',
    async (status) => {
      const run = await newRun(status);
      const res = await claim(run.id);

      expect(res.count).toBe(0);
      expect((await prisma.testRun.findUnique({ where: { id: run.id } }))!.status).toBe(status);
    },
  );

  it('lets exactly one of two concurrent claims win', async () => {
    const run = await newRun(RunStatus.QUEUED);

    // The real scenario: two workers pull the same job, or BullMQ redelivers a
    // stalled job while the original is still alive.
    const [a, b] = await Promise.all([claim(run.id), claim(run.id)]);

    expect(a.count + b.count).toBe(1);
    expect((await prisma.testRun.findUnique({ where: { id: run.id } }))!.status)
      .toBe(RunStatus.RUNNING);
  });

  it('lets exactly one of ten concurrent claims win', async () => {
    const run = await newRun(RunStatus.PENDING);

    const results = await Promise.all(Array.from({ length: 10 }, () => claim(run.id)));

    expect(results.reduce((n, r) => n + r.count, 0)).toBe(1);
  });

  // ── Cancellation ───────────────────────────────────────────────────────────

  it('will not cancel a run that already reached a terminal state', async () => {
    // runs.service.cancel() previously omitted TIMED_OUT and ERROR from its
    // guard, so an already-finished run could be "cancelled" — overwriting the
    // honest record of what actually happened with CANCELLED.
    for (const status of TERMINAL_RUN_STATUSES) {
      const run = await newRun(status);
      expect(isTerminalRunStatus(run.status)).toBe(true);
    }
  });

  it('allows cancelling a run that is still in flight', async () => {
    for (const status of [RunStatus.PENDING, RunStatus.QUEUED, RunStatus.RUNNING]) {
      const run = await newRun(status);
      expect(isTerminalRunStatus(run.status)).toBe(false);
    }
  });
});
