import { createHash } from 'node:crypto';
import { requestJson, RetryingHttpOptions, SafeHttpError } from '../http/retrying-json';

export type EmbeddingProvider =
  | 'OPENAI'
  | 'GEMINI'
  | 'AZURE'
  | 'OLLAMA'
  | 'OPENAI_COMPATIBLE';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  azureDeployment?: string | null;
  azureApiVersion?: string | null;
}

export interface EmbeddingProbe {
  dimension: number;
  latencyMs: number;
}

export class EmbeddingClient {
  constructor(private readonly options: RetryingHttpOptions = {}) {}

  async probe(config: EmbeddingConfig): Promise<EmbeddingProbe> {
    const startedAt = Date.now();
    const [vector] = await this.embed(config, ['qa-platform-embedding-probe']);
    return { dimension: vector.length, latencyMs: Date.now() - startedAt };
  }

  async embedQuery(config: EmbeddingConfig, input: string): Promise<number[]> {
    const [vector] = await this.embed(config, [input]);
    return vector;
  }

  async embed(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
    if (inputs.length === 0) return [];
    validateConfig(config);
    let vectors: number[][];
    switch (config.provider) {
      case 'OPENAI':
      case 'OPENAI_COMPATIBLE':
        vectors = await this.openAi(config, inputs);
        break;
      case 'AZURE':
        vectors = await this.azure(config, inputs);
        break;
      case 'GEMINI':
        vectors = await this.gemini(config, inputs);
        break;
      case 'OLLAMA':
        vectors = await this.ollama(config, inputs);
        break;
    }
    validateVectors(vectors, inputs.length);
    return vectors;
  }

  private async openAi(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
    const baseUrl = (config.baseUrl
      || (config.provider === 'OPENAI' ? 'https://api.openai.com' : '')).replace(/\/$/, '');
    const { data } = await requestJson<{ data?: Array<{ index: number; embedding: number[] }> }>(
      `${baseUrl}/v1/embeddings`,
      {
        method: 'POST',
        headers: jsonHeaders(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        body: JSON.stringify({ model: config.model, input: inputs }),
      },
      { ...this.options, secrets: [config.apiKey] },
    );
    return (data.data ?? [])
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }

  private async azure(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
    const baseUrl = config.baseUrl?.replace(/\/$/, '') ?? '';
    const deployment = encodeURIComponent(config.azureDeployment ?? '');
    const apiVersion = encodeURIComponent(config.azureApiVersion ?? '2024-02-01');
    const { data } = await requestJson<{ data?: Array<{ index: number; embedding: number[] }> }>(
      `${baseUrl}/openai/deployments/${deployment}/embeddings?api-version=${apiVersion}`,
      {
        method: 'POST',
        headers: jsonHeaders({ 'api-key': config.apiKey ?? '' }),
        body: JSON.stringify({ input: inputs }),
      },
      { ...this.options, secrets: [config.apiKey] },
    );
    return (data.data ?? [])
      .sort((left, right) => left.index - right.index)
      .map((item) => item.embedding);
  }

  private async gemini(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
    const model = config.model.startsWith('models/') ? config.model : `models/${config.model}`;
    const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const { data } = await requestJson<{ embeddings?: Array<{ values?: number[] }> }>(
      `${baseUrl}/v1beta/${model}:batchEmbedContents?key=${encodeURIComponent(config.apiKey ?? '')}`,
      {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          requests: inputs.map((input) => ({
            model,
            content: { parts: [{ text: input }] },
          })),
        }),
      },
      { ...this.options, secrets: [config.apiKey] },
    );
    return (data.embeddings ?? []).map((item) => item.values ?? []);
  }

  private async ollama(config: EmbeddingConfig, inputs: string[]): Promise<number[][]> {
    const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    const { data } = await requestJson<{ embeddings?: number[][] }>(
      `${baseUrl}/api/embed`,
      {
        method: 'POST',
        headers: jsonHeaders(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        body: JSON.stringify({ model: config.model, input: inputs }),
      },
      { ...this.options, secrets: [config.apiKey] },
    );
    return data.embeddings ?? [];
  }
}

export function embeddingFingerprint(config: EmbeddingConfig, dimension: number): string {
  return createHash('sha256').update(JSON.stringify({
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl?.replace(/\/$/, '') || null,
    azureDeployment: config.azureDeployment || null,
    azureApiVersion: config.azureApiVersion || null,
    dimension,
  })).digest('hex');
}

function validateConfig(config: EmbeddingConfig): void {
  if (!config.model.trim()) throw new SafeHttpError('Embedding model is required');
  if (config.provider !== 'OLLAMA' && !config.apiKey) {
    throw new SafeHttpError(`API key is required for ${config.provider} embeddings`);
  }
  if (config.provider === 'OPENAI_COMPATIBLE' && !config.baseUrl) {
    throw new SafeHttpError('Base URL is required for OpenAI-compatible embeddings');
  }
  if (config.provider === 'AZURE') {
    if (!config.baseUrl) throw new SafeHttpError('Azure endpoint URL is required');
    if (!config.azureDeployment) throw new SafeHttpError('Azure deployment is required');
  }
}

function validateVectors(vectors: number[][], expectedCount: number): void {
  if (vectors.length !== expectedCount || vectors.some((vector) => vector.length === 0)) {
    throw new SafeHttpError('Embedding provider returned a malformed vector response');
  }
  const dimension = vectors[0].length;
  if (vectors.some((vector) =>
    vector.length !== dimension || vector.some((value) => !Number.isFinite(value)))) {
    throw new SafeHttpError('Embedding provider returned inconsistent vector dimensions');
  }
}

function jsonHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    ...extra,
  };
}
