import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import tar from 'tar-stream';
import { loadCodeIndexLimits } from '../config';
import {
  ArchiveSafetyError,
  extractGitHubTarball,
  saveArchiveStream,
} from './safe-archive';

interface FixtureEntry {
  name: string;
  type?: tar.Headers['type'];
  content?: string | Buffer;
}

describe('safe GitHub archive handling', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'indexer-archive-test-'));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('extracts selected source files and never writes hard-denied files', async () => {
    const archivePath = path.join(root, 'repo.tar.gz');
    await writeFixture(archivePath, [
      { name: 'repo-sha/', type: 'directory' },
      { name: 'repo-sha/src/', type: 'directory' },
      { name: 'repo-sha/src/routes.ts', content: 'export const route = "/login";' },
      { name: 'repo-sha/.env', content: 'TOKEN=do-not-write' },
      { name: 'repo-sha/image.png', content: Buffer.from([0, 1, 2]) },
    ]);

    const files = await extractGitHubTarball(
      archivePath,
      path.join(root, 'source'),
      { includeGlobs: [], excludeGlobs: [] },
      loadCodeIndexLimits(),
    );

    expect(files.map((file) => file.repoPath)).toEqual(['src/routes.ts']);
    await expect(readFile(path.join(root, 'source/.env'))).rejects.toThrow();
  });

  it.each([
    { name: '../outside.ts', type: 'file' as const, content: 'bad' },
    { name: '/absolute.ts', type: 'file' as const, content: 'bad' },
    { name: 'repo-sha/link.ts', type: 'symlink' as const },
    { name: 'repo-sha/hard.ts', type: 'link' as const },
  ])('rejects unsafe archive entry $name', async (entry) => {
    const archivePath = path.join(root, 'unsafe.tar.gz');
    await writeFixture(archivePath, [entry]);
    await expect(
      extractGitHubTarball(
        archivePath,
        path.join(root, 'source'),
        { includeGlobs: [], excludeGlobs: [] },
        loadCodeIndexLimits(),
      ),
    ).rejects.toBeInstanceOf(ArchiveSafetyError);
  });

  it('enforces compressed and extracted limits', async () => {
    await expect(
      saveArchiveStream(
        Readable.from(Buffer.alloc(64)),
        path.join(root, 'too-large.tar.gz'),
        32,
      ),
    ).rejects.toBeInstanceOf(ArchiveSafetyError);

    const archivePath = path.join(root, 'large.tar.gz');
    await writeFixture(archivePath, [
      { name: 'repo-sha/src/large.ts', content: 'a'.repeat(128) },
    ]);
    await expect(
      extractGitHubTarball(
        archivePath,
        path.join(root, 'source'),
        { includeGlobs: [], excludeGlobs: [] },
        { ...loadCodeIndexLimits(), maxFileBytes: 64 },
      ),
    ).rejects.toBeInstanceOf(ArchiveSafetyError);
  });
});

async function writeFixture(destination: string, entries: FixtureEntry[]): Promise<void> {
  const pack = tar.pack();
  const chunks: Buffer[] = [];
  pack.on('data', (chunk: Buffer) => chunks.push(chunk));
  const complete = new Promise<void>((resolve, reject) => {
    pack.once('end', resolve);
    pack.once('error', reject);
  });
  for (const entry of entries) {
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content ?? '');
    pack.entry(
      {
        name: entry.name,
        type: entry.type ?? 'file',
        size: entry.type && entry.type !== 'file' ? 0 : content.length,
        linkname: entry.type === 'link' || entry.type === 'symlink' ? 'target' : undefined,
      },
      content,
    );
  }
  pack.finalize();
  await complete;
  const { writeFile } = await import('node:fs/promises');
  await writeFile(destination, gzipSync(Buffer.concat(chunks)));
}
