import { EmbeddingClient, EmbeddingConfig, embeddingFingerprint } from './client';

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('EmbeddingClient', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const sleep = jest.fn(async () => undefined);
  const client = new EmbeddingClient({ fetchImpl: fetchMock, sleep });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    {
      provider: 'OPENAI' as const,
      config: { provider: 'OPENAI' as const, model: 'text-embedding-3-small', apiKey: 'key' },
      response: { data: [{ index: 0, embedding: [1, 2, 3] }] },
      url: 'https://api.openai.com/v1/embeddings',
    },
    {
      provider: 'OPENAI_COMPATIBLE' as const,
      config: {
        provider: 'OPENAI_COMPATIBLE' as const,
        model: 'local',
        apiKey: 'key',
        baseUrl: 'https://embeddings.example',
      },
      response: { data: [{ index: 0, embedding: [1, 2, 3] }] },
      url: 'https://embeddings.example/v1/embeddings',
    },
    {
      provider: 'AZURE' as const,
      config: {
        provider: 'AZURE' as const,
        model: 'text-embedding-3-small',
        apiKey: 'key',
        baseUrl: 'https://qa.openai.azure.com',
        azureDeployment: 'embedding',
        azureApiVersion: '2024-02-01',
      },
      response: { data: [{ index: 0, embedding: [1, 2, 3] }] },
      url: 'https://qa.openai.azure.com/openai/deployments/embedding/embeddings?api-version=2024-02-01',
    },
    {
      provider: 'GEMINI' as const,
      config: { provider: 'GEMINI' as const, model: 'text-embedding-004', apiKey: 'key' },
      response: { embeddings: [{ values: [1, 2, 3] }] },
      url: 'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:batchEmbedContents?key=key',
    },
    {
      provider: 'OLLAMA' as const,
      config: {
        provider: 'OLLAMA' as const,
        model: 'nomic-embed-text',
        baseUrl: 'http://ollama:11434',
      },
      response: { embeddings: [[1, 2, 3]] },
      url: 'http://ollama:11434/api/embed',
    },
  ])('supports $provider embedding responses', async ({ config, response, url }) => {
    fetchMock.mockResolvedValue(json(response));

    await expect(client.embed(config, ['hello'])).resolves.toEqual([[1, 2, 3]]);
    expect(String(fetchMock.mock.calls[0][0])).toBe(url);
  });

  it('retries a 429 response using Retry-After', async () => {
    const config: EmbeddingConfig = {
      provider: 'OPENAI',
      model: 'text-embedding-3-small',
      apiKey: 'key',
    };
    fetchMock
      .mockResolvedValueOnce(json({ message: 'rate limited' }, {
        status: 429,
        headers: { 'content-type': 'application/json', 'retry-after': '2' },
      }))
      .mockResolvedValueOnce(json({
        data: [{ index: 0, embedding: [1, 2, 3] }],
      }));

    await expect(client.embed(config, ['hello'])).resolves.toEqual([[1, 2, 3]]);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it('rejects inconsistent vector dimensions', async () => {
    fetchMock.mockResolvedValue(json({
      data: [
        { index: 0, embedding: [1, 2, 3] },
        { index: 1, embedding: [1, 2] },
      ],
    }));

    await expect(client.embed({
      provider: 'OPENAI',
      model: 'text-embedding-3-small',
      apiKey: 'key',
    }, ['one', 'two'])).rejects.toThrow('inconsistent vector dimensions');
  });

  it('redacts API keys from errors', async () => {
    fetchMock.mockResolvedValue(json(
      { message: 'credential secret-key rejected' },
      { status: 401 },
    ));

    await expect(client.embed({
      provider: 'OPENAI',
      model: 'text-embedding-3-small',
      apiKey: 'secret-key',
    }, ['hello'])).rejects.toThrow('credential [REDACTED] rejected');
  });

  it('generates stable fingerprints without including the API key', () => {
    const base = {
      provider: 'OPENAI' as const,
      model: 'text-embedding-3-small',
    };
    expect(embeddingFingerprint({ ...base, apiKey: 'first' }, 1536))
      .toBe(embeddingFingerprint({ ...base, apiKey: 'second' }, 1536));
    expect(embeddingFingerprint(base, 1536))
      .not.toBe(embeddingFingerprint(base, 3072));
  });
});
