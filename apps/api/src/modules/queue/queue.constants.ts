import { CODE_INDEX_JOB, CODE_INDEX_QUEUE } from '@qa-platform/shared';

export const QUEUE_NAMES = {
  TEST_RUN: 'test-run',
  REPORT_PDF: 'report-pdf',
  CODE_INDEX: CODE_INDEX_QUEUE,
} as const;

export const JOB_NAMES = {
  EXECUTE_RUN: 'execute-run',
  GENERATE_REPORT_PDF: 'generate-report-pdf',
  CODE_INDEX: CODE_INDEX_JOB,
} as const;
