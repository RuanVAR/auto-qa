import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CreateAccessRequestDto } from './dto/create-access-request.dto';
import { ReviewAccessRequestDto } from './dto/review-access-request.dto';
import { OrgRole, ProjectRole } from '@prisma/client';

@Injectable()
export class AccessRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrgRequest(
    orgId: string,
    requesterId: string,
    dto: CreateAccessRequestDto,
  ) {
    // Verify org exists
    const org = await this.prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');

    // Check user is NOT already an org member
    const existingMember = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: requesterId } },
    });
    if (existingMember) {
      throw new BadRequestException('You are already a member of this organisation');
    }

    // Check no PENDING request already exists
    const existingRequest = await this.prisma.accessRequest.findFirst({
      where: { orgId, requesterId, type: 'ORG', status: 'PENDING' },
    });
    if (existingRequest) {
      throw new ConflictException('You already have a pending access request for this organisation');
    }

    return this.prisma.accessRequest.create({
      data: {
        type: 'ORG',
        orgId,
        requesterId,
        message: dto.message,
        status: 'PENDING',
      },
      include: {
        requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
        org: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  async createProjectRequest(
    orgId: string,
    projectId: string,
    requesterId: string,
    dto: CreateAccessRequestDto,
  ) {
    // Verify project exists
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, orgId },
    });
    if (!project) throw new NotFoundException('Project not found');

    // Check user IS an org member
    const orgMember = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: requesterId } },
    });
    if (!orgMember) {
      throw new BadRequestException('You must be an organisation member to request project access');
    }

    // Check NOT already a project member
    const existingProjectMember = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: requesterId } },
    });
    if (existingProjectMember) {
      throw new BadRequestException('You are already a member of this project');
    }

    // Check no PENDING request already exists
    const existingRequest = await this.prisma.accessRequest.findFirst({
      where: { projectId, requesterId, type: 'PROJECT', status: 'PENDING' },
    });
    if (existingRequest) {
      throw new ConflictException('You already have a pending access request for this project');
    }

    return this.prisma.accessRequest.create({
      data: {
        type: 'PROJECT',
        orgId,
        projectId,
        requesterId,
        message: dto.message,
        status: 'PENDING',
      },
      include: {
        requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
        org: { select: { id: true, name: true, slug: true } },
        project: { select: { id: true, name: true } },
      },
    });
  }

  async listOrgRequests(orgId: string, status?: string) {
    const where: Record<string, unknown> = { orgId, type: 'ORG' };
    if (status) where['status'] = status;

    return this.prisma.accessRequest.findMany({
      where,
      include: {
        requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        org: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listProjectRequests(projectId: string, status?: string) {
    const where: Record<string, unknown> = { projectId, type: 'PROJECT' };
    if (status) where['status'] = status;

    return this.prisma.accessRequest.findMany({
      where,
      include: {
        requester: { select: { id: true, name: true, email: true, avatarUrl: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
        project: { select: { id: true, name: true } },
        org: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listMyRequests(userId: string) {
    return this.prisma.accessRequest.findMany({
      where: { requesterId: userId },
      include: {
        org: { select: { id: true, name: true, slug: true } },
        project: { select: { id: true, name: true } },
        reviewedBy: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async reviewRequest(
    requestId: string,
    reviewerId: string,
    dto: ReviewAccessRequestDto,
  ) {
    const request = await this.prisma.accessRequest.findUnique({
      where: { id: requestId },
    });
    if (!request) throw new NotFoundException('Access request not found');

    const updatedRequest = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.accessRequest.update({
        where: { id: requestId },
        data: {
          status: dto.action,
          reviewedById: reviewerId,
          reviewedAt: new Date(),
          grantedRole: dto.grantedRole ?? null,
          reviewerNote: dto.reviewerNote ?? null,
        },
        include: {
          requester: { select: { id: true, name: true, email: true } },
          org: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
        },
      });

      if (dto.action === 'APPROVED') {
        if (request.type === 'ORG') {
          const role = (dto.grantedRole as OrgRole) ?? OrgRole.ORG_MEMBER;
          // Check if already a member (idempotent)
          const existing = await tx.orgMember.findUnique({
            where: { orgId_userId: { orgId: request.orgId, userId: request.requesterId } },
          });
          if (!existing) {
            await tx.orgMember.create({
              data: {
                orgId: request.orgId,
                userId: request.requesterId,
                role,
              },
            });
          }
        } else if (request.type === 'PROJECT' && request.projectId) {
          const role = (dto.grantedRole as ProjectRole) ?? ProjectRole.QA_ENGINEER;
          // Check if already a project member (idempotent)
          const existing = await tx.projectMember.findUnique({
            where: { projectId_userId: { projectId: request.projectId, userId: request.requesterId } },
          });
          if (!existing) {
            await tx.projectMember.create({
              data: {
                projectId: request.projectId,
                userId: request.requesterId,
                role,
              },
            });
          }
        }
      }

      return updated;
    });

    return updatedRequest;
  }
}
