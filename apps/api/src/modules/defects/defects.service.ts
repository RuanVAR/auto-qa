import { BadGatewayException, BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DefectStatus, Prisma, StepType, TriageBucket } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PluginService } from '../../plugins/plugin.service';
import { ScopeResolverService } from '../../plugins/scope-resolver.service';
import { DefectSyncService } from '../../plugins/defect-sync.service';
import type { CreateIssueOutput, LinkTicketOutput } from '../../plugins/capabilities';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
    private readonly scopeResolver: ScopeResolverService,
    private readonly defectSync: DefectSyncService,
  ) {}

  list(projectId: string) {
    return this.prisma.defect.findMany({
      where: { projectId },
      include: { _count: { select: { matches: true } }, issue: { select: { id: true, title: true, status: true } }, ticketLinks: { where: { deletedAt: null } } },
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
    const updated = await this.prisma.defect.update({
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
    if (input.status !== undefined && input.status !== existing.status) {
      this.defectSync.syncDefectStatus(id, input.status);
    }
    return updated;
  }

  async pushToClickUp(projectId: string, defectId: string, userId: string) {
    const defect = await this.prisma.defect.findFirst({
      where: { id: defectId, projectId },
      include: { issue: { select: { id: true, title: true } } },
    });
    if (!defect) throw new NotFoundException('Defect not found');

    const binding = await this.prisma.projectPluginBinding.findFirst({
      where: {
        projectId,
        deletedAt: null,
        install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: { install: { select: { orgId: true } } },
    });
    if (!binding) throw new NotFoundException('No healthy ClickUp project binding found');

    const config = await this.scopeResolver.resolve(binding.installId, { defectId });
    const description = [
      defect.description,
      `**Platform defect:** ${defect.id}`,
      `**Lifecycle status:** ${defect.status}`,
      defect.category ? `**Triage bucket:** ${defect.category}` : null,
      defect.messagePattern ? `**Message pattern:** \`${defect.messagePattern}\`` : null,
      defect.stackPattern ? `**Stack pattern:** \`${defect.stackPattern}\`` : null,
      defect.issue ? `**Linked platform issue:** ${defect.issue.title} (${defect.issue.id})` : null,
    ].filter(Boolean).join('\n\n');

    let created: CreateIssueOutput;
    try {
      created = await this.plugins.dispatch<CreateIssueOutput>(
        'createIssue',
        binding.installId,
        {
          scope: { kind: 'defect', defectId },
          title: `Defect: ${defect.title}`,
          description,
          severity: defect.category === 'PRODUCT' ? 'high' : 'medium',
          labels: ['qa-platform', 'known-defect'],
        },
        config,
        { actingUserId: userId },
      );
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : 'ClickUp rejected the ticket create');
    }

    return this.persistTicketLink({
      projectId,
      defectId,
      orgId: binding.install.orgId,
      installId: binding.installId,
      external: created,
    });
  }

  async linkClickUp(projectId: string, defectId: string, ticketRef: string, userId: string) {
    const defect = await this.prisma.defect.findFirst({ where: { id: defectId, projectId }, select: { id: true } });
    if (!defect) throw new NotFoundException('Defect not found');
    if (!ticketRef?.trim()) throw new BadRequestException('ticketRef is required');

    const binding = await this.prisma.projectPluginBinding.findFirst({
      where: {
        projectId,
        deletedAt: null,
        install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null },
      },
      include: { install: { select: { orgId: true } } },
    });
    if (!binding) throw new NotFoundException('No healthy ClickUp project binding found');

    const config = await this.scopeResolver.resolve(binding.installId, { defectId });
    let linked: LinkTicketOutput;
    try {
      linked = await this.plugins.dispatch<LinkTicketOutput>(
        'linkTicket',
        binding.installId,
        { scope: { kind: 'defect', defectId }, ticketRef: ticketRef.trim() },
        config,
        { actingUserId: userId },
      );
    } catch (error) {
      throw new BadGatewayException(error instanceof Error ? error.message : 'ClickUp ticket could not be linked');
    }

    return this.persistTicketLink({
      projectId,
      defectId,
      orgId: binding.install.orgId,
      installId: binding.installId,
      external: linked,
    });
  }

  private persistTicketLink(args: {
    projectId: string;
    defectId: string;
    orgId: string;
    installId: string;
    external: CreateIssueOutput | LinkTicketOutput;
  }) {
    const { external } = args;
    return this.prisma.ticketLink.upsert({
      where: {
        installId_externalId_defectId: {
          installId: args.installId,
          externalId: external.externalId,
          defectId: args.defectId,
        },
      },
      create: {
        orgId: args.orgId,
        installId: args.installId,
        projectId: args.projectId,
        defectId: args.defectId,
        externalId: external.externalId,
        externalUrl: external.externalUrl,
        externalTitle: external.externalTitle ?? null,
        externalStatus: external.externalStatus ?? null,
        externalStatusColor: 'externalStatusColor' in external ? external.externalStatusColor ?? null : null,
        externalStatusType: 'externalStatusType' in external ? external.externalStatusType ?? null : null,
      },
      update: {
        externalUrl: external.externalUrl,
        externalTitle: external.externalTitle ?? null,
        externalStatus: external.externalStatus ?? null,
        externalStatusColor: 'externalStatusColor' in external ? external.externalStatusColor ?? null : null,
        externalStatusType: 'externalStatusType' in external ? external.externalStatusType ?? null : null,
        deletedAt: null,
      },
    });
  }

  private validatePattern(value: string | undefined, field: string) {
    if (value === undefined || value === '') return;
    if (value.length > 500) throw new BadRequestException(`${field} must be 500 characters or less`);
    try { new RegExp(value); } catch { throw new BadRequestException(`${field} is not a valid regular expression`); }
  }
}
