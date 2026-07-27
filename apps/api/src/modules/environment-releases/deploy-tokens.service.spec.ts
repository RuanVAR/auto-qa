import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DeployTokensService } from './deploy-tokens.service';

describe('DeployTokensService', () => {
  const prisma = {
    project: { findUnique: jest.fn() },
    environment: { count: jest.fn(), findFirst: jest.fn() },
    projectDeployToken: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  };
  const audit = { log: jest.fn() };
  let service: DeployTokensService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        DeployTokensService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();
    service = module.get(DeployTokensService);
  });

  it('returns a qadp token once and stores only its hash', async () => {
    prisma.project.findUnique.mockResolvedValue({ id: 'project-1', orgId: 'org-1' });
    prisma.environment.count.mockResolvedValue(1);
    prisma.projectDeployToken.create.mockImplementation(({ data }) => ({
      id: 'token-1',
      ...data,
      lastUsedAt: null,
      lastUsedIp: null,
      revokedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));
    audit.log.mockResolvedValue({});

    const result = await service.issue(
      'project-1',
      { name: 'deploy', allowedEnvironmentIds: ['11111111-1111-4111-8111-111111111111'] },
      'user-1',
      { orgId: 'org-1' },
    );

    expect(result.token).toMatch(/^qadp_/u);
    const stored = prisma.projectDeployToken.create.mock.calls[0][0].data;
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(stored.tokenHash).not.toContain(result.token);
  });

  it('rejects cross-project and environment-out-of-scope use', async () => {
    prisma.projectDeployToken.findUnique.mockResolvedValue({
      id: 'token-1',
      orgId: 'org-1',
      projectId: 'project-2',
      allowedEnvironmentIds: [],
      expiresAt: null,
      revokedAt: null,
      deletedAt: null,
    });
    await expect(
      service.validate('qadp_secret', 'project-1', 'env-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);

    prisma.projectDeployToken.findUnique.mockResolvedValue({
      id: 'token-1',
      orgId: 'org-1',
      projectId: 'project-1',
      allowedEnvironmentIds: ['env-2'],
      expiresAt: null,
      revokedAt: null,
      deletedAt: null,
    });
    await expect(
      service.validate('qadp_secret', 'project-1', 'env-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects expired tokens', async () => {
    prisma.projectDeployToken.findUnique.mockResolvedValue({
      id: 'token-1',
      orgId: 'org-1',
      projectId: 'project-1',
      allowedEnvironmentIds: [],
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
      deletedAt: null,
    });
    await expect(
      service.validate('qadp_secret', 'project-1', 'env-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
