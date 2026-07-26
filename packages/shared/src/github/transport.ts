import { createSign } from 'node:crypto';
import { Readable } from 'node:stream';
import {
  isRetryableStatus,
  requestJson,
  retryDelayMs,
  RetryingHttpOptions,
  SafeHttpError,
} from '../http/retrying-json';

export type GitHubAuth =
  | { kind: 'PAT'; token: string; baseUrl?: string | null }
  | {
      kind: 'APP';
      appId: string;
      privateKey: string;
      installationId?: string | null;
      baseUrl?: string | null;
    };

export interface GitHubIdentity {
  login: string;
}

export interface GitHubBranch {
  name: string;
  sha: string;
}

export interface GitHubRepository {
  owner: string;
  name: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
}

export interface GitHubFile {
  path: string;
  sha: string;
  content: string;
  size: number;
}

export interface GitHubRateLimit {
  remaining: number | null;
  resetAt: Date | null;
}

export interface GitHubTransportOptions extends RetryingHttpOptions {
  maxPages?: number;
}

export class GitHubTransport {
  constructor(private readonly options: GitHubTransportOptions = {}) {}

  async identity(auth: GitHubAuth): Promise<GitHubIdentity> {
    if (auth.kind === 'PAT') {
      const { data } = await this.apiJson<{ login?: string }>(auth, '/user');
      return { login: data.login ?? 'unknown' };
    }
    const { data } = await this.apiJson<{ slug?: string }>(auth, '/app', true);
    return { login: data.slug ? `app:${data.slug}` : 'app' };
  }

  async repository(auth: GitHubAuth, owner: string, name: string): Promise<{ fullName: string }> {
    const { data } = await this.apiJson<{ full_name?: string }>(
      auth,
      `/repos/${part(owner)}/${part(name)}`,
    );
    return { fullName: data.full_name ?? `${owner}/${name}` };
  }

  async listRepositories(auth: GitHubAuth): Promise<GitHubRepository[]> {
    const repositories: GitHubRepository[] = [];
    const maxPages = this.options.maxPages ?? 20;
    for (let page = 1; page <= maxPages; page += 1) {
      const path = auth.kind === 'APP'
        ? `/installation/repositories?per_page=100&page=${page}`
        : `/user/repos?per_page=100&page=${page}&affiliation=owner,collaborator,organization_member&sort=full_name&direction=asc`;
      const { data } = await this.apiJson<
        Array<GitHubRepositoryResponse>
        | { repositories?: Array<GitHubRepositoryResponse> }
      >(auth, path);
      const pageRows = Array.isArray(data) ? data : (data.repositories ?? []);
      repositories.push(...pageRows.map(toRepository));
      if (pageRows.length < 100) break;
      if (page === maxPages) {
        throw new SafeHttpError(`GitHub repository pagination exceeded ${maxPages} pages`);
      }
    }
    return repositories.sort((left, right) =>
      left.fullName.localeCompare(right.fullName, undefined, { sensitivity: 'base' }),
    );
  }

  async listBranches(auth: GitHubAuth, owner: string, name: string): Promise<GitHubBranch[]> {
    const branches: GitHubBranch[] = [];
    const maxPages = this.options.maxPages ?? 20;
    for (let page = 1; page <= maxPages; page += 1) {
      const { data } = await this.apiJson<Array<{ name: string; commit: { sha: string } }>>(
        auth,
        `/repos/${part(owner)}/${part(name)}/branches?per_page=100&page=${page}`,
      );
      branches.push(...data.map((branch) => ({
        name: branch.name,
        sha: branch.commit.sha,
      })));
      if (data.length < 100) break;
      if (page === maxPages) {
        throw new SafeHttpError(`GitHub branch pagination exceeded ${maxPages} pages`);
      }
    }
    return branches;
  }

  async getBranchHead(
    auth: GitHubAuth,
    owner: string,
    name: string,
    branch: string,
  ): Promise<string> {
    const { data } = await this.apiJson<{ commit?: { sha?: string } }>(
      auth,
      `/repos/${part(owner)}/${part(name)}/branches/${part(branch)}`,
    );
    if (!data.commit?.sha) throw new SafeHttpError('GitHub branch response did not include a commit SHA');
    return data.commit.sha;
  }

  async getFileContent(
    auth: GitHubAuth,
    owner: string,
    name: string,
    path: string,
    ref: string,
    maxBytes = 200 * 1024,
  ): Promise<GitHubFile> {
    const encodedPath = path.split('/').map(part).join('/');
    const { data } = await this.apiJson<{
      path?: string;
      sha?: string;
      size?: number;
      encoding?: string;
      content?: string;
    }>(
      auth,
      `/repos/${part(owner)}/${part(name)}/contents/${encodedPath}?ref=${part(ref)}`,
    );
    if (data.encoding !== 'base64' || !data.content || !data.sha) {
      throw new SafeHttpError('GitHub file response was malformed');
    }
    const bytes = Buffer.from(data.content.replace(/\s/g, ''), 'base64');
    if (bytes.length > maxBytes) {
      throw new SafeHttpError(`GitHub file exceeds the ${maxBytes}-byte response limit`);
    }
    return {
      path: data.path ?? path,
      sha: data.sha,
      size: data.size ?? bytes.length,
      content: bytes.toString('utf8'),
    };
  }

  async downloadTarball(
    auth: GitHubAuth,
    owner: string,
    name: string,
    ref: string,
  ): Promise<{ stream: Readable; contentLength: number | null; rateLimit: GitHubRateLimit }> {
    const fetchImpl = this.options.fetchImpl ?? fetch;
    const headers = await this.authHeaders(auth);
    let url = `${apiBase(auth.baseUrl)}/repos/${part(owner)}/${part(name)}/tarball/${part(ref)}`;

    for (let redirect = 0; redirect <= 3; redirect += 1) {
      const response = await this.fetchTarballResponse(
        fetchImpl,
        url,
        redirect === 0 ? headers : githubHeaders(),
      );
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) throw new SafeHttpError('GitHub tarball redirect omitted its location');
        const next = new URL(location, url);
        if (next.protocol !== 'https:') {
          throw new SafeHttpError('GitHub tarball redirect must use HTTPS');
        }
        url = next.toString();
        continue;
      }
      if (!response.ok || !response.body) {
        throw new SafeHttpError(`GitHub tarball request failed with HTTP ${response.status}`, response.status);
      }
      return {
        stream: Readable.from(readWebStream(response.body)),
        contentLength: numberHeader(response.headers.get('content-length')),
        rateLimit: rateLimit(response),
      };
    }
    throw new SafeHttpError('GitHub tarball exceeded the redirect limit');
  }

  private async fetchTarballResponse(
    fetchImpl: typeof fetch,
    url: string,
    headers: Record<string, string>,
  ): Promise<Response> {
    const retries = this.options.maxRetries ?? 2;
    const sleep = this.options.sleep ?? ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const response = await fetchImpl(url, {
          headers,
          redirect: 'manual',
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 30_000),
        });
        if (
          attempt < retries
          && isRetryableStatus(response.status)
        ) {
          await sleep(retryDelayMs(response, attempt));
          continue;
        }
        return response;
      } catch (error) {
        if (attempt === retries) {
          throw new SafeHttpError(message(error));
        }
        await sleep(250 * (2 ** attempt));
      }
    }
    throw new SafeHttpError('GitHub tarball request failed');
  }

  private async apiJson<T>(
    auth: GitHubAuth,
    path: string,
    appOnly = false,
  ): Promise<{ data: T; rateLimit: GitHubRateLimit }> {
    const headers = appOnly && auth.kind === 'APP'
      ? { ...githubHeaders(), Authorization: `Bearer ${mintAppJwt(auth.appId, auth.privateKey)}` }
      : await this.authHeaders(auth);
    const result = await requestJson<T>(
      `${apiBase(auth.baseUrl)}${path}`,
      { headers },
      {
        ...this.options,
        secrets: auth.kind === 'PAT'
          ? [auth.token]
          : [auth.privateKey],
      },
    );
    return { data: result.data, rateLimit: rateLimit(result.response) };
  }

  private async authHeaders(auth: GitHubAuth): Promise<Record<string, string>> {
    if (auth.kind === 'PAT') {
      return { ...githubHeaders(), Authorization: `Bearer ${auth.token}` };
    }
    const jwt = mintAppJwt(auth.appId, auth.privateKey);
    if (!auth.installationId) {
      return { ...githubHeaders(), Authorization: `Bearer ${jwt}` };
    }
    const { data } = await requestJson<{ token?: string }>(
      `${apiBase(auth.baseUrl)}/app/installations/${part(auth.installationId)}/access_tokens`,
      {
        method: 'POST',
        headers: { ...githubHeaders(), Authorization: `Bearer ${jwt}` },
      },
      { ...this.options, secrets: [auth.privateKey] },
    );
    if (!data.token) throw new SafeHttpError('GitHub installation token response was malformed');
    return { ...githubHeaders(), Authorization: `Bearer ${data.token}` };
  }
}

interface GitHubRepositoryResponse {
  owner?: { login?: string };
  name?: string;
  full_name?: string;
  default_branch?: string;
  private?: boolean;
  archived?: boolean;
}

function toRepository(repository: GitHubRepositoryResponse): GitHubRepository {
  const owner = repository.owner?.login?.trim() ?? '';
  const name = repository.name?.trim() ?? '';
  if (!owner || !name) {
    throw new SafeHttpError('GitHub repository response was malformed');
  }
  return {
    owner,
    name,
    fullName: repository.full_name?.trim() || `${owner}/${name}`,
    defaultBranch: repository.default_branch?.trim() || 'main',
    private: repository.private ?? false,
    archived: repository.archived ?? false,
  };
}

function githubHeaders(): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'qa-platform-github-integration',
  };
}

function apiBase(baseUrl?: string | null): string {
  return (baseUrl || 'https://api.github.com').replace(/\/$/, '');
}

function part(value: string): string {
  return encodeURIComponent(value);
}

function mintAppJwt(appId: string, privateKeyPem: string): string {
  const now = Math.floor(Date.now() / 1000);
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
    iat: now - 60,
    exp: now + 9 * 60,
    iss: appId,
  })}`;
  const signature = createSign('RSA-SHA256')
    .update(payload)
    .sign(privateKeyPem)
    .toString('base64url');
  return `${payload}.${signature}`;
}

function rateLimit(response: Response): GitHubRateLimit {
  const remaining = numberHeader(response.headers.get('x-ratelimit-remaining'));
  const reset = numberHeader(response.headers.get('x-ratelimit-reset'));
  return {
    remaining,
    resetAt: reset === null ? null : new Date(reset * 1_000),
  };
}

function numberHeader(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function* readWebStream(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<Buffer> {
  const reader = stream.getReader();
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return;
      yield Buffer.from(result.value);
    }
  } finally {
    reader.releaseLock();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'GitHub tarball request failed';
}
