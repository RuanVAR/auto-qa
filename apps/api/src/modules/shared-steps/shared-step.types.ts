export interface SharedStepParameter {
  key: string;
  label?: string;
  required?: boolean;
  defaultValue?: string;
  secret?: boolean;
}

export interface SharedStepReference {
  index?: number;
  name?: string;
  type: 'SHARED';
  input: { sharedStepId: string; params?: Record<string, string> };
}

export interface ResolvedRunSpec {
  schemaVersion: 1;
  testDefinitionId: string;
  testDefinitionVersion: number;
  steps: Array<Record<string, unknown>>;
  sharedStepDependencies: Array<{ id: string; name: string; version: number }>;
}

export function isSharedStepReference(value: unknown): value is SharedStepReference {
  if (!value || typeof value !== 'object') return false;
  const step = value as { type?: unknown; input?: { sharedStepId?: unknown } };
  return step.type === 'SHARED' && typeof step.input?.sharedStepId === 'string' && step.input.sharedStepId.length > 0;
}
