import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateIssueDto } from './dto/create-issue.dto';
import { UpdateIssueDto } from './dto/update-issue.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { AddCommentDto } from './dto/add-comment.dto';
import { ListIssuesDto } from './dto/list-issues.dto';
import { IssueStatus, IssueType, Prisma } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { WorkSessionsService } from '../work-sessions/work-sessions.service';

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
};

@Injectable()
export class IssuesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workSessions: WorkSessionsService,
  ) {}

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

    // Resolve QA work session for the reporter and attach
    let workSessionId: string | undefined;
    if (project.orgId) {
      // Derive moduleId from feature if not given
      let resolvedModuleId = dto.moduleId;
      if (!resolvedModuleId && dto.featureId) {
        const feat = await this.prisma.feature.findUnique({
          where: { id: dto.featureId },
          select: { moduleId: true },
        });
        resolvedModuleId = feat?.moduleId;
      }
      workSessionId = await this.workSessions.attachToSession(reportedById, project.orgId, {
        testDefinitionId: dto.testDefinitionId,
        featureId: dto.featureId,
        moduleId: resolvedModuleId,
        projectId,
        activityType: 'ISSUE_LOGGED',
      });
    }

    const issue = await this.prisma.$transaction(async (tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => {
      const created = await tx.issue.create({
        data: {
          type:               dto.type,
          severity:           dto.severity ?? 'MEDIUM',
          title:              dto.title,
          description:        dto.description,
          stepsToReproduce:   dto.stepsToReproduce,
          expectedBehaviour:  dto.expectedBehaviour,
          actualBehaviour:    dto.actualBehaviour,
          screenshotUrls:     dto.screenshotUrls ?? [],
          projectId,
          moduleId:           dto.moduleId,
          featureId:          dto.featureId,
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
      resolved:   0,
      wontFix:    0,
      closed:     0,
      byType:     { BUG: 0, SNAG: 0, QUERY: 0 },
    };

    for (const row of rows) {
      const count = row._count;
      stats.total += count;
      if (row.status === 'OPEN')        stats.open       += count;
      if (row.status === 'IN_PROGRESS') stats.inProgress += count;
      if (row.status === 'RESOLVED')    stats.resolved   += count;
      if (row.status === 'WONT_FIX')    stats.wontFix    += count;
      if (row.status === 'CLOSED')      stats.closed     += count;
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
    await this.findOne(id); // ensure exists
    return this.prisma.issue.update({
      where: { id },
      data: {
        ...(dto.title              !== undefined ? { title:              dto.title              } : {}),
        ...(dto.severity           !== undefined ? { severity:           dto.severity           } : {}),
        ...(dto.description        !== undefined ? { description:        dto.description        } : {}),
        ...(dto.stepsToReproduce   !== undefined ? { stepsToReproduce:   dto.stepsToReproduce   } : {}),
        ...(dto.expectedBehaviour  !== undefined ? { expectedBehaviour:  dto.expectedBehaviour  } : {}),
        ...(dto.actualBehaviour    !== undefined ? { actualBehaviour:    dto.actualBehaviour    } : {}),
        ...(dto.screenshotUrls     !== undefined ? { screenshotUrls:     dto.screenshotUrls     } : {}),
        ...(dto.assignedToId       !== undefined ? { assignedToId:       dto.assignedToId       } : {}),
      },
      include: ISSUE_INCLUDE,
    });
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

      return tx.issue.update({
        where: { id },
        data: {
          status: dto.status,
          ...(resolvedAt     ? { resolvedAt }     : {}),
          ...(resolvedById   ? { resolvedById }   : {}),
        },
        include: ISSUE_INCLUDE,
      });
    });

    return updated;
  }

  // ─── COMMENTS ────────────────────────────────────────────────────────────────

  async addComment(issueId: string, dto: AddCommentDto, userId: string) {
    await this.findOne(issueId);
    return this.prisma.issueComment.create({
      data: { issueId, userId, content: dto.content },
      include: { user: { select: { id: true, name: true, avatarUrl: true } } },
    });
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

  // ─── PUSH TO EXTERNAL (ClickUp prep) ─────────────────────────────────────────

  async markPushedExternal(
    id: string,
    externalTicketId: string,
    externalTicketUrl: string,
    externalSystem: string,
  ) {
    return this.prisma.issue.update({
      where: { id },
      data: {
        externalTicketId,
        externalTicketUrl,
        externalSystem,
        pushedExternallyAt: new Date(),
      },
      include: ISSUE_INCLUDE,
    });
  }
}
