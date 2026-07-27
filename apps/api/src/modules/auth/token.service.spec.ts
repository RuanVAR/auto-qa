import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TokenService } from './token.service';

describe('TokenService.authenticateAccessToken', () => {
  const jwt = { verifyAsync: jest.fn() };
  const user = { findUnique: jest.fn() };
  const orgMember = { findUnique: jest.fn() };
  const prisma = { user, orgMember };
  let service: TokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TokenService(
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      {} as ConfigService,
    );
    jest.spyOn(service, 'isAccessTokenRevoked').mockResolvedValue(false);
    jwt.verifyAsync.mockResolvedValue({
      sub: 'user-1',
      email: 'stale@example.com',
      platformRole: 'USER',
      activeOrgId: 'org-1',
      orgRole: 'ORG_MEMBER',
      jti: 'jti-1',
    });
    user.findUnique.mockResolvedValue({
      email: 'current@example.com',
      platformRole: 'USER',
      accountStatus: 'ACTIVE',
    });
    orgMember.findUnique.mockResolvedValue({ role: 'ORG_ADMIN' });
  });

  it('returns canonical user data and live organisation membership', async () => {
    await expect(service.authenticateAccessToken('jwt')).resolves.toMatchObject({
      sub: 'user-1',
      email: 'current@example.com',
      activeOrgId: 'org-1',
      orgRole: 'ORG_ADMIN',
    });
    expect(jwt.verifyAsync).toHaveBeenCalledWith('jwt', {
      algorithms: ['HS256'],
    });
  });

  it('rejects a revoked access token', async () => {
    jest.spyOn(service, 'isAccessTokenRevoked').mockResolvedValue(true);

    await expect(service.authenticateAccessToken('jwt'))
      .rejects.toBeInstanceOf(UnauthorizedException);
    expect(user.findUnique).not.toHaveBeenCalled();
  });

  it('clears stale organisation context after membership removal', async () => {
    orgMember.findUnique.mockResolvedValue(null);

    await expect(service.authenticateAccessToken('jwt')).resolves.toMatchObject({
      activeOrgId: null,
      orgRole: null,
    });
  });
});
