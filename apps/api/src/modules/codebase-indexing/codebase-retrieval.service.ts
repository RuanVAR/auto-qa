import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RepoIndexStatus } from '@prisma/client';
import { EmbeddingClient, type EmbeddingConfig } from '@qa-platform/shared';
import type { AccessContext } from '../../common/access/access-context';
import { EnvAccessService } from '../../common/access/env-access.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SecretsService } from '../../common/secrets/secrets.service';

export interface RetrieveCodeChunksInput {
  projectId: string;
  query: string;
  environmentId?: string;
  repoIds?: string[];
  filePathHint?: string;
  limit?: number;
  minScore?: number;
}

export interface RetrievedCodeChunk {
  repo: {
    id: string;
    owner: string;
    name: string;
  };
  branch: string;
  commitSha: string | null;
  filePath: string;
  symbol: string | null;
  content: string;
  selectors: string[];
  routes: string[];
  score: number;
  stale: boolean;
  indexStatus: RepoIndexStatus;
}

interface RetrievalRow {
  repoId: string;
  repoOwner: string;
  repoName: string;
  branch: string;
  commitSha: string | null;
  filePath: string;
  symbol: string | null;
  content: string;
  selectors: string[];
  routes: string[];
  score: number;
  indexStatus: RepoIndexStatus;
}

@Injectable()
export class CodebaseRetrievalService {
  private readonly embeddingClient = new EmbeddingClient();

  constructor(
    private readonly prisma: PrismaService,
    private readonly envAccess: EnvAccessService,
    private readonly secrets: SecretsService,
  ) {}

  async retrieveChunks(
    userId: string,
    input: RetrieveCodeChunksInput,
    context: AccessContext = { jwtRoleHint: {} },
  ): Promise<RetrievedCodeChunk[]> {
    await this.envAccess.assertProjectAccess(userId, input.projectId, context);
    if (input.environmentId) {
      await this.envAccess.assertEnvAccess(
        userId,
        input.projectId,
        input.environmentId,
        context,
      );
    }
    const query = input.query.trim();
    if (!query) throw new BadRequestException('query is required');

    const project = await this.prisma.project.findUnique({
      where: { id: input.projectId },
      select: { orgId: true },
    });
    if (!project) throw new NotFoundException('Project not found');
    if (!project.orgId) {
      throw new BadRequestException('Project is not attached to an organisation');
    }
    const orgId = project.orgId;

    if (input.environmentId) {
      const environment = await this.prisma.environment.findFirst({
        where: {
          id: input.environmentId,
          projectId: input.projectId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!environment) throw new NotFoundException('Environment not found');
    }

    const requestedRepoIds = [...new Set(input.repoIds ?? [])];
    const repos = await this.prisma.projectRepo.findMany({
      where: {
        orgId,
        projectId: input.projectId,
        deletedAt: null,
        ...(requestedRepoIds.length > 0 ? { id: { in: requestedRepoIds } } : {}),
      },
      select: {
        id: true,
        repoOwner: true,
        repoName: true,
        defaultBranch: true,
      },
    });
    if (requestedRepoIds.length > 0 && repos.length !== requestedRepoIds.length) {
      throw new NotFoundException('One or more repos were not found in this project');
    }
    if (repos.length === 0) return [];

    const bindingMap = new Map<string, string>();
    if (input.environmentId) {
      const bindings = await this.prisma.repoEnvBinding.findMany({
        where: {
          orgId,
          projectId: input.projectId,
          environmentId: input.environmentId,
          projectRepoId: { in: repos.map((repo) => repo.id) },
          deletedAt: null,
        },
        select: { projectRepoId: true, branch: true },
      });
      for (const binding of bindings) bindingMap.set(binding.projectRepoId, binding.branch);
    }

    const branchByRepo = new Map(
      repos.map((repo) => [
        repo.id,
        bindingMap.get(repo.id) ?? repo.defaultBranch,
      ]),
    );
    const indexes = await this.prisma.repoBranchIndex.findMany({
      where: {
        orgId,
        projectId: input.projectId,
        projectRepoId: { in: repos.map((repo) => repo.id) },
        activeGeneration: { not: null },
        deletedAt: null,
      },
      select: {
        id: true,
        projectRepoId: true,
        branch: true,
        activeGeneration: true,
        embeddingFingerprint: true,
        embeddingDimension: true,
      },
    });

    const embedding = await this.resolveEmbedding(orgId);
    const selected = indexes.filter((index) =>
      branchByRepo.get(index.projectRepoId) === index.branch
      && index.embeddingFingerprint === embedding.fingerprint
      && index.embeddingDimension === embedding.dimension
      && index.activeGeneration !== null);
    if (selected.length === 0) return [];

    const vector = await this.embeddingClient.embedQuery(embedding.config, query);
    if (vector.length !== embedding.dimension) {
      throw new BadRequestException(
        `Embedding provider returned dimension ${vector.length}; expected ${embedding.dimension}`,
      );
    }

    const limit = Math.min(50, Math.max(1, input.limit ?? 8));
    const minScore = Math.min(1, Math.max(-1, input.minScore ?? 0.2));
    const pairs = selected.map((index) => Prisma.sql`(
      ${index.id},
      ${index.activeGeneration as number}
    )`);
    const fileFilter = input.filePathHint?.trim()
      ? Prisma.sql`AND c."filePath" ILIKE ${`%${escapeLike(input.filePathHint.trim())}%`} ESCAPE '\\'`
      : Prisma.empty;
    const vectorValue = vectorLiteral(vector);

    const rows = await this.prisma.$queryRaw<RetrievalRow[]>(Prisma.sql`
      WITH selected_indexes ("branchIndexId", "generation") AS (
        VALUES ${Prisma.join(pairs)}
      )
      SELECT
        r."id" AS "repoId",
        r."repoOwner",
        r."repoName",
        bi."branch",
        bi."commitSha",
        c."filePath",
        c."symbol",
        c."content",
        c."selectors",
        c."routes",
        (1 - (c."embedding" <=> ${vectorValue}::vector))::double precision AS "score",
        bi."status" AS "indexStatus"
      FROM "code_chunks" c
      INNER JOIN selected_indexes si
        ON si."branchIndexId" = c."branchIndexId"
       AND si."generation" = c."generation"
      INNER JOIN "repo_branch_indexes" bi
        ON bi."id" = c."branchIndexId"
       AND bi."orgId" = ${orgId}
       AND bi."projectId" = ${input.projectId}
       AND bi."deletedAt" IS NULL
      INNER JOIN "project_repos" r
        ON r."id" = bi."projectRepoId"
       AND r."orgId" = ${orgId}
       AND r."projectId" = ${input.projectId}
       AND r."deletedAt" IS NULL
      WHERE c."orgId" = ${orgId}
        AND c."projectId" = ${input.projectId}
        AND bi."embeddingFingerprint" = ${embedding.fingerprint}
        AND bi."embeddingDimension" = ${embedding.dimension}
        ${fileFilter}
        AND (1 - (c."embedding" <=> ${vectorValue}::vector)) >= ${minScore}
      ORDER BY c."embedding" <=> ${vectorValue}::vector
      LIMIT ${limit}
    `);

    return rows.map((row) => ({
      repo: {
        id: row.repoId,
        owner: row.repoOwner,
        name: row.repoName,
      },
      branch: row.branch,
      commitSha: row.commitSha,
      filePath: row.filePath,
      symbol: row.symbol,
      content: row.content,
      selectors: row.selectors,
      routes: row.routes,
      score: Number(row.score),
      stale: row.indexStatus !== RepoIndexStatus.READY,
      indexStatus: row.indexStatus,
    }));
  }

  private async resolveEmbedding(orgId: string): Promise<{
    config: EmbeddingConfig;
    dimension: number;
    fingerprint: string;
  }> {
    const row = await this.prisma.orgEmbeddingCredential.findFirst({
      where: { orgId, active: true, deletedAt: null },
    });
    if (!row) {
      throw new BadRequestException(
        'No active embedding credential configured for this organisation',
      );
    }
    const apiKey = row.secretsCiphertext && row.secretsKeyId
      ? this.secrets.decrypt(row.secretsCiphertext, row.secretsKeyId).apiKey
      : null;
    return {
      config: {
        provider: row.provider,
        model: row.model,
        apiKey,
        baseUrl: row.baseUrl,
        azureDeployment: row.azureDeployment,
        azureApiVersion: row.azureApiVersion,
      },
      dimension: row.dimension,
      fingerprint: row.configFingerprint,
    };
  }
}

function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => {
    if (!Number.isFinite(value)) throw new BadRequestException('Embedding contains invalid values');
    return value.toString();
  }).join(',')}]`;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
