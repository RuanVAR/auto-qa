import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import tar from 'tar-stream';
import type { CodeIndexLimits } from '../config';
import {
  type FileSelection,
  isProbablyBinary,
  normalizeRepoPath,
  shouldIndexPath,
} from './file-selection';

export interface ExtractedSourceFile {
  absolutePath: string;
  repoPath: string;
  size: number;
}

export async function saveArchiveStream(
  source: Readable,
  destination: string,
  maxBytes: number,
): Promise<number> {
  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > maxBytes) {
        callback(new ArchiveSafetyError(`Compressed archive exceeds ${maxBytes} bytes`));
        return;
      }
      callback(null, chunk);
    },
  });
  await pipeline(source, limiter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
  return bytes;
}

export async function extractGitHubTarball(
  archivePath: string,
  outputRoot: string,
  selection: FileSelection,
  limits: CodeIndexLimits,
): Promise<ExtractedSourceFile[]> {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const extract = tar.extract();
  const files: ExtractedSourceFile[] = [];
  let fileCount = 0;
  let extractedBytes = 0;
  let archiveRoot: string | null = null;

  extract.on('entry', (header, entry, next) => {
    void (async () => {
      if (header.type === 'pax-header' || header.type === 'pax-global-header') {
        entry.resume();
        await streamFinished(entry);
        next();
        return;
      }
      const safeName = validateArchivePath(header.name, limits.maxPathLength);
      const [root, ...rest] = safeName.split('/');
      if (!archiveRoot) archiveRoot = root;
      if (root !== archiveRoot) {
        throw new ArchiveSafetyError('Archive contains multiple root directories');
      }
      const repoPath = normalizeRepoPath(rest.join('/'));
      if (header.type === 'directory') {
        entry.resume();
        await streamFinished(entry);
        next();
        return;
      }
      if (header.type !== 'file') {
        throw new ArchiveSafetyError(`Archive entry type "${header.type}" is not allowed`);
      }
      if (!repoPath) throw new ArchiveSafetyError('Archive file is outside its root directory');
      const fileSize = header.size ?? 0;

      fileCount += 1;
      extractedBytes += fileSize;
      if (fileCount > limits.maxFiles) {
        throw new ArchiveSafetyError(`Archive exceeds ${limits.maxFiles} files`);
      }
      if (fileSize > limits.maxFileBytes) {
        throw new ArchiveSafetyError(`Archive file exceeds ${limits.maxFileBytes} bytes`);
      }
      if (extractedBytes > limits.maxExtractedBytes) {
        throw new ArchiveSafetyError(
          `Extracted archive exceeds ${limits.maxExtractedBytes} bytes`,
        );
      }
      if (!shouldIndexPath(repoPath, selection)) {
        entry.resume();
        await streamFinished(entry);
        next();
        return;
      }

      const destination = resolveInside(outputRoot, repoPath);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const sampleChunks: Buffer[] = [];
      let sampleBytes = 0;
      const probe = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          if (sampleBytes < 8_192) {
            const remaining = 8_192 - sampleBytes;
            const sample = chunk.subarray(0, remaining);
            sampleChunks.push(sample);
            sampleBytes += sample.length;
          }
          callback(null, chunk);
        },
      });
      await pipeline(entry, probe, createWriteStream(destination, { flags: 'wx', mode: 0o600 }));
      if (isProbablyBinary(Buffer.concat(sampleChunks))) {
        await rm(destination, { force: true });
        next();
        return;
      }
      files.push({ absolutePath: destination, repoPath, size: fileSize });
      next();
    })().catch((error: unknown) => next(asError(error)));
  });

  await pipeline(createReadStream(archivePath), createGunzip(), extract);
  return files.sort((left, right) => left.repoPath.localeCompare(right.repoPath));
}

export class ArchiveSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveSafetyError';
  }
}

function validateArchivePath(entryPath: string, maxLength: number): string {
  const normalized = normalizeRepoPath(entryPath);
  if (!normalized || normalized.includes('\0')) {
    throw new ArchiveSafetyError('Archive contains an invalid path');
  }
  if (
    entryPath.startsWith('/')
    || entryPath.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(entryPath)
  ) {
    throw new ArchiveSafetyError('Archive contains an absolute path');
  }
  const withoutTrailingSlash = normalized.replace(/\/+$/, '');
  if (withoutTrailingSlash.length > maxLength) {
    throw new ArchiveSafetyError(`Archive path exceeds ${maxLength} characters`);
  }
  if (withoutTrailingSlash.split('/').some((part) => part === '..' || part === '')) {
    throw new ArchiveSafetyError('Archive contains path traversal');
  }
  return withoutTrailingSlash;
}

function resolveInside(root: string, repoPath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...repoPath.split('/'));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new ArchiveSafetyError('Archive path escapes the extraction root');
  }
  return resolved;
}

async function streamFinished(stream: Readable): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    stream.once('end', resolve);
    stream.once('error', reject);
  });
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
