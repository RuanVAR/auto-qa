import path from 'node:path';

const DENIED_DIRECTORIES = new Set([
  '.aws',
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.ssh',
  '.terraform',
  '.venv',
  '__pycache__',
  'bin',
  'build',
  'coverage',
  'dist',
  'generated',
  'node_modules',
  'obj',
  'out',
  'target',
  'vendor',
  'venv',
]);

const DENIED_EXTENSIONS = new Set(['.key', '.p12', '.pem', '.pfx']);
const DENIED_NAMES = new Set([
  '.netrc',
  '.npmrc',
  '.pypirc',
  'credentials',
  'credentials.json',
  'id_dsa',
  'id_ed25519',
  'id_rsa',
  'secrets',
  'secrets.json',
  'vault.json',
]);

export class UnsafeRepoPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeRepoPathError';
  }
}

export function normalizeRepoPath(filePath: string): string {
  return filePath.replaceAll('\\', '/').replace(/^\.\/+/, '');
}

export function validateRepoFilePath(filePath: string, maxLength = 1_000): string {
  const raw = filePath.trim();
  if (!raw || raw.includes('\0')) {
    throw new UnsafeRepoPathError('Repository file path is invalid');
  }
  if (
    raw.startsWith('/')
    || raw.startsWith('\\')
    || /^[A-Za-z]:[\\/]/.test(raw)
  ) {
    throw new UnsafeRepoPathError('Absolute repository file paths are not allowed');
  }
  const normalized = normalizeRepoPath(raw);
  if (normalized.length > maxLength) {
    throw new UnsafeRepoPathError(`Repository file path exceeds ${maxLength} characters`);
  }
  if (
    normalized.endsWith('/')
    || normalized.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new UnsafeRepoPathError('Repository file path traversal is not allowed');
  }
  return normalized;
}

export function isHardDeniedRepoPath(filePath: string): boolean {
  const normalized = normalizeRepoPath(filePath);
  const parts = normalized.toLowerCase().split('/');
  const basename = parts.at(-1) ?? '';
  const extension = path.posix.extname(basename);
  if (parts.some((part) => DENIED_DIRECTORIES.has(part))) return true;
  if (basename.startsWith('.env')) return true;
  if (DENIED_EXTENSIONS.has(extension)) return true;
  if (DENIED_NAMES.has(basename)) return true;
  if (
    /(?:^|[._-])(secrets?|credentials?|vault)(?:[._-]|$)/i.test(basename)
    && !basename.endsWith('.example')
  ) {
    return true;
  }
  return false;
}

export function isProbablyBinary(sample: Buffer): boolean {
  if (sample.includes(0)) return true;
  if (sample.length === 0) return false;
  let suspicious = 0;
  for (const byte of sample) {
    const allowedControl = byte === 9 || byte === 10 || byte === 13;
    if (!allowedControl && (byte < 32 || byte === 127)) suspicious += 1;
  }
  return suspicious / sample.length > 0.05;
}
