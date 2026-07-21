import { Injectable, Logger } from '@nestjs/common';
import { RunStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

const TERMINAL_RESULTS: RunStatus[] = [RunStatus.PASSED, RunStatus.FAILED, RunStatus.ERROR, RunStatus.TIMED_OUT];
const HEALTHY_RUNS_TO_RELEASE = 3;

/**
 * Applies the quarantine lifecycle after every terminal automated run. A
 * quarantined test still executes and records evidence; it is simply excluded
 * from retry and feature-gating decisions until it proves healthy repeatedly.
 */
@Injectable()
export class QuarantineService {
  private readonly logger = new Logger(QuarantineService.name);
  constructor(private readonly prisma: PrismaService, private readonly notifications: NotificationsService) {}

  async evaluate(testRunId: string): Promise<void> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: testRunId },
      select: {
        status: true,
        runMode: true,
        testDefinitionId: true,
        testDefinition: { select: { id: true, name: true, quarantineStatus: true, healthyRunsSince: true, projectId: true, project: { select: { orgId: true, ownerId: true } } } },
      },
    });
    if (!run || run.runMode !== 'AUTOMATED' || !TERMINAL_RESULTS.includes(run.status)) return;

    const test = run.testDefinition;
    if (test.quarantineStatus === 'QUARANTINED') {
      const healthyRunsSince = run.status === RunStatus.PASSED ? test.healthyRunsSince + 1 : 0;
      const release = healthyRunsSince >= HEALTHY_RUNS_TO_RELEASE;
      await this.prisma.testDefinition.update({
        where: { id: test.id },
        data: release
          ? { quarantineStatus: 'ACTIVE', quarantinedAt: null, quarantineReason: null, healthyRunsSince: 0 }
          : { healthyRunsSince },
      });
      if (release) await this.notify(test, `${test.name} left quarantine`, `Passed ${HEALTHY_RUNS_TO_RELEASE} consecutive automated runs and now gates feature runs again.`);
      return;
    }

    // A repeatable signal, not a single failure: at least six recent results
    // with three pass/fail transitions. This deliberately mirrors the existing
    // transition flake monitor and keeps quarantine conservative.
    const recent = await this.prisma.testRun.findMany({
      where: { testDefinitionId: test.id, runMode: 'AUTOMATED', status: { in: TERMINAL_RESULTS } },
      select: { status: true }, orderBy: { completedAt: 'desc' }, take: 6,
    });
    if (recent.length < 6) return;
    const outcomes = recent.map(item => item.status === RunStatus.PASSED ? 'P' : 'F').reverse();
    const transitions = outcomes.slice(1).filter((outcome, index) => outcome !== outcomes[index]).length;
    if (transitions < 3) return;

    await this.prisma.testDefinition.update({
      where: { id: test.id },
      data: {
        quarantineStatus: 'QUARANTINED',
        quarantinedAt: new Date(),
        quarantineReason: `Automatic quarantine: ${transitions} pass/fail transitions across the last ${recent.length} automated runs`,
        healthyRunsSince: 0,
      },
    });
    await this.notify(test, `${test.name} was quarantined`, 'The test is flaky. It will continue to run and collect evidence, but will not block feature completion until it passes three consecutive automated runs.');
  }

  private async notify(test: { project: { orgId: string | null; ownerId: string }; projectId: string }, title: string, body: string) {
    if (!test.project.orgId) return;
    try {
      await this.notifications.create({
        userId: test.project.ownerId,
        orgId: test.project.orgId,
        type: 'FLAKY_TEST_FLAGGED',
        category: 'RUN',
        title,
        body,
        actionUrl: `/projects/${test.projectId}/runs`,
        actionLabel: 'Review runs',
      });
    } catch (error) {
      this.logger.warn(`Could not notify owner about quarantine: ${String(error)}`);
    }
  }
}
