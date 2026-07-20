import type { Config } from 'jest';

/**
 * The shared package holds the AES-GCM secret-box implementation, the DSL
 * parser and the secret scrubber — all of them security- or correctness-
 * critical, and none of them had a test runner at all until now.
 */
const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
  collectCoverageFrom: ['**/*.ts', '!**/__tests__/**'],
  coverageDirectory: '../coverage',
};

export default config;
