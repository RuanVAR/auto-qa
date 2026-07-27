import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  EmbeddingProvider,
  OrgEmbeddingCredential,
  Prisma,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import {
  EmbeddingClient,
  EmbeddingConfig,
  embeddingFingerprint,
} from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { UpsertEmbeddingCredentialDto } from './dto/upsert-embedding-credential.dto';
import { CodeIndexRequestService } from '../codebase-indexing/code-index-request.service';

const MASKED = '••••••••';

export interface PublicEmbeddingCredential {
  provider: EmbeddingProvider;
  model: string;
  baseUrl: string | null;
  azureDeployment: string | null;
  azureApiVersion: string | null;
  dimension: number;
  configFingerprint: string;
  active: boolean;
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class EmbeddingCredentialService {
  private readonly client = new EmbeddingClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly indexRequests: CodeIndexRequestService,
  ) {}

  async getMasked(orgId: string): Promise<PublicEmbeddingCredential | null> {
    const row = await this.prisma.orgEmbeddingCredential.findUnique({ where: { orgId } });
    return row && !row.deletedAt ? toPublic(row) : null;
  }

  async upsert(
    orgId: string,
    userId: string,
    input: UpsertEmbeddingCredentialDto,
  ): Promise<PublicEmbeddingCredential> {
    const existing = await this.prisma.orgEmbeddingCredential.findUnique({ where: { orgId } });
    const activeExisting = existing?.deletedAt ? null : existing;
    const normalized = normalize(input);
    const secret = this.resolveSecret(normalized, activeExisting);
    const config = toConfig(normalized, secret.apiKey);

    let probe: { dimension: number; latencyMs: number };
    try {
      probe = await this.client.probe(config);
    } catch (error) {
      throw new BadRequestException(safeMessage(error));
    }

    const fingerprint = embeddingFingerprint(config, probe.dimension);
    const secretData = secret.encrypted ?? (
      activeExisting
        ? {
            ciphertext: activeExisting.secretsCiphertext,
            keyId: activeExisting.secretsKeyId,
          }
        : { ciphertext: null, keyId: null }
    );
    const data = {
      provider: normalized.provider,
      model: normalized.model,
      baseUrl: normalized.baseUrl ?? null,
      azureDeployment: normalized.azureDeployment ?? null,
      azureApiVersion: normalized.azureApiVersion ?? null,
      secretsCiphertext: secretData.ciphertext,
      secretsKeyId: secretData.keyId,
      dimension: probe.dimension,
      configFingerprint: fingerprint,
      active: true,
      deletedAt: null,
    } satisfies Prisma.OrgEmbeddingCredentialUncheckedUpdateInput;

    const row = existing
      ? await this.prisma.orgEmbeddingCredential.update({ where: { orgId }, data })
      : await this.prisma.orgEmbeddingCredential.create({
          data: {
            ...data,
            orgId,
            createdById: userId,
          } as Prisma.OrgEmbeddingCredentialUncheckedCreateInput,
        });

    if (!activeExisting || activeExisting.configFingerprint !== fingerprint) {
      await this.indexRequests.requestOrganisationIndexes(orgId, userId);
    }
    return toPublic(row);
  }

  async test(
    orgId: string,
    input: UpsertEmbeddingCredentialDto,
  ): Promise<{
    ok: boolean;
    model: string;
    dimension?: number;
    latencyMs: number;
    error?: string;
  }> {
    try {
      const existing = await this.prisma.orgEmbeddingCredential.findUnique({ where: { orgId } });
      const activeExisting = existing?.deletedAt ? null : existing;
      const normalized = normalize(input);
      const secret = this.resolveSecret(normalized, activeExisting);
      const probe = await this.client.probe(toConfig(normalized, secret.apiKey));
      return {
        ok: true,
        model: normalized.model,
        dimension: probe.dimension,
        latencyMs: probe.latencyMs,
      };
    } catch (error) {
      return {
        ok: false,
        model: input.model,
        latencyMs: 0,
        error: safeMessage(error),
      };
    }
  }

  async remove(orgId: string): Promise<void> {
    const row = await this.prisma.orgEmbeddingCredential.findUnique({ where: { orgId } });
    if (!row || row.deletedAt) return;
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.orgEmbeddingCredential.update({
        where: { orgId },
        data: {
          active: false,
          deletedAt: now,
          secretsCiphertext: row.secretsCiphertext
            ? this.secrets.zeroBuffer(row.secretsCiphertext.length)
            : null,
          secretsKeyId: null,
        },
      }),
      this.prisma.repoBranchIndex.updateMany({
        where: { orgId, deletedAt: null },
        data: {
          status: RepoIndexStatus.BLOCKED,
          stage: RepoIndexStage.QUEUED,
          progressPercent: 0,
          error: 'Embedding credential is not configured',
        },
      }),
    ]);
  }

  async resolvedConfig(orgId: string): Promise<{
    credentialId: string;
    config: EmbeddingConfig;
    dimension: number;
    fingerprint: string;
  }> {
    const row = await this.prisma.orgEmbeddingCredential.findUnique({ where: { orgId } });
    if (!row || row.deletedAt || !row.active) {
      throw new NotFoundException('No active embedding credential configured for this organisation');
    }
    const secret = row.secretsCiphertext && row.secretsKeyId
      ? this.secrets.decrypt(row.secretsCiphertext, row.secretsKeyId).apiKey
      : null;
    return {
      credentialId: row.id,
      config: toConfig(row, secret),
      dimension: row.dimension,
      fingerprint: row.configFingerprint,
    };
  }

  private resolveSecret(
    input: UpsertEmbeddingCredentialDto,
    existing: OrgEmbeddingCredential | null,
  ): {
    apiKey: string | null;
    encrypted?: { ciphertext: Buffer; keyId: string };
  } {
    if (input.apiKey && input.apiKey !== MASKED) {
      return {
        apiKey: input.apiKey,
        encrypted: this.secrets.encrypt({ apiKey: input.apiKey }),
      };
    }
    if (existing && existing.provider === input.provider) {
      if (!existing.secretsCiphertext || !existing.secretsKeyId) return { apiKey: null };
      return {
        apiKey: this.secrets.decrypt(
          existing.secretsCiphertext,
          existing.secretsKeyId,
        ).apiKey,
      };
    }
    if (input.provider === EmbeddingProvider.OLLAMA) return { apiKey: null };
    throw new BadRequestException(
      `apiKey is required when configuring ${input.provider} embeddings`,
    );
  }
}

function normalize(input: UpsertEmbeddingCredentialDto): UpsertEmbeddingCredentialDto {
  const model = input.model.trim();
  if (!model) throw new BadRequestException('Embedding model is required');
  let baseUrl: string | undefined;
  if (input.baseUrl) {
    const parsed = new URL(input.baseUrl);
    if (
      process.env.NODE_ENV === 'production'
      && input.provider !== EmbeddingProvider.OLLAMA
      && parsed.protocol !== 'https:'
    ) {
      throw new BadRequestException('Cloud embedding endpoints must use HTTPS in production');
    }
    baseUrl = parsed.toString().replace(/\/$/, '');
  }
  if (input.provider === EmbeddingProvider.OPENAI_COMPATIBLE && !baseUrl) {
    throw new BadRequestException('baseUrl is required for OpenAI-compatible embeddings');
  }
  if (input.provider === EmbeddingProvider.AZURE) {
    if (!baseUrl) throw new BadRequestException('baseUrl is required for Azure embeddings');
    if (!input.azureDeployment?.trim()) {
      throw new BadRequestException('azureDeployment is required for Azure embeddings');
    }
  }
  return {
    ...input,
    model,
    baseUrl,
    azureDeployment: input.azureDeployment?.trim() || undefined,
    azureApiVersion: input.azureApiVersion?.trim() || undefined,
  };
}

function toConfig(
  input: {
    provider: EmbeddingProvider;
    model: string;
    baseUrl?: string | null;
    azureDeployment?: string | null;
    azureApiVersion?: string | null;
  },
  apiKey: string | null,
): EmbeddingConfig {
  return {
    provider: input.provider,
    model: input.model,
    apiKey,
    baseUrl: input.baseUrl,
    azureDeployment: input.azureDeployment,
    azureApiVersion: input.azureApiVersion,
  };
}

function toPublic(row: OrgEmbeddingCredential): PublicEmbeddingCredential {
  return {
    provider: row.provider,
    model: row.model,
    baseUrl: row.baseUrl,
    azureDeployment: row.azureDeployment,
    azureApiVersion: row.azureApiVersion,
    dimension: row.dimension,
    configFingerprint: row.configFingerprint,
    active: row.active,
    apiKey: row.secretsCiphertext ? MASKED : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Embedding provider request failed';
}
