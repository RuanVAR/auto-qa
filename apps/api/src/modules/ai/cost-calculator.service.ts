import { Injectable } from '@nestjs/common';
import { AiProviderType } from './providers/provider.factory';

/**
 * Per-million-token prices in USD. Refreshed quarterly via PR — provider
 * price changes happen ~2× per year per family. When a provider doesn't
 * publish prices (Ollama, self-hosted) the calculator returns 0.
 *
 * Keys are matched as prefixes — `gpt-4o` matches `gpt-4o-2024-08-06`.
 * Longer keys are tried first so `gpt-4o-mini` beats `gpt-4o`.
 */
const PRICE_TABLE: Record<AiProviderType, Array<{ prefix: string; input: number; output: number }>> = {
  gemini: [
    // https://ai.google.dev/pricing
    { prefix: 'gemini-2.0-flash', input: 0.075, output: 0.30 },
    { prefix: 'gemini-2.0', input: 0.075, output: 0.30 },
    { prefix: 'gemini-1.5-flash', input: 0.075, output: 0.30 },
    { prefix: 'gemini-1.5-pro', input: 1.25, output: 5.00 },
    { prefix: 'gemini', input: 0.50, output: 1.50 },
  ],
  openai: [
    // https://openai.com/api/pricing/
    { prefix: 'gpt-4o-mini', input: 0.15, output: 0.60 },
    { prefix: 'gpt-4o', input: 2.50, output: 10.00 },
    { prefix: 'gpt-4-turbo', input: 10.00, output: 30.00 },
    { prefix: 'gpt-4', input: 30.00, output: 60.00 },
    { prefix: 'gpt-3.5', input: 0.50, output: 1.50 },
  ],
  anthropic: [
    // https://www.anthropic.com/pricing#api
    { prefix: 'claude-haiku-4', input: 0.80, output: 4.00 },
    { prefix: 'claude-haiku-3', input: 0.25, output: 1.25 },
    { prefix: 'claude-sonnet-4', input: 3.00, output: 15.00 },
    { prefix: 'claude-sonnet-3', input: 3.00, output: 15.00 },
    { prefix: 'claude-opus-4', input: 15.00, output: 75.00 },
    { prefix: 'claude-opus-3', input: 15.00, output: 75.00 },
  ],
  // Azure mirrors OpenAI prices; deployment names rarely match model names
  // exactly, so the fallback in `calculate` covers it.
  azure: [
    { prefix: 'gpt-4o-mini', input: 0.15, output: 0.60 },
    { prefix: 'gpt-4o', input: 2.50, output: 10.00 },
    { prefix: 'gpt-4-turbo', input: 10.00, output: 30.00 },
  ],
  ollama: [],
  'openai-compatible': [],
};

@Injectable()
export class AiCostCalculator {
  /**
   * Cost in USD for a single LLM call. `provider` + `modelName` come from
   * AiModelMeta — both fields are populated by the factory.
   */
  calculate(provider: AiProviderType, modelName: string, inputTokens: number, outputTokens: number): number {
    const table = PRICE_TABLE[provider] ?? [];
    // Sort by prefix length desc so 'gpt-4o-mini' beats 'gpt-4o'
    const sorted = [...table].sort((a, b) => b.prefix.length - a.prefix.length);
    const match = sorted.find((row) => modelName.startsWith(row.prefix));
    if (!match) return 0;
    const inputCost = (inputTokens / 1_000_000) * match.input;
    const outputCost = (outputTokens / 1_000_000) * match.output;
    return inputCost + outputCost;
  }

  /** Used by the UI catalogue — displays "input/output per 1M tokens" labels. */
  priceFor(provider: AiProviderType, modelName: string): { input: number; output: number } | null {
    const table = PRICE_TABLE[provider] ?? [];
    const sorted = [...table].sort((a, b) => b.prefix.length - a.prefix.length);
    const match = sorted.find((row) => modelName.startsWith(row.prefix));
    return match ? { input: match.input, output: match.output } : null;
  }
}
