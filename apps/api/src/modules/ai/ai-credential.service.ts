import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiProvider, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';
import { AiCredentialResolver } from './credential-resolver.service';
import { AiCostCalculator } from './cost-calculator.service';
import { AiModelMeta, DEFAULT_MODELS } from './providers/provider.factory';

const MASKED = '••••••••';

export interface PublicCredential {
  provider: AiProvider;
  model: string;
  maxTokens: number;
  baseUrl: string | null;
  azureInstance: string | null;
  azureDeployment: string | null;
  azureApiVersion: string | null;
  monthlyCapUsd: number;
  rateLimitPerUserPerHour: number;
  active: boolean;
  /** Always masked. UI uses this to display "key is set" without ever rendering plaintext. */
  apiKey: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertCredentialInput {
  provider: AiProvider;
  model?: string;
  /**
   * New key (re-encrypted) when a string is supplied. Pass undefined/null to
   * keep the existing key — standard "leave masked to preserve" pattern.
   */
  apiKey?: string | null;
  maxTokens?: number;
  baseUrl?: string;
  azureInstance?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
  monthlyCapUsd?: number;
  rateLimitPerUserPerHour?: number;
}

/**
 * Owns the OrgAiCredential row lifecycle. Encryption / decryption goes
 * through SecretsService; the controller never sees plaintext keys.
 *
 * Public surface:
 *   getMasked     — read for the Settings page (apiKey replaced with ••••)
 *   upsert        — create or update; preserves existing key when input omits one
 *   delete        — soft-delete via row removal (no audit log for now)
 *   testConnection — build a model from a DRAFT config (no DB write), invoke
 *                    a 1-token request, and return latency + cost
 *   monthlySpend  — sum AISummary.costUsd for the current calendar month
 */
@Injectable()
export class AiCredentialService {
  private readonly logger = new Logger(AiCredentialService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretsService,
    private readonly resolver: AiCredentialResolver,
    private readonly cost: AiCostCalculator,
  ) {}

  async getMasked(orgId: string): Promise<PublicCredential | null> {
    const row = await this.prisma.orgAiCredential.findUnique({ where: { orgId } });
    if (!row) return null;
    return this.toPublic(row);
  }

  async upsert(orgId: string, userId: string, input: UpsertCredentialInput): Promise<PublicCredential> {
    const existing = await this.prisma.orgAiCredential.findUnique({ where: { orgId } });

    // Resolve the key to encrypt. If the caller passed a string we re-encrypt;
    // if they passed undefined/null we keep whatever's on disk (or fail when
    // there's nothing to keep).
    let ciphertext: Buffer;
    let keyId: string;
    if (input.apiKey != null && input.apiKey !== MASKED && input.apiKey !== '') {
      const enc = this.secrets.encrypt({ apiKey: input.apiKey });
      ciphertext = enc.ciphertext;
      keyId = enc.keyId;
    } else if (existing) {
      ciphertext = existing.secretsCiphertext;
      keyId = existing.secretsKeyId;
    } else {
      throw new BadRequestException('apiKey is required when configuring AI for the first time');
    }

    const model = input.model ?? existing?.model ?? DEFAULT_MODELS[this.providerToType(input.provider)];

    const data = {
      provider: input.provider,
      model,
      maxTokens: input.maxTokens ?? existing?.maxTokens ?? 4000,
      secretsCiphertext: ciphertext,
      secretsKeyId: keyId,
      baseUrl: input.baseUrl ?? existing?.baseUrl ?? null,
      azureInstance: input.azureInstance ?? existing?.azureInstance ?? null,
      azureDeployment: input.azureDeployment ?? existing?.azureDeployment ?? null,
      azureApiVersion: input.azureApiVersion ?? existing?.azureApiVersion ?? null,
      monthlyCapUsd:
        input.monthlyCapUsd != null
          ? new Prisma.Decimal(input.monthlyCapUsd)
          : (existing?.monthlyCapUsd ?? new Prisma.Decimal('50.00')),
      rateLimitPerUserPerHour:
        input.rateLimitPerUserPerHour ?? existing?.rateLimitPerUserPerHour ?? 20,
      active: true,
    } satisfies Prisma.OrgAiCredentialUncheckedUpdateInput;

    const row = existing
      ? await this.prisma.orgAiCredential.update({ where: { orgId }, data })
      : await this.prisma.orgAiCredential.create({
          data: { ...data, orgId, createdById: userId } as Prisma.OrgAiCredentialUncheckedCreateInput,
        });

    return this.toPublic(row);
  }

  async delete(orgId: string): Promise<void> {
    await this.prisma.orgAiCredential
      .delete({ where: { orgId } })
      .catch(() => undefined);
  }

  /**
   * One-token probe of the configured provider. Used by Settings → AI's
   * "Test connection" button. We accept a partial draft so the user can
   * verify BEFORE saving (key, base url, etc).
   *
   * If `apiKey` is omitted we fall back to the stored row — useful for
   * "test the saved config" without re-typing the key.
   */
  async testConnection(orgId: string, draft: UpsertCredentialInput): Promise<{
    ok: boolean;
    model: string;
    latencyMs: number;
    costUsd: number;
    error?: string;
    sampleResponse?: string;
  }> {
    let apiKey = draft.apiKey ?? undefined;
    if (!apiKey || apiKey === MASKED) {
      const existing = await this.prisma.orgAiCredential.findUnique({ where: { orgId } });
      if (existing) {
        const decrypted = this.secrets.decrypt(existing.secretsCiphertext, existing.secretsKeyId);
        apiKey = decrypted.apiKey;
      }
    }
    const model = draft.model ?? DEFAULT_MODELS[this.providerToType(draft.provider)];

    let meta: AiModelMeta;
    try {
      meta = await this.resolver.buildFromDraft({
        provider: draft.provider,
        model,
        apiKey,
        maxTokens: 64,
        baseUrl: draft.baseUrl,
        azureInstance: draft.azureInstance,
        azureDeployment: draft.azureDeployment,
        azureApiVersion: draft.azureApiVersion,
      });
    } catch (err) {
      return {
        ok: false,
        model,
        latencyMs: 0,
        costUsd: 0,
        error: (err as Error).message ?? 'Failed to build model',
      };
    }

    const t0 = Date.now();
    try {
      const result = await meta.model.invoke('Reply with just the word OK.');
      const latencyMs = Date.now() - t0;
      // LangChain providers expose usage_metadata on the AIMessage. Fall back
      // to 0/0 so the cost calc still produces something rather than crashing.
      const usage = (result as unknown as { usage_metadata?: { input_tokens?: number; output_tokens?: number } })
        .usage_metadata;
      const inTok = usage?.input_tokens ?? 0;
      const outTok = usage?.output_tokens ?? 0;
      const costUsd = this.cost.calculate(meta.provider, meta.modelName, inTok, outTok);
      const content = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
      return {
        ok: true,
        model: meta.label,
        latencyMs,
        costUsd,
        sampleResponse: content.slice(0, 120),
      };
    } catch (err) {
      return {
        ok: false,
        model: meta.label,
        latencyMs: Date.now() - t0,
        costUsd: 0,
        error: (err as Error).message ?? 'Provider call failed',
      };
    }
  }

  /**
   * Sum AISummary.costUsd for the org for `month` (YYYY-MM, UTC).
   * Defaults to current calendar month when no month is supplied.
   */
  async monthlySpend(orgId: string, monthIso?: string): Promise<{
    month: string;
    totalUsd: number;
    byPurpose: Record<string, number>;
    callCount: number;
  }> {
    const { start, end, key } = monthRange(monthIso);
    const rows = await this.prisma.aISummary.findMany({
      where: { orgId, createdAt: { gte: start, lt: end } },
      select: { costUsd: true, purpose: true },
    });
    const byPurpose: Record<string, number> = {};
    let total = 0;
    for (const r of rows) {
      const c = Number(r.costUsd ?? 0);
      total += c;
      const k = r.purpose ?? 'unknown';
      byPurpose[k] = (byPurpose[k] ?? 0) + c;
    }
    return { month: key, totalUsd: total, byPurpose, callCount: rows.length };
  }

  private toPublic(row: {
    provider: AiProvider;
    model: string;
    maxTokens: number;
    baseUrl: string | null;
    azureInstance: string | null;
    azureDeployment: string | null;
    azureApiVersion: string | null;
    monthlyCapUsd: Prisma.Decimal;
    rateLimitPerUserPerHour: number;
    active: boolean;
    secretsCiphertext: Buffer;
    createdAt: Date;
    updatedAt: Date;
  }): PublicCredential {
    return {
      provider: row.provider,
      model: row.model,
      maxTokens: row.maxTokens,
      baseUrl: row.baseUrl,
      azureInstance: row.azureInstance,
      azureDeployment: row.azureDeployment,
      azureApiVersion: row.azureApiVersion,
      monthlyCapUsd: Number(row.monthlyCapUsd),
      rateLimitPerUserPerHour: row.rateLimitPerUserPerHour,
      active: row.active,
      apiKey: row.secretsCiphertext.length > 0 ? MASKED : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private providerToType(p: AiProvider): import('./providers/provider.factory').AiProviderType {
    switch (p) {
      case 'ANTHROPIC': return 'anthropic';
      case 'OPENAI': return 'openai';
      case 'GEMINI': return 'gemini';
      case 'AZURE': return 'azure';
      case 'OLLAMA': return 'ollama';
      case 'OPENAI_COMPATIBLE': return 'openai-compatible';
    }
  }
}

function monthRange(monthIso?: string): { start: Date; end: Date; key: string } {
  const now = new Date();
  const [yearStr, monStr] = (monthIso ?? '').split('-');
  const year = yearStr ? Number(yearStr) : now.getUTCFullYear();
  const month = monStr ? Number(monStr) - 1 : now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month + 1, 1));
  const key = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  return { start, end, key };
}
