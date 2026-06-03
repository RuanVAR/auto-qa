import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PluginService } from '../../plugins/plugin.service';

interface MemberItem {
  id: string;
  label: string;
  meta?: { clickupUserId?: number; username?: string; email?: string; initials?: string; color?: string };
}

/**
 * Maps QA-platform users to ClickUp workspace users so that assigning an issue
 * here can also assign the linked ClickUp task.
 *
 * Everything is gated on a ClickUp install that is present, enabled, AND
 * healthy (isEnabled && lastHealthOk). With no healthy install the linking
 * surface is inert — base QA assignment is unaffected.
 */
@Injectable()
export class ClickUpLinksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly plugins: PluginService,
  ) {}

  /** Resolve the org's healthy ClickUp install, or throw. */
  private async requireHealthyInstall(orgId: string) {
    const install = await this.prisma.orgPluginInstall.findFirst({
      where: { orgId, pluginId: 'clickup', deletedAt: null },
      select: { id: true, config: true, isEnabled: true, lastHealthOk: true },
    });
    if (!install) {
      throw new NotFoundException('ClickUp is not installed for this organisation.');
    }
    if (!install.isEnabled || !install.lastHealthOk) {
      throw new NotFoundException('ClickUp integration is disabled or unhealthy — reconnect it before managing user links.');
    }
    return install;
  }

  /** Lightweight "is there a usable CU install" probe for the frontend. */
  async getHealth(orgId: string): Promise<{ installed: boolean; healthy: boolean }> {
    const install = await this.prisma.orgPluginInstall.findFirst({
      where: { orgId, pluginId: 'clickup', deletedAt: null },
      select: { isEnabled: true, lastHealthOk: true },
    });
    return {
      installed: !!install,
      healthy: !!install && install.isEnabled && install.lastHealthOk,
    };
  }

  /**
   * Workspace members + their current QA link + an email auto-match suggestion,
   * plus the org's QA users for the linking dropdown.
   */
  async getMembers(orgId: string) {
    const install = await this.requireHealthyInstall(orgId);

    const out = await this.plugins.dispatch<{ items: MemberItem[] }>(
      'listEntities',
      install.id,
      { kind: 'member' },
      install.config ?? {},
    );
    const members = out?.items ?? [];

    const [links, orgMembers] = await Promise.all([
      this.prisma.clickUpUserLink.findMany({ where: { installId: install.id } }),
      this.prisma.orgMember.findMany({
        where: { orgId },
        select: { user: { select: { id: true, name: true, email: true } } },
      }),
    ]);

    const qaUsers = orgMembers.map((m) => m.user);
    const linkByCuId = new Map(links.map((l) => [l.clickupUserId, l]));
    const linkByQaId = new Map(links.map((l) => [l.qaUserId, l]));
    const qaByEmail = new Map(
      qaUsers.filter((u) => u.email).map((u) => [u.email!.toLowerCase(), u.id]),
    );

    return {
      members: members.map((m) => {
        const cuId = m.meta?.clickupUserId ?? Number(m.id);
        const existing = linkByCuId.get(cuId);
        const email = m.meta?.email ?? null;
        const suggestedQaUserId = !existing && email ? qaByEmail.get(email.toLowerCase()) ?? null : null;
        return {
          clickupUserId: cuId,
          username: m.meta?.username ?? m.label,
          email,
          color: m.meta?.color ?? null,
          linkedQaUserId: existing?.qaUserId ?? null,
          suggestedQaUserId,
        };
      }),
      qaUsers: qaUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        linkedClickupUserId: linkByQaId.get(u.id)?.clickupUserId ?? null,
      })),
    };
  }

  /** Create/replace a QA-user ↔ ClickUp-user link. */
  async link(
    orgId: string,
    body: { qaUserId: string; clickupUserId: number; clickupUsername?: string; clickupEmail?: string },
  ) {
    const install = await this.requireHealthyInstall(orgId);
    if (!body?.qaUserId || typeof body.clickupUserId !== 'number') {
      throw new BadRequestException('qaUserId and numeric clickupUserId are required.');
    }
    // qaUser must belong to this org.
    const member = await this.prisma.orgMember.findFirst({
      where: { orgId, userId: body.qaUserId },
      select: { id: true },
    });
    if (!member) throw new BadRequestException('User is not a member of this organisation.');

    // Enforce one-to-one both ways: drop any existing link that holds either
    // side, then create the new pairing — atomically, so concurrent links on
    // the same account can't race past the unique constraints.
    return this.prisma.$transaction(async (tx) => {
      await tx.clickUpUserLink.deleteMany({
        where: { installId: install.id, OR: [{ qaUserId: body.qaUserId }, { clickupUserId: body.clickupUserId }] },
      });
      return tx.clickUpUserLink.create({
        data: {
          orgId,
          installId: install.id,
          qaUserId: body.qaUserId,
          clickupUserId: body.clickupUserId,
          clickupUsername: body.clickupUsername ?? null,
          clickupEmail: body.clickupEmail ?? null,
        },
      });
    });
  }

  /** Remove a QA user's ClickUp link. */
  async unlink(orgId: string, qaUserId: string) {
    const install = await this.requireHealthyInstall(orgId);
    await this.prisma.clickUpUserLink.deleteMany({ where: { installId: install.id, qaUserId } });
    return { unlinked: true };
  }

  /**
   * Resolve a QA user's ClickUp user id for a given install — used by the
   * issue-assignee sync. Returns null when the user isn't linked.
   */
  async resolveClickUpUserId(installId: string, qaUserId: string): Promise<number | null> {
    const link = await this.prisma.clickUpUserLink.findUnique({
      where: { installId_qaUserId: { installId, qaUserId } },
      select: { clickupUserId: true },
    });
    return link?.clickupUserId ?? null;
  }
}
