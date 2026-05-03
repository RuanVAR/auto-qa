import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from '../auth.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';

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
    create: jest.fn(),
    update: jest.fn(),
  },
  organisation: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
  orgMember: {
    findUnique: jest.fn(),
  },
  platformConfig: {
    findFirst: jest.fn(),
  },
  $transaction: jest.fn(),
};

const mockJwt = {
  sign: jest.fn().mockReturnValue('mock-jwt-token'),
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    mockUser.passwordHash = await bcrypt.hash('password123', 12);
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: JwtService, useValue: mockJwt },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  describe('register', () => {
    it('throws BadRequestException when orgName is missing', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);
      await expect(
        service.register({ email: 'test@example.com', name: 'Test User', password: 'password123' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('throws ConflictException when email already exists', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      await expect(
        service.register({ email: 'test@example.com', name: 'Test', password: 'pass123', orgName: 'My Org' }),
      ).rejects.toThrow(ConflictException);
    });

    it('creates user + org and returns token when approval is disabled', async () => {
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
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const result = await service.login({
        email: 'test@example.com',
        password: 'password123',
      });

      expect(result).toHaveProperty('accessToken', 'mock-jwt-token');
    });

    it('throws UnauthorizedException for non-existent user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for wrong password', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.login({ email: 'test@example.com', password: 'wrongpassword' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException for suspended user', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ ...mockUser, accountStatus: 'SUSPENDED' });

      await expect(
        service.login({ email: 'test@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
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
