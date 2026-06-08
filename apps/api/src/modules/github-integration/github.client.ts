import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { createSign } from 'crypto';

/**
 * Thin GitHub REST client for Layer A health/reachability checks. Auth is
 * either a PAT (Bearer token) or a GitHub App (RS256-signed app JWT, optionally
 * exchanged for an installation token to read a specific repo). No SDK — axios
 * keeps the dependency surface small.
 */
export type GitAuth =
  | { kind: 'PAT'; token: string; baseUrl?: string | null }
  | { kind: 'APP'; appId: string; privateKey: string; installationId?: string | null; baseUrl?: string | null };

export interface GitHealth {
  ok: boolean;
  connectedAs?: string;
  error?: string;
}

@Injectable()
export class GitHubClient {
  private readonly logger = new Logger(GitHubClient.name);

  private api(baseUrl?: string | null): AxiosInstance {
    return axios.create({
      baseURL: baseUrl || 'https://api.github.com',
      timeout: 10_000,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'qa-platform-github-integration',
      },
    });
  }

  /** Authenticated identity probe — proves the credential works. */
  async health(auth: GitAuth): Promise<GitHealth> {
    try {
      if (auth.kind === 'PAT') {
        const { data } = await this.api(auth.baseUrl).get('/user', {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        return { ok: true, connectedAs: data?.login };
      }
      const jwt = this.mintAppJwt(auth.appId, auth.privateKey);
      const { data } = await this.api(auth.baseUrl).get('/app', {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      return { ok: true, connectedAs: data?.slug ? `app:${data.slug}` : 'app' };
    } catch (err) {
      return { ok: false, error: extractErr(err) };
    }
  }

  /** Confirm a specific repo is readable with the given auth. */
  async repoReachable(auth: GitAuth, owner: string, name: string): Promise<GitHealth> {
    try {
      const headers = await this.authHeader(auth);
      const { data } = await this.api(auth.baseUrl).get(`/repos/${owner}/${name}`, { headers });
      return { ok: true, connectedAs: data?.full_name };
    } catch (err) {
      return { ok: false, error: extractErr(err) };
    }
  }

  private async authHeader(auth: GitAuth): Promise<Record<string, string>> {
    if (auth.kind === 'PAT') return { Authorization: `Bearer ${auth.token}` };
    const jwt = this.mintAppJwt(auth.appId, auth.privateKey);
    if (!auth.installationId) return { Authorization: `Bearer ${jwt}` };
    // Exchange the app JWT for a short-lived installation token to read repos.
    const { data } = await this.api(auth.baseUrl).post(
      `/app/installations/${auth.installationId}/access_tokens`,
      {},
      { headers: { Authorization: `Bearer ${jwt}` } },
    );
    return { Authorization: `Bearer ${data.token}` };
  }

  /** RS256 app JWT (≤10 min), per GitHub App auth spec. */
  private mintAppJwt(appId: string, privateKeyPem: string): string {
    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const data = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 9 * 60, iss: appId })}`;
    const sig = createSign('RSA-SHA256').update(data).sign(privateKeyPem).toString('base64url');
    return `${data}.${sig}`;
  }
}

function extractErr(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { message?: string } }; message?: string };
  if (e.response?.status) return `GitHub ${e.response.status}: ${e.response.data?.message ?? 'request failed'}`;
  return e.message ?? 'unknown error';
}
