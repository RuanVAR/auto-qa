import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { AccountStatus, PlatformRole, UserRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { EmailService } from '../../email/email.service';
import { OrganisationsService } from '../organisations/organisations.service';
import { webUrl } from '../../common/config/urls';
import * as bcrypt from 'bcryptjs';

const MASK = '••••••••';

function maskConfig(cfg: { key: string; value: string; isSecret: boolean; [key: string]: unknown }) {
  return { ...cfg, value: cfg.isSecret ? MASK : cfg.value };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly orgs: OrganisationsService,
  ) {}

  // ── Platform Config ──────────────────────────────────────────────────────────

  async listConfig() {
    const configs = await this.prisma.platformConfig.findMany({ orderBy: [{ category: 'asc' }, { key: 'asc' }] });
    return configs.map(maskConfig);
  }

  async createConfig(dto: CreateConfigDto) {
    const cfg = await this.prisma.platformConfig.create({
      data: { key: dto.key, value: dto.value, isSecret: dto.isSecret ?? false, category: dto.category },
    });
    return maskConfig(cfg);
  }

  async updateConfig(key: string, value: string) {
    const existing = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Config key "${key}" not found`);
    const cfg = await this.prisma.platformConfig.update({ where: { key }, data: { value } });
    return maskConfig(cfg);
  }

  async deleteConfig(key: string) {
    const existing = await this.prisma.platformConfig.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`Config key "${key}" not found`);
    return this.prisma.platformConfig.delete({ where: { key } });
  }

  /** Resolve a config key — returns raw value (for internal use only, never expose to API) */
  async resolveRaw(key: string): Promise<string | null> {
    const cfg = await this.prisma.platformConfig.findUnique({ where: { key } });
    return cfg?.value ?? null;
  }

  // ── User Management ──────────────────────────────────────────────────────────

  async listUsers(page = 1, limit = 50, status?: AccountStatus) {
    const skip = (page - 1) * limit;
    const where = status ? { accountStatus: status } : {};
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          platformRole: true,
          accountStatus: true,
          createdAt: true,
          lastActiveOrgId: true,
          orgMemberships: {
            include: { org: { select: { id: true, name: true, slug: true } } },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page, limit };
  }

  async updateUser(id: string, data: { role?: UserRole; accountStatus?: AccountStatus; platformRole?: PlatformRole }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, platformRole: true, accountStatus: true },
    });
  }

  async invitePlatformAdmin(inviterId: string, emailRaw: string, name?: string) {
    const email = emailRaw.trim().toLowerCase();
    const inviterName = await this.lookupName(inviterId);
    const loginUrl = `${webUrl()}/login`;

    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      if (existing.platformRole === 'PLATFORM_ADMIN') {
        throw new ForbiddenException('User is already a platform admin');
      }

      const promoted = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          platformRole: 'PLATFORM_ADMIN',
          accountStatus: 'ACTIVE',
        },
        select: { id: true, email: true, name: true, platformRole: true, accountStatus: true },
      });

      await this.ensureSystemOrgAdminMembership(promoted.id);
      this.email.sendAccountApproved(promoted.email, {
        userName: promoted.name,
        loginUrl,
        approverName: inviterName,
      });

      return {
        mode: 'PROMOTED_EXISTING_USER' as const,
        user: promoted,
      };
    }

    const passwordHash = await bcrypt.hash(`${Date.now()}-${Math.random()}-temp`, 12);
    const created = await this.prisma.user.create({
      data: {
        email,
        name: name?.trim() || email.split('@')[0],
        passwordHash,
        platformRole: 'PLATFORM_ADMIN',
        accountStatus: 'ACTIVE',
      },
      select: { id: true, email: true, name: true, platformRole: true, accountStatus: true },
    });

    await this.ensureSystemOrgAdminMembership(created.id);
    this.email.sendAccountApproved(created.email, {
      userName: created.name,
      loginUrl,
      approverName: inviterName,
    });

    return {
      mode: 'INVITED_NEW_USER' as const,
      user: created,
      message: 'Platform admin invited. Ask them to use "Forgot password" to set credentials.',
    };
  }

  // ── Registration Approvals ───────────────────────────────────────────────────

  async listPendingApprovals() {
    return this.prisma.user.findMany({
      where: { accountStatus: 'PENDING_APPROVAL' },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        orgMemberships: {
          include: { org: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async approveUser(userId: string, approverId: string, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.accountStatus !== 'PENDING_APPROVAL') {
      throw new ForbiddenException('User is not pending approval');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'ACTIVE',
        approvedById: approverId,
        approvedAt: new Date(),
        approverNote: note,
      },
      select: { id: true, email: true, name: true, accountStatus: true },
    });
    // Notify the approved user (their "you're in" email) + audit-trail copy
    // to the admin who approved. Both fire-and-forget; the EmailService
    // catches its own errors so a transient SMTP issue never breaks the
    // approval response.
    const loginUrl = `${webUrl()}/login`;
    this.email.sendAccountApproved(updated.email, {
      userName: updated.name,
      loginUrl,
      approverName: await this.lookupName(approverId),
    });
    const adminEmail = await this.lookupEmail(approverId);
    if (adminEmail) {
      this.email.sendAdminApprovalConfirmation(adminEmail, {
        adminName: await this.lookupName(approverId) ?? 'Admin',
        approvedUserName: updated.name,
        approvedUserEmail: updated.email,
        decision: 'APPROVED',
      });
    }
    return updated;
  }

  async rejectUser(userId: string, approverId: string, note?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    if (user.accountStatus !== 'PENDING_APPROVAL') {
      throw new ForbiddenException('User is not pending approval');
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        accountStatus: 'DEACTIVATED',
        approvedById: approverId,
        approvedAt: new Date(),
        approverNote: note ?? 'Registration rejected',
      },
      select: { id: true, email: true, name: true, accountStatus: true },
    });
    this.email.sendAccountRejected(updated.email, {
      userName: updated.name,
      reason: note,
    });
    const adminEmail = await this.lookupEmail(approverId);
    if (adminEmail) {
      this.email.sendAdminApprovalConfirmation(adminEmail, {
        adminName: await this.lookupName(approverId) ?? 'Admin',
        approvedUserName: updated.name,
        approvedUserEmail: updated.email,
        decision: 'REJECTED',
      });
    }
    return updated;
  }

  /** Helpers — keep email-side enrichment out of the main flow. */
  private async lookupEmail(userId: string): Promise<string | null> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    return u?.email ?? null;
  }
  private async lookupName(userId: string): Promise<string | undefined> {
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    return u?.name ?? undefined;
  }

  async suspendUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'SUSPENDED' },
      select: { id: true, email: true, accountStatus: true },
    });
  }

  async reactivateUser(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'ACTIVE' },
      select: { id: true, email: true, accountStatus: true },
    });
  }

  // ── Organisation Management ──────────────────────────────────────────────────

  /**
   * Platform-admin org creation. Assigns an owner by email:
   *   - existing user  → org owned by them, added as ORG_ADMIN.
   *   - unknown email   → org owned (of-record) by the creating admin, with an
   *                       ORG_ADMIN invite sent to the email (reuses the org
   *                       invite flow + its branded email).
   * Returns the created org (id, name, slug).
   */
  async createOrg(
    adminUserId: string,
    dto: { name: string; ownerEmail: string; website?: string; description?: string },
  ) {
    const name = dto.name?.trim();
    if (!name) throw new BadRequestException('Organisation name is required');
    const ownerEmail = dto.ownerEmail?.trim().toLowerCase();
    if (!ownerEmail) throw new BadRequestException('Owner email is required');

    const slug = await this.uniqueSlug(name);
    const existingOwner = await this.prisma.user.findFirst({
      where: { email: { equals: ownerEmail, mode: 'insensitive' } },
      select: { id: true },
    });

    // Owner-of-record: the resolved user if they exist, else the creating admin
    // (a valid FK that also satisfies the "can't remove the owner" guard).
    const ownerId = existingOwner?.id ?? adminUserId;

    const org = await this.prisma.organisation.create({
      data: {
        name,
        slug,
        ownerId,
        ...(dto.website ? { website: dto.website.trim() } : {}),
        ...(dto.description ? { description: dto.description.trim() } : {}),
        // Only seed a membership when the owner already has an account; an
        // unknown owner joins as ORG_ADMIN when they accept the invite below.
        ...(existingOwner ? { members: { create: { userId: existingOwner.id, role: 'ORG_ADMIN' } } } : {}),
      },
      select: { id: true, name: true, slug: true },
    });

    // Unknown owner → send them an ORG_ADMIN invite (creates OrgInvite + email).
    if (!existingOwner) {
      await this.orgs.inviteMember(org.id, adminUserId, { email: ownerEmail, role: 'ORG_ADMIN' });
    }

    return org;
  }

  /** Slugify a name and append a numeric suffix until the slug is unique. */
  private async uniqueSlug(name: string): Promise<string> {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50) || 'org';
    let slug = base;
    let n = 1;
    // Loop is bounded in practice; collisions are rare.
    while (await this.prisma.organisation.findUnique({ where: { slug }, select: { id: true } })) {
      n += 1;
      slug = `${base.substring(0, 46)}-${n}`;
    }
    return slug;
  }

  async listOrgs(page = 1, limit = 50) {
    const skip = (page - 1) * limit;
    const [items, total] = await Promise.all([
      this.prisma.organisation.findMany({
        where: { deletedAt: null },
        include: {
          _count: { select: { members: true, projects: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.organisation.count({ where: { deletedAt: null } }),
    ]);
    return { items, total, page, limit };
  }

  async updateOrgStatus(orgId: string, isActive: boolean) {
    const org = await this.prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    return this.prisma.organisation.update({
      where: { id: orgId },
      data: { isActive },
      select: { id: true, name: true, slug: true, isActive: true },
    });
  }

  async deleteOrg(orgId: string) {
    const org = await this.prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');
    return this.prisma.organisation.update({
      where: { id: orgId },
      data: { deletedAt: new Date() },
      select: { id: true, name: true, deletedAt: true },
    });
  }

  async getOrgDetail(orgId: string) {
    const org = await this.prisma.organisation.findUniqueOrThrow({
      where: { id: orgId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true, accountStatus: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        projects: {
          where: { deletedAt: null },
          include: {
            _count: { select: { modules: true, testDefinitions: true, runs: true } },
          },
        },
      },
    });

    const totalProjects = org.projects.length;
    const totalModules = org.projects.reduce((s: number, p) => s + p._count.modules, 0);
    const totalTestCases = org.projects.reduce((s: number, p) => s + p._count.testDefinitions, 0);
    const activeRuns = await this.prisma.testRun.count({
      where: { project: { orgId }, status: { in: ['PENDING', 'RUNNING'] } },
    });

    return {
      ...org,
      stats: { totalProjects, totalModules, totalTestCases, activeRuns, totalMembers: org.members.length },
    };
  }

  async getPlatformStats() {
    const [totalUsers, activeUsers, pendingApproval, totalOrgs, totalProjects] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.count({ where: { accountStatus: 'ACTIVE' } }),
      this.prisma.user.count({ where: { accountStatus: 'PENDING_APPROVAL' } }),
      this.prisma.organisation.count({ where: { deletedAt: null } }),
      this.prisma.project.count({ where: { deletedAt: null } }),
    ]);
    return { totalUsers, activeUsers, pendingApproval, totalOrgs, totalProjects };
  }

  private async ensureSystemOrgAdminMembership(userId: string) {
    const systemOrg = await this.prisma.organisation.upsert({
      where: { slug: 'system' },
      create: {
        name: 'System',
        slug: 'system',
        description: 'Platform system organisation',
        ownerId: userId,
      },
      update: {},
    });

    await this.prisma.orgMember.upsert({
      where: { orgId_userId: { orgId: systemOrg.id, userId } },
      create: { orgId: systemOrg.id, userId, role: 'ORG_ADMIN' },
      update: { role: 'ORG_ADMIN' },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { lastActiveOrgId: systemOrg.id },
    });
  }
}
