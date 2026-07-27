import { generateKeyPairSync } from 'node:crypto';
import { GitHubTransport } from './transport';

function json(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('GitHubTransport', () => {
  const fetchMock = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
  const transport = new GitHubTransport({
    fetchImpl: fetchMock,
    sleep: async () => undefined,
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('uses PAT bearer authentication for identity checks', async () => {
    fetchMock.mockResolvedValue(json({ login: 'octocat' }));

    await expect(transport.identity({ kind: 'PAT', token: 'ghp_secret' }))
      .resolves.toEqual({ login: 'octocat' });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.headers).toMatchObject({ Authorization: 'Bearer ghp_secret' });
  });

  it('exchanges a GitHub App JWT for an installation token', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    fetchMock
      .mockResolvedValueOnce(json({ token: 'installation-token' }))
      .mockResolvedValueOnce(json({ full_name: 'OpenAI/qa-platform' }));

    await expect(transport.repository({
      kind: 'APP',
      appId: '123',
      installationId: '456',
      privateKey: privateKeyPem,
    }, 'OpenAI', 'qa-platform')).resolves.toEqual({
      fullName: 'OpenAI/qa-platform',
    });

    expect(String(fetchMock.mock.calls[0][0])).toContain('/app/installations/456/access_tokens');
    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    expect(firstInit.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Bearer [^.]+\.[^.]+\.[^.]+$/),
    });
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(secondInit.headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
  });

  it('paginates branches until a short page is returned', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      name: `branch-${index}`,
      commit: { sha: `sha-${index}` },
    }));
    fetchMock
      .mockResolvedValueOnce(json(firstPage))
      .mockResolvedValueOnce(json([{ name: 'last', commit: { sha: 'sha-last' } }]));

    const branches = await transport.listBranches(
      { kind: 'PAT', token: 'secret' },
      'OpenAI',
      'qa-platform',
    );

    expect(branches).toHaveLength(101);
    expect(String(fetchMock.mock.calls[1][0])).toContain('page=2');
  });

  it('lists the same fixture branches with PAT and App authentication', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const appAuth = {
      kind: 'APP' as const,
      appId: '123',
      installationId: '456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    };
    const fixture = [{ name: 'main', commit: { sha: 'sha-main' } }];
    fetchMock
      .mockResolvedValueOnce(json(fixture))
      .mockResolvedValueOnce(json({ token: 'installation-token' }))
      .mockResolvedValueOnce(json(fixture));

    const patBranches = await transport.listBranches(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
    );
    const appBranches = await transport.listBranches(
      appAuth,
      'OpenAI',
      'qa-platform',
    );

    expect(appBranches).toEqual(patBranches);
  });

  it('lists and sorts repositories available to a PAT', async () => {
    fetchMock.mockResolvedValueOnce(json([
      {
        owner: { login: 'OpenAI' },
        name: 'zeta',
        full_name: 'OpenAI/zeta',
        default_branch: 'develop',
        private: true,
        archived: false,
      },
      {
        owner: { login: 'octocat' },
        name: 'alpha',
        full_name: 'octocat/alpha',
        default_branch: 'main',
        private: false,
        archived: false,
      },
    ]));

    await expect(transport.listRepositories({
      kind: 'PAT',
      token: 'ghp_secret',
    })).resolves.toEqual([
      {
        owner: 'octocat',
        name: 'alpha',
        fullName: 'octocat/alpha',
        defaultBranch: 'main',
        private: false,
        archived: false,
      },
      {
        owner: 'OpenAI',
        name: 'zeta',
        fullName: 'OpenAI/zeta',
        defaultBranch: 'develop',
        private: true,
        archived: false,
      },
    ]);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/user/repos?');
  });

  it('uses installation repositories for GitHub App authentication', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    fetchMock
      .mockResolvedValueOnce(json({ token: 'installation-token' }))
      .mockResolvedValueOnce(json({
        total_count: 1,
        repositories: [{
          owner: { login: 'OpenAI' },
          name: 'qa-platform',
          full_name: 'OpenAI/qa-platform',
          default_branch: 'main',
          private: true,
          archived: false,
        }],
      }));

    const repositories = await transport.listRepositories({
      kind: 'APP',
      appId: '123',
      installationId: '456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    });

    expect(repositories).toHaveLength(1);
    expect(String(fetchMock.mock.calls[1][0])).toContain('/installation/repositories?');
  });

  it('never forwards authorization to a tarball redirect host', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 302,
        headers: { location: 'https://codeload.github.com/OpenAI/qa-platform/tar.gz/main' },
      }))
      .mockResolvedValueOnce(new Response('archive', {
        status: 200,
        headers: { 'content-length': '7' },
      }));

    const result = await transport.downloadTarball(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
      'main',
    );

    const firstInit = fetchMock.mock.calls[0][1] as RequestInit;
    const secondInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(firstInit.headers).toMatchObject({ Authorization: 'Bearer ghp_secret' });
    expect(secondInit.headers).not.toHaveProperty('Authorization');
    expect(result.contentLength).toBe(7);
  });

  it('honors Retry-After when a tarball request is rate limited', async () => {
    const sleep = jest.fn(async () => undefined);
    const retryingTransport = new GitHubTransport({
      fetchImpl: fetchMock,
      sleep,
    });
    fetchMock
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { 'retry-after': '3' },
      }))
      .mockResolvedValueOnce(new Response('archive', { status: 200 }));

    await retryingTransport.downloadTarball(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
      'main',
    );

    expect(sleep).toHaveBeenCalledWith(3_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('downloads a fixture archive with GitHub App installation auth', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    fetchMock
      .mockResolvedValueOnce(json({ token: 'installation-token' }))
      .mockResolvedValueOnce(new Response('archive', { status: 200 }));

    const result = await transport.downloadTarball({
      kind: 'APP',
      appId: '123',
      installationId: '456',
      privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    }, 'OpenAI', 'qa-platform', 'main');

    const archiveInit = fetchMock.mock.calls[1][1] as RequestInit;
    expect(archiveInit.headers).toMatchObject({
      Authorization: 'Bearer installation-token',
    });
    expect(result.stream).toBeDefined();
  });

  it('reads a text file with a hard 200 KB decoded-content limit', async () => {
    fetchMock.mockResolvedValue(json({
      path: 'src/login.ts',
      sha: 'file-sha',
      size: 29,
      encoding: 'base64',
      content: Buffer.from('export const route = "/login";').toString('base64'),
    }));

    await expect(transport.getFileContent(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
      'src/login.ts',
      'main',
    )).resolves.toEqual({
      path: 'src/login.ts',
      sha: 'file-sha',
      size: 29,
      content: 'export const route = "/login";',
    });
  });

  it('rejects decoded file content over 200 KB', async () => {
    const oversized = Buffer.alloc((200 * 1024) + 1, 0x61);
    fetchMock.mockResolvedValue(json({
      path: 'src/generated.ts',
      sha: 'file-sha',
      size: oversized.length,
      encoding: 'base64',
      content: oversized.toString('base64'),
    }));

    await expect(transport.getFileContent(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
      'src/generated.ts',
      'main',
    )).rejects.toThrow('exceeds the 204800-byte response limit');
  });

  it('honors Retry-After when a file read is rate limited', async () => {
    const sleep = jest.fn(async () => undefined);
    const retryingTransport = new GitHubTransport({
      fetchImpl: fetchMock,
      sleep,
    });
    fetchMock
      .mockResolvedValueOnce(json(
        { message: 'rate limited' },
        { status: 429, headers: { 'retry-after': '2' } },
      ))
      .mockResolvedValueOnce(json({
        path: 'src/login.ts',
        sha: 'file-sha',
        size: 5,
        encoding: 'base64',
        content: Buffer.from('login').toString('base64'),
      }));

    await retryingTransport.getFileContent(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
      'src/login.ts',
      'main',
    );

    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('redacts tokens from provider errors', async () => {
    fetchMock.mockResolvedValue(json(
      { message: 'token ghp_secret rejected' },
      { status: 401 },
    ));

    await expect(transport.identity({ kind: 'PAT', token: 'ghp_secret' }))
      .rejects.toThrow('token [REDACTED] rejected');
  });

  it.each([403, 404])('returns a bounded HTTP %s error without retrying', async (status) => {
    fetchMock.mockResolvedValue(json({ message: 'request rejected' }, { status }));

    await expect(transport.repository(
      { kind: 'PAT', token: 'ghp_secret' },
      'OpenAI',
      'qa-platform',
    )).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
