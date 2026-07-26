import {
  codeIndexConcurrency,
  codeIndexJobsPerMinute,
  loadCodeIndexLimits,
} from './config';

describe('code index configuration', () => {
  it('uses conservative production defaults', () => {
    expect(codeIndexConcurrency({})).toBe(1);
    expect(codeIndexJobsPerMinute({})).toBe(4);
    expect(loadCodeIndexLimits({})).toEqual(expect.objectContaining({
      embedBatchSize: 64,
      insertBatchSize: 64,
      statementTimeoutMs: 30_000,
    }));
  });

  it('accepts an explicit distributed job-start ceiling', () => {
    expect(codeIndexJobsPerMinute({
      CODE_INDEX_JOBS_PER_MINUTE: '2',
    })).toBe(2);
  });

  it('rejects zero, negative, fractional, and non-numeric limits', () => {
    for (const value of ['0', '-1', '1.5', 'not-a-number']) {
      expect(() => codeIndexJobsPerMinute({
        CODE_INDEX_JOBS_PER_MINUTE: value,
      })).toThrow('Invalid positive integer configuration value');
    }
  });
});
