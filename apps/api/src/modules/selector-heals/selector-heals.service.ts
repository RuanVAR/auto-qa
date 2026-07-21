import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { RunMode, RunStatus, StepStatus } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TestsService } from '../tests/tests.service';
import { UpdateTestDto } from '../tests/dto/update-test.dto';

/**
 * Selector drift detection — promotion/demotion review queue
 * (docs/plan/04-PHASE-2-HEALING.md §2.7).
 *
 * A heal reaches this queue only after the same fallback succeeded for the
 * configured number of consecutive automated runs. The worker records raw
 * evidence immediately; API terminal-run processing corroborates it before
 * promotion can be reviewed or automatically applied.
 */
@Injectable()
export class SelectorHealsService {
  private readonly logger = new Logger(SelectorHealsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tests: TestsService,
  ) {}

  /** Pending heals for a project, newest first — the review queue list. */
  async listPending(projectId: string) {
    return this.prisma.selectorHeal.findMany({
      where: {
        promoted: false,
        eligibleForPromotion: true,
        testDefinition: { projectId },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        testDefinition: { select: { id: true, name: true } },
      },
    });
  }

  async getSettings(projectId: string) {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { selectorHealAutoApply: true, selectorHealPromotionRuns: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    return {
      autoApply: project.selectorHealAutoApply,
      promotionRuns: project.selectorHealPromotionRuns,
    };
  }

  async updateSettings(projectId: string, settings: { autoApply?: boolean; promotionRuns?: number }) {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(settings.autoApply !== undefined ? { selectorHealAutoApply: settings.autoApply } : {}),
        ...(settings.promotionRuns !== undefined ? { selectorHealPromotionRuns: settings.promotionRuns } : {}),
      },
      select: { selectorHealAutoApply: true, selectorHealPromotionRuns: true },
    });
    return {
      autoApply: project.selectorHealAutoApply,
      promotionRuns: project.selectorHealPromotionRuns,
    };
  }

  /**
   * Evaluate heals emitted by one newly-completed run. A fallback is
   * promotable only if it was used by the same test step on the latest N
   * automated, non-preview, passing runs. A clean primary pass, a different
   * fallback, or a failed run breaks that sequence.
   */
  async evaluateCompletedRun(runId: string): Promise<void> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { status: true, runMode: true, isPreview: true },
    });
    if (!run || run.status !== RunStatus.PASSED || run.runMode !== RunMode.AUTOMATED || run.isPreview) return;

    const heals = await this.prisma.selectorHeal.findMany({
      where: { runId, promoted: false },
      include: {
        testDefinition: {
          select: {
            project: { select: { selectorHealAutoApply: true, selectorHealPromotionRuns: true } },
          },
        },
      },
    });

    for (const heal of heals) {
      const project = heal.testDefinition.project;
      // Query executions, not just step rows. A run that failed before it
      // reached this step is still a break in the required consecutive-run
      // sequence and must not be silently skipped.
      const recentRuns = await this.prisma.testRun.findMany({
        where: {
          testDefinitionId: heal.testDefinitionId,
          runMode: RunMode.AUTOMATED,
          isPreview: false,
        },
        orderBy: { createdAt: 'desc' },
        take: project.selectorHealPromotionRuns,
        select: {
          status: true,
          steps: {
            where: { index: heal.stepIndex },
            select: {
              status: true,
              selectorHeals: { select: { healedSelector: true, strategy: true } },
            },
          },
        },
      });

      const corroborated = recentRuns.length === project.selectorHealPromotionRuns
        && recentRuns.every((candidateRun) => {
          if (candidateRun.status !== RunStatus.PASSED || candidateRun.steps.length !== 1) return false;
          const [step] = candidateRun.steps;
          return step.status === StepStatus.PASSED_HEALED
            && step.selectorHeals.some((candidate) => (
              candidate.healedSelector === heal.healedSelector && candidate.strategy === heal.strategy
            ));
        });
      if (!corroborated) continue;

      // Claim the promotion once. Duplicate terminal events must not create
      // multiple test snapshots or race to auto-promote the same selector.
      const claimed = await this.prisma.selectorHeal.updateMany({
        where: { id: heal.id, eligibleForPromotion: false, promoted: false },
        data: { eligibleForPromotion: true },
      });
      if (claimed.count === 0 || !project.selectorHealAutoApply || heal.confidence !== 'high') continue;

      try {
        await this.promote(heal.id, undefined, { autoApplied: true });
      } catch (error) {
        // It remains in the review queue after a failed automatic promotion.
        this.logger.error(`Automatic selector-heal promotion failed for ${heal.id}`, error);
      }
    }
  }

  private async loadPromotable(id: string) {
    const heal = await this.prisma.selectorHeal.findUnique({ where: { id } });
    if (!heal) throw new NotFoundException('Heal not found');
    if (heal.promoted) throw new ConflictException('Already promoted');
    if (!heal.eligibleForPromotion) {
      throw new ConflictException('Not eligible — the owning run has not yet finished PASSED and non-preview');
    }
    return heal;
  }

  /** projectId for the RBAC check — resolved via the owning test definition. */
  async projectIdOf(id: string): Promise<string> {
    const heal = await this.prisma.selectorHeal.findUnique({
      where: { id }, select: { testDefinition: { select: { projectId: true } } },
    });
    if (!heal) throw new NotFoundException('Heal not found');
    return heal.testDefinition.projectId;
  }

  /**
   * Promote the healed selector to primary, demoting the current primary
   * into the front of fallbackSelectors — so if the app reverts, the old
   * selector is still tried first among the fallbacks. Reuses
   * TestsService.update so the existing snapshot/version/audit trail applies
   * exactly as any other step edit would.
   */
  async promote(id: string, userId?: string, options: { autoApplied?: boolean } = {}) {
    const heal = await this.loadPromotable(id);
    const testDef = await this.prisma.testDefinition.findUnique({ where: { id: heal.testDefinitionId } });
    if (!testDef) throw new NotFoundException('Test definition not found');

    // TestDefinition.steps has no stored `index` field — a step's index is
    // its position in the array (the same convention run.executor.ts uses:
    // `for (let i = 0; i < steps.length; i++)`). An `.index` field on the
    // object would only ever match by coincidence.
    const steps = (Array.isArray(testDef.steps) ? testDef.steps : []) as Array<Record<string, unknown>>;
    const step = steps[heal.stepIndex];
    if (!step) throw new ConflictException('Step no longer exists on this test — it may have been edited or removed');
    const input = (step.input ?? {}) as Record<string, unknown>;
    const currentPrimary = typeof input.selector === 'string' ? input.selector : heal.originalSelector;
    const existingFallbacks = (Array.isArray(input.fallbackSelectors) ? input.fallbackSelectors : [])
      .filter((f): f is string => typeof f === 'string' && f !== heal.healedSelector);

    const newSteps = steps.map((s, i) => (i === heal.stepIndex
      ? {
        ...s,
        input: {
          ...input,
          selector: heal.healedSelector,
          fallbackSelectors: currentPrimary ? [currentPrimary, ...existingFallbacks] : existingFallbacks,
        },
      }
      : s));

    const dto: UpdateTestDto = { steps: newSteps } as UpdateTestDto;
    await this.tests.update(heal.testDefinitionId, dto, userId);
    return this.prisma.selectorHeal.update({
      where: { id },
      data: {
        promoted: true,
        promotedAt: new Date(),
        promotedById: userId ?? null,
        autoApplied: options.autoApplied ?? false,
      },
    });
  }

  /** Decline: drop it from the queue without touching the stored step. */
  async dismiss(id: string) {
    await this.loadPromotable(id);
    return this.prisma.selectorHeal.update({ where: { id }, data: { eligibleForPromotion: false } });
  }
}
