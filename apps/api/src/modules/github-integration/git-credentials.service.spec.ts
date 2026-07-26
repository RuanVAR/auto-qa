import { BadRequestException } from '@nestjs/common';
import { GitAuthKind, GitProvider, OrgGitCredential } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { GitCredentialsService } from './git-credentials.service';
import { GitHubClient } from './github.client';

const now = new Date('2026-07-24T10:00:00.000Z');

function credential(overrides: Partial<OrgGitCredential> = {}): OrgGitCredential {
  return {
    id: 'credential-1',
    orgId: 'org-1',
    provider: GitProvider.GITHUB,
    authKind: GitAuthKind.PAT,
    displayLabel: null,
    baseUrl: null,
    appInstallationId: null,
    secretsCiphertext: Buffer.from('ciphertext'),
    secretsKeyId: 'v1',
    lastHealthOk: false,
    lastHealthAt: null,
    lastHealthError: null,
    connectedAs: null,
    isEnabled: true,
    createdById: 'user-1',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('GitCredentialsService', () => {
  const tx = {
    projectRepo: { update: jest.fn() },
    orgGitCredential: { update: jest.fn() },
  };
  const prisma = {
    orgGitCredential: {
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    projectRepo: { findMany: jest.fn() },
    $transaction: jest.fn((operation: (client: typeof tx) => Promise<void>) => operation(tx)),
  };
  const github = {
    health: jest.fn(),
  };
  const secrets = new SecretsService();
  let service: GitCredentialsService;

  beforeEach(() => {
    jest.clearAllMocks();
    secrets._initForTest({ currentKek: randomBytes(32), currentKeyId: 'v1' });
    service = new GitCredentialsService(
      prisma as unknown as PrismaService,
      secrets,
      github as unknown as GitHubClient,
    );
  });

  it('encrypts a PAT and returns only masked credential metadata', async () => {
    const encrypted = secrets.encrypt({ token: 'ghp_secret' });
    const stored = credential({
      secretsCiphertext: encrypted.ciphertext,
      secretsKeyId: encrypted.keyId,
    });
    const healthy = credential({
      ...stored,
      lastHealthOk: true,
      lastHealthAt: now,
      connectedAs: 'octocat',
    });
    prisma.orgGitCredential.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    prisma.orgGitCredential.create.mockResolvedValue(stored);
    prisma.orgGitCredential.findUniqueOrThrow.mockResolvedValue(stored);
    prisma.orgGitCredential.update.mockResolvedValue(healthy);
    github.health.mockResolvedValue({ ok: true, connectedAs: 'octocat' });

    const result = await service.upsert('org-1', 'user-1', {
      authKind: GitAuthKind.PAT,
      token: 'ghp_secret',
    });

    const createArgs = prisma.orgGitCredential.create.mock.calls[0][0];
    const persisted = createArgs.data as { secretsCiphertext: Buffer; secretsKeyId: string };
    expect(secrets.decrypt(persisted.secretsCiphertext, persisted.secretsKeyId)).toEqual({
      token: 'ghp_secret',
    });
    expect(result).toMatchObject({
      id: 'credential-1',
      connectedAs: 'octocat',
      lastHealthOk: true,
      hasSecret: true,
    });
    expect(result).not.toHaveProperty('secretsCiphertext');
  });

  it('requires the new secret when switching authentication kinds', async () => {
    const encrypted = secrets.encrypt({ token: 'ghp_secret' });
    prisma.orgGitCredential.findFirst.mockResolvedValue(credential({
      secretsCiphertext: encrypted.ciphertext,
      secretsKeyId: encrypted.keyId,
    }));

    await expect(service.upsert('org-1', 'user-1', {
      authKind: GitAuthKind.APP,
      appId: '123',
      appInstallationId: '456',
    })).rejects.toThrow(BadRequestException);
    expect(prisma.orgGitCredential.update).not.toHaveBeenCalled();
  });

  it('re-encrypts an App private key when its app ID changes', async () => {
    const initial = secrets.encrypt({ appId: '123', privateKey: 'private-key' });
    const existing = credential({
      authKind: GitAuthKind.APP,
      appInstallationId: '456',
      secretsCiphertext: initial.ciphertext,
      secretsKeyId: initial.keyId,
    });
    prisma.orgGitCredential.findFirst.mockResolvedValue(existing);
    prisma.orgGitCredential.update
      .mockImplementationOnce(async ({ data }: { data: { secretsCiphertext: Buffer; secretsKeyId: string } }) =>
        credential({
          ...existing,
          authKind: GitAuthKind.APP,
          secretsCiphertext: data.secretsCiphertext,
          secretsKeyId: data.secretsKeyId,
        }))
      .mockResolvedValueOnce(existing);
    prisma.orgGitCredential.findUniqueOrThrow.mockResolvedValue(existing);
    github.health.mockResolvedValue({ ok: true, connectedAs: 'app:qa' });

    await service.upsert('org-1', 'user-1', {
      authKind: GitAuthKind.APP,
      appId: '999',
      appInstallationId: '456',
    });

    const updateArgs = prisma.orgGitCredential.update.mock.calls[0][0];
    const data = updateArgs.data as { secretsCiphertext: Buffer; secretsKeyId: string };
    expect(secrets.decrypt(data.secretsCiphertext, data.secretsKeyId)).toEqual({
      appId: '999',
      privateKey: 'private-key',
    });
  });

  it('soft-deletes linked repos and zeroes all stored secret material', async () => {
    const stored = credential({ secretsCiphertext: Buffer.from('credential-secret') });
    prisma.orgGitCredential.findFirst.mockResolvedValue(stored);
    prisma.projectRepo.findMany.mockResolvedValue([
      { id: 'repo-1', secretsCiphertext: Buffer.from('repo-secret') },
    ]);

    await service.remove('org-1');

    expect(tx.projectRepo.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'repo-1' },
      data: expect.objectContaining({
        deletedAt: expect.any(Date),
        secretsKeyId: null,
        webhookSecret: null,
      }),
    }));
    const repoData = tx.projectRepo.update.mock.calls[0][0].data;
    expect(repoData.secretsCiphertext.equals(Buffer.alloc('repo-secret'.length))).toBe(true);

    const credentialData = tx.orgGitCredential.update.mock.calls[0][0].data;
    expect(credentialData.deletedAt).toBeInstanceOf(Date);
    expect(credentialData.isEnabled).toBe(false);
    expect(credentialData.secretsCiphertext.equals(Buffer.alloc('credential-secret'.length))).toBe(true);
  });

  it('does not expose auth for a disabled credential', async () => {
    prisma.orgGitCredential.findFirst.mockResolvedValue(credential({ isEnabled: false }));

    await expect(service.authForOrg('org-1')).resolves.toBeNull();
  });
});
