import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { OrganisationsService } from '../organisations.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { EmailService } from '../../../email/email.service';
import { AuditService } from '../../audit/audit.service';
import { AuthService } from '../../auth/auth.service';

/**
 * Org-admin member lifecycle (suspend / reactivate / password-reset).
 * The guard logic is the whole point: account status is platform-level, so an
 * org admin may only touch a sole-org member, never the owner or last admin,
 * and only across valid status transitions.
 */
const ORG = 'org-1';
const ADMIN = 'admin-1'; // the acting org admin
const TARGET = 'user-2'; // the member being acted on

const mockPrisma = {
  organisation: { findUnique: jest.fn() },
  orgMember: { findUnique: jest.fn(), count: jest.fn(), findMany: jest.fn(), groupBy: jest.fn() },
  user: { update: jest.fn() },
};
const mockAudit = { log: jest.fn() };
const mockAuth = { requestPasswordReset: jest.fn().mockResolvedValue(undefined) };

const membership = (accountStatus: string, role = 'ORG_MEMBER') => ({
  orgId: ORG,
  userId: TARGET,
  role,
  user: { id: TARGET, email: 'm@x.test', name: 'Member', accountStatus },
});

async function build(): Promise<OrganisationsService> {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      OrganisationsService,
      { provide: PrismaService, useValue: mockPrisma },
      { provide: EmailService, useValue: {} },
      { provide: AuditService, useValue: mockAudit },
      { provide: AuthService, useValue: mockAuth },
    ],
  }).compile();
  return module.get(OrganisationsService);
}

describe('OrganisationsService — member lifecycle', () => {
  let service: OrganisationsService;

  beforeEach(async () => {
    jest.clearAllMocks();
    // Defaults: single-org member, not owner, plenty of admins.
    mockPrisma.orgMember.count.mockResolvedValue(0); // other-org memberships = 0 (sole-org)
    mockPrisma.organisation.findUnique.mockResolvedValue({ ownerId: 'someone-else' });
    mockPrisma.user.update.mockImplementation(({ data }: { data: { accountStatus: string } }) =>
      Promise.resolve({ id: TARGET, email: 'm@x.test', name: 'Member', accountStatus: data.accountStatus }),
    );
    service = await build();
  });

  describe('suspendMember', () => {
    it('suspends an ACTIVE sole-org member and audits the transition', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('ACTIVE'));
      const r = await service.suspendMember(ORG, TARGET, ADMIN);
      expect(r.accountStatus).toBe('SUSPENDED');
      expect(mockPrisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: TARGET }, data: { accountStatus: 'SUSPENDED' } }),
      );
      expect(mockAudit.log).toHaveBeenCalledWith(
        ADMIN, 'org.member.suspended', 'User', TARGET,
        { accountStatus: 'ACTIVE' }, { accountStatus: 'SUSPENDED' }, { orgId: ORG },
      );
    });

    it('404s when the target is not a member of this org', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(null);
      await expect(service.suspendMember(ORG, TARGET, ADMIN)).rejects.toThrow(NotFoundException);
    });

    it('refuses a member who also belongs to another org (cross-org safety)', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('ACTIVE'));
      mockPrisma.orgMember.count.mockResolvedValue(1); // one OTHER-org membership
      await expect(service.suspendMember(ORG, TARGET, ADMIN)).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses suspending yourself', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue({ ...membership('ACTIVE'), userId: ADMIN, user: { id: ADMIN, email: 'a@x.test', name: 'Admin', accountStatus: 'ACTIVE' } });
      await expect(service.suspendMember(ORG, ADMIN, ADMIN)).rejects.toThrow(ForbiddenException);
    });

    it('refuses suspending the org owner', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('ACTIVE'));
      mockPrisma.organisation.findUnique.mockResolvedValue({ ownerId: TARGET });
      await expect(service.suspendMember(ORG, TARGET, ADMIN)).rejects.toThrow(ForbiddenException);
    });

    it('refuses suspending the last remaining admin', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('ACTIVE', 'ORG_ADMIN'));
      // count is used twice: first for other-org memberships (0), then admin count (1)
      mockPrisma.orgMember.count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
      await expect(service.suspendMember(ORG, TARGET, ADMIN)).rejects.toThrow(ForbiddenException);
    });

    it('is a no-op when already suspended', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('SUSPENDED'));
      const r = await service.suspendMember(ORG, TARGET, ADMIN);
      expect(r.accountStatus).toBe('SUSPENDED');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to suspend a non-ACTIVE (e.g. pending) account', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('PENDING_APPROVAL'));
      await expect(service.suspendMember(ORG, TARGET, ADMIN)).rejects.toThrow(BadRequestException);
    });
  });

  describe('reactivateMember', () => {
    it('reactivates a SUSPENDED sole-org member', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('SUSPENDED'));
      const r = await service.reactivateMember(ORG, TARGET, ADMIN);
      expect(r.accountStatus).toBe('ACTIVE');
      expect(mockAudit.log).toHaveBeenCalledWith(
        ADMIN, 'org.member.reactivated', 'User', TARGET,
        { accountStatus: 'SUSPENDED' }, { accountStatus: 'ACTIVE' }, { orgId: ORG },
      );
    });

    it('reactivates a DEACTIVATED member', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('DEACTIVATED'));
      const r = await service.reactivateMember(ORG, TARGET, ADMIN);
      expect(r.accountStatus).toBe('ACTIVE');
    });

    it('refuses a member who also belongs to another org', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('SUSPENDED'));
      mockPrisma.orgMember.count.mockResolvedValue(1);
      await expect(service.reactivateMember(ORG, TARGET, ADMIN)).rejects.toThrow(ForbiddenException);
    });

    it('is a no-op when already active', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('ACTIVE'));
      const r = await service.reactivateMember(ORG, TARGET, ADMIN);
      expect(r.accountStatus).toBe('ACTIVE');
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('refuses to reactivate a pending (onboarding) account — would skip verification/approval', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(membership('PENDING_ACTIVATION'));
      await expect(service.reactivateMember(ORG, TARGET, ADMIN)).rejects.toThrow(BadRequestException);
    });
  });

  describe('sendMemberPasswordReset', () => {
    it('triggers the reset flow with the member email and audits', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue({ orgId: ORG, userId: TARGET, user: { email: 'm@x.test', name: 'Member' } });
      const r = await service.sendMemberPasswordReset(ORG, TARGET, ADMIN);
      expect(mockAuth.requestPasswordReset).toHaveBeenCalledWith('m@x.test');
      expect(mockAudit.log).toHaveBeenCalledWith(
        ADMIN, 'org.member.password_reset_sent', 'User', TARGET, undefined, { email: 'm@x.test' }, { orgId: ORG },
      );
      expect(r.message).toContain('m@x.test');
    });

    it('404s for a non-member', async () => {
      mockPrisma.orgMember.findUnique.mockResolvedValue(null);
      await expect(service.sendMemberPasswordReset(ORG, TARGET, ADMIN)).rejects.toThrow(NotFoundException);
      expect(mockAuth.requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  describe('getMembers sole-org flag', () => {
    it('marks members in one org true and multi-org members false', async () => {
      mockPrisma.orgMember.findMany.mockResolvedValue([
        { userId: 'sole', role: 'ORG_MEMBER', user: { id: 'sole' } },
        { userId: 'multi', role: 'ORG_MEMBER', user: { id: 'multi' } },
      ]);
      mockPrisma.orgMember.groupBy.mockResolvedValue([
        { userId: 'sole', _count: { userId: 1 } },
        { userId: 'multi', _count: { userId: 3 } },
      ]);
      const r = await service.getMembers(ORG);
      expect(r.find(m => m.userId === 'sole')?.isSoleOrgMember).toBe(true);
      expect(r.find(m => m.userId === 'multi')?.isSoleOrgMember).toBe(false);
    });
  });
});
