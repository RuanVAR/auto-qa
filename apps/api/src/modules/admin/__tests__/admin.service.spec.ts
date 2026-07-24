import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { AdminService } from '../admin.service';
import { EmailService } from '../../../email/email.service';
import { OrganisationsService } from '../../organisations/organisations.service';
import { AuthService } from '../../auth/auth.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const mockOrgs = { inviteMember: jest.fn() };
const mockAuth = { requestPasswordReset: jest.fn().mockResolvedValue(undefined) };

// ── Mock fixtures ────────────────────────────────────────────────────────────

const mockOrg = {
  id: 'org-1',
  name: 'Acme Corp',
  slug: 'acme-corp',
  logoUrl: null,
  website: null,
  description: null,
  isActive: true,
  deletedAt: null,
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
  ownerId: 'user-1',
  ssoDomain: null,
  ssoEnforced: false,
  allowedSsoDomains: [],
  members: [
    {
      id: 'mem-1',
      role: 'ORG_ADMIN',
      joinedAt: new Date('2024-01-01'),
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      orgId: 'org-1',
      userId: 'user-1',
      user: {
        id: 'user-1',
        name: 'Alice',
        email: 'alice@acme.com',
        avatarUrl: null,
        accountStatus: 'ACTIVE',
        createdAt: new Date('2024-01-01'),
      },
    },
    {
      id: 'mem-2',
      role: 'ORG_MEMBER',
      joinedAt: new Date('2024-02-01'),
      createdAt: new Date('2024-02-01'),
      updatedAt: new Date('2024-02-01'),
      orgId: 'org-1',
      userId: 'user-2',
      user: {
        id: 'user-2',
        name: 'Bob',
        email: 'bob@acme.com',
        avatarUrl: null,
        accountStatus: 'ACTIVE',
        createdAt: new Date('2024-02-01'),
      },
    },
  ],
  projects: [
    {
      id: 'proj-1',
      name: 'Web App',
      slug: 'web-app',
      _count: { modules: 3, testDefinitions: 12, runs: 50 },
    },
    {
      id: 'proj-2',
      name: 'Mobile App',
      slug: 'mobile-app',
      _count: { modules: 2, testDefinitions: 8, runs: 20 },
    },
  ],
};

const mockPrisma = {
  user: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
  },
  organisation: {
    count: jest.fn(),
    findMany: jest.fn(),
    findUnique: jest.fn(),
    findUniqueOrThrow: jest.fn(),
    create: jest.fn(),
  },
  project: {
    count: jest.fn(),
  },
  testRun: {
    count: jest.fn(),
  },
  platformConfig: {
    findMany: jest.fn(),
    findUnique: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
};

// ── Test suite ────────────────────────────────────────────────────────────────

describe('AdminService', () => {
  let service: AdminService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: PrismaService, useValue: mockPrisma },
        // AdminService dispatches approval / suspension emails via
        // EmailService — none of the read-side tests exercise that
        // surface so jest-fn stubs are enough to satisfy DI.
        { provide: EmailService, useValue: { sendAccountApproved: jest.fn(), sendApprovalRejected: jest.fn(), sendAccountSuspended: jest.fn() } },
        { provide: OrganisationsService, useValue: mockOrgs },
        { provide: AuthService, useValue: mockAuth },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
  });

  describe('sendUserPasswordReset', () => {
    it('looks up the user and triggers the reset flow with their email', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ email: 'u@x.test' });
      const r = await service.sendUserPasswordReset('user-1');
      expect(mockAuth.requestPasswordReset).toHaveBeenCalledWith('u@x.test');
      expect(r.message).toContain('u@x.test');
    });

    it('404s for an unknown user and does not send', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(service.sendUserPasswordReset('ghost')).rejects.toThrow(NotFoundException);
      expect(mockAuth.requestPasswordReset).not.toHaveBeenCalled();
    });
  });

  // ── getPlatformStats ────────────────────────────────────────────────────────

  describe('getPlatformStats', () => {
    it('returns aggregated platform-wide stats', async () => {
      mockPrisma.user.count
        .mockResolvedValueOnce(100)   // totalUsers
        .mockResolvedValueOnce(80)    // activeUsers
        .mockResolvedValueOnce(5);    // pendingApproval
      mockPrisma.organisation.count.mockResolvedValue(10);
      mockPrisma.project.count.mockResolvedValue(25);

      const result = await service.getPlatformStats();

      expect(result).toEqual({
        totalUsers: 100,
        activeUsers: 80,
        pendingApproval: 5,
        totalOrgs: 10,
        totalProjects: 25,
      });
      expect(mockPrisma.user.count).toHaveBeenCalledTimes(3);
    });
  });

  // ── getOrgDetail ────────────────────────────────────────────────────────────

  describe('getOrgDetail', () => {
    it('returns org with computed stats', async () => {
      mockPrisma.organisation.findUniqueOrThrow.mockResolvedValue(mockOrg);
      mockPrisma.testRun.count.mockResolvedValue(2);

      const result = await service.getOrgDetail('org-1');

      expect(result.id).toBe('org-1');
      expect(result.stats.totalMembers).toBe(2);
      expect(result.stats.totalProjects).toBe(2);
      expect(result.stats.totalModules).toBe(5);   // 3 + 2
      expect(result.stats.totalTestCases).toBe(20); // 12 + 8
      expect(result.stats.activeRuns).toBe(2);
    });

    it('queries testRun.count with PENDING and RUNNING statuses scoped to org', async () => {
      mockPrisma.organisation.findUniqueOrThrow.mockResolvedValue(mockOrg);
      mockPrisma.testRun.count.mockResolvedValue(0);

      await service.getOrgDetail('org-1');

      expect(mockPrisma.testRun.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            project: { orgId: 'org-1' },
            status: { in: ['PENDING', 'RUNNING'] },
          }),
        }),
      );
    });

    it('returns stats.totalMembers as 0 when org has no members', async () => {
      mockPrisma.organisation.findUniqueOrThrow.mockResolvedValue({ ...mockOrg, members: [], projects: [] });
      mockPrisma.testRun.count.mockResolvedValue(0);

      const result = await service.getOrgDetail('org-1');

      expect(result.stats.totalMembers).toBe(0);
      expect(result.stats.totalProjects).toBe(0);
      expect(result.stats.totalModules).toBe(0);
      expect(result.stats.totalTestCases).toBe(0);
    });
  });

  // ── listOrgs ────────────────────────────────────────────────────────────────

  describe('listOrgs', () => {
    it('returns paginated orgs with total', async () => {
      const orgSummary = { ...mockOrg, _count: { members: 2, projects: 2 } };
      mockPrisma.organisation.findMany.mockResolvedValue([orgSummary]);
      mockPrisma.organisation.count.mockResolvedValue(1);

      const result = await service.listOrgs(1, 50);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('applies pagination offset', async () => {
      mockPrisma.organisation.findMany.mockResolvedValue([]);
      mockPrisma.organisation.count.mockResolvedValue(100);

      await service.listOrgs(3, 10);

      expect(mockPrisma.organisation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('filters out soft-deleted orgs', async () => {
      mockPrisma.organisation.findMany.mockResolvedValue([]);
      mockPrisma.organisation.count.mockResolvedValue(0);

      await service.listOrgs();

      expect(mockPrisma.organisation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { deletedAt: null } }),
      );
    });
  });

  // ── listUsers ───────────────────────────────────────────────────────────────

  describe('listUsers', () => {
    const mockUsers = [
      {
        id: 'user-1',
        email: 'alice@acme.com',
        name: 'Alice',
        role: 'ENGINEER',
        platformRole: 'USER',
        accountStatus: 'ACTIVE',
        createdAt: new Date('2024-01-01'),
        lastActiveOrgId: 'org-1',
        orgMemberships: [],
      },
    ];

    it('returns paginated users with total', async () => {
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(1);

      const result = await service.listUsers(1, 50);

      expect(result.items).toHaveLength(1);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });

    it('filters by accountStatus when provided', async () => {
      mockPrisma.user.findMany.mockResolvedValue([]);
      mockPrisma.user.count.mockResolvedValue(0);

      await service.listUsers(1, 50, 'PENDING_APPROVAL' as never);

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { accountStatus: 'PENDING_APPROVAL' } }),
      );
    });

    it('uses empty where clause when no status filter', async () => {
      mockPrisma.user.findMany.mockResolvedValue(mockUsers);
      mockPrisma.user.count.mockResolvedValue(1);

      await service.listUsers();

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });

  // ── createOrg ───────────────────────────────────────────────────────────────
  describe('createOrg', () => {
    beforeEach(() => {
      mockPrisma.organisation.findUnique.mockResolvedValue(null); // slug free
      mockPrisma.organisation.create.mockResolvedValue({ id: 'org-new', name: 'Acme', slug: 'acme' });
    });

    it('existing-user owner → org seeded with an ORG_ADMIN membership, no invite', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-9' });
      const res = await service.createOrg('admin-1', { name: 'Acme', ownerEmail: 'owner@acme.com' });
      expect(res).toEqual({ id: 'org-new', name: 'Acme', slug: 'acme' });
      const createArg = mockPrisma.organisation.create.mock.calls[0][0];
      expect(createArg.data.ownerId).toBe('user-9');
      expect(createArg.data.members.create).toEqual({ userId: 'user-9', role: 'ORG_ADMIN' });
      expect(mockOrgs.inviteMember).not.toHaveBeenCalled();
    });

    it('unknown owner email → org owned by the admin + an ORG_ADMIN invite is sent', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await service.createOrg('admin-1', { name: 'Acme', ownerEmail: 'new@acme.com' });
      const createArg = mockPrisma.organisation.create.mock.calls[0][0];
      expect(createArg.data.ownerId).toBe('admin-1');
      expect(createArg.data.members).toBeUndefined();
      expect(mockOrgs.inviteMember).toHaveBeenCalledWith('org-new', 'admin-1', { email: 'new@acme.com', role: 'ORG_ADMIN' });
    });

    it('appends a numeric suffix when the slug is taken', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-9' });
      // First slug check: taken; second: free.
      mockPrisma.organisation.findUnique
        .mockResolvedValueOnce({ id: 'x' })
        .mockResolvedValueOnce(null);
      await service.createOrg('admin-1', { name: 'Acme', ownerEmail: 'owner@acme.com' });
      expect(mockPrisma.organisation.create.mock.calls[0][0].data.slug).toBe('acme-2');
    });
  });
});
