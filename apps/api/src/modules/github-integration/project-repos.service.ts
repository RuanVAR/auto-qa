import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ProjectRepo,
  RepoBranchIndex,
  RepoIndexStatus,
  RepoRole,
} from '@prisma/client';
import {
  isHardDeniedRepoPath,
  isProbablyBinary,
  validateRepoFilePath,
  type GitHubBranch,
  type GitHubRepository,
} from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CodeIndexRequestService } from '../codebase-indexing/code-index-request.service';
import type { LinkRepoDto } from './dto/link-repo.dto';
import type { RepoEnvBindingInputDto } from './dto/put-repo-env-bindings.dto';
import type { UpdateRepoDto } from './dto/update-repo.dto';
import { GitCredentialsService } from './git-credentials.service';
import { GitHubClient } from './github.client';

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
 * fields aggregate the branch-generation state maintained by the dedicated
 * indexer service.
 */
@Injectable()
export class ProjectReposService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly credentials: GitCredentialsService,
    private readonly github: GitHubClient,
    private readonly indexRequests: CodeIndexRequestService,
  ) {}

  async list(projectId: string): Promise<PublicRepo[]> {
    const rows = await this.prisma.projectRepo.findMany({
      where: { projectId, deletedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toPublic);
  }

  async listAvailable(projectId: string): Promise<GitHubRepository[]> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.orgId) {
      throw new BadRequestException('Project is not attached to an organisation');
    }
    const credential = await this.credentials.authForOrg(project.orgId);
    if (!credential) {
      throw new BadRequestException('Connect a GitHub credential for this org first (Org → GitHub).');
    }
    const [available, linked] = await Promise.all([
      this.github.listRepositories(credential.auth),
      this.prisma.projectRepo.findMany({
        where: { projectId, deletedAt: null },
        select: { repoOwner: true, repoName: true },
      }),
    ]);
    const linkedNames = new Set(
      linked.map((repo) => `${repo.repoOwner}/${repo.repoName}`.toLowerCase()),
    );
    return available.filter((repo) => !linkedNames.has(repo.fullName.toLowerCase()));
  }

  async link(projectId: string, input: LinkRepoDto, requestedById?: string): Promise<PublicRepo> {
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

    const [canonicalOwner, canonicalName] = reach.connectedAs?.split('/') ?? [];
    const repoOwner = canonicalOwner || owner;
    const repoName = canonicalName || name;
    const removed = await this.prisma.projectRepo.findFirst({
      where: {
        projectId,
        repoOwner: { equals: repoOwner, mode: 'insensitive' },
        repoName: { equals: repoName, mode: 'insensitive' },
        deletedAt: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
    });
    let row: ProjectRepo;
    if (removed) {
      row = await this.prisma.projectRepo.update({
        where: { id: removed.id },
        data: {
          orgId,
          credentialId: cred.credentialId,
          repoOwner,
          repoName,
          role: input.role ?? RepoRole.OTHER,
          defaultBranch: input.defaultBranch?.trim() || 'main',
          secretsCiphertext: null,
          secretsKeyId: null,
          status: RepoIndexStatus.PENDING,
          chunkCount: 0,
          lastIndexedAt: null,
          webhookSecret: null,
          webhookExternalId: null,
          deletedAt: null,
        },
      });
    } else {
      try {
        row = await this.prisma.projectRepo.create({
        data: {
          orgId,
          projectId,
          credentialId: cred.credentialId,
          repoOwner,
          repoName,
          role: input.role ?? RepoRole.OTHER,
          defaultBranch: input.defaultBranch?.trim() || 'main',
        },
        });
      } catch (e: unknown) {
        if (isUniqueViolation(e)) throw new BadRequestException('That repo is already linked to this project');
        throw e;
      }
    }
    const branchIndex = await this.indexRequests.request({
      projectId,
      repoId: row.id,
      branch: row.defaultBranch,
      force: false,
      trigger: 'INITIAL',
      requestedById,
    });
    return toPublic({ ...row, status: branchIndex.status });
  }

  async update(
    projectId: string,
    repoId: string,
    patch: UpdateRepoDto,
    requestedById?: string,
  ): Promise<PublicRepo> {
    const existing = await this.mustExist(projectId, repoId);
    const branchChanged = patch.defaultBranch !== undefined
      && patch.defaultBranch.trim() !== existing.defaultBranch;
    await this.prisma.projectRepo.updateMany({
      where: { id: repoId, projectId, orgId: existing.orgId, deletedAt: null },
      data: {
        role: patch.role,
        defaultBranch: patch.defaultBranch?.trim() || undefined,
        includeGlobs: patch.includeGlobs,
        excludeGlobs: patch.excludeGlobs,
        ...(branchChanged ? { status: RepoIndexStatus.PENDING } : {}),
      },
    });
    const row = await this.mustExist(projectId, repoId);
    if (branchChanged) {
      const branchIndex = await this.indexRequests.request({
        projectId,
        repoId,
        branch: row.defaultBranch,
        force: false,
        trigger: 'BINDING_CHANGE',
        requestedById,
      });
      return toPublic({ ...row, status: branchIndex.status });
    }
    return toPublic(row);
  }

  async unlink(projectId: string, repoId: string): Promise<void> {
    const row = await this.mustExist(projectId, repoId);
    const now = new Date();
    const [result] = await this.prisma.$transaction([
      this.prisma.projectRepo.updateMany({
        where: { id: repoId, projectId, orgId: row.orgId, deletedAt: null },
        data: {
          deletedAt: now,
          secretsCiphertext: row.secretsCiphertext
            ? Buffer.alloc(row.secretsCiphertext.length)
            : null,
          secretsKeyId: null,
          webhookSecret: null,
          webhookExternalId: null,
        },
      }),
      this.prisma.repoEnvBinding.updateMany({
        where: { projectRepoId: repoId, projectId, orgId: row.orgId, deletedAt: null },
        data: { deletedAt: now },
      }),
      this.prisma.repoBranchIndex.updateMany({
        where: { projectRepoId: repoId, projectId, orgId: row.orgId, deletedAt: null },
        data: { deletedAt: now },
      }),
    ]);
    if (result.count !== 1) throw new NotFoundException('Repo not found');
  }

  async reindexDefaultBranch(
    projectId: string,
    repoId: string,
    requestedById?: string,
  ) {
    const existing = await this.mustExist(projectId, repoId);
    const index = await this.indexRequests.request({
      projectId,
      repoId,
      branch: existing.defaultBranch,
      force: true,
      trigger: 'MANUAL',
      requestedById,
    });
    return toPublicIndex(index);
  }

  async listBranches(projectId: string, repoId: string): Promise<GitHubBranch[]> {
    const repo = await this.mustExist(projectId, repoId);
    const credential = await this.credentials.authForOrg(repo.orgId);
    if (!credential) throw new BadRequestException('GitHub credential is not configured');
    return this.github.listBranches(
      credential.auth,
      repo.repoOwner,
      repo.repoName,
    );
  }

  async readRepoFile(
    projectId: string,
    repoId: string,
    filePath: string,
    ref?: string,
  ) {
    let normalizedPath: string;
    try {
      normalizedPath = validateRepoFilePath(filePath);
    } catch {
      throw new BadRequestException('Repository file path is invalid');
    }
    if (isHardDeniedRepoPath(normalizedPath)) {
      throw new BadRequestException(
        'Repository file path is blocked by the secret-file policy',
      );
    }

    const repo = await this.mustExist(projectId, repoId);
    const credential = await this.credentials.authForOrg(repo.orgId);
    if (!credential) throw new BadRequestException('GitHub credential is not configured');
    const selectedRef = ref?.trim() || repo.defaultBranch;
    if (
      selectedRef.length > 255
      || selectedRef.includes('\0')
      || selectedRef.startsWith('-')
    ) {
      throw new BadRequestException('Repository ref is invalid');
    }

    const file = await this.github.getFileContent(
      credential.auth,
      repo.repoOwner,
      repo.repoName,
      normalizedPath,
      selectedRef,
    );
    if (isProbablyBinary(Buffer.from(file.content, 'utf8'))) {
      throw new BadRequestException('Binary repository files cannot be read');
    }
    return {
      repo: {
        id: repo.id,
        owner: repo.repoOwner,
        name: repo.repoName,
      },
      ref: selectedRef,
      path: file.path,
      sha: file.sha,
      size: file.size,
      content: file.content,
    };
  }

  async replaceEnvBindings(
    projectId: string,
    repoId: string,
    inputs: RepoEnvBindingInputDto[],
    requestedById?: string,
  ) {
    const repo = await this.mustExist(projectId, repoId);
    const environmentIds = inputs.map((binding) => binding.environmentId);
    if (new Set(environmentIds).size !== environmentIds.length) {
      throw new BadRequestException('Each environment may only be bound once per repository');
    }
    const environments = await this.prisma.environment.findMany({
      where: {
        id: { in: environmentIds },
        projectId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (environments.length !== environmentIds.length) {
      throw new BadRequestException('Every environment binding must belong to this project');
    }

    const normalized = inputs.map((binding) => ({
      environmentId: binding.environmentId,
      branch: binding.branch.trim(),
      versionSource: binding.versionSource,
      versionFilePath: binding.versionFilePath?.trim() || null,
      versionFileFormat: binding.versionFileFormat,
      versionSelector: binding.versionSelector?.trim() || null,
      componentName: binding.componentName?.trim() || null,
    }));
    if (normalized.length > 0) {
      const available = new Set((await this.listBranches(projectId, repoId)).map((branch) => branch.name));
      const missing = normalized.find((binding) => !available.has(binding.branch));
      if (missing) throw new BadRequestException(`GitHub branch not found: ${missing.branch}`);
    }

    const existing = await this.prisma.repoEnvBinding.findMany({
      where: { projectRepoId: repoId, projectId, orgId: repo.orgId, deletedAt: null },
    });
    const existingByEnvironment = new Map(
      existing.map((binding) => [binding.environmentId, binding]),
    );
    const changedBranches = new Set<string>();
    for (const binding of normalized) {
      if (existingByEnvironment.get(binding.environmentId)?.branch !== binding.branch) {
        changedBranches.add(binding.branch);
      }
    }
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.repoEnvBinding.updateMany({
        where: {
          projectRepoId: repoId,
          projectId,
          orgId: repo.orgId,
          deletedAt: null,
          ...(environmentIds.length > 0
            ? { environmentId: { notIn: environmentIds } }
            : {}),
        },
        data: { deletedAt: now },
      });
      for (const binding of normalized) {
        const active = existingByEnvironment.get(binding.environmentId);
        if (active) {
          await tx.repoEnvBinding.update({
            where: { id: active.id },
            data: {
              branch: binding.branch,
              versionSource: binding.versionSource,
              versionFilePath: binding.versionFilePath,
              versionFileFormat: binding.versionFileFormat,
              versionSelector: binding.versionSelector,
              componentName: binding.componentName,
            },
          });
          continue;
        }
        const removed = await tx.repoEnvBinding.findFirst({
          where: {
            projectRepoId: repoId,
            environmentId: binding.environmentId,
            deletedAt: { not: null },
          },
          orderBy: { updatedAt: 'desc' },
        });
        if (removed) {
          await tx.repoEnvBinding.update({
            where: { id: removed.id },
            data: {
              orgId: repo.orgId,
              projectId,
              branch: binding.branch,
              versionSource: binding.versionSource,
              versionFilePath: binding.versionFilePath,
              versionFileFormat: binding.versionFileFormat,
              versionSelector: binding.versionSelector,
              componentName: binding.componentName,
              deletedAt: null,
            },
          });
        } else {
          await tx.repoEnvBinding.create({
            data: {
              orgId: repo.orgId,
              projectId,
              projectRepoId: repoId,
              environmentId: binding.environmentId,
              branch: binding.branch,
              versionSource: binding.versionSource,
              versionFilePath: binding.versionFilePath,
              versionFileFormat: binding.versionFileFormat,
              versionSelector: binding.versionSelector,
              componentName: binding.componentName,
            },
          });
        }
      }
    });

    for (const branch of changedBranches) {
      await this.indexRequests.request({
        projectId,
        repoId,
        branch,
        force: false,
        trigger: 'BINDING_CHANGE',
        requestedById,
      });
    }
    return this.listEnvBindings(projectId, repoId);
  }

  async listEnvBindings(projectId: string, repoId: string) {
    const repo = await this.mustExist(projectId, repoId);
    return this.prisma.repoEnvBinding.findMany({
      where: {
        projectRepoId: repoId,
        projectId,
        orgId: repo.orgId,
        deletedAt: null,
      },
      select: {
        id: true,
        environmentId: true,
        branch: true,
        versionSource: true,
        versionFilePath: true,
        versionFileFormat: true,
        versionSelector: true,
        componentName: true,
        createdAt: true,
        updatedAt: true,
        environment: {
          select: { name: true, type: true },
        },
      },
      orderBy: { environment: { order: 'asc' } },
    });
  }

  async listIndexes(projectId: string, repoId: string) {
    const repo = await this.mustExist(projectId, repoId);
    return this.prisma.repoBranchIndex.findMany({
      where: {
        projectRepoId: repoId,
        projectId,
        orgId: repo.orgId,
        deletedAt: null,
      },
      select: publicIndexSelect,
      orderBy: { branch: 'asc' },
    });
  }

  async reindexBranch(
    projectId: string,
    repoId: string,
    indexId: string,
    requestedById?: string,
  ) {
    const repo = await this.mustExist(projectId, repoId);
    const index = await this.prisma.repoBranchIndex.findFirst({
      where: {
        id: indexId,
        projectRepoId: repoId,
        projectId,
        orgId: repo.orgId,
        deletedAt: null,
      },
      select: { branch: true },
    });
    if (!index) throw new NotFoundException('Branch index not found');
    const requested = await this.indexRequests.request({
      projectId,
      repoId,
      branch: index.branch,
      force: true,
      trigger: 'MANUAL',
      requestedById,
    });
    return toPublicIndex(requested);
  }

  async indexSummary(projectId: string) {
    const repos = await this.prisma.projectRepo.findMany({
      where: { projectId, deletedAt: null },
      select: {
        id: true,
        repoOwner: true,
        repoName: true,
        defaultBranch: true,
        status: true,
        branchIndexes: {
          where: { deletedAt: null },
          select: publicIndexSelect,
          orderBy: { branch: 'asc' },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const indexes = repos.flatMap((repo) => repo.branchIndexes);
    return {
      repositories: repos,
      totals: {
        repositories: repos.length,
        indexes: indexes.length,
        ready: indexes.filter((index) => index.status === RepoIndexStatus.READY).length,
        indexing: indexes.filter((index) => index.status === RepoIndexStatus.INDEXING).length,
        pending: indexes.filter((index) => index.status === RepoIndexStatus.PENDING).length,
        blocked: indexes.filter((index) => index.status === RepoIndexStatus.BLOCKED).length,
        failed: indexes.filter((index) => index.status === RepoIndexStatus.FAILED).length,
        chunks: indexes.reduce((sum, index) => sum + index.chunkCount, 0),
      },
    };
  }

  private async mustExist(projectId: string, repoId: string): Promise<ProjectRepo> {
    const row = await this.prisma.projectRepo.findFirst({
      where: { id: repoId, projectId, deletedAt: null },
    });
    if (!row) throw new NotFoundException('Repo not found');
    return row;
  }
}

const publicIndexSelect = {
  id: true,
  branch: true,
  status: true,
  stage: true,
  progressPercent: true,
  filesProcessed: true,
  totalFiles: true,
  chunkCount: true,
  activeGeneration: true,
  requestedGeneration: true,
  commitSha: true,
  lastIndexedAt: true,
  lastRequestedAt: true,
  error: true,
  createdAt: true,
  updatedAt: true,
} as const;

function toPublicIndex(index: RepoBranchIndex) {
  return {
    id: index.id,
    branch: index.branch,
    status: index.status,
    stage: index.stage,
    progressPercent: index.progressPercent,
    filesProcessed: index.filesProcessed,
    totalFiles: index.totalFiles,
    chunkCount: index.chunkCount,
    activeGeneration: index.activeGeneration,
    requestedGeneration: index.requestedGeneration,
    commitSha: index.commitSha,
    lastIndexedAt: index.lastIndexedAt,
    lastRequestedAt: index.lastRequestedAt,
    error: index.error,
    createdAt: index.createdAt,
    updatedAt: index.updatedAt,
  };
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
