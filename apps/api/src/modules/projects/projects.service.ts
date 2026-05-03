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

  async findAll(userId?: string, orgId?: string, orgRole?: string) {
    const isOrgAdmin = orgRole === 'ORG_ADMIN';
    const isPlatformAdmin = orgRole === 'PLATFORM_ADMIN';

    // Scope project list: org users only see their org's projects; platform admins see all
    const where = isPlatformAdmin
      ? { isActive: true, deletedAt: null }
      : { isActive: true, deletedAt: null, ...(orgId ? { orgId } : {}) };

    const projects = await this.prisma.project.findMany({
      where,
      include: {
        _count: { select: { testDefinitions: true, runs: true, environments: true, modules: true } },
        members: { select: { userId: true, role: true } },
      },
      orderBy: { createdAt: 'desc' },
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
}
