// ─── Shared types for FeaturePage + ManualPlayer + subcomponents ─────────────
// Extracted from FeaturePage.tsx as part of the 2656-line split.
// Pure types — zero runtime code.

export type VersionInfo = {
  id: string;
  versionNumber: number;
  label: string;
  name: string;
  isActive: boolean;
  publishedAt: string;
};

export type TestRunRef = {
  id: string;
  status: string;
  testDefinition: { name: string };
};

export type FeatureRun = {
  id: string;
  status: string;
  runMode?: string;
  createdAt: string;
  completedAt: string | null;
  duration: number | null;
  testRuns: TestRunRef[];
};

export type RunStep = {
  id: string;
  index: number;
  name: string;
  type: string;
  status: string;
  input: Record<string, string> | null;
  notes: string | null;
  screenshot: string | null;
  completedAt: string | null;
};

export type Environment = {
  id: string;
  name: string;
  baseUrl: string;
  embedAllowed: boolean;
};

export type IframeState = 'loading' | 'loaded' | 'timeout' | 'blocked';

export type IssueType = 'BUG' | 'SNAG' | 'QUERY';
export type IssueSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface AttachedEvidence {
  token: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes?: number;
  preview?: string;
}

export interface IssueModalState {
  evidence: AttachedEvidence;
  title: string;
  description: string;
  stepsToReproduce: string;
  type: IssueType;
  severity: IssueSeverity;
}

export interface ManualPlayerProps {
  featureRun: FeatureRun;
  environments: Environment[];
  /** Stops the run (marks it CANCELLED). Closes testing mode. */
  onStop: () => void;
  /** Closes testing mode UI but keeps the run active so the user can resume. */
  onClose?: () => void;
  projectId: string;
  featureId: string;
  feature?: {
    name?: string;
    description?: string;
    acceptanceCriteria?: string;
    status?: string;
  };
}
