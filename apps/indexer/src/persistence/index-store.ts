import { randomUUID } from 'node:crypto';
import {
  EmbeddingProvider,
  GitAuthKind,
  Prisma,
  PrismaClient,
  RepoIndexStage,
  RepoIndexStatus,
} from '@prisma/client';
import type {
  EmbeddingConfig,
  GitHubAuth,
  RepoIndexProgressEvent,
  RepoIndexStageValue,
} from '@qa-platform/shared';
import { decryptSecret } from '@qa-platform/shared';
import type { CodeIndexJobData } from '@qa-platform/shared';
import type { CodeChunkDraft } from '../chunking/chunker';

export interface IndexJobContext {
  branchIndexId: string;
  generation: number;
  orgId: string;
  projectId: string;
  repoId: string;
  branch: string;
  repoOwner: string;
  repoName: string;
  includeGlobs: string[];
  excludeGlobs: string[];
  auth: GitHubAuth;
  embeddingConfig: EmbeddingConfig;
  embeddingDimension: number;
  embeddingFingerprint: string;
  indexedEmbeddingFingerprint: string | null;
  activeGeneration: number | null;
  commitSha: string | null;
  chunkCount: number;
}

export interface PersistedChunk extends CodeChunkDraft {
  embedding: number[];
}

export interface ActivateGenerationInput {
  context: IndexJobContext;
  commitSha: string;
  chunkCount: number;
}

export interface IndexStore {
  claim(job: CodeIndexJobData): Promise<IndexJobContext>;
  ensureCurrent(context: IndexJobContext): Promise<void>;
  updateProgress(
    context: IndexJobContext,
    stage: RepoIndexStageValue,
    progressPercent: number,
    filesProcessed: number,
    totalFiles: number | null,
    chunkCount: number,
  ): Promise<void>;
  prepareGeneration(context: IndexJobContext): Promise<void>;
  saveChunks(context: IndexJobContext, chunks: PersistedChunk[]): Promise<void>;
  activate(input: ActivateGenerationInput): Promise<void>;
  completeUnchanged(context: IndexJobContext, commitSha: string): Promise<void>;
  fail(
    context: IndexJobContext,
    error: string,
    blocked: boolean,
  ): Promise<void>;
  cleanupGeneration(context: IndexJobContext): Promise<void>;
}

export class PrismaIndexStore implements IndexStore {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly statementTimeoutMs: number,
  ) {}

  async claim(job: CodeIndexJobData): Promise<IndexJobContext> {
    const row = await this.loadRow(job.branchIndexId, job.generation);
    let context: IndexJobContext;
    try {
      context = await this.toContext(row, job.generation);
    } catch (error) {
      if (error instanceof IndexBlockedError) {
        error.progressEvent = {
          orgId: row.orgId,
          projectId: row.projectId,
          repoId: row.projectRepo.id,
          branchIndexId: row.id,
          branch: row.branch,
          status: 'BLOCKED',
          stage: 'AUTHENTICATING',
          progressPercent: 0,
          filesProcessed: 0,
          chunkCount: row.chunkCount,
          error: error.message,
        };
        await Promise.all([
          this.prisma.repoBranchIndex.updateMany({
            where: {
              id: job.branchIndexId,
              requestedGeneration: job.generation,
              deletedAt: null,
            },
            data: {
              status: RepoIndexStatus.BLOCKED,
              stage: RepoIndexStage.AUTHENTICATING,
              progressPercent: 0,
              error: error.message,
            },
          }),
          this.prisma.projectRepo.updateMany({
            where: {
              id: row.projectRepoId,
              projectId: row.projectId,
              orgId: row.orgId,
              deletedAt: null,
            },
            data: { status: RepoIndexStatus.BLOCKED },
          }),
        ]);
      }
      throw error;
    }
    const claim = await this.prisma.repoBranchIndex.updateMany({
      where: {
        id: job.branchIndexId,
        requestedGeneration: job.generation,
        deletedAt: null,
        status: { not: RepoIndexStatus.INDEXING },
      },
      data: {
        status: RepoIndexStatus.INDEXING,
        stage: RepoIndexStage.AUTHENTICATING,
        progressPercent: 2,
        filesProcessed: 0,
        totalFiles: null,
        error: null,
      },
    });
    if (claim.count !== 1) throw new StaleGenerationError();
    return context;
  }

  async ensureCurrent(context: IndexJobContext): Promise<void> {
    const row = await this.prisma.repoBranchIndex.findFirst({
      where: {
        id: context.branchIndexId,
        requestedGeneration: context.generation,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!row) throw new StaleGenerationError();
  }

  async updateProgress(
    context: IndexJobContext,
    stage: RepoIndexStageValue,
    progressPercent: number,
    filesProcessed: number,
    totalFiles: number | null,
    chunkCount: number,
  ): Promise<void> {
    const updated = await this.prisma.repoBranchIndex.updateMany({
      where: {
        id: context.branchIndexId,
        requestedGeneration: context.generation,
        deletedAt: null,
      },
      data: {
        stage: stage as RepoIndexStage,
        progressPercent: boundedPercent(progressPercent),
        filesProcessed,
        totalFiles,
        chunkCount,
      },
    });
    if (updated.count !== 1) throw new StaleGenerationError();
  }

  async prepareGeneration(context: IndexJobContext): Promise<void> {
    await this.ensureCurrent(context);
    await this.prisma.codeChunk.deleteMany({
      where: {
        branchIndexId: context.branchIndexId,
        generation: context.generation,
      },
    });
  }

  async saveChunks(context: IndexJobContext, chunks: PersistedChunk[]): Promise<void> {
    if (chunks.length === 0) return;
    await this.ensureCurrent(context);
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('statement_timeout', ${`${this.statementTimeoutMs}ms`}, true)`;
      const rows = chunks.map((chunk) => Prisma.sql`(
        ${randomUUID()},
        ${context.orgId},
        ${context.projectId},
        ${context.branchIndexId},
        ${context.generation},
        ${chunk.filePath},
        ${chunk.chunkIndex},
        ${chunk.content},
        ${chunk.symbol},
        ${chunk.selectors}::text[],
        ${chunk.routes}::text[],
        ${vectorLiteral(chunk.embedding)}::vector,
        CURRENT_TIMESTAMP
      )`);
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "code_chunks" (
          "id", "orgId", "projectId", "branchIndexId", "generation",
          "filePath", "chunkIndex", "content", "symbol", "selectors", "routes",
          "embedding", "createdAt"
        )
        VALUES ${Prisma.join(rows)}
      `);
    }, { timeout: this.statementTimeoutMs + 5_000 });
  }

  async activate(input: ActivateGenerationInput): Promise<void> {
    const { context, commitSha, chunkCount } = input;
    if (chunkCount <= 0) throw new Error('Index generation contains no chunks');
    await this.prisma.$transaction(async (tx) => {
      const [storedCount, embedding] = await Promise.all([
        tx.codeChunk.count({
          where: {
            branchIndexId: context.branchIndexId,
            generation: context.generation,
          },
        }),
        tx.orgEmbeddingCredential.findFirst({
          where: {
            orgId: context.orgId,
            active: true,
            deletedAt: null,
            configFingerprint: context.embeddingFingerprint,
            dimension: context.embeddingDimension,
          },
          select: { id: true },
        }),
      ]);
      if (storedCount !== chunkCount) {
        throw new Error(`Staged chunk count mismatch: expected ${chunkCount}, stored ${storedCount}`);
      }
      if (!embedding) throw new StaleGenerationError('Embedding configuration changed during indexing');

      const activated = await tx.repoBranchIndex.updateMany({
        where: {
          id: context.branchIndexId,
          requestedGeneration: context.generation,
          deletedAt: null,
        },
        data: {
          status: RepoIndexStatus.READY,
          stage: RepoIndexStage.COMPLETE,
          progressPercent: 100,
          chunkCount,
          activeGeneration: context.generation,
          commitSha,
          embeddingFingerprint: context.embeddingFingerprint,
          embeddingDimension: context.embeddingDimension,
          lastIndexedAt: new Date(),
          error: null,
        },
      });
      if (activated.count !== 1) throw new StaleGenerationError();
      await tx.projectRepo.updateMany({
        where: {
          id: context.repoId,
          projectId: context.projectId,
          orgId: context.orgId,
          deletedAt: null,
        },
        data: {
          status: RepoIndexStatus.READY,
          chunkCount,
          lastIndexedAt: new Date(),
        },
      });
    });

    try {
      await this.prisma.codeChunk.deleteMany({
        where: {
          branchIndexId: context.branchIndexId,
          generation: { not: context.generation },
        },
      });
    } catch (error) {
      console.warn(
        `[Indexer] Could not remove superseded generations for ${context.branchIndexId}: ${safeDatabaseMessage(error)}`,
      );
    }
  }

  async completeUnchanged(context: IndexJobContext, commitSha: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const embedding = await tx.orgEmbeddingCredential.findFirst({
        where: {
          orgId: context.orgId,
          active: true,
          deletedAt: null,
          configFingerprint: context.embeddingFingerprint,
          dimension: context.embeddingDimension,
        },
        select: { id: true },
      });
      if (!embedding) throw new StaleGenerationError('Embedding configuration changed during indexing');
      const updated = await tx.repoBranchIndex.updateMany({
        where: {
          id: context.branchIndexId,
          requestedGeneration: context.generation,
          deletedAt: null,
          activeGeneration: context.activeGeneration,
        },
        data: {
          status: RepoIndexStatus.READY,
          stage: RepoIndexStage.COMPLETE,
          progressPercent: 100,
          commitSha,
          embeddingFingerprint: context.embeddingFingerprint,
          embeddingDimension: context.embeddingDimension,
          lastIndexedAt: new Date(),
          error: null,
        },
      });
      if (updated.count !== 1) throw new StaleGenerationError();
      await tx.projectRepo.updateMany({
        where: {
          id: context.repoId,
          projectId: context.projectId,
          orgId: context.orgId,
          deletedAt: null,
        },
        data: {
          status: RepoIndexStatus.READY,
          chunkCount: context.chunkCount,
          lastIndexedAt: new Date(),
        },
      });
    });
  }

  async fail(context: IndexJobContext, error: string, blocked: boolean): Promise<void> {
    const status = blocked ? RepoIndexStatus.BLOCKED : RepoIndexStatus.FAILED;
    const failed = await this.prisma.repoBranchIndex.updateMany({
      where: {
        id: context.branchIndexId,
        requestedGeneration: context.generation,
        deletedAt: null,
      },
      data: {
        status,
        progressPercent: 0,
        chunkCount: context.chunkCount,
        error,
      },
    });
    if (failed.count === 1) {
      await this.prisma.projectRepo.updateMany({
        where: {
          id: context.repoId,
          projectId: context.projectId,
          orgId: context.orgId,
          deletedAt: null,
        },
        data: { status },
      });
    }
  }

  async cleanupGeneration(context: IndexJobContext): Promise<void> {
    if (context.generation === context.activeGeneration) return;
    await this.prisma.codeChunk.deleteMany({
      where: {
        branchIndexId: context.branchIndexId,
        generation: context.generation,
      },
    });
  }

  private async loadRow(branchIndexId: string, generation: number) {
    const row = await this.prisma.repoBranchIndex.findFirst({
      where: {
        id: branchIndexId,
        requestedGeneration: generation,
        deletedAt: null,
      },
      include: {
        projectRepo: {
          include: { credential: true },
        },
      },
    });
    if (!row) throw new StaleGenerationError();
    return row;
  }

  private async toContext(
    row: Awaited<ReturnType<PrismaIndexStore['loadRow']>>,
    generation: number,
  ): Promise<IndexJobContext> {
    const repo = row.projectRepo;
    const credential = repo.credential;
    if (
      repo.deletedAt
      || credential.deletedAt
      || !credential.isEnabled
      || !credential.lastHealthOk
    ) {
      throw new IndexBlockedError('GitHub credential is disabled or unhealthy');
    }
    if (
      repo.orgId !== row.orgId
      || repo.projectId !== row.projectId
      || credential.orgId !== row.orgId
    ) {
      throw new IndexBlockedError('Repository credential tenant scope is invalid');
    }
    const embedding = await this.prisma.orgEmbeddingCredential.findFirst({
      where: {
        orgId: row.orgId,
        active: true,
        deletedAt: null,
      },
    });
    if (!embedding) throw new IndexBlockedError('Embedding credential is not configured');

    const credentialSecret = decryptStoredSecret(
      Buffer.from(credential.secretsCiphertext),
      credential.secretsKeyId,
      'GitHub',
    );
    const overrideSecret = repo.secretsCiphertext && repo.secretsKeyId
      ? decryptStoredSecret(
          Buffer.from(repo.secretsCiphertext),
          repo.secretsKeyId,
          'repository override',
        )
      : null;
    const auth: GitHubAuth = overrideSecret?.token
      ? { kind: 'PAT', token: overrideSecret.token, baseUrl: credential.baseUrl }
      : credential.authKind === GitAuthKind.PAT
        ? { kind: 'PAT', token: required(credentialSecret.token, 'GitHub PAT'), baseUrl: credential.baseUrl }
        : {
            kind: 'APP',
            appId: required(credentialSecret.appId, 'GitHub App ID'),
            privateKey: required(credentialSecret.privateKey, 'GitHub App private key'),
            installationId: credential.appInstallationId,
            baseUrl: credential.baseUrl,
          };
    const embeddingSecret = embedding.secretsCiphertext && embedding.secretsKeyId
      ? decryptStoredSecret(
          Buffer.from(embedding.secretsCiphertext),
          embedding.secretsKeyId,
          'embedding',
        )
      : null;

    return {
      branchIndexId: row.id,
      generation,
      orgId: row.orgId,
      projectId: row.projectId,
      repoId: repo.id,
      branch: row.branch,
      repoOwner: repo.repoOwner,
      repoName: repo.repoName,
      includeGlobs: repo.includeGlobs,
      excludeGlobs: repo.excludeGlobs,
      auth,
      embeddingConfig: {
        provider: embedding.provider as EmbeddingProvider,
        model: embedding.model,
        apiKey: embeddingSecret?.apiKey ?? null,
        baseUrl: embedding.baseUrl,
        azureDeployment: embedding.azureDeployment,
        azureApiVersion: embedding.azureApiVersion,
      },
      embeddingDimension: embedding.dimension,
      embeddingFingerprint: embedding.configFingerprint,
      indexedEmbeddingFingerprint: row.embeddingFingerprint,
      activeGeneration: row.activeGeneration,
      commitSha: row.commitSha,
      chunkCount: row.chunkCount,
    };
  }
}

export class StaleGenerationError extends Error {
  constructor(message = 'A newer repository index generation was requested') {
    super(message);
    this.name = 'StaleGenerationError';
  }
}

export class IndexBlockedError extends Error {
  progressEvent?: RepoIndexProgressEvent;

  constructor(message: string) {
    super(message);
    this.name = 'IndexBlockedError';
  }
}

export function progressEvent(
  context: IndexJobContext,
  stage: RepoIndexStageValue,
  progressPercent: number,
  filesProcessed: number,
  totalFiles: number | null,
  chunkCount: number,
  status: RepoIndexProgressEvent['status'] = 'INDEXING',
  error?: string,
): RepoIndexProgressEvent {
  return {
    orgId: context.orgId,
    projectId: context.projectId,
    repoId: context.repoId,
    branchIndexId: context.branchIndexId,
    branch: context.branch,
    status,
    stage,
    progressPercent: boundedPercent(progressPercent),
    filesProcessed,
    ...(totalFiles === null ? {} : { totalFiles }),
    chunkCount,
    ...(error ? { error } : {}),
  };
}

function required(value: string | undefined, label: string): string {
  if (!value) throw new IndexBlockedError(`${label} is missing`);
  return value;
}

function vectorLiteral(vector: number[]): string {
  if (vector.length === 0 || vector.some((value) => !Number.isFinite(value))) {
    throw new Error('Cannot persist an invalid embedding vector');
  }
  return `[${vector.join(',')}]`;
}

function boundedPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function decryptStoredSecret(
  ciphertext: Buffer,
  keyId: string,
  label: string,
): Record<string, string> {
  try {
    return decryptSecret(ciphertext, keyId);
  } catch {
    throw new IndexBlockedError(`Stored ${label} credential could not be decrypted`);
  }
}

function safeDatabaseMessage(error: unknown): string {
  return error instanceof Error ? error.name : 'database cleanup failed';
}
