import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import type {
  CodeIndexJobData,
  RepoIndexProgressEvent,
  RepoIndexStageValue,
} from '@qa-platform/shared';
import { loadCodeIndexLimits } from '../config';
import type { ProgressPublisher } from '../events/progress-publisher';
import {
  type ActivateGenerationInput,
  type IndexJobContext,
  type IndexStore,
  type PersistedChunk,
  IndexBlockedError,
  StaleGenerationError,
} from '../persistence/index-store';
import { IndexingService } from './indexing-service';

const job: CodeIndexJobData = {
  branchIndexId: 'index-1',
  generation: 2,
  force: false,
  trigger: 'INITIAL',
  requestedById: 'user-1',
};

describe('IndexingService', () => {
  it('takes a fixture repository through staging to atomic READY activation', async () => {
    const store = new MemoryIndexStore();
    const publisher = new MemoryPublisher();
    const service = fixtureService(store, publisher, await fixtureArchive([
      ['fixture-sha/src/login.tsx', `
        export function Login() {
          return <button data-testid="submit" onClick={() => navigate("/home")}>Go</button>;
        }
      `],
      ['fixture-sha/.env', 'GITHUB_TOKEN=never-index-this'],
    ]));

    await expect(service.process(job)).resolves.toMatchObject({
      outcome: 'READY',
      commitSha: 'commit-2',
    });
    expect(store.status).toBe('READY');
    expect(store.activeGeneration).toBe(2);
    expect(store.generations.get(2)?.length).toBeGreaterThan(0);
    expect(store.generations.get(1)).toBeUndefined();
    expect(store.generations.get(2)?.every((chunk) => chunk.filePath !== '.env')).toBe(true);
    expect(publisher.events.at(-1)).toMatchObject({
      status: 'READY',
      stage: 'COMPLETE',
      progressPercent: 100,
      generation: 2,
      trigger: 'INITIAL',
      requestedById: 'user-1',
      commitSha: 'commit-2',
      embeddingFingerprint: 'embedding-v1',
      unchanged: false,
    });
    expect(publisher.events.at(-1)?.durationMs).toEqual(expect.any(Number));
  });

  it('does not re-embed an unchanged compatible commit unless forced', async () => {
    const store = new MemoryIndexStore({
      commitSha: 'commit-2',
      indexedEmbeddingFingerprint: 'embedding-v1',
      activeGeneration: 1,
      chunkCount: 1,
    });
    const embeddings = { embed: jest.fn() };
    const publisher = new MemoryPublisher();
    const service = fixtureService(
      store,
      publisher,
      await fixtureArchive([['fixture-sha/src/app.ts', 'export const app = true;']]),
      embeddings,
    );

    await expect(service.process(job)).resolves.toEqual({
      outcome: 'UNCHANGED',
      commitSha: 'commit-2',
    });
    expect(embeddings.embed).not.toHaveBeenCalled();
    expect(store.activeGeneration).toBe(1);
    expect(store.status).toBe('READY');
    expect(publisher.events.at(-1)).toMatchObject({
      status: 'READY',
      generation: 2,
      unchanged: true,
      commitSha: 'commit-2',
    });
  });

  it('retains the active generation when embedding fails', async () => {
    const store = new MemoryIndexStore();
    const service = fixtureService(
      store,
      new MemoryPublisher(),
      await fixtureArchive([['fixture-sha/src/app.ts', 'export const app = true;']]),
      { embed: async () => { throw new Error('provider unavailable'); } },
    );

    await expect(service.process(job)).rejects.toThrow('provider unavailable');
    expect(store.activeGeneration).toBe(1);
    expect(store.generations.get(1)).toHaveLength(1);
    expect(store.generations.get(2)).toBeUndefined();
    expect(store.status).toBe('FAILED');
  });

  it('abandons a stale generation without replacing or failing the active one', async () => {
    const store = new MemoryIndexStore();
    store.staleAfterEnsure = 3;
    const service = fixtureService(
      store,
      new MemoryPublisher(),
      await fixtureArchive([['fixture-sha/src/app.ts', 'export const app = true;']]),
    );

    await expect(service.process(job)).resolves.toEqual({ outcome: 'STALE' });
    expect(store.activeGeneration).toBe(1);
    expect(store.generations.get(1)).toHaveLength(1);
    expect(store.generations.get(2)).toBeUndefined();
    expect(store.status).toBe('INDEXING');
  });

  it('keeps a successful activation READY when progress publication fails', async () => {
    const store = new MemoryIndexStore();
    const service = fixtureService(
      store,
      {
        publish: async () => { throw new Error('redis publish unavailable'); },
        close: async () => {},
      },
      await fixtureArchive([['fixture-sha/src/app.ts', 'export const app = true;']]),
    );

    await expect(service.process(job)).resolves.toMatchObject({ outcome: 'READY' });
    expect(store.status).toBe('READY');
    expect(store.activeGeneration).toBe(2);
    expect(store.generations.get(2)).toHaveLength(1);
  });

  it('publishes a terminal blocked event when context loading fails', async () => {
    const blocked = new IndexBlockedError('GitHub credential is disabled');
    blocked.progressEvent = {
      orgId: 'org-1',
      projectId: 'project-1',
      repoId: 'repo-1',
      branchIndexId: 'index-1',
      branch: 'main',
      status: 'BLOCKED',
      stage: 'AUTHENTICATING',
      progressPercent: 0,
      filesProcessed: 0,
      chunkCount: 0,
      error: blocked.message,
    };
    const publisher = new MemoryPublisher();
    const store = {
      claim: async () => { throw blocked; },
    } as unknown as IndexStore;
    const service = fixtureService(
      store,
      publisher,
      await fixtureArchive([]),
    );

    await expect(service.process(job)).rejects.toThrow(blocked);
    expect(publisher.events).toContainEqual(expect.objectContaining({
      status: 'BLOCKED',
      trigger: 'INITIAL',
      requestedById: 'user-1',
      generation: 2,
      error: 'GitHub credential is disabled',
    }));
  });
});

class MemoryIndexStore implements IndexStore {
  readonly context: IndexJobContext;
  readonly generations = new Map<number, PersistedChunk[]>([
    [1, [{
      filePath: 'old.ts',
      chunkIndex: 0,
      content: 'old',
      symbol: null,
      selectors: [],
      routes: [],
      embedding: [1, 0, 0],
    }]],
  ]);
  status = 'PENDING';
  activeGeneration = 1;
  staleAfterEnsure = Number.POSITIVE_INFINITY;
  private ensureCalls = 0;

  constructor(overrides: Partial<IndexJobContext> = {}) {
    this.context = {
      branchIndexId: 'index-1',
      generation: 2,
      orgId: 'org-1',
      projectId: 'project-1',
      repoId: 'repo-1',
      branch: 'main',
      repoOwner: 'owner',
      repoName: 'repo',
      includeGlobs: [],
      excludeGlobs: [],
      auth: { kind: 'PAT', token: 'github-token' },
      embeddingConfig: {
        provider: 'OPENAI',
        model: 'fixture',
        apiKey: 'embedding-key',
      },
      embeddingDimension: 3,
      embeddingFingerprint: 'embedding-v1',
      indexedEmbeddingFingerprint: null,
      activeGeneration: 1,
      commitSha: 'commit-1',
      chunkCount: 1,
      ...overrides,
    };
    this.activeGeneration = this.context.activeGeneration ?? 0;
  }

  async claim(): Promise<IndexJobContext> {
    this.status = 'INDEXING';
    return this.context;
  }

  async ensureCurrent(): Promise<void> {
    this.ensureCalls += 1;
    if (this.ensureCalls >= this.staleAfterEnsure) throw new StaleGenerationError();
  }

  async updateProgress(
    _context: IndexJobContext,
    _stage: RepoIndexStageValue,
    _progressPercent: number,
    _filesProcessed: number,
    _totalFiles: number | null,
    _chunkCount: number,
  ): Promise<void> {}

  async prepareGeneration(): Promise<void> {
    this.generations.delete(2);
  }

  async saveChunks(_context: IndexJobContext, chunks: PersistedChunk[]): Promise<void> {
    this.generations.set(2, [...(this.generations.get(2) ?? []), ...chunks]);
  }

  async activate(input: ActivateGenerationInput): Promise<void> {
    if (!this.generations.get(2)?.length) throw new Error('No staged chunks');
    this.activeGeneration = input.context.generation;
    this.status = 'READY';
    this.generations.delete(1);
  }

  async completeUnchanged(): Promise<void> {
    this.status = 'READY';
  }

  async fail(): Promise<void> {
    this.status = 'FAILED';
  }

  async cleanupGeneration(context: IndexJobContext): Promise<void> {
    if (context.generation !== this.activeGeneration) this.generations.delete(context.generation);
  }
}

class MemoryPublisher implements ProgressPublisher {
  readonly events: RepoIndexProgressEvent[] = [];

  async publish(event: RepoIndexProgressEvent): Promise<void> {
    this.events.push(event);
  }

  async close(): Promise<void> {}
}

function fixtureService(
  store: IndexStore,
  publisher: ProgressPublisher,
  archive: Buffer,
  embeddings: { embed: (config: IndexJobContext['embeddingConfig'], inputs: string[]) => Promise<number[][]> } = {
    embed: async (_config, inputs) => inputs.map((input) => [input.length, 1, 2]),
  },
): IndexingService {
  return new IndexingService({
    store,
    publisher,
    github: {
      getBranchHead: async () => 'commit-2',
      downloadTarball: async () => ({
        stream: Readable.from(archive),
        contentLength: archive.length,
      }),
    },
    embeddings,
    limits: {
      ...loadCodeIndexLimits(),
      maxArchiveBytes: 1024 * 1024,
      maxExtractedBytes: 1024 * 1024,
      maxFiles: 100,
      maxFileBytes: 1024 * 1024,
      embedBatchSize: 2,
      insertBatchSize: 2,
    },
  });
}

async function fixtureArchive(entries: Array<[string, string]>): Promise<Buffer> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<void>((resolve, reject) => {
    pack.once('end', resolve);
    pack.once('error', reject);
  });
  for (const [name, content] of entries) {
    pack.entry({ name }, content);
  }
  pack.finalize();
  await completed;
  return gzipSync(Buffer.concat(chunks));
}
