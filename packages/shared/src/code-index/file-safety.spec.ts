import {
  isHardDeniedRepoPath,
  isProbablyBinary,
  normalizeRepoPath,
  validateRepoFilePath,
} from './file-safety';

describe('repository file safety', () => {
  it.each([
    '.env',
    '.env-production',
    'config/.env.local',
    '.git/config',
    'node_modules/pkg/index.js',
    'certs/client.pem',
    '.ssh/id_rsa',
    'config/credentials.json',
    'deploy/secrets.yaml',
  ])('hard-denies %s', (filePath) => {
    expect(isHardDeniedRepoPath(filePath)).toBe(true);
  });

  it.each([
    '../secret.ts',
    'src/../../secret.ts',
    '/etc/passwd',
    String.raw`C:\Users\secret.txt`,
    String.raw`\\server\share\secret.txt`,
    'src//login.ts',
    'src/./login.ts',
    'src/login.ts/',
    '',
  ])('rejects unsafe provider path %s', (filePath) => {
    expect(() => validateRepoFilePath(filePath)).toThrow();
  });

  it('normalizes a safe relative provider path', () => {
    expect(validateRepoFilePath(String.raw`.\src\login.ts`)).toBe('src/login.ts');
    expect(normalizeRepoPath('./src/login.ts')).toBe('src/login.ts');
  });

  it('detects binary control bytes', () => {
    expect(isProbablyBinary(Buffer.from([0x50, 0x00, 0x01]))).toBe(true);
    expect(isProbablyBinary(Buffer.from('export const route = "/login";\n'))).toBe(false);
  });
});
