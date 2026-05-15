import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async findAll(userId?: string, orgId?: string, orgRole?: string, opts?: { includeArchived?: boolean }) {
    const isOrgAdmin = orgRole === 'ORG_ADMIN';
    const isPlatformAdmin = orgRole === 'PLATFORM_ADMIN';

    // Scope project list: org users only see their org's projects; platform
    // admins see all. Archived (isActive=false, deletedAt set) are excluded
    // by default — only org admins (or platform admins) can opt in via
    // `?includeArchived=true`. Non-admin members never see them.
    const canSeeArchived = isOrgAdmin || isPlatformAdmin;
    const includeArchived = canSeeArchived && opts?.includeArchived === true;
    const activeFilter = includeArchived ? {} : { isActive: true, deletedAt: null };
    const where = isPlatformAdmin
      ? activeFilter
      : { ...activeFilter, ...(orgId ? { orgId } : {}) };

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        _count: { select: { testDefinitions: true, runs: true, environments: true, modules: true } },
        members: { select: { userId: true, role: true } },
      },
      orderBy: [
        // Active projects first, archived at the bottom — keeps the default
        // experience unchanged when admins flip on includeArchived.
        { isActive: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    // Compute isMember for each project based on the requesting user
    return projects.map(p => ({
      ...p,
      isMember:
        isPlatformAdmin ||
        (isOrgAdmin && p.orgId === orgId) ||
        p.ownerId === userId ||
        p.members.some(m => m.userId === userId),
    }));
  }

  async findOne(id: string) {
    const project = await this.prisma.project.findFirst({
      where: { id, deletedAt: null },
      include: {
        environments: { where: { deletedAt: null } },
        modules: { where: { deletedAt: null }, orderBy: { order: 'asc' } },
        _count: { select: { testDefinitions: true, runs: true } },
      },
    });
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async create(dto: CreateProjectDto, ownerId: string, orgId?: string | null) {
    const project = await this.prisma.project.create({
      data: {
        ...dto,
        ownerId,
        ...(orgId ? { orgId } : {}),
      },
    });
    // Also add the creator as OWNER project member
    await this.prisma.projectMember.create({
      data: { projectId: project.id, userId: ownerId, role: 'OWNER' },
    });
    await this.audit.log(ownerId, 'CREATE', 'Project', project.id, undefined, { name: project.name, slug: project.slug });
    return project;
  }

  async update(id: string, dto: UpdateProjectDto, userId?: string) {
    const before = await this.findOne(id);
    const updated = await this.prisma.project.update({ where: { id }, data: dto });
    await this.audit.log(userId, 'UPDATE', 'Project', id, { name: before.name }, { name: updated.name });
    return updated;
  }

  async remove(id: string, userId?: string) {
    const project = await this.findOne(id);
    await this.prisma.project.update({ where: { id }, data: { isActive: false, deletedAt: new Date() } });
    await this.audit.log(userId, 'DELETE', 'Project', id, { name: project.name });
    return { id };
  }

  /**
   * Archive a project — soft-delete that can be restored. Same effect as
   * `remove()` semantically; named separately so callers see "archive" in
   * the audit log and the contract is explicit about reversibility.
   * `findOne()` rejects already-archived ids (deletedAt filter), so a
   * second archive on the same row returns 404 — caller's responsibility.
   */
  async archive(id: string, userId?: string) {
    const project = await this.findOne(id);
    await this.prisma.project.update({
      where: { id },
      data: { isActive: false, deletedAt: new Date() },
    });
    await this.audit.log(userId, 'ARCHIVE', 'Project', id, { name: project.name });
    return { id, isActive: false };
  }

  /**
   * Restore an archived project. We bypass findOne() (which filters out
   * archived rows) and check the row directly so admins can act on stuff
   * that's already been soft-deleted.
   */
  async restore(id: string, userId?: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('Project not found');
    if (project.isActive && project.deletedAt == null) {
      // Nothing to do — already active. Returning success keeps the call
      // idempotent for UI double-clicks.
      return { id, isActive: true };
    }
    await this.prisma.project.update({
      where: { id },
      data: { isActive: true, deletedAt: null },
    });
    await this.audit.log(userId, 'RESTORE', 'Project', id, { name: project.name });
    return { id, isActive: true };
  }

  /**
   * Resolve the org that owns a project — used by the controller to gate
   * archive/restore on ORG_ADMIN of the project's org. Cheap select-only.
   */
  async getOrgId(id: string): Promise<string | null> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      select: { orgId: true },
    });
    return project?.orgId ?? null;
  }
}
