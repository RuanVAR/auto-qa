import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';
import {
  type CodeIndexJobData,
  type EmbeddingClient,
  type GitHubTransport,
  scrubString,
} from '@qa-platform/shared';
import type { CodeIndexLimits } from '../config';
import { extractGitHubTarball, saveArchiveStream } from '../archive/safe-archive';
import { chunkDocuments, type CodeChunkDraft } from '../chunking/chunker';
import type { ProgressPublisher } from '../events/progress-publisher';
import {
  type IndexJobContext,
  type IndexStore,
  IndexBlockedError,
  progressEvent,
  StaleGenerationError,
} from '../persistence/index-store';

interface GitHubClientLike {
  getBranchHead(
    auth: IndexJobContext['auth'],
    owner: string,
    name: string,
    branch: string,
  ): Promise<string>;
  downloadTarball(
    auth: IndexJobContext['auth'],
    owner: string,
    name: string,
    ref: string,
  ): Promise<{ stream: Readable; contentLength: number | null }>;
}

interface EmbeddingClientLike {
  embed(config: IndexJobContext['embeddingConfig'], inputs: string[]): Promise<number[][]>;
}

export interface IndexingServiceDependencies {
  store: IndexStore;
  github: GitHubClientLike | GitHubTransport;
  embeddings: EmbeddingClientLike | EmbeddingClient;
  publisher: ProgressPublisher;
  limits: CodeIndexLimits;
}

export interface IndexingResult {
  outcome: 'READY' | 'UNCHANGED' | 'STALE';
  commitSha?: string;
  chunkCount?: number;
}

export class IndexingService {
  constructor(private readonly dependencies: IndexingServiceDependencies) {}

  async process(job: CodeIndexJobData): Promise<IndexingResult> {
    let context: IndexJobContext | null = null;
    let workDirectory: string | null = null;
    let targetCommitSha: string | undefined;
    const startedAt = Date.now();
    try {
      context = await this.dependencies.store.claim(job);
      await this.report(context, 'AUTHENTICATING', 5, 0, null, 0);
      const headSha = await this.dependencies.github.getBranchHead(
        context.auth,
        context.repoOwner,
        context.repoName,
        context.branch,
      );
      targetCommitSha = headSha;
      await this.dependencies.store.ensureCurrent(context);

      if (
        !job.force
        && context.activeGeneration !== null
        && context.commitSha === headSha
        && context.indexedEmbeddingFingerprint === context.embeddingFingerprint
      ) {
        await this.dependencies.store.completeUnchanged(context, headSha);
        await this.publishTerminal(
          progressEvent(
            context,
            'COMPLETE',
            100,
            0,
            null,
            context.chunkCount,
            'READY',
          ),
          job,
          startedAt,
          {
            commitSha: headSha,
            embeddingFingerprint: context.embeddingFingerprint,
            unchanged: true,
          },
        );
        return { outcome: 'UNCHANGED', commitSha: headSha };
      }

      workDirectory = await mkdtemp(path.join(tmpdir(), 'qa-code-index-'));
      const archivePath = path.join(workDirectory, 'repository.tar.gz');
      const sourceRoot = path.join(workDirectory, 'source');
      await this.report(context, 'DOWNLOADING', 10, 0, null, 0);
      const archive = await this.dependencies.github.downloadTarball(
        context.auth,
        context.repoOwner,
        context.repoName,
        headSha,
      );
      if (
        archive.contentLength !== null
        && archive.contentLength > this.dependencies.limits.maxArchiveBytes
      ) {
        throw new Error(
          `Compressed archive exceeds ${this.dependencies.limits.maxArchiveBytes} bytes`,
        );
      }
      await saveArchiveStream(
        archive.stream,
        archivePath,
        this.dependencies.limits.maxArchiveBytes,
      );
      await this.dependencies.store.ensureCurrent(context);

      await this.report(context, 'SCANNING', 25, 0, null, 0);
      const files = await extractGitHubTarball(
        archivePath,
        sourceRoot,
        {
          includeGlobs: context.includeGlobs,
          excludeGlobs: context.excludeGlobs,
        },
        this.dependencies.limits,
      );
      if (files.length === 0) throw new Error('Repository contains no indexable source files');
      await this.report(context, 'CHUNKING', 40, 0, files.length, 0);
      await this.dependencies.store.prepareGeneration(context);

      const pending: CodeChunkDraft[] = [];
      let chunkCount = 0;
      let filesProcessed = 0;
      for (const file of files) {
        await this.dependencies.store.ensureCurrent(context);
        const raw = await readFile(file.absolutePath);
        const content = decodeText(raw);
        if (content !== null) {
          pending.push(...chunkDocuments([{ filePath: file.repoPath, content }]));
        }
        filesProcessed += 1;
        while (pending.length >= this.embeddingBatchSize(context)) {
          const batch = pending.splice(0, this.embeddingBatchSize(context));
          chunkCount += await this.embedAndSave(context, batch);
        }
        if (filesProcessed % 25 === 0 || filesProcessed === files.length) {
          const percent = 40 + (filesProcessed / files.length) * 45;
          await this.report(
            context,
            'EMBEDDING',
            percent,
            filesProcessed,
            files.length,
            chunkCount,
          );
        }
      }
      if (pending.length > 0) chunkCount += await this.embedAndSave(context, pending);
      if (chunkCount === 0) throw new Error('Repository produced no source chunks');

      await this.report(context, 'SAVING', 92, files.length, files.length, chunkCount);
      await this.dependencies.store.ensureCurrent(context);
      await this.dependencies.store.activate({ context, commitSha: headSha, chunkCount });
      await this.publishTerminal(
        progressEvent(
          context,
          'COMPLETE',
          100,
          files.length,
          files.length,
          chunkCount,
          'READY',
        ),
        job,
        startedAt,
        {
          commitSha: headSha,
          embeddingFingerprint: context.embeddingFingerprint,
          unchanged: false,
        },
      );
      return { outcome: 'READY', commitSha: headSha, chunkCount };
    } catch (error) {
      if (error instanceof StaleGenerationError) {
        if (context) await this.dependencies.store.cleanupGeneration(context);
        return { outcome: 'STALE' };
      }
      if (context) {
        const message = safeError(error, context);
        await this.dependencies.store.cleanupGeneration(context);
        await this.dependencies.store.fail(
          context,
          message,
          error instanceof IndexBlockedError,
        );
        await this.publishTerminal(
          progressEvent(
            context,
            contextStage(error),
            0,
            0,
            null,
            0,
            error instanceof IndexBlockedError ? 'BLOCKED' : 'FAILED',
            message,
          ),
          job,
          startedAt,
          {
            commitSha: targetCommitSha,
            embeddingFingerprint: context.embeddingFingerprint,
            unchanged: false,
          },
        );
      } else if (error instanceof IndexBlockedError && error.progressEvent) {
        await this.publishTerminal(
          error.progressEvent,
          job,
          startedAt,
          {
            embeddingFingerprint: undefined,
            unchanged: false,
          },
        );
      }
      throw error;
    } finally {
      if (workDirectory) {
        await rm(workDirectory, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        }).catch(() => {
          console.error('[Indexer] Failed to remove an indexing work directory');
        });
      }
    }
  }

  private async embedAndSave(
    context: IndexJobContext,
    drafts: CodeChunkDraft[],
  ): Promise<number> {
    await this.dependencies.store.ensureCurrent(context);
    const vectors = await this.dependencies.embeddings.embed(
      context.embeddingConfig,
      drafts.map((draft) => `${draft.filePath}\n${draft.symbol ?? ''}\n${draft.content}`),
    );
    if (
      vectors.length !== drafts.length
      || vectors.some((vector) => vector.length !== context.embeddingDimension)
    ) {
      throw new Error(
        `Embedding dimension mismatch; expected ${context.embeddingDimension}`,
      );
    }
    for (let start = 0; start < drafts.length; start += this.dependencies.limits.insertBatchSize) {
      const end = start + this.dependencies.limits.insertBatchSize;
      await this.dependencies.store.saveChunks(
        context,
        drafts.slice(start, end).map((draft, index) => ({
          ...draft,
          embedding: vectors[start + index],
        })),
      );
    }
    return drafts.length;
  }

  private embeddingBatchSize(context: IndexJobContext): number {
    const providerLimit = context.embeddingConfig.provider === 'GEMINI'
      ? 100
      : context.embeddingConfig.provider === 'OLLAMA'
        ? 32
        : 96;
    return Math.min(this.dependencies.limits.embedBatchSize, providerLimit);
  }

  private async report(
    context: IndexJobContext,
    stage: Parameters<IndexStore['updateProgress']>[1],
    percent: number,
    filesProcessed: number,
    totalFiles: number | null,
    chunkCount: number,
  ): Promise<void> {
    await this.dependencies.store.updateProgress(
      context,
      stage,
      percent,
      filesProcessed,
      totalFiles,
      chunkCount,
    );
    await this.publish(
      progressEvent(context, stage, percent, filesProcessed, totalFiles, chunkCount),
    );
  }

  private async publish(event: Parameters<ProgressPublisher['publish']>[0]): Promise<void> {
    await this.dependencies.publisher.publish(event).catch((error: unknown) => {
      const message = error instanceof Error ? scrubString(error.message) : 'publish failed';
      console.warn(`[Indexer] Progress event publish failed: ${message}`);
    });
  }

  private async publishTerminal(
    event: Parameters<ProgressPublisher['publish']>[0],
    job: CodeIndexJobData,
    startedAt: number,
    outcome: {
      commitSha?: string;
      embeddingFingerprint?: string;
      unchanged: boolean;
    },
  ): Promise<void> {
    await this.publish({
      ...event,
      generation: job.generation,
      trigger: job.trigger,
      ...(job.requestedById ? { requestedById: job.requestedById } : {}),
      ...(outcome.commitSha ? { commitSha: outcome.commitSha } : {}),
      ...(outcome.embeddingFingerprint
        ? { embeddingFingerprint: outcome.embeddingFingerprint }
        : {}),
      durationMs: Math.max(0, Date.now() - startedAt),
      unchanged: outcome.unchanged,
    });
  }
}

function decodeText(buffer: Buffer): string | null {
  const content = buffer.toString('utf8');
  if (!content) return null;
  const replacements = [...content].filter((character) => character === '\uFFFD').length;
  return replacements / content.length > 0.01 ? null : content;
}

function safeError(error: unknown, context: IndexJobContext): string {
  const raw = error instanceof Error ? error.message : 'Repository indexing failed';
  const secrets = [
    context.auth.kind === 'PAT' ? context.auth.token : context.auth.privateKey,
    context.embeddingConfig.apiKey,
  ].filter((value): value is string => Boolean(value));
  return secrets.reduce(
    (message, secret) => message.replaceAll(secret, '[redacted]'),
    scrubString(raw),
  ).slice(0, 1_000);
}

function contextStage(error: unknown): Parameters<typeof progressEvent>[1] {
  return error instanceof IndexBlockedError ? 'AUTHENTICATING' : 'SAVING';
}
