import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrgRole, ProjectRole, Prisma } from '@prisma/client';
import { InviteMemberDto } from './dto/invite-member.dto';
import { EmailService } from '../../email/email.service';

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
  ) {}

  async getOrg(orgId: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { id: orgId },
      include: {
        members: {
          include: {
            user: {
              select: { id: true, name: true, email: true, avatarUrl: true, accountStatus: true },
            },
          },
        },
        _count: { select: { projects: true } },
      },
    });
    if (!org) throw new NotFoundException('Organisation not found');
    return org;
  }

  async updateOrg(orgId: string, data: Partial<{ name: string; description: string; website: string; logoUrl: string }>) {
    return this.prisma.organisation.update({ where: { id: orgId }, data });
  }

  async getMembers(orgId: string) {
    return this.prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, accountStatus: true, createdAt: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
  }

  async inviteMember(orgId: string, invitedById: string, dto: InviteMemberDto) {
    // Check user isn't already a member
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      const membership = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: existing.id } },
      });
      if (membership) throw new ConflictException('User is already a member of this organisation.');
    }

    // Check for pending invite
    const pendingInvite = await this.prisma.orgInvite.findFirst({
      where: { orgId, email: dto.email, status: 'PENDING' },
    });
    if (pendingInvite) throw new ConflictException('An invite is already pending for this email.');

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Validate any pre-scoped project assignments belong to this org and the
    // env IDs belong to those projects — fail fast rather than discover
    // inconsistencies at accept time when the user is already onboarding.
    if (dto.projectAssignments && dto.projectAssignments.length > 0) {
      const projectIds = dto.projectAssignments.map(a => a.projectId);
      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds }, orgId },
        select: { id: true },
      });
      if (projects.length !== projectIds.length) {
        throw new ConflictException('One or more projectIds do not belong to this organisation');
      }
      for (const a of dto.projectAssignments) {
        if (a.allowedEnvironmentIds && a.allowedEnvironmentIds.length > 0) {
          const envCount = await this.prisma.environment.count({
            where: { id: { in: a.allowedEnvironmentIds }, projectId: a.projectId },
          });
          if (envCount !== a.allowedEnvironmentIds.length) {
            throw new ConflictException(`envIds in assignment for project ${a.projectId} are not all valid`);
          }
        }
      }
    }

    const invite = await this.prisma.orgInvite.create({
      data: {
        orgId,
        email: dto.email,
        role: dto.role ?? OrgRole.ORG_MEMBER,
        invitedById,
        expiresAt,
        ...(dto.projectAssignments?.length
          ? { projectAssignments: dto.projectAssignments as object as Prisma.InputJsonValue }
          : {}),
      },
      include: { org: { select: { name: true } } },
    });

    // Resolve a human-readable summary of project assignments + the inviter
    // name so the email body has context. Fire-and-forget — the invite is
    // already persisted, no need to block on email delivery.
    const inviter = await this.prisma.user.findUnique({
      where: { id: invitedById }, select: { name: true },
    });
    let assignmentsSummary: string | undefined;
    if (dto.projectAssignments?.length) {
      const projectIds = dto.projectAssignments.map(a => a.projectId);
      const projects = await this.prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: { id: true, name: true },
      });
      const byId = new Map(projects.map(p => [p.id, p.name]));
      assignmentsSummary = dto.projectAssignments
        .map(a => `${byId.get(a.projectId) ?? a.projectId} (${a.role}${a.allowedEnvironmentIds?.length ? `, ${a.allowedEnvironmentIds.length} env(s)` : ''})`)
        .join('; ');
    }
    const acceptUrl = `${process.env.WEB_URL ?? 'http://localhost:3000'}/invites/${invite.token}/accept`;
    this.email.sendMemberInvite(dto.email, {
      inviterName: inviter?.name ?? 'A team member',
      orgName: invite.org.name,
      acceptUrl,
      projectAssignmentsSummary: assignmentsSummary,
    });

    return invite;
  }

  async acceptInvite(token: string, userId: string) {
    const invite = await this.prisma.orgInvite.findUnique({ where: { token } });
    if (!invite) throw new NotFoundException('Invite not found.');
    if (invite.status !== 'PENDING') throw new ForbiddenException('This invite is no longer valid.');
    if (invite.expiresAt < new Date()) {
      await this.prisma.orgInvite.update({ where: { id: invite.id }, data: { status: 'EXPIRED' } });
      throw new ForbiddenException('This invite has expired.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.email !== invite.email) {
      throw new ForbiddenException('This invite was sent to a different email address.');
    }

    // Decode pre-scoped project assignments (if any) — applied atomically
    // alongside org membership so an invite always lands the user in a
    // ready-to-test state without admin follow-up.
    const assignments = (invite.projectAssignments ?? []) as unknown as {
      projectId: string;
      role: ProjectRole;
      allowedEnvironmentIds?: string[];
    }[];

    await this.prisma.$transaction([
      this.prisma.orgMember.create({
        data: { orgId: invite.orgId, userId, role: invite.role },
      }),
      ...assignments.map(a => this.prisma.projectMember.upsert({
        where: { projectId_userId: { projectId: a.projectId, userId } },
        update: { role: a.role, allowedEnvironmentIds: a.allowedEnvironmentIds ?? [] },
        create: {
          projectId: a.projectId,
          userId,
          role: a.role,
          allowedEnvironmentIds: a.allowedEnvironmentIds ?? [],
        },
      })),
      this.prisma.orgInvite.update({
        where: { id: invite.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      }),
    ]);

    return {
      message: 'Invite accepted. You are now a member of the organisation.',
      projectsJoined: assignments.length,
    };
  }

  async removeMember(orgId: string, targetUserId: string, requestingUserId: string) {
    const org = await this.prisma.organisation.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organisation not found');

    // Cannot remove the org owner
    if (org.ownerId === targetUserId) {
      throw new ForbiddenException('Cannot remove the organisation owner.');
    }

    // Cannot remove yourself if you are the last admin
    const admins = await this.prisma.orgMember.count({ where: { orgId, role: 'ORG_ADMIN' } });
    if (targetUserId === requestingUserId && admins <= 1) {
      throw new ForbiddenException('You cannot leave the organisation as the only admin.');
    }

    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    return { message: 'Member removed from organisation.' };
  }

  async updateMemberRole(orgId: string, targetUserId: string, role: OrgRole) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Membership not found.');
    return this.prisma.orgMember.update({
      where: { id: membership.id },
      data: { role },
    });
  }

  async listInvites(orgId: string) {
    return this.prisma.orgInvite.findMany({
      where: { orgId, status: 'PENDING' },
      include: { invitedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancelInvite(inviteId: string, orgId: string) {
    const invite = await this.prisma.orgInvite.findFirst({ where: { id: inviteId, orgId } });
    if (!invite) throw new NotFoundException('Invite not found.');
    return this.prisma.orgInvite.update({ where: { id: inviteId }, data: { status: 'CANCELLED' } });
  }
}
