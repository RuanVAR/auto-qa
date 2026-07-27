import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { embeddingCredentialsApi } from '@/lib/api';
import { EmbeddingSettingsSection } from './EmbeddingSettingsSection';

vi.mock('@/lib/api', () => ({
  embeddingCredentialsApi: {
    get: vi.fn(),
    upsert: vi.fn(),
    test: vi.fn(),
    remove: vi.fn(),
  },
}));

describe('EmbeddingSettingsSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(embeddingCredentialsApi.get).mockResolvedValue({
      provider: 'OPENAI',
      model: 'text-embedding-3-small',
      baseUrl: null,
      azureDeployment: null,
      azureApiVersion: null,
      dimension: 1536,
      configFingerprint: 'fingerprint',
      active: true,
      apiKey: '••••••••',
      createdAt: '2026-07-24T10:00:00.000Z',
      updatedAt: '2026-07-24T10:00:00.000Z',
    });
  });

  it('renders saved embedding metadata without exposing a plaintext key', async () => {
    renderSection();

    expect(await screen.findByText('1536 dimensions')).toBeInTheDocument();
    expect(screen.getByDisplayValue('••••••••')).toHaveAttribute('type', 'password');
    const options = Array.from(
      screen.getByRole('combobox').querySelectorAll('option'),
      (option) => option.value,
    );
    expect(options).not.toContain('ANTHROPIC');
  });

  it('shows the keyless Ollama base URL when the provider changes', async () => {
    renderSection();
    const provider = await screen.findByRole('combobox');

    await userEvent.selectOptions(provider, 'OLLAMA');

    expect(screen.getByDisplayValue('http://host.docker.internal:11434'))
      .toBeInTheDocument();
    expect(screen.getByText('API key (optional)')).toBeInTheDocument();
  });
});

function renderSection() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <EmbeddingSettingsSection orgId="org-1" />
    </QueryClientProvider>,
  );
}
