import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SharedStepReferenceIndexService } from './shared-step-reference-index.service';
import { isSharedStepReference, SharedStepParameter } from './shared-step.types';

type SharedStepInput = {
  name: string;
  description?: string;
  folderId?: string | null;
  steps: Array<Record<string, unknown>>;
  parameters?: SharedStepParameter[];
};

@Injectable()
export class SharedStepsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly referenceIndex: SharedStepReferenceIndexService,
  ) {}

  private async project(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId }, select: { orgId: true } });
    if (!project?.orgId) throw new BadRequestException('Shared steps require an organisation project');
    return { id: projectId, orgId: project.orgId };
  }

  private validate(input: SharedStepInput): void {
    if (!input.name?.trim()) throw new BadRequestException('Shared step name is required');
    if (!Array.isArray(input.steps) || input.steps.length === 0 || input.steps.length > 2000) {
      throw new BadRequestException('Shared steps require between 1 and 2000 steps');
    }
    const keys = new Set<string>();
    for (const parameter of input.parameters ?? []) {
      if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(parameter.key) || keys.has(parameter.key)) {
        throw new BadRequestException('Parameters need unique identifier-style keys');
      }
      keys.add(parameter.key);
      if (parameter.secret && parameter.defaultValue && !/^\{\{[^}]+\}\}$/.test(parameter.defaultValue)) {
        throw new BadRequestException(`Secret parameter "${parameter.key}" cannot have a literal default`);
      }
    }
    for (const step of input.steps) {
      if (!step || typeof step.type !== 'string') throw new BadRequestException('Every shared step needs a type');
      if (isSharedStepReference(step) && Object.values(step.input.params ?? {}).some((value) => typeof value !== 'string')) {
        throw new BadRequestException('Shared-step parameter bindings must be strings');
      }
    }
  }

  async list(projectId: string, includeArchived = false) {
    const project = await this.project(projectId);
    return this.prisma.sharedStep.findMany({
      where: { orgId: project.orgId, OR: [{ projectId }, { projectId: null }], ...(includeArchived ? {} : { isArchived: false }) },
      include: { folder: true, _count: { select: { referencesTo: true } } },
      orderBy: [{ projectId: 'desc' }, { name: 'asc' }],
    });
  }

  async create(projectId: string, input: SharedStepInput, userId: string) {
    this.validate(input);
    const project = await this.project(projectId);
    const step = await this.prisma.$transaction(async (tx) => {
      if (input.folderId) {
        const folder = await tx.sharedStepFolder.findFirst({ where: { id: input.folderId, orgId: project.orgId, projectId } });
        if (!folder) throw new BadRequestException('Folder does not belong to this project');
      }
      const created = await tx.sharedStep.create({
        data: { orgId: project.orgId, projectId, name: input.name.trim(), description: input.description, folderId: input.folderId ?? null, steps: input.steps as Prisma.InputJsonValue, parameters: (input.parameters ?? []) as unknown as Prisma.InputJsonValue },
      });
      await this.referenceIndex.syncSharedStepReferences(tx, created.id, input.steps);
      return created;
    });
    await this.audit.log(userId, 'CREATE', 'SharedStep', step.id, undefined, { name: step.name, scope: 'PROJECT' });
    return step;
  }

  async update(projectId: string, id: string, input: Partial<SharedStepInput>, userId: string, isOrgAdmin = false) {
    const project = await this.project(projectId);
    const existing = await this.prisma.sharedStep.findFirst({ where: { id, orgId: project.orgId, OR: [{ projectId }, { projectId: null }] } });
    if (!existing) throw new NotFoundException('Shared step not found');
    if (existing.projectId === null && !isOrgAdmin) throw new ForbiddenException('Only an organisation admin may edit an organisation shared step');
    const full = { name: input.name ?? existing.name, description: input.description ?? existing.description ?? undefined, folderId: input.folderId === undefined ? existing.folderId : input.folderId, steps: (input.steps ?? existing.steps) as Array<Record<string, unknown>>, parameters: (input.parameters ?? existing.parameters) as SharedStepParameter[] };
    this.validate(full);
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.sharedStep.update({ where: { id }, data: { name: full.name.trim(), description: full.description, folderId: full.folderId, steps: full.steps as Prisma.InputJsonValue, parameters: full.parameters as unknown as Prisma.InputJsonValue, version: { increment: 1 } } });
      await this.referenceIndex.syncSharedStepReferences(tx, id, full.steps);
      return row;
    });
    await this.audit.log(userId, 'UPDATE', 'SharedStep', id, { version: existing.version }, { version: updated.version });
    return updated;
  }

  async archive(projectId: string, id: string, userId: string, archived = true, isOrgAdmin = false) {
    const project = await this.project(projectId);
    const step = await this.prisma.sharedStep.findFirst({ where: { id, orgId: project.orgId, OR: [{ projectId }, { projectId: null }] } });
    if (!step) throw new NotFoundException('Shared step not found');
    if (step.projectId === null && !isOrgAdmin) throw new ForbiddenException('Only an organisation admin may archive an organisation shared step');
    const updated = await this.prisma.sharedStep.update({ where: { id }, data: { isArchived: archived } });
    await this.audit.log(userId, archived ? 'ARCHIVE' : 'RESTORE', 'SharedStep', id, undefined, { name: step.name });
    return updated;
  }

  async dependents(projectId: string, id: string) {
    const project = await this.project(projectId);
    const root = await this.prisma.sharedStep.findFirst({ where: { id, orgId: project.orgId, OR: [{ projectId }, { projectId: null }] } });
    if (!root) throw new NotFoundException('Shared step not found');
    const seen = new Set([id]);
    const queue = [id];
    const testIds = new Set<string>();
    while (queue.length) {
      const targetSharedStepId = queue.shift()!;
      const refs = await this.prisma.sharedStepReference.findMany({ where: { targetSharedStepId }, select: { testDefinitionId: true, parentSharedStepId: true } });
      for (const ref of refs) {
        if (ref.testDefinitionId) testIds.add(ref.testDefinitionId);
        if (ref.parentSharedStepId && !seen.has(ref.parentSharedStepId)) { seen.add(ref.parentSharedStepId); queue.push(ref.parentSharedStepId); }
      }
    }
    const tests = await this.prisma.testDefinition.findMany({ where: { id: { in: [...testIds] }, projectId, deletedAt: null }, select: { id: true, name: true, featureId: true } });
    return { directOrNestedSharedSteps: seen.size - 1, tests };
  }

  async promote(projectId: string, ids: string[], userId: string) {
    const project = await this.project(projectId);
    const steps = await this.prisma.sharedStep.findMany({ where: { id: { in: ids }, orgId: project.orgId, projectId } });
    if (steps.length !== ids.length) throw new BadRequestException('Every promoted shared step must belong to this project');
    const promotedIds = new Set(ids);
    for (const step of steps) {
      const nested = Array.isArray(step.steps)
        ? (step.steps as unknown[]).filter(isSharedStepReference).map((ref) => ref.input.sharedStepId)
        : [];
      if (nested.length) {
        const children = await this.prisma.sharedStep.findMany({ where: { id: { in: nested } }, select: { id: true, projectId: true } });
        if (children.some((child) => child.projectId !== null && !promotedIds.has(child.id))) {
          throw new BadRequestException('Promote nested project shared steps in the same request before making this step global');
        }
      }
    }
    await this.prisma.sharedStep.updateMany({ where: { id: { in: ids } }, data: { projectId: null, folderId: null, version: { increment: 1 } } });
    await this.audit.log(userId, 'PROMOTE', 'SharedStep', ids.join(','), undefined, { count: ids.length, scope: 'ORG_GLOBAL' });
    return { promoted: ids.length };
  }

  async listFolders(projectId: string) {
    const project = await this.project(projectId);
    return this.prisma.sharedStepFolder.findMany({
      where: { orgId: project.orgId, OR: [{ projectId }, { projectId: null }] },
      orderBy: [{ projectId: 'desc' }, { name: 'asc' }],
    });
  }

  async createFolder(projectId: string, body: { name: string; parentId?: string | null }, userId: string) {
    const project = await this.project(projectId);
    const name = body.name?.trim();
    if (!name) throw new BadRequestException('Folder name is required');
    if (body.parentId) {
      const parent = await this.prisma.sharedStepFolder.findFirst({ where: { id: body.parentId, orgId: project.orgId, projectId } });
      if (!parent) throw new BadRequestException('Parent folder must belong to this project');
    }
    const folder = await this.prisma.sharedStepFolder.create({ data: { orgId: project.orgId, projectId, parentId: body.parentId ?? null, name } });
    await this.audit.log(userId, 'CREATE', 'SharedStepFolder', folder.id, undefined, { name });
    return folder;
  }
}
