import { ConfigService } from '@nestjs/config';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Supported AI providers.
 *
 * - anthropic          : Anthropic Claude (cloud)
 * - openai             : OpenAI GPT (cloud)
 * - azure              : Azure-hosted OpenAI (cloud / enterprise)
 * - ollama             : Ollama running locally or on a private server
 * - openai-compatible  : Any OpenAI-compatible REST API (vLLM, LM Studio, llama.cpp, etc.)
 */
export type AiProviderType =
  | 'anthropic'
  | 'openai'
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
}

/**
 * Reads the AI_PROVIDER env var (or legacy ANTHROPIC_API_KEY / OPENAI_API_KEY fallback)
 * and returns the appropriate LangChain chat model together with a label string.
 *
 * Environment variables
 * ─────────────────────
 * AI_PROVIDER            anthropic | openai | azure | ollama | openai-compatible
 * AI_MODEL               Model / deployment name (provider-specific default used if omitted)
 * AI_API_KEY             API key (not needed for local providers)
 * AI_MAX_TOKENS          Max tokens to generate (default: 2048)
 * AI_BASE_URL            Base URL for Ollama / openai-compatible / Azure endpoint override
 *
 * Azure-specific
 * AI_AZURE_INSTANCE      {instance}.openai.azure.com  (e.g. "my-company")
 * AI_AZURE_DEPLOYMENT    Deployment name (falls back to AI_MODEL)
 * AI_AZURE_API_VERSION   API version (default: 2024-05-01-preview)
 *
 * Legacy fallbacks (still respected when AI_PROVIDER is not set)
 * ANTHROPIC_API_KEY      Implies provider=anthropic
 * OPENAI_API_KEY         Implies provider=openai
 */
export async function createAiModel(config: ConfigService): Promise<AiModelMeta> {
  const maxTokens = config.get<number>('AI_MAX_TOKENS') ?? 2048;

  // ── resolve provider ──────────────────────────────────────────────────────
  let provider = config.get<string>('AI_PROVIDER') as AiProviderType | undefined;

  if (!provider) {
    // legacy fallback: infer from whichever key is present
    if (config.get<string>('ANTHROPIC_API_KEY')) provider = 'anthropic';
    else if (config.get<string>('OPENAI_API_KEY')) provider = 'openai';
    else throw new Error(
      'No AI provider configured. Set AI_PROVIDER (anthropic | openai | azure | ollama | openai-compatible) ' +
      'or provide ANTHROPIC_API_KEY / OPENAI_API_KEY.',
    );
  }

  switch (provider) {
    // ── Anthropic Claude ────────────────────────────────────────────────────
    case 'anthropic': {
      const { ChatAnthropic } = await import('@langchain/anthropic');
      const apiKey = config.get<string>('AI_API_KEY') ?? config.get<string>('ANTHROPIC_API_KEY');
      const modelName = config.get<string>('AI_MODEL') ?? 'claude-sonnet-4-20250514';
      return {
        label: `anthropic/${modelName}`,
        model: new ChatAnthropic({ apiKey, model: modelName, maxTokens }) as unknown as AnyChatModel,
      };
    }

    // ── OpenAI ──────────────────────────────────────────────────────────────
    case 'openai': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const apiKey = config.get<string>('AI_API_KEY') ?? config.get<string>('OPENAI_API_KEY');
      const modelName = config.get<string>('AI_MODEL') ?? 'gpt-4o';
      return {
        label: `openai/${modelName}`,
        model: new ChatOpenAI({ apiKey, model: modelName, maxTokens }) as unknown as AnyChatModel,
      };
    }

    // ── Azure OpenAI ────────────────────────────────────────────────────────
    case 'azure': {
      const { AzureChatOpenAI } = await import('@langchain/openai');
      const apiKey =
        config.get<string>('AI_API_KEY') ?? config.get<string>('AZURE_OPENAI_API_KEY');
      const deployment =
        config.get<string>('AI_AZURE_DEPLOYMENT') ?? config.get<string>('AI_MODEL') ?? 'gpt-4o';
      const instance = config.get<string>('AI_AZURE_INSTANCE');
      const apiVersion =
        config.get<string>('AI_AZURE_API_VERSION') ?? '2024-05-01-preview';

      const params: Record<string, unknown> = {
        azureOpenAIApiKey: apiKey,
        azureOpenAIApiDeploymentName: deployment,
        azureOpenAIApiVersion: apiVersion,
        maxTokens,
      };

      // AI_BASE_URL overrides the auto-generated endpoint (useful for sovereign clouds)
      const baseUrl = config.get<string>('AI_BASE_URL');
      if (baseUrl) {
        params.azureOpenAIBasePath = baseUrl;
      } else if (instance) {
        params.azureOpenAIApiInstanceName = instance;
      } else {
        throw new Error(
          'Azure OpenAI requires either AI_AZURE_INSTANCE (e.g. "my-company") or AI_BASE_URL.',
        );
      }

      return {
        label: `azure/${deployment}`,
        model: new AzureChatOpenAI(
          params as ConstructorParameters<typeof AzureChatOpenAI>[0],
        ) as unknown as AnyChatModel,
      };
    }

    // ── Ollama (local / private server) ─────────────────────────────────────
    case 'ollama': {
      const { ChatOllama } = await import('@langchain/ollama');
      const baseUrl = config.get<string>('AI_BASE_URL') ?? 'http://localhost:11434';
      const modelName = config.get<string>('AI_MODEL') ?? 'llama3';
      return {
        label: `ollama/${modelName}`,
        model: new ChatOllama({ baseUrl, model: modelName }) as unknown as AnyChatModel,
      };
    }

    // ── Generic OpenAI-compatible (vLLM, LM Studio, llama.cpp, etc.) ────────
    case 'openai-compatible': {
      const { ChatOpenAI } = await import('@langchain/openai');
      const baseUrl = config.get<string>('AI_BASE_URL');
      if (!baseUrl) {
        throw new Error(
          'openai-compatible provider requires AI_BASE_URL (e.g. http://localhost:8000/v1).',
        );
      }
      const apiKey = config.get<string>('AI_API_KEY') ?? 'local';
      const modelName = config.get<string>('AI_MODEL') ?? 'local-model';
      return {
        label: `openai-compatible/${modelName}`,
        model: new ChatOpenAI({
          apiKey,
          model: modelName,
          maxTokens,
          configuration: { baseURL: baseUrl },
        }) as unknown as AnyChatModel,
      };
    }

    default:
      throw new Error(
        `Unknown AI_PROVIDER "${provider}". ` +
        'Supported values: anthropic | openai | azure | ollama | openai-compatible',
      );
  }
}
