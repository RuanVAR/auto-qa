export interface CodeIndexLimits {
  maxArchiveBytes: number;
  maxExtractedBytes: number;
  maxFiles: number;
  maxFileBytes: number;
  maxPathLength: number;
  embedBatchSize: number;
  insertBatchSize: number;
  statementTimeoutMs: number;
}

const MEBIBYTE = 1024 * 1024;

export function loadCodeIndexLimits(env: NodeJS.ProcessEnv = process.env): CodeIndexLimits {
  return {
    maxArchiveBytes: positiveNumber(env.CODE_INDEX_MAX_ARCHIVE_MB, 250) * MEBIBYTE,
    maxExtractedBytes: positiveNumber(env.CODE_INDEX_MAX_EXTRACTED_MB, 750) * MEBIBYTE,
    maxFiles: positiveNumber(env.CODE_INDEX_MAX_FILES, 50_000),
    maxFileBytes: positiveNumber(env.CODE_INDEX_MAX_FILE_MB, 2) * MEBIBYTE,
    maxPathLength: positiveNumber(env.CODE_INDEX_MAX_PATH_LENGTH, 1_024),
    embedBatchSize: positiveNumber(env.CODE_INDEX_EMBED_BATCH_SIZE, 64),
    insertBatchSize: positiveNumber(env.CODE_INDEX_INSERT_BATCH_SIZE, 64),
    statementTimeoutMs: positiveNumber(env.CODE_INDEX_STATEMENT_TIMEOUT_MS, 30_000),
  };
}

export function codeIndexConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  return positiveNumber(env.CODE_INDEX_CONCURRENCY, 1);
}

export function codeIndexJobsPerMinute(
  env: NodeJS.ProcessEnv = process.env,
): number {
  return positiveNumber(env.CODE_INDEX_JOBS_PER_MINUTE, 4);
}

function positiveNumber(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer configuration value: ${value}`);
  }
  return parsed;
}
