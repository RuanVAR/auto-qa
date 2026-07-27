import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrgRole, ProjectRole, Prisma, AccountStatus } from '@prisma/client';
import { InviteMemberDto } from './dto/invite-member.dto';
import { EmailService } from '../../email/email.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { webUrl } from '../../common/config/urls';

@Injectable()
export class OrganisationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
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

  async updateOrg(orgId: string, data: Partial<{ name: string; description: string; website: string; logoUrl: string | null; primaryColor: string | null; ssoDomain: string | null; allowedSsoDomains: string[]; autoJoinEnabled: boolean }>) {
    return this.prisma.organisation.update({ where: { id: orgId }, data });
  }

  /**
   * Public, unauthenticated lookup used by the login/register pages to render
   * an org's own branding before the user has signed in. Returns ONLY cosmetic
   * fields (name + logo). Inactive / soft-deleted orgs are treated as not found
   * so they can't brand a login page.
   */
  async getPublicBranding(slug: string) {
    const org = await this.prisma.organisation.findUnique({
      where: { slug },
      select: { slug: true, name: true, logoUrl: true, primaryColor: true, isActive: true, deletedAt: true },
    });
    if (!org || !org.isActive || org.deletedAt) {
      throw new NotFoundException('Organisation not found');
    }
    return { slug: org.slug, name: org.name, logoUrl: org.logoUrl, primaryColor: org.primaryColor };
  }

  async getMembers(orgId: string) {
    const members = await this.prisma.orgMember.findMany({
      where: { orgId },
      include: {
        user: {
          select: { id: true, name: true, email: true, avatarUrl: true, accountStatus: true, createdAt: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });

    // Flag members who belong to THIS org only. Account-status changes are
    // platform-level (one status governs login to every org the user is in),
    // so an org admin may only flip status for a member with no other org —
    // the UI uses this to enable/disable the suspend/reactivate action, and
    // the service enforces it regardless (see setMemberAccountStatus).
    const userIds = members.map(m => m.userId);
    const membershipCounts = userIds.length
      ? await this.prisma.orgMember.groupBy({
          by: ['userId'],
          where: { userId: { in: userIds } },
          _count: { userId: true },
        })
      : [];
    const countByUser = new Map(membershipCounts.map(c => [c.userId, c._count.userId]));

    return members.map(m => ({
      ...m,
      isSoleOrgMember: (countByUser.get(m.userId) ?? 1) <= 1,
    }));
  }

  async inviteMember(orgId: string, invitedById: string, dto: InviteMemberDto) {
    const email = dto.email.trim().toLowerCase();
    let recipientType: 'EXISTING_USER' | 'NEW_USER' = 'NEW_USER';

    // Check user isn't already a member
    const existing = await this.prisma.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
    if (existing) {
      recipientType = 'EXISTING_USER';
      if (existing.accountStatus === 'SUSPENDED' || existing.accountStatus === 'DEACTIVATED') {
        throw new ConflictException('This user account is suspended/deactivated and cannot be invited.');
      }
      const membership = await this.prisma.orgMember.findUnique({
        where: { orgId_userId: { orgId, userId: existing.id } },
      });
      if (membership) throw new ConflictException('User is already a member of this organisation.');
    }

    // Check for pending invite
    const pendingInvite = await this.prisma.orgInvite.findFirst({
      where: { orgId, email: { equals: email, mode: 'insensitive' }, status: 'PENDING' },
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
        email,
        role: dto.role ?? OrgRole.ORG_MEMBER,
        invitedById,
        expiresAt,
        ...(dto.projectAssignments?.length
          ? { projectAssignments: dto.projectAssignments as object as Prisma.InputJsonValue }
          : {}),
      },
      include: { org: { select: { name: true, logoUrl: true } } },
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
    const acceptUrl = `${webUrl()}/invites/${invite.token}/accept`;
    this.email.sendMemberInvite(
      email,
      {
        inviterName: inviter?.name ?? 'A team member',
        orgName: invite.org.name,
        acceptUrl,
        projectAssignmentsSummary: assignmentsSummary,
      },
      { name: invite.org.name, logoUrl: invite.org.logoUrl },
    );

    return {
      ...invite,
      recipientType,
    };
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
    if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) {
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

    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Membership not found.');

    // Removing the last admin would leave the org orphaned — block it
    // regardless of whether the requester is targeting themselves.
    if (membership.role === 'ORG_ADMIN') {
      const admins = await this.prisma.orgMember.count({ where: { orgId, role: 'ORG_ADMIN' } });
      if (admins <= 1) {
        throw new ForbiddenException('Cannot remove the last admin of the organisation.');
      }
    }

    await this.prisma.orgMember.delete({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    await this.audit.log(
      requestingUserId,
      'org.member.removed',
      'OrgMember',
      membership.id,
      { orgId, userId: targetUserId, role: membership.role },
      undefined,
    );
    return { message: 'Member removed from organisation.' };
  }

  async updateMemberRole(orgId: string, targetUserId: string, role: OrgRole, requestingUserId?: string) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Membership not found.');
    if (membership.role === role) return membership;  // no-op

    // Demoting an admin? Make sure at least one admin remains. The check
    // covers self-demotion and demoting another admin equally — either
    // way, an org without an admin is bricked.
    if (membership.role === 'ORG_ADMIN' && role !== 'ORG_ADMIN') {
      const admins = await this.prisma.orgMember.count({ where: { orgId, role: 'ORG_ADMIN' } });
      if (admins <= 1) {
        throw new ForbiddenException('Cannot demote the last admin of the organisation.');
      }
    }

    const updated = await this.prisma.orgMember.update({
      where: { id: membership.id },
      data: { role },
    });
    await this.audit.log(
      requestingUserId ?? null,
      'org.member.role_changed',
      'OrgMember',
      membership.id,
      { orgId, userId: targetUserId, role: membership.role },
      { orgId, userId: targetUserId, role },
    );
    return updated;
  }

  /**
   * Shared guard for org-admin account-status changes. Confirms the target is
   * a member of this org and — because accountStatus is platform-level, not
   * per-org — that this is their ONLY org, so an org admin can never reach
   * into a user whose account is shared with another organisation. Returns
   * the membership + the user's current status for the caller to act on.
   */
  private async loadMemberForStatusChange(orgId: string, targetUserId: string, requestingUserId: string) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      include: { user: { select: { id: true, email: true, name: true, accountStatus: true } } },
    });
    if (!membership) throw new NotFoundException('Membership not found.');

    const otherMemberships = await this.prisma.orgMember.count({
      where: { userId: targetUserId, orgId: { not: orgId } },
    });
    if (otherMemberships > 0) {
      throw new ForbiddenException(
        'This member also belongs to other organisations. Only a platform admin can change their account status.',
      );
    }

    const org = await this.prisma.organisation.findUnique({ where: { id: orgId }, select: { ownerId: true } });
    return { membership, org, isOwner: org?.ownerId === targetUserId, isSelf: requestingUserId === targetUserId };
  }

  /**
   * Suspend a member's account (blocks their login). Org-admin action.
   * Guarded: not self, not the org owner, not the last remaining admin, and
   * only from an ACTIVE state — onboarding states (PENDING_*) aren't an
   * admin-suspension concern and DEACTIVATED is already blocked.
   */
  async suspendMember(orgId: string, targetUserId: string, requestingUserId: string) {
    const { membership, isOwner, isSelf } = await this.loadMemberForStatusChange(orgId, targetUserId, requestingUserId);
    if (isSelf) throw new ForbiddenException('You cannot suspend your own account.');
    if (isOwner) throw new ForbiddenException('Cannot suspend the organisation owner.');
    if (membership.role === 'ORG_ADMIN') {
      const admins = await this.prisma.orgMember.count({ where: { orgId, role: 'ORG_ADMIN' } });
      if (admins <= 1) throw new ForbiddenException('Cannot suspend the last admin of the organisation.');
    }
    if (membership.user.accountStatus === AccountStatus.SUSPENDED) return membership.user; // already suspended — no-op
    if (membership.user.accountStatus !== AccountStatus.ACTIVE) {
      throw new BadRequestException('Only active members can be suspended.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: AccountStatus.SUSPENDED },
      select: { id: true, email: true, name: true, accountStatus: true },
    });
    await this.audit.log(
      requestingUserId,
      'org.member.suspended',
      'User',
      targetUserId,
      { accountStatus: membership.user.accountStatus },
      { accountStatus: updated.accountStatus },
      { orgId },
    );
    return updated;
  }

  /**
   * Reactivate a suspended/deactivated member back to ACTIVE. Org-admin action.
   * Only valid from SUSPENDED or DEACTIVATED — reactivating a PENDING_* account
   * would skip email verification / platform approval, so those are refused.
   */
  async reactivateMember(orgId: string, targetUserId: string, requestingUserId: string) {
    const { membership } = await this.loadMemberForStatusChange(orgId, targetUserId, requestingUserId);
    const status = membership.user.accountStatus;
    if (status === AccountStatus.ACTIVE) return membership.user; // already active — no-op
    if (status !== AccountStatus.SUSPENDED && status !== AccountStatus.DEACTIVATED) {
      throw new BadRequestException('Only suspended or deactivated members can be reactivated.');
    }

    const updated = await this.prisma.user.update({
      where: { id: targetUserId },
      data: { accountStatus: AccountStatus.ACTIVE },
      select: { id: true, email: true, name: true, accountStatus: true },
    });
    await this.audit.log(
      requestingUserId,
      'org.member.reactivated',
      'User',
      targetUserId,
      { accountStatus: status },
      { accountStatus: updated.accountStatus },
      { orgId },
    );
    return updated;
  }

  /**
   * Send a member the standard password-reset email. Org-admin action for the
   * "they're locked out and can't self-serve" case. Reuses the auth reset flow
   * verbatim (30-min single-use token) — nothing sensitive is returned to the
   * admin; the link only ever reaches the member's inbox.
   */
  async sendMemberPasswordReset(orgId: string, targetUserId: string, requestingUserId: string) {
    const membership = await this.prisma.orgMember.findUnique({
      where: { orgId_userId: { orgId, userId: targetUserId } },
      include: { user: { select: { email: true, name: true } } },
    });
    if (!membership) throw new NotFoundException('Membership not found.');

    await this.auth.requestPasswordReset(membership.user.email);
    await this.audit.log(
      requestingUserId,
      'org.member.password_reset_sent',
      'User',
      targetUserId,
      undefined,
      { email: membership.user.email },
      { orgId },
    );
    return { message: `Password reset email sent to ${membership.user.email}.` };
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

  /**
   * Public preview of an invite token — no auth required.
   * Returns enough info for the accept page to decide whether to route the
   * visitor to /login (existing account) or /register (new user), and to
   * pre-populate the email on whichever form they land on.
   */
  async getInvitePreview(token: string) {
    const invite = await this.prisma.orgInvite.findUnique({
      where: { token },
      include: { org: { select: { name: true } } },
    });

    if (!invite) {
      return { valid: false as const, reason: 'not_found' };
    }
    if (invite.status === 'ACCEPTED') {
      return { valid: false as const, reason: 'already_accepted' };
    }
    if (invite.status === 'CANCELLED') {
      return { valid: false as const, reason: 'cancelled' };
    }
    if (invite.expiresAt < new Date()) {
      return { valid: false as const, reason: 'expired' };
    }
    if (invite.status !== 'PENDING') {
      return { valid: false as const, reason: 'invalid' };
    }

    const userExists = !!(await this.prisma.user.findFirst({
      where: { email: { equals: invite.email, mode: 'insensitive' } },
      select: { id: true },
    }));

    return {
      valid: true as const,
      email: invite.email,
      orgName: invite.org.name,
      role: invite.role,
      userExists,
    };
  }
}
