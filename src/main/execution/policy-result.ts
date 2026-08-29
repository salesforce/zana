import { createHash } from 'node:crypto';

export type WorkflowPolicyStatus = 'PENDING' | 'PASSED' | 'BLOCKED' | 'FAILED' | 'ELIGIBLE_FOR_DELIVERY';

export interface WorkflowPolicyResultV1 {
  version: 1;
  executionId: string;
  attempt: number;
  outputDigest: string;
  extensionDigest: string;
  status: WorkflowPolicyStatus;
  summary: string;
}

const STATUSES = new Set<WorkflowPolicyStatus>(['PENDING', 'PASSED', 'BLOCKED', 'FAILED', 'ELIGIBLE_FOR_DELIVERY']);

function string(value: unknown, label: string, max = 2_048): string | undefined {
  return typeof value === 'string' && value.trim() && value.length <= max ? value : undefined;
}

/** Validates an opaque optional-policy result without interpreting policy semantics. */
export function validateWorkflowPolicyResult(value: unknown): WorkflowPolicyResultV1 | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result = value as Partial<WorkflowPolicyResultV1>;
  const executionId = string(result.executionId, 'execution id');
  const outputDigest = string(result.outputDigest, 'output digest');
  const extensionDigest = string(result.extensionDigest, 'extension digest');
  const summary = string(result.summary, 'summary');
  const attempt = result.attempt;
  if (result.version !== 1 || !executionId || !outputDigest || !extensionDigest || !summary
    || typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1 || !STATUSES.has(result.status as WorkflowPolicyStatus)) return undefined;
  return { version: 1, executionId, attempt, outputDigest, extensionDigest, status: result.status as WorkflowPolicyStatus, summary };
}

export function workflowPolicyResultDigest(result: WorkflowPolicyResultV1): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(result)).digest('hex')}`;
}
