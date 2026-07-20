import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TestsService } from '../tests/tests.service';
import { UpdateTestDto } from '../tests/dto/update-test.dto';

/**
 * Selector drift detection — promotion/demotion review queue
 * (docs/plan/04-PHASE-2-HEALING.md §2.7).
 *
 * A heal only reaches this queue once it is `eligibleForPromotion` — set by
 * the worker after the owning run finished PASSED and non-preview
 * (run.executor.ts, §2.5). That gate already encodes both conditions the
 * doc requires for promotion ("resolved to exactly one element" — structural,
 * every recorded heal already cleared probeUnique — and "downstream
 * assertions passed" — the run's overall status). Nothing further to
 * re-validate here.
 */
@Injectable()
export class SelectorHealsService {
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
  async promote(id: string, userId?: string) {
    const heal = await this.loadPromotable(id);
    const testDef = await this.prisma.testDefinition.findUnique({ where: { id: heal.testDefinitionId } });
    if (!testDef) throw new NotFoundException('Test definition not found');

    const steps = (Array.isArray(testDef.steps) ? testDef.steps : []) as Array<Record<string, unknown>>;
    const step = steps.find((s) => s.index === heal.stepIndex);
    if (!step) throw new ConflictException('Step no longer exists on this test — it may have been edited or removed');
    const input = (step.input ?? {}) as Record<string, unknown>;
    const currentPrimary = typeof input.selector === 'string' ? input.selector : heal.originalSelector;
    const existingFallbacks = (Array.isArray(input.fallbackSelectors) ? input.fallbackSelectors : [])
      .filter((f): f is string => typeof f === 'string' && f !== heal.healedSelector);

    const newSteps = steps.map((s) => (s.index === heal.stepIndex
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
      data: { promoted: true, promotedAt: new Date(), promotedById: userId ?? null },
    });
  }

  /** Decline: drop it from the queue without touching the stored step. */
  async dismiss(id: string) {
    await this.loadPromotable(id);
    return this.prisma.selectorHeal.update({ where: { id }, data: { eligibleForPromotion: false } });
  }
}
