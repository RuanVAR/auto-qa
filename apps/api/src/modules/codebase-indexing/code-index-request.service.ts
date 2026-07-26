import {
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  RepoIndexStage,
  RepoIndexStatus,
  type RepoBranchIndex,
} from '@prisma/client';
import type { CodeIndexTrigger } from '@qa-platform/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';

export interface RequestCodeIndexInput {
  projectId: string;
  repoId: string;
  branch: string;
  force: boolean;
  trigger: CodeIndexTrigger;
  requestedById?: string;
}

@Injectable()
export class CodeIndexRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: QueueService,
  ) {}

  async request(input: RequestCodeIndexInput): Promise<RepoBranchIndex> {
    const branch = input.branch.trim();
    const repo = await this.prisma.projectRepo.findFirst({
      where: {
        id: input.repoId,
        projectId: input.projectId,
        deletedAt: null,
      },
      select: { id: true, orgId: true },
    });
    if (!repo) throw new NotFoundException('Repo not found');

    const embedding = await this.prisma.orgEmbeddingCredential.findFirst({
      where: { orgId: repo.orgId, active: true, deletedAt: null },
      select: { id: true },
    });
    const status = embedding ? RepoIndexStatus.PENDING : RepoIndexStatus.BLOCKED;
    const error = embedding ? null : 'Embedding credential is not configured';
    const now = new Date();

    const index = await this.prisma.$transaction(async (tx) => {
      const row = await tx.repoBranchIndex.upsert({
        where: {
          projectRepoId_branch: {
            projectRepoId: repo.id,
            branch,
          },
        },
        create: {
          orgId: repo.orgId,
          projectId: input.projectId,
          projectRepoId: repo.id,
          branch,
          status,
          stage: RepoIndexStage.QUEUED,
          requestedGeneration: 1,
          requestedById: input.requestedById,
          lastRequestedAt: now,
          error,
        },
        update: {
          orgId: repo.orgId,
          projectId: input.projectId,
          status,
          stage: RepoIndexStage.QUEUED,
          progressPercent: 0,
          filesProcessed: 0,
          totalFiles: null,
          requestedGeneration: { increment: 1 },
          requestedById: input.requestedById,
          lastRequestedAt: now,
          error,
          deletedAt: null,
        },
      });
      await tx.projectRepo.updateMany({
        where: {
          id: repo.id,
          projectId: input.projectId,
          orgId: repo.orgId,
          deletedAt: null,
        },
        data: { status },
      });
      return row;
    });

    if (!embedding) return index;

    try {
      await this.queue.enqueueCodeIndex({
        branchIndexId: index.id,
        generation: index.requestedGeneration,
        force: input.force,
        requestedById: input.requestedById,
        trigger: input.trigger,
      });
    } catch (cause) {
      const safeError = 'Code index queue is unavailable';
      await this.prisma.$transaction([
        this.prisma.repoBranchIndex.updateMany({
          where: {
            id: index.id,
            requestedGeneration: index.requestedGeneration,
            deletedAt: null,
          },
          data: {
            status: RepoIndexStatus.FAILED,
            error: safeError,
          },
        }),
        this.prisma.projectRepo.updateMany({
          where: {
            id: repo.id,
            projectId: input.projectId,
            orgId: repo.orgId,
            deletedAt: null,
          },
          data: { status: RepoIndexStatus.FAILED },
        }),
      ]);
      throw new InternalServerErrorException(safeError, { cause });
    }
    return index;
  }

  async requestOrganisationIndexes(orgId: string, requestedById?: string): Promise<void> {
    const repos = await this.prisma.projectRepo.findMany({
      where: { orgId, deletedAt: null },
      select: {
        id: true,
        projectId: true,
        defaultBranch: true,
        envBindings: {
          where: { deletedAt: null },
          select: { branch: true },
        },
      },
    });
    for (const repo of repos) {
      const branches = new Set([
        repo.defaultBranch,
        ...repo.envBindings.map((binding) => binding.branch),
      ]);
      for (const branch of branches) {
        await this.request({
          projectId: repo.projectId,
          repoId: repo.id,
          branch,
          force: true,
          trigger: 'MANUAL',
          requestedById,
        });
      }
    }
  }
}
