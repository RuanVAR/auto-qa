import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, QuarantineStatus } from '@prisma/client';
import { encryptSecret } from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';

/** Never expose the webhook signing material — mirrors Environment's
 *  ciphertext stripping. `webhookSecretSet` tells the UI a secret exists. */
function stripWebhookSecret<T extends { webhookSecretCiphertext?: Uint8Array | null; webhookSecretKeyId?: string | null }>(p: T) {
  const { webhookSecretCiphertext, webhookSecretKeyId: _k, ...rest } = p;
  return { ...rest, webhookSecretSet: !!webhookSecretCiphertext };
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Dashboard "Heals Today" tile (docs/plan/04-PHASE-2-HEALING.md §3) — a
   * real count, restored after 1.8 removed the hardcoded-0 version. Scoped
   * identically to findAll(): org-wide for org users, unscoped for platform
   * admins. Counts every SelectorHeal row regardless of promotion status —
   * it answers "how much drift happened today", not "how much was approved".
   */
  async getHealsToday(orgId?: string, orgRole?: string): Promise<number> {
    const isPlatformAdmin = orgRole === 'PLATFORM_ADMIN';
    if (!isPlatformAdmin && !orgId) return 0; // no active org — nothing is visible
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    return this.prisma.selectorHeal.count({
      where: {
        createdAt: { gte: startOfDay },
        run: { project: isPlatformAdmin ? {} : { orgId } },
      },
    });
  }

  /** Active quarantines are a risk signal, not a failure count: these tests
   * still execute but no longer gate a feature run until they prove healthy. */
  async getQuarantinedTestCount(orgId?: string, orgRole?: string): Promise<number> {
    const isPlatformAdmin = orgRole === 'PLATFORM_ADMIN';
    if (!isPlatformAdmin && !orgId) return 0;
    return this.prisma.testDefinition.count({
      where: {
        isActive: true,
        deletedAt: null,
        quarantineStatus: QuarantineStatus.QUARANTINED,
        project: isPlatformAdmin ? {} : { orgId },
      },
    });
  }

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
      ...stripWebhookSecret(p),
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
    return stripWebhookSecret(project);
  }

  async create(dto: CreateProjectDto, ownerId: string, orgId?: string | null) {
    // Reject duplicates within the organisation up front, with a clear message
    // (case-insensitive name, exact slug). The @@unique([orgId, slug]) index is
    // the race-safe backstop. Archived projects still hold their slug.
    if (orgId) {
      const clash = await this.prisma.project.findFirst({
        where: {
          orgId,
          deletedAt: null,
          OR: [{ name: { equals: dto.name, mode: 'insensitive' } }, { slug: dto.slug }],
        },
        select: { name: true, slug: true },
      });
      if (clash) {
        const sameName = clash.name.toLowerCase() === dto.name.toLowerCase();
        throw new ConflictException(
          sameName
            ? `A project named "${dto.name}" already exists in this organisation.`
            : `A project with the URL slug "${dto.slug}" already exists in this organisation.`,
        );
      }
    }
    // webhookSecret is write-only (encrypted) — never persisted as-is.
    const { webhookSecret: createSecret, ...createRest } = dto;
    const project = await this.prisma.project.create({
      data: {
        ...createRest,
        ...(createSecret
          ? (() => { const { ciphertext, keyId } = encryptSecret({ secret: createSecret }); return { webhookSecretCiphertext: ciphertext, webhookSecretKeyId: keyId }; })()
          : {}),
        ownerId,
        ...(orgId ? { orgId } : {}),
      },
    });
    // Also add the creator as OWNER project member
    await this.prisma.projectMember.create({
      data: { projectId: project.id, userId: ownerId, role: 'OWNER' },
    });
    await this.audit.log(ownerId, 'CREATE', 'Project', project.id, undefined, { name: project.name, slug: project.slug });
    return stripWebhookSecret(project);
  }

  async update(id: string, dto: UpdateProjectDto, userId?: string) {
    const before = await this.findOne(id);
    // webhookSecret is write-only: encrypted with the KEK, never stored or
    // returned in plaintext. Empty string on either webhook field clears it.
    const { webhookSecret, webhookUrl, ...rest } = dto;
    const data: Prisma.ProjectUpdateInput = { ...rest };
    if (webhookUrl !== undefined) data.webhookUrl = webhookUrl === '' ? null : webhookUrl;
    if (webhookSecret !== undefined) {
      if (webhookSecret === '') {
        data.webhookSecretCiphertext = null;
        data.webhookSecretKeyId = null;
      } else {
        const { ciphertext, keyId } = encryptSecret({ secret: webhookSecret });
        data.webhookSecretCiphertext = ciphertext;
        data.webhookSecretKeyId = keyId;
      }
    }
    const updated = await this.prisma.project.update({ where: { id }, data });
    await this.audit.log(userId, 'UPDATE', 'Project', id, { name: before.name }, { name: updated.name });
    return stripWebhookSecret(updated);
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
