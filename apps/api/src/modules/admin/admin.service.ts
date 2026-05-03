import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { AccountStatus, PlatformRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateConfigDto } from './dto/create-config.dto';
import { UserRole } from '@prisma/client';
import { EmailService } from '../../email/email.service';

const MASK = '••••••••';

function maskConfig(cfg: { key: string; value: string; isSecret: boolean; [key: string]: unknown }) {
  return { ...cfg, value: cfg.isSecret ? MASK : cfg.value };
}

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
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
    const loginUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/login`;
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
}
