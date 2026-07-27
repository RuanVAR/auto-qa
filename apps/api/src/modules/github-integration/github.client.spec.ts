import { GitHubTransport, SafeHttpError } from '@qa-platform/shared';
import { GitHubClient } from './github.client';

describe('GitHubClient', () => {
  const client = new GitHubClient();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('maps a shared PAT identity response to health metadata', async () => {
    jest.spyOn(GitHubTransport.prototype, 'identity')
      .mockResolvedValue({ login: 'octocat' });

    await expect(client.health({ kind: 'PAT', token: 'ghp_secret' })).resolves.toEqual({
      ok: true,
      connectedAs: 'octocat',
    });
  });

  it('maps a shared App identity response to health metadata', async () => {
    jest.spyOn(GitHubTransport.prototype, 'identity')
      .mockResolvedValue({ login: 'app:qa-platform' });

    await expect(client.health({
      kind: 'APP',
      appId: '123',
      privateKey: 'private-key',
      installationId: '456',
    })).resolves.toEqual({
      ok: true,
      connectedAs: 'app:qa-platform',
    });
  });

  it('delegates repository reachability to the shared transport', async () => {
    const repository = jest.spyOn(GitHubTransport.prototype, 'repository')
      .mockResolvedValue({ fullName: 'OpenAI/qa-platform' });

    await expect(client.repoReachable(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
    )).resolves.toEqual({
      ok: true,
      connectedAs: 'OpenAI/qa-platform',
    });
    expect(repository).toHaveBeenCalledWith(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
    );
  });

  it('delegates accessible repository listing to the shared transport', async () => {
    const listRepositories = jest.spyOn(GitHubTransport.prototype, 'listRepositories')
      .mockResolvedValue([{
        owner: 'OpenAI',
        name: 'qa-platform',
        fullName: 'OpenAI/qa-platform',
        defaultBranch: 'main',
        private: true,
        archived: false,
      }]);

    await expect(client.listRepositories({ kind: 'PAT', token: 'ghp_secret' }))
      .resolves.toHaveLength(1);
    expect(listRepositories).toHaveBeenCalledWith({ kind: 'PAT', token: 'ghp_secret' });
  });

  it('preserves the existing non-throwing error contract', async () => {
    jest.spyOn(GitHubTransport.prototype, 'identity')
      .mockRejectedValue(new SafeHttpError('HTTP 401: Bad credentials', 401));

    await expect(client.health({ kind: 'PAT', token: 'invalid' })).resolves.toEqual({
      ok: false,
      error: 'HTTP 401: Bad credentials',
    });
  });
});
