import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  // Regression floor for `pnpm test:cov` / CI — does NOT affect plain `pnpm test`.
  // Intentionally conservative (a "don't regress to nothing" gate); ratchet up as
  // the audit adds unit + e2e coverage (target 40%+ over Phases 0–6).
  coverageThreshold: {
    global: { statements: 10, branches: 8, functions: 8, lines: 10 },
  },
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/$1',
    // Use the storage package's TS source in tests (no prebuilt dist needed).
    '^@qa-platform/storage$': '<rootDir>/../../../packages/storage/src/index.ts',
  },
};

export default config;
