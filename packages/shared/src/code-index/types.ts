export const CODE_INDEX_QUEUE = 'code-index';
export const CODE_INDEX_JOB = 'index-repository';
export const WORKER_EVENTS_CHANNEL = 'worker:events';

export type CodeIndexTrigger = 'INITIAL' | 'BINDING_CHANGE' | 'MANUAL' | 'SCHEDULED';

export interface CodeIndexJobData {
  branchIndexId: string;
  generation: number;
  force: boolean;
  requestedById?: string;
  trigger: CodeIndexTrigger;
}

export type RepoIndexStatusValue = 'BLOCKED' | 'PENDING' | 'INDEXING' | 'READY' | 'FAILED';

export type RepoIndexStageValue =
  | 'QUEUED'
  | 'AUTHENTICATING'
  | 'DOWNLOADING'
  | 'SCANNING'
  | 'CHUNKING'
  | 'EMBEDDING'
  | 'SAVING'
  | 'COMPLETE';

export interface RepoIndexProgressEvent {
  orgId: string;
  projectId: string;
  repoId: string;
  branchIndexId: string;
  branch: string;
  status: RepoIndexStatusValue;
  stage: RepoIndexStageValue;
  progressPercent: number;
  filesProcessed: number;
  totalFiles?: number;
  chunkCount: number;
  error?: string;
  generation?: number;
  trigger?: CodeIndexTrigger;
  requestedById?: string;
  commitSha?: string;
  embeddingFingerprint?: string;
  durationMs?: number;
  unchanged?: boolean;
}

export interface WorkerEventEnvelope<TType extends string, TPayload> {
  type: TType;
  payload: TPayload;
}
