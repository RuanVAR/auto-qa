import { Injectable } from '@nestjs/common';
import {
  GitHubAuth,
  GitHubBranch,
  GitHubFile,
  GitHubRepository,
  GitHubTransport,
} from '@qa-platform/shared';
import { Readable } from 'node:stream';

export type GitAuth = GitHubAuth;

export interface GitHealth {
  ok: boolean;
  connectedAs?: string;
  error?: string;
}

/**
 * Thin Nest wrapper over the shared GitHub transport. The future indexer uses
 * GitHubTransport directly; API consumers keep this non-throwing health surface.
 */
@Injectable()
export class GitHubClient {
  private readonly transport = new GitHubTransport();

  async health(auth: GitAuth): Promise<GitHealth> {
    try {
      const identity = await this.transport.identity(auth);
      return { ok: true, connectedAs: identity.login };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  async repoReachable(auth: GitAuth, owner: string, name: string): Promise<GitHealth> {
    try {
      const repository = await this.transport.repository(auth, owner, name);
      return { ok: true, connectedAs: repository.fullName };
    } catch (error) {
      return { ok: false, error: message(error) };
    }
  }

  listRepositories(auth: GitAuth): Promise<GitHubRepository[]> {
    return this.transport.listRepositories(auth);
  }

  listBranches(auth: GitAuth, owner: string, name: string): Promise<GitHubBranch[]> {
    return this.transport.listBranches(auth, owner, name);
  }

  getBranchHead(auth: GitAuth, owner: string, name: string, branch: string): Promise<string> {
    return this.transport.getBranchHead(auth, owner, name, branch);
  }

  getFileContent(
    auth: GitAuth,
    owner: string,
    name: string,
    path: string,
    ref: string,
  ): Promise<GitHubFile> {
    return this.transport.getFileContent(auth, owner, name, path, ref);
  }

  downloadTarball(
    auth: GitAuth,
    owner: string,
    name: string,
    ref: string,
  ): Promise<{ stream: Readable; contentLength: number | null }> {
    return this.transport.downloadTarball(auth, owner, name, ref);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : 'GitHub request failed';
}
