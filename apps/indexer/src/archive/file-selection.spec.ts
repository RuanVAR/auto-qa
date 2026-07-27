import {
  isHardDeniedPath,
  isProbablyBinary,
  shouldIndexPath,
} from './file-selection';

describe('file selection', () => {
  it.each([
    '.env',
    'config/.env.production',
    '.git/config',
    'node_modules/library/index.js',
    'dist/app.js',
    'certs/client.pem',
    '.ssh/id_rsa',
    'config/credentials.json',
    'deploy/secrets.yaml',
  ])('hard-denies %s', (filePath) => {
    expect(isHardDeniedPath(filePath)).toBe(true);
    expect(shouldIndexPath(filePath, { includeGlobs: ['**/*'], excludeGlobs: [] })).toBe(false);
  });

  it('applies project globs only inside the hard-safe source set', () => {
    const selection = {
      includeGlobs: ['src/**'],
      excludeGlobs: ['**/*.spec.ts'],
    };
    expect(shouldIndexPath('src/routes.ts', selection)).toBe(true);
    expect(shouldIndexPath('src/routes.spec.ts', selection)).toBe(false);
    expect(shouldIndexPath('README.md', selection)).toBe(false);
    expect(shouldIndexPath('config/.env', selection)).toBe(false);
  });

  it('detects binary control bytes without rejecting normal source', () => {
    expect(isProbablyBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(true);
    expect(isProbablyBinary(Buffer.from('const answer = 42;\n'))).toBe(false);
  });
});
