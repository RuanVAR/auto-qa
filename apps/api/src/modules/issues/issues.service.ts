import { Injectable, NotFoundException, ForbiddenException, BadRequestException, GoneException, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListIssuesDto } from './dto/list-issues.dto';
import { IssueStatus, IssueType, Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';
import { NotificationsService } from '../notifications/notifications.service';
import { resolveChannels, type ChannelPrefs } from '../notifications/notification-defaults';
import { EmailService } from '../../email/email.service';
import { webUrl } from '../../common/config/urls';
import { PluginService } from '../../plugins/plugin.service';

const ISSUE_INCLUDE = {
  reportedBy: { select: { id: true, name: true, email: true, avatarUrl: true } },
  assignedTo:  { select: { id: true, name: true, email: true, avatarUrl: true } },
  resolvedBy:  { select: { id: true, name: true, email: true, avatarUrl: true } },
  feature:     { select: { id: true, name: true } },
  module:      { select: { id: true, name: true } },
  testDefinition: { select: { id: true, name: true } },
  statusHistory: {
    include: { changedBy: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  comments: {
    where: { deletedAt: null },
    include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
  // Linked tracker tickets — lightweight snapshot so list rows + panels can
  // render the external (e.g. ClickUp) status chip without a per-row fetch.
  ticketLinks: {
    where: { deletedAt: null },
    select: {
      id: true,
      externalUrl: true,
      externalStatus: true,
      externalStatusColor: true,
      install: { select: { pluginId: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
};

@Injectable()
export class IssuesService {
  private readonly logger = new Logger(IssuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workSessions: WorkSessionsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    @Inject(forwardRef(() => PluginService))
    private readonly plugins: PluginService,
  ) {}

  /**
   * Mirror a QA issue reassignment onto its linked ClickUp task. Best-effort —
   * only runs when the issue has a linked task on a healthy ClickUp install and
   * the relevant users are CU-linked. Swallows errors so CU never blocks the
   * QA update.
   */
  private async syncAssigneeToClickUp(
    issueId: string,
    oldAssigneeId: string | null,
    newAssigneeId: string | null,
  ): Promise<void> {
    try {
      const link = await this.prisma.ticketLink.findFirst({
        where: {
          issueId,
          deletedAt: null,
          install: { pluginId: 'clickup', isEnabled: true, lastHealthOk: true, deletedAt: null },
        },
        select: { externalId: true, installId: true },
      });
      if (!link) return;
      const [oldL, newL] = await Promise.all([
        oldAssigneeId
          ? this.prisma.clickUpUserLink.findUnique({
              where: { installId_qaUserId: { installId: link.installId, qaUserId: oldAssigneeId } },
              select: { clickupUserId: true },
            })
          : null,
        newAssigneeId
          ? this.prisma.clickUpUserLink.findUnique({
              where: { installId_qaUserId: { installId: link.installId, qaUserId: newAssigneeId } },
              select: { clickupUserId: true },
            })
          : null,
      ]);
      const add = newL ? [newL.clickupUserId] : [];
      const rem = oldL ? [oldL.clickupUserId] : [];
      if (add.length === 0 && rem.length === 0) return;
      await this.plugins.dispatch('updateAssignees', link.installId, { taskId: link.externalId, add, rem });
    } catch (err) {
      this.logger.warn(`ClickUp assignee sync failed for issue ${issueId}: ${(err as Error).message}`);
    }
  }

  // ─── CREATE ──────────────────────────────────────────────────────────────────

  async create(projectId: string, dto: CreateIssueDto, reportedById: string) {
    // Verify bug tracking is enabled for this project
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { bugTrackingEnabled: true, orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.bugTrackingEnabled) {
      throw new ForbiddenException('Bug tracking is not enabled for this project');
    }
    if (dto.assignedToId) {
      await this.ensureAssignableMember(projectId, dto.assignedToId);
    }

    // Backfill the hierarchy FKs so stats/list queries by module or feature
    // count this issue even if the caller only supplied the deeper level.
    // Without this, an issue logged from a test ends up with moduleId=NULL and
    // disappears from the module overview's "X open · Y total" chip.
    let resolvedFeatureId = dto.featureId ?? undefined;
    let resolvedModuleId  = dto.moduleId  ?? undefined;
    if (dto.testDefinitionId && (!resolvedFeatureId || !resolvedModuleId)) {
      const test = await this.prisma.testDefinition.findUnique({
        where: { id: dto.testDefinitionId },
        select: { featureId: true, feature: { select: { moduleId: true } } },
      });
      if (!resolvedFeatureId && test?.featureId) resolvedFeatureId = test.featureId;
      if (!resolvedModuleId  && test?.feature?.moduleId) resolvedModuleId = test.feature.moduleId;
    }
    if (resolvedFeatureId && !resolvedModuleId) {
      const feat = await this.prisma.feature.findUnique({
        where: { id: resolvedFeatureId },
        select: { moduleId: true },
      });
      if (feat?.moduleId) resolvedModuleId = feat.moduleId;
    }

    // Category — caller-provided wins. Otherwise: if the issue is logged
    // against a failed TestRun that already has a failureCategory set,
    // inherit it (the QA tester already classified the failure; no need to
    // re-think it). Else fall back to FUNCTIONALITY as the product default.
    let resolvedCategory = dto.category;
    if (!resolvedCategory && dto.testRunId) {
      const run = await this.prisma.testRun.findUnique({
        where: { id: dto.testRunId },
        select: { failureCategory: true },
      });
      if (run?.failureCategory) resolvedCategory = run.failureCategory;
    }
    if (!resolvedCategory) resolvedCategory = 'FUNCTIONALITY';

    // Resolve QA work session for the reporter and attach
    let workSessionId: string | undefined;
    if (project.orgId) {
      workSessionId = await this.workSessions.attachToSession(reportedById, project.orgId, {
        testDefinitionId: dto.testDefinitionId,
        featureId: resolvedFeatureId,
        moduleId: resolvedModuleId,
        projectId,
        activityType: 'ISSUE_LOGGED',
      });
    }

    const issue = await this.prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
      const created = await tx.issue.create({
        data: {
          type:               dto.type,
          category:           resolvedCategory,
          severity:           dto.severity ?? 'MEDIUM',
          title:              dto.title,
          description:        dto.description,
          stepsToReproduce:   dto.stepsToReproduce,
          expectedBehaviour:  dto.expectedBehaviour,
          actualBehaviour:    dto.actualBehaviour,
          screenshotUrls:     dto.screenshotUrls ?? [],
          ...(dto.recordingUrl ? { recordingUrl: dto.recordingUrl } : {}),
          projectId,
          moduleId:           resolvedModuleId,
          featureId:          resolvedFeatureId,
          testDefinitionId:   dto.testDefinitionId,
          testRunId:          dto.testRunId,
          runStepId:          dto.runStepId,
          reportedById,
          assignedToId:       dto.assignedToId,
          ...(workSessionId ? { workSessionId } : {}),
        },
        include: ISSUE_INCLUDE,
      });

      // Write initial status history entry
      await tx.issueStatusHistory.create({
        data: {
          issueId:    created.id,
          fromStatus: null,
          toStatus:   'OPEN',
          changedById: reportedById,
          note:       'Issue created',
        },
      });

      return created;
    });

    await this.notifyAssigneeOnCreate(issue.id, reportedById);

    return issue;
  }

  // ─── LIST / FILTER ───────────────────────────────────────────────────────────

  async findAll(projectId: string, dto: ListIssuesDto) {
    const page  = dto.page  ?? 1;
    const limit = dto.limit ?? 25;
    const skip  = (page - 1) * limit;

    const where: Prisma.IssueWhereInput = {
      projectId,
      deletedAt: null,
      ...(dto.status   ? { status:   dto.status   } : {}),
      ...(dto.type     ? { type:     dto.type     } : {}),
      ...(dto.severity ? { severity: dto.severity } : {}),
      ...(dto.moduleId         ? { moduleId:         dto.moduleId         } : {}),
      ...(dto.featureId        ? { featureId:        dto.featureId        } : {}),
      ...(dto.testDefinitionId ? { testDefinitionId: dto.testDefinitionId } : {}),
      ...(dto.assignedToId     ? { assignedToId:     dto.assignedToId     } : {}),
      ...(dto.search           ? { title: { contains: dto.search, mode: 'insensitive' } } : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.issue.findMany({
        where,
        include: ISSUE_INCLUDE,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: limit,
      }),
      this.prisma.issue.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit),
    };
  }

  // ─── STATS ───────────────────────────────────────────────────────────────────

  async getStats(scope: {
    projectId?: string;
    moduleId?: string;
    featureId?: string;
    testDefinitionId?: string;
  }) {
    const where: Prisma.IssueWhereInput = { deletedAt: null };
    if (scope.projectId)       where.projectId       = scope.projectId;
    if (scope.moduleId)        where.moduleId        = scope.moduleId;
    if (scope.featureId)       where.featureId       = scope.featureId;
    if (scope.testDefinitionId) where.testDefinitionId = scope.testDefinitionId;

    const rows = await this.prisma.issue.groupBy({
      by:    ['status', 'type'],
      where,
      _count: true,
    });

    const stats = {
      total:      0,
      open:       0,
      inProgress: 0,
      readyForQa: 0,
      resolved:   0,
      wontFix:    0,
      closed:     0,
      byType:     { BUG: 0, SNAG: 0, QUERY: 0 },
    };

    for (const row of rows) {
      const count = row._count;
      stats.total += count;
      if (row.status === 'OPEN')          stats.open       += count;
      if (row.status === 'IN_PROGRESS')   stats.inProgress += count;
      if (row.status === 'READY_FOR_QA')  stats.readyForQa += count;
      if (row.status === 'RESOLVED')      stats.resolved   += count;
      if (row.status === 'WONT_FIX')      stats.wontFix    += count;
      if (row.status === 'CLOSED')        stats.closed     += count;
      stats.byType[row.type as IssueType] += count;
    }

    return stats;
  }

  // ─── GET ONE ─────────────────────────────────────────────────────────────────

  async findOne(id: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: ISSUE_INCLUDE,
    });
    if (!issue || issue.deletedAt) throw new NotFoundException('Issue not found');
    return issue;
  }

  // ─── UPDATE ──────────────────────────────────────────────────────────────────

  async update(id: string, dto: UpdateIssueDto) {
    const existing = await this.findOne(id); // ensure exists
    if (dto.assignedToId) {
      await this.ensureAssignableMember(existing.projectId, dto.assignedToId);
    }
    const assigneeChanged =
      dto.assignedToId !== undefined && dto.assignedToId !== existing.assignedToId;
    const updated = await this.prisma.issue.update({
      where: { id },
      data: {
        ...(dto.title              !== undefined ? { title:              dto.title              } : {}),
        ...(dto.severity           !== undefined ? { severity:           dto.severity           } : {}),
        ...(dto.category           !== undefined ? { category:           dto.category           } : {}),
        ...(dto.description        !== undefined ? { description:        dto.description        } : {}),
        ...(dto.stepsToReproduce   !== undefined ? { stepsToReproduce:   dto.stepsToReproduce   } : {}),
        ...(dto.expectedBehaviour  !== undefined ? { expectedBehaviour:  dto.expectedBehaviour  } : {}),
        ...(dto.actualBehaviour    !== undefined ? { actualBehaviour:    dto.actualBehaviour    } : {}),
        ...(dto.screenshotUrls     !== undefined ? { screenshotUrls:     dto.screenshotUrls     } : {}),
        ...(dto.recordingUrl       !== undefined ? { recordingUrl:       dto.recordingUrl       } : {}),
        ...(dto.assignedToId       !== undefined ? { assignedToId:       dto.assignedToId       } : {}),
      },
      include: ISSUE_INCLUDE,
    });

    // Mirror reassignment onto the linked ClickUp task (best-effort, health-gated).
    if (assigneeChanged) {
      void this.syncAssigneeToClickUp(id, existing.assignedToId ?? null, dto.assignedToId ?? null);
    }

    return updated;
  }

  // ─── CHANGE STATUS ───────────────────────────────────────────────────────────

  async changeStatus(id: string, dto: ChangeStatusDto, changedById: string) {
    const issue = await this.findOne(id);

    if (issue.status === dto.status) {
      throw new BadRequestException(`Issue is already in status ${dto.status}`);
    }

    const updated = await this.prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
      // Write history entry
      await tx.issueStatusHistory.create({
        data: {
          issueId:    id,
          fromStatus: issue.status as IssueStatus,
          toStatus:   dto.status,
          note:       dto.note,
          changedById,
        },
      });

      // Resolve tracking
      const resolvedAt = ['RESOLVED', 'CLOSED'].includes(dto.status) ? new Date() : null;
      const resolvedById = ['RESOLVED', 'CLOSED'].includes(dto.status) ? changedById : null;

      const result = await tx.issue.update({
        where: { id },
        data: {
          status: dto.status,
          ...(resolvedAt     ? { resolvedAt }     : {}),
          ...(resolvedById   ? { resolvedById }   : {}),
        },
        include: {
          ...ISSUE_INCLUDE,
          project: { select: { id: true, name: true, orgId: true } },
        },
      });

      // Notify reporter + assignee (excluding changer)
      const notifyUserIds = [
        issue.reportedById,
        (issue as { assignedToId?: string | null }).assignedToId ?? null,
      ].filter((uid): uid is string => !!uid && uid !== changedById);
      const uniqueNotifyIds = [...new Set(notifyUserIds)];

      if (uniqueNotifyIds.length > 0) {
        const actor = await tx.user.findUnique({ where: { id: changedById }, select: { name: true } });
        const orgId = (result as { project?: { orgId?: string | null } }).project?.orgId ?? '';
        const actionUrl = `/issues/${id}`;

        await tx.notification.createMany({
          data: uniqueNotifyIds.map((uid) => ({
            userId: uid,
            orgId,
            type: 'ISSUE_STATUS_CHANGED' as const,
            category: 'ASSIGNMENT' as const,
            title: `Issue "${issue.title}" status changed to ${dto.status}`,
            body: `${actor?.name ?? 'Someone'} changed the status from ${issue.status} to ${dto.status}${dto.note ? `: ${dto.note}` : ''}.`,
            actionUrl,
            actionLabel: 'View issue',
            meta: {
              issueId: id,
              fromStatus: issue.status,
              toStatus: dto.status,
              actorId: changedById,
              actorName: actor?.name,
              issueTitle: issue.title,
            },
          })),
          skipDuplicates: true,
        });
      }

      return result;
    });

    return updated;
  }

  // ─── VIEWER ──────────────────────────────────────────────────────────────────

  async findOneForViewer(id: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id },
      include: {
        ...ISSUE_INCLUDE,
        views: {
          include: { user: { select: { id: true, name: true, avatarUrl: true } } },
          orderBy: { lastViewedAt: 'desc' as const },
          take: 20,
        },
        project: { select: { id: true, name: true, orgId: true } },
        testDefinition: { select: { id: true, name: true } },
      },
    });

    if (!issue) throw new NotFoundException('Issue not found');
    if (issue.deletedAt) {
      throw new GoneException({ deletedAt: issue.deletedAt, title: issue.title });
    }

    // Check project membership
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId: issue.projectId, userId } },
    });

    if (!member) {
      // Check if user is ORG_ADMIN of the issue's org
      const orgId = issue.project?.orgId;
      const isOrgAdmin = orgId
        ? !!(await this.prisma.orgMember.findUnique({
            where: { orgId_userId: { orgId, userId } },
            select: { role: true },
          }).then((m) => m?.role === 'ORG_ADMIN'))
        : false;

      if (!isOrgAdmin) {
        throw new ForbiddenException('You do not have access to this issue');
      }
    }

    const viewCount = issue.views.reduce((sum, v) => sum + v.viewCount, 0);
    return { ...issue, viewCount };
  }

  async recordView(issueId: string, userId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { reportedById: true },
    });
    if (!issue || issue.reportedById === userId) return { ok: true };
    await this.prisma.issueView.upsert({
      where: { issueId_userId: { issueId, userId } },
      create: { issueId, userId },
      update: { lastViewedAt: new Date(), viewCount: { increment: 1 } },
    });
    return { ok: true };
  }

  async getViews(issueId: string) {
    return this.prisma.issueView.findMany({
      where: { issueId },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      orderBy: { lastViewedAt: 'desc' },
      take: 20,
    });
  }

  async getMentionable(issueId: string) {
    const issue = await this.prisma.issue.findUnique({
      where: { id: issueId },
      select: { projectId: true, project: { select: { orgId: true } } },
    });
    if (!issue) throw new NotFoundException('Issue not found');
    return this.getMentionableForTx(issue.projectId, issue.project?.orgId ?? '', this.prisma);
  }

  private async getMentionableForTx(
    projectId: string,
    orgId: string,
    tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'> | PrismaService,
  ) {
    const [projectMembers, orgAdmins] = await Promise.all([
      tx.projectMember.findMany({
        where: { projectId },
        include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
      }),
      orgId
        ? tx.orgMember.findMany({
            where: { orgId, role: 'ORG_ADMIN' },
            include: { user: { select: { id: true, name: true, email: true, avatarUrl: true } } },
          })
        : Promise.resolve([]),
    ]);

    const seen = new Set<string>();
    const result: Array<{ id: string; name: string; email: string; avatarUrl: string | null; role: string }> = [];

    for (const pm of projectMembers) {
      if (!seen.has(pm.userId)) {
        seen.add(pm.userId);
        result.push({ ...pm.user, role: pm.role });
      }
    }
    for (const om of orgAdmins) {
      if (!seen.has(om.userId)) {
        seen.add(om.userId);
        result.push({ ...om.user, role: om.role });
      }
    }

    return result;
  }

  // ─── COMMENTS ────────────────────────────────────────────────────────────────

  async addComment(issueId: string, dto: AddCommentDto, userId: string) {
    const issue = await this.findOne(issueId);

    const comment = await this.prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
      const created = await tx.issueComment.create({
        data: { issueId, userId, content: dto.content },
        include: { user: { select: { id: true, name: true, avatarUrl: true } } },
      });

      // Parse @mentions
      const mentionMatches = [...dto.content.matchAll(/(^|[^a-z0-9_])@([a-z0-9_.-]+)/gi)];
      const slugs = [...new Set(mentionMatches.map((m) => m[2].toLowerCase()))].slice(0, 10);

      if (slugs.length > 0) {
        const issueWithProject = await tx.issue.findUnique({
          where: { id: issueId },
          select: { projectId: true, project: { select: { orgId: true } } },
        });
        const mentionable = await this.getMentionableForTx(
          issueWithProject?.projectId ?? '',
          issueWithProject?.project?.orgId ?? '',
          tx,
        );

        const resolved = slugs
          .map((slug) =>
            mentionable.find(
              (u) =>
                u.email.split('@')[0].toLowerCase() === slug ||
                u.name.toLowerCase().replace(/\s+/g, '-') === slug,
            ),
          )
          .filter(Boolean)
          .filter((u) => u!.id !== userId)
          .filter((u, i, arr) => arr.findIndex((x) => x!.id === u!.id) === i);

        if (resolved.length > 0) {
          const actor = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
          const orgId = issueWithProject?.project?.orgId ?? '';
          await tx.notification.createMany({
            data: resolved.map((u) => ({
              userId: u!.id,
              orgId,
              type: 'ISSUE_MENTIONED' as const,
              category: 'ASSIGNMENT' as const,
              title: `${actor?.name ?? 'Someone'} mentioned you in "${issue.title}"`,
              body: dto.content.slice(0, 140),
              actionUrl: `/issues/${issue.id}?comment=${created.id}`,
              actionLabel: 'Open issue',
              meta: {
                issueId: issue.id,
                commentId: created.id,
                actorId: userId,
                actorName: actor?.name,
                issueTitle: issue.title,
              },
            })),
            skipDuplicates: true,
          });
        }
      }

      return created;
    });

    return comment;
  }

  async deleteComment(commentId: string, userId: string) {
    const comment = await this.prisma.issueComment.findUnique({ where: { id: commentId } });
    if (!comment || comment.deletedAt) throw new NotFoundException('Comment not found');
    if (comment.userId !== userId) throw new ForbiddenException('Can only delete your own comments');
    return this.prisma.issueComment.update({
      where: { id: commentId },
      data: { deletedAt: new Date() },
    });
  }

  // ─── SOFT DELETE ─────────────────────────────────────────────────────────────

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.issue.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  // ─── HARD DELETE (OWNER / ORG_ADMIN only) ────────────────────────────────────

  async hardDelete(id: string) {
    await this.prisma.issue.delete({ where: { id } });
  }

  private async ensureAssignableMember(projectId: string, assignedToId: string) {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: assignedToId } },
      include: { user: { select: { accountStatus: true } } },
    });

    if (!member) {
      throw new BadRequestException('Assignee must be a member of this project');
    }

    if (member.user.accountStatus !== 'ACTIVE') {
      throw new BadRequestException('Assignee account must be active');
    }
  }

  private parseUserPrefs(raw: unknown): Record<string, ChannelPrefs> {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const prefs = raw as Record<string, unknown>;
    const parsed: Record<string, ChannelPrefs> = {};
    for (const [key, value] of Object.entries(prefs)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const candidate = value as { inApp?: unknown; email?: unknown };
      if (typeof candidate.inApp !== 'boolean' || typeof candidate.email !== 'boolean') {
        continue;
      }
      parsed[key] = { inApp: candidate.inApp, email: candidate.email };
    }
    return parsed;
  }

  private async notifyAssigneeOnCreate(issueId: string, reporterId: string) {
    try {
      const issue = await this.prisma.issue.findUnique({
        where: { id: issueId },
        select: {
          id: true,
          type: true,
          title: true,
          projectId: true,
          assignedToId: true,
          project: { select: { orgId: true, name: true } },
        },
      });

      if (!issue?.assignedToId || issue.assignedToId === reporterId) return;

      const [assignee, reporter] = await Promise.all([
        this.prisma.user.findUnique({
          where: { id: issue.assignedToId },
          select: { id: true, email: true, name: true, notificationPrefs: true },
        }),
        this.prisma.user.findUnique({
          where: { id: reporterId },
          select: { name: true },
        }),
      ]);

      if (!assignee) return;

      const channels = resolveChannels(this.parseUserPrefs(assignee.notificationPrefs), 'ISSUE_ASSIGNED');
      const issueLabel = issue.type.toLowerCase();
      const actionUrl = `/issues/${issue.id}`;
      const actorName = reporter?.name ?? 'A teammate';
      const orgId = issue.project.orgId;

      if (channels.inApp && orgId) {
        await this.notifications.create({
          userId: assignee.id,
          orgId,
          type: 'ISSUE_ASSIGNED',
          category: 'ASSIGNMENT',
          title: `You were assigned a ${issueLabel}`,
          body: `${actorName} assigned "${issue.title}" to you in ${issue.project.name}.`,
          actionUrl,
          actionLabel: 'Open issue',
          meta: {
            issueId: issue.id,
            issueTitle: issue.title,
            issueType: issue.type,
            projectId: issue.projectId,
            actorId: reporterId,
            actorName,
          },
        });
      }

      if (channels.email && assignee.email) {
        const issueUrl = `${webUrl()}${actionUrl}`;
        await this.email.sendRaw({
          to: assignee.email,
          subject: `Issue assigned: ${issue.title}`,
          text: `${actorName} assigned you a ${issueLabel} in ${issue.project.name}.\n\nIssue: ${issue.title}\nOpen: ${issueUrl}`,
          html: `
            <p>${actorName} assigned you a ${issueLabel} in <strong>${issue.project.name}</strong>.</p>
            <p><strong>Issue:</strong> ${issue.title}</p>
            <p><a href="${issueUrl}">Open issue</a></p>
          `,
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to send issue assignment notification for ${issueId}: ${(err as Error)?.message ?? err}`);
    }
  }
}
