import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AiProvider, OrgAiCredential } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import {
  AiModelMeta,
  AiProviderType,
  createAiModel,
  createAiModelFromConfig,
} from './providers/provider.factory';

const ENUM_TO_TYPE: Record<AiProvider, AiProviderType> = {
  ANTHROPIC: 'anthropic',
  OPENAI: 'openai',
  GEMINI: 'gemini',
  AZURE: 'azure',
  OLLAMA: 'ollama',
  OPENAI_COMPATIBLE: 'openai-compatible',
};

export const TYPE_TO_ENUM: Record<AiProviderType, AiProvider> = {
  anthropic: 'ANTHROPIC',
  openai: 'OPENAI',
  gemini: 'GEMINI',
  azure: 'AZURE',
  ollama: 'OLLAMA',
  'openai-compatible': 'OPENAI_COMPATIBLE',
};

/**
 * Resolves which AI model to use for an org. Lookup order:
 *
 *   1. OrgAiCredential row (active=true) — BYOK, the production path
 *   2. Platform env-var fallback — only when AI_ALLOW_PLATFORM_DEFAULT=true
 *      (used in dev so engineers don't need to provision a key per org)
 *
 * Returns the same {@link AiModelMeta} shape regardless of source so calling
 * code never branches on credential provenance.
 */
@Injectable()
export class AiCredentialResolver {
  private readonly logger = new Logger(AiCredentialResolver.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly config: ConfigService,
  ) {}

  async resolveForOrg(orgId: string): Promise<AiModelMeta> {
    const row = await this.prisma.orgAiCredential.findUnique({ where: { orgId } });

    if (row && row.active) {
      return this.buildFromRow(row);
    }

    if (this.config.get<string>('AI_ALLOW_PLATFORM_DEFAULT') === 'true') {
      this.logger.debug(`Org ${orgId} has no BYOK credential — using platform env fallback`);
      return createAiModel(this.config);
    }

    throw new BadRequestException(
      'AI is not configured for this organisation. ' +
        'Ask an admin to set it up in Settings → AI.',
    );
  }

  /** Used by the "Test connection" endpoint — builds the model without persisting. */
  async buildFromDraft(draft: {
    provider: AiProvider;
    model: string;
    apiKey?: string;
    maxTokens?: number;
    baseUrl?: string;
    azureInstance?: string;
    azureDeployment?: string;
    azureApiVersion?: string;
  }): Promise<AiModelMeta> {
    return createAiModelFromConfig({
      provider: ENUM_TO_TYPE[draft.provider],
      model: draft.model,
      apiKey: draft.apiKey,
      maxTokens: draft.maxTokens,
      baseUrl: draft.baseUrl,
      azureInstance: draft.azureInstance,
      azureDeployment: draft.azureDeployment,
      azureApiVersion: draft.azureApiVersion,
    });
  }

  private buildFromRow(row: OrgAiCredential): Promise<AiModelMeta> {
    const decrypted = this.secrets.decrypt(row.secretsCiphertext, row.secretsKeyId);
    const apiKey = decrypted.apiKey;
    return createAiModelFromConfig({
      provider: ENUM_TO_TYPE[row.provider],
      model: row.model,
      apiKey,
      maxTokens: row.maxTokens,
      baseUrl: row.baseUrl ?? undefined,
      azureInstance: row.azureInstance ?? undefined,
      azureDeployment: row.azureDeployment ?? undefined,
      azureApiVersion: row.azureApiVersion ?? undefined,
    });
  }
}
