import path from 'node:path';
import { minimatch } from 'minimatch';
import {
  isHardDeniedRepoPath,
  isProbablyBinary,
  normalizeRepoPath,
} from '@qa-platform/shared';

const SOURCE_EXTENSIONS = new Set([
  '.cjs',
  '.cs',
  '.css',
  '.feature',
  '.go',
  '.htm',
  '.html',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.less',
  '.mjs',
  '.py',
  '.sass',
  '.scss',
  '.ts',
  '.tsx',
  '.vue',
  '.yaml',
  '.yml',
]);

export interface FileSelection {
  includeGlobs: string[];
  excludeGlobs: string[];
}

export function isHardDeniedPath(filePath: string): boolean {
  return isHardDeniedRepoPath(filePath);
}

export function shouldIndexPath(filePath: string, selection: FileSelection): boolean {
  const normalized = normalizeRepoPath(filePath);
  if (!normalized || isHardDeniedPath(normalized)) return false;
  if (!SOURCE_EXTENSIONS.has(path.posix.extname(normalized).toLowerCase())) return false;
  const options = { dot: true, nocase: false, matchBase: true };
  if (
    selection.includeGlobs.length > 0
    && !selection.includeGlobs.some((glob) => minimatch(normalized, glob, options))
  ) {
    return false;
  }
  return !selection.excludeGlobs.some((glob) => minimatch(normalized, glob, options));
}

export { isProbablyBinary, normalizeRepoPath };
