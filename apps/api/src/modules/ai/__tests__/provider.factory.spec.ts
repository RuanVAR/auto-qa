import { createAiModel } from '../providers/provider.factory';
import { ConfigService } from '@nestjs/config';

function makeConfig(overrides: Record<string, string | undefined> = {}) {
  return {
    get: jest.fn((key: string, def?: unknown) => overrides[key] ?? def),
  } as unknown as ConfigService;
}

describe('provider.factory — createAiModel', () => {
  it('throws when no provider is configured', async () => {
    const config = makeConfig({});
    await expect(createAiModel(config)).rejects.toThrow('No AI provider configured');
  });

  it('throws for unknown provider value', async () => {
    const config = makeConfig({ AI_PROVIDER: 'unknown-provider' });
    await expect(createAiModel(config)).rejects.toThrow('Unknown AI_PROVIDER');
  });

  it('throws for azure provider without instance or base url', async () => {
    const config = makeConfig({ AI_PROVIDER: 'azure', AI_API_KEY: 'key' });
    await expect(createAiModel(config)).rejects.toThrow('Azure OpenAI requires');
  });

  it('throws for openai-compatible without base url', async () => {
    const config = makeConfig({ AI_PROVIDER: 'openai-compatible' });
    await expect(createAiModel(config)).rejects.toThrow('requires AI_BASE_URL');
  });

  it('infers anthropic provider from ANTHROPIC_API_KEY legacy fallback', async () => {
    const config = makeConfig({ ANTHROPIC_API_KEY: 'ant-key' });
    // This will try to import @langchain/anthropic — in unit tests we just verify it
    // resolves a label correctly without actually hitting the network.
    // We mock the module to avoid real import.
    const { ChatAnthropic } = await import('@langchain/anthropic');
    jest.spyOn({ ChatAnthropic }, 'ChatAnthropic').mockImplementation(() => ({ invoke: jest.fn() }) as unknown as InstanceType<typeof ChatAnthropic>);

    // Just checking it doesn't throw with the key present
    await expect(createAiModel(config)).resolves.toMatchObject({
      label: expect.stringContaining('anthropic'),
    });
  });
});
