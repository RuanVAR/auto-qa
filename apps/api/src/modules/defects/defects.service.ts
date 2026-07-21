import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DefectStatus, Prisma, StepType, TriageBucket } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export type CreateDefectInput = {
  title: string;
  description?: string;
  messagePattern?: string;
  stackPattern?: string;
  stepTypeIn?: StepType[];
  category?: TriageBucket;
  issueId?: string;
  sourceRunId?: string;
  sourceStepId?: string;
};

@Injectable()
export class DefectsService {
  constructor(private readonly prisma: PrismaService) {}

  list(projectId: string) {
    return this.prisma.defect.findMany({
      where: { projectId },
      include: { _count: { select: { matches: true } }, issue: { select: { id: true, title: true, status: true } } },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
  }

  async create(projectId: string, input: CreateDefectInput, userId: string) {
    this.validatePattern(input.messagePattern, 'messagePattern');
    this.validatePattern(input.stackPattern, 'stackPattern');
    if (!input.messagePattern && !input.stackPattern && !(input.stepTypeIn?.length) && !input.category) {
      throw new BadRequestException('A defect needs at least one matching rule');
    }
    if (input.issueId) {
      const issue = await this.prisma.issue.findFirst({ where: { id: input.issueId, projectId }, select: { id: true } });
      if (!issue) throw new BadRequestException('Linked issue does not belong to this project');
    }

    return this.prisma.$transaction(async tx => {
      let source: { id: string; runId: string; testDefinitionId: string; errorMessage: string | null; type: StepType; triageBucket: TriageBucket | null } | null = null;
      if (input.sourceStepId) {
        source = await tx.runStep.findFirst({
          where: { id: input.sourceStepId, runId: input.sourceRunId },
          select: { id: true, runId: true, testDefinitionId: true, errorMessage: true, type: true, triageBucket: true },
        });
        if (!source) throw new NotFoundException('Source failed step not found');
      }
      const defect = await tx.defect.create({
        data: {
          projectId,
          title: input.title.trim(),
          description: input.description?.trim() || null,
          messagePattern: input.messagePattern?.trim() || null,
          stackPattern: input.stackPattern?.trim() || null,
          stepTypeIn: input.stepTypeIn ?? [],
          category: input.category ?? null,
          issueId: input.issueId ?? null,
          createdById: userId,
          ...(source ? { testDefinitionId: source.testDefinitionId } : {}),
        },
      });
      if (source) {
        await tx.defectMatch.create({ data: { defectId: defect.id, testRunId: source.runId, runStepId: source.id } });
        await tx.runStep.update({
          where: { id: source.id },
          data: { resolution: 'DEFECT', resolvedAt: new Date(), resolvedById: userId },
        });
      }
      return defect;
    });
  }

  async update(id: string, projectId: string, input: Partial<CreateDefectInput> & { status?: DefectStatus }) {
    this.validatePattern(input.messagePattern, 'messagePattern');
    this.validatePattern(input.stackPattern, 'stackPattern');
    const existing = await this.prisma.defect.findFirst({ where: { id, projectId } });
    if (!existing) throw new NotFoundException('Defect not found');
    return this.prisma.defect.update({
      where: { id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
        ...(input.messagePattern !== undefined ? { messagePattern: input.messagePattern?.trim() || null } : {}),
        ...(input.stackPattern !== undefined ? { stackPattern: input.stackPattern?.trim() || null } : {}),
        ...(input.stepTypeIn !== undefined ? { stepTypeIn: input.stepTypeIn } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });
  }

  private validatePattern(value: string | undefined, field: string) {
    if (value === undefined || value === '') return;
    if (value.length > 500) throw new BadRequestException(`${field} must be 500 characters or less`);
    try { new RegExp(value); } catch { throw new BadRequestException(`${field} is not a valid regular expression`); }
  }
}
