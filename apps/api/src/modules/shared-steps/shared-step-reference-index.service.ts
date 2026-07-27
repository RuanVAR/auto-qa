import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { isSharedStepReference } from './shared-step.types';

@Injectable()
export class SharedStepReferenceIndexService {
  constructor(private readonly prisma: PrismaService) {}
  private refs(steps: unknown): Array<{ targetSharedStepId: string; stepIndex: number }> {
    if (!Array.isArray(steps)) return [];
    return steps.flatMap((step, stepIndex) => isSharedStepReference(step)
      ? [{ targetSharedStepId: step.input.sharedStepId, stepIndex }]
      : []);
  }

  async syncTestReferences(tx: Prisma.TransactionClient, testDefinitionId: string, steps: unknown): Promise<void> {
    await tx.sharedStepReference.deleteMany({ where: { testDefinitionId } });
    const refs = this.refs(steps);
    if (refs.length) await tx.sharedStepReference.createMany({
      data: refs.map((ref) => ({ ...ref, testDefinitionId })),
    });
  }

  /** New tests may not attach archived, cross-project, or cross-org definitions. */
  async assertUsableForNewTest(projectId: string, steps: unknown): Promise<void> {
    const ids = this.refs(steps).map((ref) => ref.targetSharedStepId);
    if (!ids.length) return;
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
    const available = await this.prisma.sharedStep.findMany({
      where: { id: { in: ids }, orgId: project?.orgId ?? '__none__', isArchived: false, OR: [{ projectId }, { projectId: null }] },
      select: { id: true },
    });
    if (available.length !== new Set(ids).size) throw new BadRequestException('A new test may only use active shared steps from its project or organisation');
  }

  async assertUsableForTestUpdate(projectId: string, previousSteps: unknown, nextSteps: unknown): Promise<void> {
    const previous = new Set(this.refs(previousSteps).map((ref) => ref.targetSharedStepId));
    const introduced = this.refs(nextSteps).filter((ref) => !previous.has(ref.targetSharedStepId));
    if (introduced.length) await this.assertUsableForNewTest(projectId, introduced.map((ref) => ({ type: 'SHARED', input: { sharedStepId: ref.targetSharedStepId } })));
  }

  async syncSharedStepReferences(tx: Prisma.TransactionClient, parentSharedStepId: string, steps: unknown): Promise<void> {
    await tx.sharedStepReference.deleteMany({ where: { parentSharedStepId } });
    const refs = this.refs(steps);
    if (refs.length) await tx.sharedStepReference.createMany({
      data: refs.map((ref) => ({ ...ref, parentSharedStepId })),
    });
  }
}
