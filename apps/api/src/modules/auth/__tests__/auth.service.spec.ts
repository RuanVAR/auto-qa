import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';
import { EmailService } from '../../../email/email.service';
import { TokenService } from '../token.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  name: 'Test User',
  passwordHash: '',
  role: 'ENGINEER' as const,
  platformRole: 'USER' as const,
  accountStatus: 'ACTIVE' as const,
  lastActiveOrgId: 'org-1',
  orgMemberships: [{ orgId: 'org-1', role: 'ORG_MEMBER', org: { id: 'org-1', name: 'Test Org' } }],
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockOrg = { id: 'org-1', name: 'Test Org', slug: 'test-org', ownerId: 'user-1' };

const mockPrisma = {
  user: {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  organisation: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  orgMember: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
  orgInvite: {
    findUnique: jest.fn(),
    update: jest.fn(),
  },
  userSsoAccount: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  projectMember: {
    upsert: jest.fn(),
  },
  platformConfig: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
};

// Side-effect-free stubs so the AuthService DI graph resolves under jest.
// AuthService dispatches activation emails + refresh-token rotation but the
// tests don't care about either; we just need the providers to exist.
const mockEmail = {
  sendWelcomePending: jest.fn(),
  sendAccountApproved: jest.fn(),
  sendPasswordReset: jest.fn(),
  sendEmailVerification: jest.fn(),
};

const mockTokens = {
  issuePair: jest
    .fn()
    .mockResolvedValue({ accessToken: 'mock-jwt-token', refreshToken: 'refresh-mock' }),
  revokeAllForUser: jest.fn().mockResolvedValue(undefined),
  isAccessTokenRevoked: jest.fn().mockResolvedValue(false),
  blacklistAccessToken: jest.fn().mockResolvedValue(undefined),
};

// Precomputed bcrypt hash of 'password123' with 12 rounds. Re-hashing in
// beforeEach (or even beforeAll) flaked when this suite ran alongside the
// rest of the API tests — 13 jest workers competing for CPU pushed each
// hash past the 5000ms hook timeout. The value is static; bake it in.
//
// Verify offline with:
//   node -e "console.log(require('bcryptjs').hashSync('password123', 12))"
const STATIC_PASSWORD_HASH = '$2a$12$EcUJSoJXpYj8sF8Y6AFAjehZhB885beX6Q2mya4MKKbXERc0Fr90S';

describe('AuthService', () => {
  let service: AuthService;

  beforeAll(() => {
    mockUser.passwordHash = STATIC_PASSWORD_HASH;
  });

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
        { provide: EmailService, useValue: mockEmail },
        { provide: TokenService, useValue: mockTokens },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('throws BadRequestException when orgName is missing', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      await expect(
        service.register({ email: 'test@example.com', name: 'Test User', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);
      await expect(
        service.register({ email: 'test@example.com', name: 'Test', password: 'pass123', orgName: 'My Org' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user + org and returns token when approval is disabled', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organisation.findUnique.mockResolvedValue(null);
      mockPrisma.platformConfig.findFirst.mockResolvedValue({ key: 'requireRegistrationApproval', value: 'false' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const result = await fn(mockPrisma);
        return result;
      });
      mockPrisma.user.create.mockResolvedValue({ ...mockUser });
      mockPrisma.organisation.create.mockResolvedValue(mockOrg);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
        orgName: 'Test Org',
      });

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
    });

    it('requires approval by default when approval config is absent', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.user.findUnique.mockResolvedValue(null);
      mockPrisma.organisation.findUnique.mockResolvedValue(null);
      mockPrisma.platformConfig.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => {
        const result = await fn(mockPrisma);
        return result;
      });
      mockPrisma.user.create.mockResolvedValue({ ...mockUser, accountStatus: 'PENDING_APPROVAL' });
      mockPrisma.organisation.create.mockResolvedValue(mockOrg);
      mockPrisma.user.update.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'test@example.com',
        name: 'Test User',
        password: 'password123',
        orgName: 'Test Org',
      });

      expect(result).toEqual({
        requiresApproval: true,
        message: 'Your account has been created and is pending approval by a platform administrator.',
      });
    });
  });

  describe('login', () => {
    it('returns a token for valid credentials', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
    });

    it('throws UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      mockPrisma.user.findFirst.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for suspended user', async () => {
      mockPrisma.user.findFirst.mockResolvedValue({ ...mockUser, accountStatus: 'SUSPENDED' });

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('acceptInviteViaSso', () => {
    const futureDate = new Date(Date.now() + 60 * 60 * 1000);
    const baseInvite = {
      id: 'inv-1',
      token: 'invite-token',
      email: 'invitee@example.com',
      role: 'ORG_MEMBER',
      orgId: 'org-1',
      status: 'PENDING',
      expiresAt: futureDate,
      projectAssignments: [],
    };
    const ssoProfile = {
      inviteToken: 'invite-token',
      provider: 'MICROSOFT',
      providerId: 'ms-123',
      email: 'invitee@example.com',
      name: 'Invited User',
    };

    it('rejects when the invite token does not exist', async () => {
      mockPrisma.orgInvite.findUnique.mockResolvedValue(null);
      await expect(service.acceptInviteViaSso(ssoProfile)).rejects.toThrow(ForbiddenException);
    });

    it('rejects when the invite is no longer PENDING', async () => {
      mockPrisma.orgInvite.findUnique.mockResolvedValue({ ...baseInvite, status: 'ACCEPTED' });
      await expect(service.acceptInviteViaSso(ssoProfile)).rejects.toThrow(ForbiddenException);
    });

    it('rejects (security) when the IdP email does not match the invite email', async () => {
      mockPrisma.orgInvite.findUnique.mockResolvedValue(baseInvite);
      await expect(
        service.acceptInviteViaSso({ ...ssoProfile, email: 'someone-else@evil.com' }),
      ).rejects.toThrow(ForbiddenException);
      // Must never create a user / consume the invite on a mismatch.
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when the SSO identity is already linked to another user', async () => {
      mockPrisma.orgInvite.findUnique.mockResolvedValue(baseInvite);
      mockPrisma.userSsoAccount.findUnique.mockResolvedValue({ userId: 'other-user', providerId: 'ms-123' });
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      mockPrisma.user.findFirst.mockResolvedValue(null); // no user with the invite email
      await expect(service.acceptInviteViaSso(ssoProfile)).rejects.toThrow(ConflictException);
    });

    it('creates an ACTIVE user, links the provider, and returns a token for a valid new-user invite', async () => {
      mockPrisma.orgInvite.findUnique.mockResolvedValue(baseInvite);
      mockPrisma.userSsoAccount.findUnique.mockResolvedValue(null);
      mockPrisma.user.findFirst.mockResolvedValue(null);
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: typeof mockPrisma) => Promise<unknown>) => fn(mockPrisma));
      const created = { id: 'new-user', email: 'invitee@example.com', platformRole: 'USER', lastActiveOrgId: 'org-1' };
      mockPrisma.user.create.mockResolvedValue(created);
      mockPrisma.userSsoAccount.create.mockResolvedValue({});
      mockPrisma.orgMember.upsert.mockResolvedValue({});
      mockPrisma.orgInvite.update.mockResolvedValue({});

      const result = await service.acceptInviteViaSso(ssoProfile);

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
      expect(mockPrisma.user.create).toHaveBeenCalled();
      expect(mockPrisma.userSsoAccount.create).toHaveBeenCalled();
      expect(mockPrisma.orgInvite.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
      );
    });
  });

  describe('me', () => {
    it('returns user profile by id', async () => {
      const profile = {
        id: 'user-1',
        email: 'test@example.com',
        name: 'Test User',
        platformRole: 'USER',
        accountStatus: 'ACTIVE',
        lastActiveOrgId: 'org-1',
        orgMemberships: [],
        createdAt: new Date(),
      };
      mockPrisma.user.findUnique.mockResolvedValue(profile);

      const result = await service.me('user-1');

      expect(result).toEqual(profile);
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        select: expect.objectContaining({ id: true, email: true }),
      });
    });
  });
});
