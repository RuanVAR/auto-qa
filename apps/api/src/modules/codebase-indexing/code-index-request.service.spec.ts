import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import {
  RepoIndexStage,
  RepoIndexStatus,
  type RepoBranchIndex,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { CodeIndexRequestService } from './code-index-request.service';

const now = new Date('2026-07-24T12:00:00.000Z');

function index(overrides: Partial<RepoBranchIndex> = {}): RepoBranchIndex {
  return {
    id: 'index-1',
    orgId: 'org-1',
    projectId: 'project-1',
    projectRepoId: 'repo-1',
    branch: 'main',
    status: RepoIndexStatus.PENDING,
    stage: RepoIndexStage.QUEUED,
    progressPercent: 0,
    filesProcessed: 0,
    totalFiles: null,
    chunkCount: 0,
    activeGeneration: null,
    requestedGeneration: 3,
    commitSha: null,
    embeddingFingerprint: null,
    embeddingDimension: null,
    lastIndexedAt: null,
    lastRequestedAt: now,
    requestedById: 'user-1',
    error: null,
    deletedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe('CodeIndexRequestService', () => {
  const projectRepo = {
    findFirst: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const orgEmbeddingCredential = { findFirst: jest.fn() };
  const repoBranchIndex = {
    upsert: jest.fn(),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const transactionClient = { projectRepo, repoBranchIndex };
  const prisma = {
    projectRepo,
    orgEmbeddingCredential,
    repoBranchIndex,
    $transaction: jest.fn(async (
      input: Array<Promise<unknown>>
        | ((tx: typeof transactionClient) => Promise<unknown>),
    ): Promise<unknown> => typeof input === 'function'
      ? input(transactionClient)
      : Promise.all(input)),
  };
  const queue = { enqueueCodeIndex: jest.fn() };
  let service: CodeIndexRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.projectRepo.updateMany.mockResolvedValue({ count: 1 });
    prisma.repoBranchIndex.updateMany.mockResolvedValue({ count: 1 });
    queue.enqueueCodeIndex.mockResolvedValue({ id: 'job-1' });
    service = new CodeIndexRequestService(
      prisma as unknown as PrismaService,
      queue as unknown as QueueService,
    );
  });

  it('increments a generation transactionally and enqueues the exact contract', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue({ id: 'repo-1', orgId: 'org-1' });
    prisma.orgEmbeddingCredential.findFirst.mockResolvedValue({ id: 'embedding-1' });
    prisma.repoBranchIndex.upsert.mockResolvedValue(index());

    await service.request({
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      force: true,
      trigger: 'MANUAL',
      requestedById: 'user-1',
    });

    expect(prisma.repoBranchIndex.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectRepoId_branch: {
            projectRepoId: 'repo-1',
            branch: 'main',
          },
        },
        update: expect.objectContaining({
          requestedGeneration: { increment: 1 },
          status: RepoIndexStatus.PENDING,
        }),
      }),
    );
    expect(queue.enqueueCodeIndex).toHaveBeenCalledWith({
      branchIndexId: 'index-1',
      generation: 3,
      force: true,
      requestedById: 'user-1',
      trigger: 'MANUAL',
    });
  });

  it('creates a BLOCKED generation without queueing when embeddings are absent', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue({ id: 'repo-1', orgId: 'org-1' });
    prisma.orgEmbeddingCredential.findFirst.mockResolvedValue(null);
    prisma.repoBranchIndex.upsert.mockResolvedValue(index({
      status: RepoIndexStatus.BLOCKED,
      error: 'Embedding credential is not configured',
    }));

    const result = await service.request({
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      force: false,
      trigger: 'INITIAL',
    });

    expect(result.status).toBe(RepoIndexStatus.BLOCKED);
    expect(queue.enqueueCodeIndex).not.toHaveBeenCalled();
  });

  it('rejects a repo id from another project before creating an index row', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue(null);

    await expect(service.request({
      projectId: 'project-2',
      repoId: 'repo-1',
      branch: 'main',
      force: false,
      trigger: 'INITIAL',
    })).rejects.toThrow(NotFoundException);

    expect(prisma.repoBranchIndex.upsert).not.toHaveBeenCalled();
  });

  it('marks only the current generation failed when Redis rejects the job', async () => {
    prisma.projectRepo.findFirst.mockResolvedValue({ id: 'repo-1', orgId: 'org-1' });
    prisma.orgEmbeddingCredential.findFirst.mockResolvedValue({ id: 'embedding-1' });
    prisma.repoBranchIndex.upsert.mockResolvedValue(index());
    queue.enqueueCodeIndex.mockRejectedValue(new Error('redis unavailable'));

    await expect(service.request({
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      force: false,
      trigger: 'INITIAL',
    })).rejects.toThrow(InternalServerErrorException);

    expect(prisma.repoBranchIndex.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'index-1',
        requestedGeneration: 3,
        deletedAt: null,
      },
      data: {
        status: RepoIndexStatus.FAILED,
        error: 'Code index queue is unavailable',
      },
    });
  });
});
