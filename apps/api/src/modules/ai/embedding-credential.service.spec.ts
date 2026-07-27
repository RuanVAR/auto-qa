import { BadRequestException } from '@nestjs/common';
import {
  EmbeddingProvider,
  OrgEmbeddingCredential,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import { EmbeddingClient } from '@qa-platform/shared';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { EmbeddingCredentialService } from './embedding-credential.service';
import { CodeIndexRequestService } from '../codebase-indexing/code-index-request.service';

const now = new Date('2026-07-24T10:00:00.000Z');

function credential(
  overrides: Partial<OrgEmbeddingCredential> = {},
): OrgEmbeddingCredential {
  return {
    id: 'embedding-1',
    orgId: 'org-1',
    provider: EmbeddingProvider.OPENAI,
    model: 'text-embedding-3-small',
    baseUrl: null,
    azureDeployment: null,
    azureApiVersion: null,
    secretsCiphertext: Buffer.from('ciphertext'),
    secretsKeyId: 'v1',
    dimension: 1536,
    configFingerprint: 'old-fingerprint',
    active: true,
    createdById: 'user-1',
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('EmbeddingCredentialService', () => {
  const prisma = {
    orgEmbeddingCredential: {
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    repoBranchIndex: {
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(async (operations: Array<Promise<unknown>>) =>
      Promise.all(operations)),
  };
  const secrets = new SecretsService();
  const indexRequests = {
    requestOrganisationIndexes: jest.fn().mockResolvedValue(undefined),
  };
  let service: EmbeddingCredentialService;

  beforeEach(() => {
    jest.clearAllMocks();
    secrets._initForTest({ currentKek: randomBytes(32), currentKeyId: 'v1' });
    jest.spyOn(EmbeddingClient.prototype, 'probe')
      .mockResolvedValue({ dimension: 1536, latencyMs: 12 });
    service = new EmbeddingCredentialService(
      prisma as unknown as PrismaService,
      secrets,
      indexRequests as unknown as CodeIndexRequestService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('probes, encrypts, and stores a new cloud embedding credential', async () => {
    prisma.orgEmbeddingCredential.findUnique.mockResolvedValue(null);
    prisma.orgEmbeddingCredential.create.mockImplementation(
      async ({ data }: { data: OrgEmbeddingCredential }) => credential(data),
    );
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 0 });

    const result = await service.upsert('org-1', 'user-1', {
      provider: EmbeddingProvider.OPENAI,
      model: 'text-embedding-3-small',
      apiKey: 'secret-key',
    });

    const create = prisma.orgEmbeddingCredential.create.mock.calls[0][0].data;
    expect(secrets.decrypt(create.secretsCiphertext, create.secretsKeyId))
      .toEqual({ apiKey: 'secret-key' });
    expect(create.dimension).toBe(1536);
    expect(create.configFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.apiKey).toBe('••••••••');
    expect(indexRequests.requestOrganisationIndexes)
      .toHaveBeenCalledWith('org-1', 'user-1');
  });

  it('preserves a saved key when the provider is unchanged', async () => {
    const encrypted = secrets.encrypt({ apiKey: 'saved-key' });
    const existing = credential({
      secretsCiphertext: encrypted.ciphertext,
      secretsKeyId: encrypted.keyId,
    });
    prisma.orgEmbeddingCredential.findUnique.mockResolvedValue(existing);
    prisma.orgEmbeddingCredential.update.mockResolvedValue(existing);
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 0 });

    await service.upsert('org-1', 'user-1', {
      provider: EmbeddingProvider.OPENAI,
      model: 'text-embedding-3-small',
    });

    const probe = jest.mocked(EmbeddingClient.prototype.probe);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'saved-key',
    }));
  });

  it('requires a new key when switching cloud providers', async () => {
    prisma.orgEmbeddingCredential.findUnique.mockResolvedValue(credential());

    await expect(service.upsert('org-1', 'user-1', {
      provider: EmbeddingProvider.GEMINI,
      model: 'text-embedding-004',
    })).rejects.toThrow(BadRequestException);
    expect(EmbeddingClient.prototype.probe).not.toHaveBeenCalled();
  });

  it('allows Ollama without an API key', async () => {
    prisma.orgEmbeddingCredential.findUnique.mockResolvedValue(null);
    prisma.orgEmbeddingCredential.create.mockImplementation(
      async ({ data }: { data: OrgEmbeddingCredential }) => credential({
        ...data,
        provider: EmbeddingProvider.OLLAMA,
      }),
    );
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 0 });

    await service.upsert('org-1', 'user-1', {
      provider: EmbeddingProvider.OLLAMA,
      model: 'nomic-embed-text',
      baseUrl: 'http://ollama:11434',
    });

    expect(EmbeddingClient.prototype.probe).toHaveBeenCalledWith({
      provider: EmbeddingProvider.OLLAMA,
      model: 'nomic-embed-text',
      apiKey: null,
      baseUrl: 'http://ollama:11434',
      azureDeployment: undefined,
      azureApiVersion: undefined,
    });
  });

  it('soft-deletes and zeroes the key while blocking active indexes', async () => {
    const row = credential({ secretsCiphertext: Buffer.from('secret-data') });
    prisma.orgEmbeddingCredential.findUnique.mockResolvedValue(row);
    prisma.orgEmbeddingCredential.update.mockResolvedValue(row);
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 2 });

    await service.remove('org-1');

    const update = prisma.orgEmbeddingCredential.update.mock.calls[0][0];
    expect(update.data).toMatchObject({
      active: false,
      deletedAt: expect.any(Date),
      secretsKeyId: null,
    });
    expect(update.data.secretsCiphertext.equals(Buffer.alloc('secret-data'.length)))
      .toBe(true);
    expect(prisma.repoBranchIndex.updateMany).toHaveBeenCalledWith({
      where: { orgId: 'org-1', deletedAt: null },
      data: {
        status: RepoIndexStatus.BLOCKED,
        stage: RepoIndexStage.QUEUED,
        progressPercent: 0,
        error: 'Embedding credential is not configured',
      },
    });
  });
});
