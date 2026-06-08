import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ProjectRepo, RepoIndexStatus, RepoRole } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { GitCredentialsService } from './git-credentials.service';
import { GitHubClient } from './github.client';

export interface LinkRepoInput {
  repoOwner: string;
  repoName: string;
  role?: RepoRole;
  defaultBranch?: string;
}

export interface UpdateRepoInput {
  role?: RepoRole;
  defaultBranch?: string;
  includeGlobs?: string[];
  excludeGlobs?: string[];
}

export interface PublicRepo {
  id: string;
  role: RepoRole;
  repoOwner: string;
  repoName: string;
  defaultBranch: string;
  status: RepoIndexStatus;
  chunkCount: number;
  lastIndexedAt: Date | null;
  createdAt: Date;
}

/**
 * Repos linked to a project (N → 1). Reuses the org's single GitHub credential
 * for auth; a repo is only linked once we confirm it's reachable. Indexing
 * fields (status/chunkCount) are placeholders until Layer C lands — `reindex`
 * just flags the repo PENDING for now.
 */
@Injectable()
export class ProjectReposService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: GitCredentialsService,
    private readonly github: GitHubClient,
  ) {}

  async list(projectId: string): Promise<PublicRepo[]> {
    const rows = await this.prisma.projectRepo.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPublic);
  }

  async link(projectId: string, input: LinkRepoInput): Promise<PublicRepo> {
    const owner = input.repoOwner?.trim();
    const name = input.repoName?.trim();
    if (!owner || !name) throw new BadRequestException('repoOwner and repoName are required');

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    const orgId = project.orgId;
    if (!orgId) throw new BadRequestException('Project is not attached to an organisation');

    const cred = await this.credentials.authForOrg(orgId);
    if (!cred) {
      throw new BadRequestException('Connect a GitHub credential for this org first (Org → GitHub).');
    }

    // Don't link a repo we can't actually read with the org credential.
    const reach = await this.github.repoReachable(cred.auth, owner, name);
    if (!reach.ok) {
      throw new BadRequestException(`Repo not reachable: ${reach.error ?? 'unknown error'}`);
    }

    return this.prisma.projectRepo
      .create({
        data: {
          orgId,
          projectId,
          credentialId: cred.credentialId,
          repoOwner: owner,
          repoName: name,
          role: input.role ?? RepoRole.OTHER,
          defaultBranch: input.defaultBranch?.trim() || 'main',
        },
      })
      .then(toPublic)
      .catch((e: unknown) => {
        if (isUniqueViolation(e)) throw new BadRequestException('That repo is already linked to this project');
        throw e;
      });
  }

  async update(repoId: string, patch: UpdateRepoInput): Promise<PublicRepo> {
    await this.mustExist(repoId);
    const row = await this.prisma.projectRepo.update({
      where: { id: repoId },
      data: {
        role: patch.role,
        defaultBranch: patch.defaultBranch?.trim() || undefined,
        includeGlobs: patch.includeGlobs,
        excludeGlobs: patch.excludeGlobs,
      },
    });
    return toPublic(row);
  }

  async unlink(repoId: string): Promise<void> {
    await this.mustExist(repoId);
    // Hard delete — cascades CodeChunk once Layer C lands; nothing to keep.
    await this.prisma.projectRepo.delete({ where: { id: repoId } }).catch(() => undefined);
  }

  /** Placeholder until Layer C indexing exists — flags the repo for (re)indexing. */
  async reindex(repoId: string): Promise<{ status: RepoIndexStatus }> {
    await this.mustExist(repoId);
    const row = await this.prisma.projectRepo.update({
      where: { id: repoId },
      data: { status: RepoIndexStatus.PENDING },
    });
    return { status: row.status };
  }

  private async mustExist(repoId: string): Promise<void> {
    const row = await this.prisma.projectRepo.findFirst({ where: { id: repoId, deletedAt: null }, select: { id: true } });
    if (!row) throw new NotFoundException('Repo not found');
  }
}

function toPublic(row: ProjectRepo): PublicRepo {
  return {
    id: row.id,
    role: row.role,
    repoOwner: row.repoOwner,
    repoName: row.repoName,
    defaultBranch: row.defaultBranch,
    status: row.status,
    chunkCount: row.chunkCount,
    lastIndexedAt: row.lastIndexedAt,
    createdAt: row.createdAt,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { code?: string }).code === 'P2002';
}
