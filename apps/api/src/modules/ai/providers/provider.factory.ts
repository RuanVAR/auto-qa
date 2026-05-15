import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Supported AI providers.
 *
 * - anthropic          : Anthropic Claude (cloud)
 * - openai             : OpenAI GPT (cloud)
 * - gemini             : Google Gemini (cloud) — Phase 0 BYOK default
 * - azure              : Azure-hosted OpenAI (cloud / enterprise)
 * - ollama             : Ollama running locally or on a private server
 * - openai-compatible  : Any OpenAI-compatible REST API (vLLM, LM Studio, llama.cpp, etc.)
 */
export type AiProviderType =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'azure'
  | 'ollama'
  | 'openai-compatible';

// Use any-parameterised BaseChatModel to avoid version-mismatch errors between
// @langchain/core and the concrete provider packages.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyChatModel = BaseChatModel<any, any>;

export interface AiModelMeta {
  model: AnyChatModel;
  /** Human-readable string recorded in AISummary.model */
  label: string;
  /** Provider type — handy for per-provider branching (e.g. structured-output capability) */
  provider: AiProviderType;
  /** Model name without the provider prefix — used for the cost calculator lookup */
  modelName: string;
}

/**
 * Explicit config shape — used by the BYOK path (`AiCredentialResolver`)
 * where the values come from `OrgAiCredential` instead of env vars.
 */
export interface AiModelConfig {
  provider: AiProviderType;
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  azureInstance?: string;
  azureDeployment?: string;
  azureApiVersion?: string;
}

/** Default model per provider — used when the caller hasn't picked one yet. */
export const DEFAULT_MODELS: Record<AiProviderType, string> = {
  anthropic: 'claude-haiku-4-20250514',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.0-flash',
  azure: 'gpt-4o-mini',
  ollama: 'llama3',
  'openai-compatible': 'local-model',
};

/**
 * Build a chat model from an explicit config. Used by the BYOK pipeline.
 * Keep this in sync with `createAiModel(config)` below — both paths must
 * produce identically-typed AiModelMeta values.
 */
export async function createAiModelFromConfig(cfg: AiModelConfig): Promise<AiModelMeta> {
  const maxTokens = cfg.maxTokens ?? 2048;
  const modelName = cfg.model || DEFAULT_MODELS[cfg.provider];

  switch (cfg.provider) {
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      return {
        provider: 'anthropic',
        modelName,
        label: `anthropic/${modelName}`,
        model: new ChatAnthropic({
          apiKey: cfg.apiKey,
          model: modelName,
          maxTokens,
        }) as unknown as AnyChatModel,
      };
    }

    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      return {
        provider: 'openai',
        modelName,
        label: `openai/${modelName}`,
        model: new ChatOpenAI({
          apiKey: cfg.apiKey,
          model: modelName,
          maxTokens,
        }) as unknown as AnyChatModel,
      };
    }

    case 'gemini': {
      // Google Generative AI — same OAuth-style API-key auth as the other clouds.
      // Free tier covers QA generation easily (15 req/min, 1500 req/day).
      const { ChatGoogleGenerativeAI } = await import('@langchain/google-genai');
      return {
        provider: 'gemini',
        modelName,
        label: `gemini/${modelName}`,
        model: new ChatGoogleGenerativeAI({
          apiKey: cfg.apiKey,
          model: modelName,
          maxOutputTokens: maxTokens,
        }) as unknown as AnyChatModel,
      };
    }

    case 'azure': {
      const { AzureChatOpenAI } = await import('@langchain/openai');
      const deployment = cfg.azureDeployment ?? modelName;
      const apiVersion = cfg.azureApiVersion ?? '2024-05-01-preview';
      const params: Record<string, unknown> = {
        azureOpenAIApiKey: cfg.apiKey,
        azureOpenAIApiDeploymentName: deployment,
        azureOpenAIApiVersion: apiVersion,
        maxTokens,
      };
      if (cfg.baseUrl) {
        params.azureOpenAIBasePath = cfg.baseUrl;
      } else if (cfg.azureInstance) {
        params.azureOpenAIApiInstanceName = cfg.azureInstance;
      } else {
        throw new Error('Azure OpenAI requires either azureInstance or baseUrl.');
      }
      return {
        provider: 'azure',
        modelName: deployment,
        label: `azure/${deployment}`,
        model: new AzureChatOpenAI(
          params as ConstructorParameters<typeof AzureChatOpenAI>[0],
        ) as unknown as AnyChatModel,
      };
    }

    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      const baseUrl = cfg.baseUrl ?? 'http://localhost:11434';
      return {
        provider: 'ollama',
        modelName,
        label: `ollama/${modelName}`,
        model: new ChatOllama({ baseUrl, model: modelName }) as unknown as AnyChatModel,
      };
    }

    case 'openai-compatible': {
      const { ChatOpenAI } = await import('@langchain/openai');
      if (!cfg.baseUrl) {
        throw new Error('openai-compatible provider requires baseUrl.');
      }
      return {
        provider: 'openai-compatible',
        modelName,
        label: `openai-compatible/${modelName}`,
        model: new ChatOpenAI({
          apiKey: cfg.apiKey ?? 'local',
          model: modelName,
          maxTokens,
          configuration: { baseURL: cfg.baseUrl },
        }) as unknown as AnyChatModel,
      };
    }

    default:
      throw new Error(`Unknown AI provider "${(cfg as AiModelConfig).provider}".`);
  }
}

/**
 * Legacy env-driven entry. Reads AI_PROVIDER + supporting env vars and
 * delegates to {@link createAiModelFromConfig}. Used as the platform
 * fallback when an org has no BYOK credential AND `AI_ALLOW_PLATFORM_DEFAULT`
 * is enabled (typically only in dev).
 *
 * Environment variables
 * ─────────────────────
 * AI_PROVIDER            anthropic | openai | gemini | azure | ollama | openai-compatible
 * AI_MODEL               Model / deployment name (provider-specific default used if omitted)
 * AI_API_KEY             API key (not needed for local providers)
 * AI_MAX_TOKENS          Max tokens to generate (default: 2048)
 * AI_BASE_URL            Base URL for Ollama / openai-compatible / Azure endpoint override
 *
 * Azure-specific
 * AI_AZURE_INSTANCE      {instance}.openai.azure.com
 * AI_AZURE_DEPLOYMENT    Deployment name (falls back to AI_MODEL)
 * AI_AZURE_API_VERSION   API version (default: 2024-05-01-preview)
 *
 * Legacy fallbacks (still respected when AI_PROVIDER is not set)
 * ANTHROPIC_API_KEY      Implies provider=anthropic
 * OPENAI_API_KEY         Implies provider=openai
 * GEMINI_API_KEY         Implies provider=gemini
 */
export async function createAiModel(config: ConfigService): Promise<AiModelMeta> {
  const maxTokens = config.get<number>('AI_MAX_TOKENS') ?? 2048;

  let provider = config.get<string>('AI_PROVIDER') as AiProviderType | undefined;
  if (!provider) {
    if (config.get<string>('ANTHROPIC_API_KEY')) provider = 'anthropic';
    else if (config.get<string>('OPENAI_API_KEY')) provider = 'openai';
    else if (config.get<string>('GEMINI_API_KEY')) provider = 'gemini';
    else throw new Error(
      'No AI provider configured. Set AI_PROVIDER (anthropic | openai | gemini | azure | ollama | openai-compatible) ' +
      'or provide ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY.',
    );
  }

  const apiKey =
    config.get<string>('AI_API_KEY') ??
    (provider === 'anthropic'
      ? config.get<string>('ANTHROPIC_API_KEY')
      : provider === 'openai'
        ? config.get<string>('OPENAI_API_KEY')
        : provider === 'gemini'
          ? config.get<string>('GEMINI_API_KEY')
          : provider === 'azure'
            ? config.get<string>('AZURE_OPENAI_API_KEY')
            : undefined);

  return createAiModelFromConfig({
    provider,
    model: config.get<string>('AI_MODEL') ?? DEFAULT_MODELS[provider],
    apiKey,
    baseUrl: config.get<string>('AI_BASE_URL'),
    maxTokens,
    azureInstance: config.get<string>('AI_AZURE_INSTANCE'),
    azureDeployment: config.get<string>('AI_AZURE_DEPLOYMENT'),
    azureApiVersion: config.get<string>('AI_AZURE_API_VERSION'),
  });
}
