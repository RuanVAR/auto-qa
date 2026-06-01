import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  // Resolve the workspace storage package to its TS source so tests don't
  // depend on a prebuilt dist (and ts-jest doesn't warn compiling its .js).
  moduleNameMapper: {
    '^@qa-platform/storage$': '<rootDir>/../../../packages/storage/src/index.ts',
  },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
};

export default config;
