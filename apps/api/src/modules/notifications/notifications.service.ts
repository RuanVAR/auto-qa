import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationType, NotificationCategory } from '@prisma/client';
import { CreateNotificationDto } from './dto/create-notification.dto';
import { resolveChannels, type ChannelPrefs } from './notification-defaults';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Create a notification (called internally by other services) */
  async create(dto: CreateNotificationDto) {
    return this.prisma.notification.create({
      data: {
        userId: dto.userId,
        orgId: dto.orgId,
        type: dto.type,
        category: dto.category,
        title: dto.title,
        body: dto.body,
        actionUrl: dto.actionUrl,
        actionLabel: dto.actionLabel,
        secondaryActionUrl: dto.secondaryActionUrl,
        secondaryActionLabel: dto.secondaryActionLabel,
        meta: (dto.meta ?? {}) as object,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      },
    });
  }

  /** List notifications for a user (unread first, then by createdAt desc) */
  async findForUser(
    userId: string,
    orgId: string,
    opts: { unreadOnly?: boolean; page?: number; limit?: number } = {},
  ) {
    const { unreadOnly = false, page = 1, limit = 20 } = opts;
    const skip = (page - 1) * limit;

    const where = {
      userId,
      orgId,
      ...(unreadOnly ? { isRead: false } : {}),
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    };

    const [items, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ isRead: 'asc' }, { createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
    ]);

    return { items, total, page, limit };
  }

  /** Count unread for badge */
  async countUnread(userId: string, orgId: string): Promise<number> {
    return this.prisma.notification.count({
      where: {
        userId,
        orgId,
        isRead: false,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  /** Mark a single notification as read */
  async markRead(id: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Mark ALL unread as read for the user in their active org */
  async markAllRead(userId: string, orgId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, orgId, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
  }

  /** Emit a RUN_COMPLETED notification to all org members who follow the project */
  async notifyRunCompleted(opts: {
    orgId: string;
    projectId: string;
    projectName: string;
    featureName: string;
    featureId: string;
    runId: string;
    passed: boolean;
    passedCount: number;
    totalCount: number;
  }) {
    // Find all org members to notify (simplified: notify all for now)
    const members = await this.prisma.orgMember.findMany({
      where: { orgId: opts.orgId },
      select: { userId: true },
    });

    const type = opts.passed
      ? NotificationType.FEATURE_RUN_PASSED
      : NotificationType.FEATURE_RUN_FAILED;

    const title = opts.passed
      ? `✅ ${opts.featureName} — Run Passed`
      : `❌ ${opts.featureName} — Run Failed`;

    const body = opts.passed
      ? `All ${opts.totalCount} test${opts.totalCount !== 1 ? 's' : ''} passed in ${opts.projectName}.`
      : `${opts.totalCount - opts.passedCount} of ${opts.totalCount} tests failed in ${opts.projectName}.`;

    await Promise.all(
      members.map(m =>
        this.create({
          userId: m.userId,
          orgId: opts.orgId,
          type,
          category: NotificationCategory.RUN,
          title,
          body,
          actionUrl: `/projects/${opts.projectId}/modules`,
          actionLabel: 'View Feature',
          meta: {
            projectId: opts.projectId,
            featureId: opts.featureId,
            runId: opts.runId,
          },
        }),
      ),
    );
  }

  /**
   * One notification when a NAMED test run finishes — sent to the project's
   * managers (ORG_ADMIN + project OWNER/TECH_LEAD/MANAGER), excluding whoever
   * ran it. Each recipient gets the in-app card when their prefs allow it.
   * Returns the emails of recipients who also opted into email, so the caller
   * can deliver the run report (PDF) to them.
   */
  async notifyTestRunFinished(opts: {
    orgId: string;
    projectId: string;
    projectName: string;
    sessionId: string;
    runName: string;
    passed: number;
    failed: number;
    total: number;
    featureCount: number;
    actorUserId: string;
  }): Promise<{ emailRecipients: string[] }> {
    const [orgAdmins, managers] = await Promise.all([
      this.prisma.orgMember.findMany({
        where: { orgId: opts.orgId, role: 'ORG_ADMIN' },
        select: { userId: true },
      }),
      this.prisma.projectMember.findMany({
        where: { projectId: opts.projectId, role: { in: ['OWNER', 'TECH_LEAD', 'MANAGER'] } },
        select: { userId: true },
      }),
    ]);
    const ids = new Set<string>([
      ...orgAdmins.map((m) => m.userId),
      ...managers.map((m) => m.userId),
    ]);
    ids.delete(opts.actorUserId); // don't notify whoever just ran it
    if (ids.size === 0) return { emailRecipients: [] };

    const users = await this.prisma.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, email: true, notificationPrefs: true },
    });

    const clean = opts.failed === 0;
    const type = clean ? NotificationType.FEATURE_RUN_PASSED : NotificationType.FEATURE_RUN_FAILED;
    const title = `${clean ? '✅' : '❌'} Test run finished — ${opts.runName}`;
    const body =
      `${opts.passed} passed · ${opts.failed} failed of ${opts.total} test${opts.total !== 1 ? 's' : ''} ` +
      `across ${opts.featureCount} feature${opts.featureCount !== 1 ? 's' : ''} in ${opts.projectName}.`;

    const emailRecipients: string[] = [];
    await Promise.all(
      users.map(async (u) => {
        const ch = resolveChannels(this.parseUserPrefs(u.notificationPrefs), type);
        if (ch.inApp) {
          await this.create({
            userId: u.id,
            orgId: opts.orgId,
            type,
            category: NotificationCategory.RUN,
            title,
            body,
            actionUrl: `/projects/${opts.projectId}/test-runs/${opts.sessionId}`,
            actionLabel: 'View run',
            meta: { projectId: opts.projectId, testRunSessionId: opts.sessionId },
          });
        }
        if (ch.email && u.email) emailRecipients.push(u.email);
      }),
    );
    return { emailRecipients };
  }

  /** Parse a User.notificationPrefs JSON blob into a typed channel-prefs map. */
  private parseUserPrefs(raw: unknown): Record<string, ChannelPrefs> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, ChannelPrefs> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const c = value as { inApp?: unknown; email?: unknown };
      out[key] = {
        inApp: typeof c.inApp === 'boolean' ? c.inApp : true,
        email: typeof c.email === 'boolean' ? c.email : false,
      };
    }
    return out;
  }
}
