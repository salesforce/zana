import { describe, expect, it } from 'vitest';
import { validateWorkflowPolicyResult, workflowPolicyResultDigest } from '../execution/policy-result.js';

const result = {
  version: 1 as const, executionId: 'execution-1', attempt: 1, outputDigest: 'sha256:output',
  extensionDigest: 'sha256:extension', status: 'ELIGIBLE_FOR_DELIVERY' as const, summary: 'Approved by optional policy'
};

describe('WorkflowPolicyResultV1', () => {
  it('validates opaque digest-bound optional policy results', () => {
    expect(validateWorkflowPolicyResult(result)).toEqual(result);
    expect(workflowPolicyResultDigest(result)).toMatch(/^sha256:/);
  });

  it('rejects malformed status, attempt, and missing digest bindings', () => {
    expect(validateWorkflowPolicyResult({ ...result, status: 'APPROVED' })).toBeUndefined();
    expect(validateWorkflowPolicyResult({ ...result, attempt: 0 })).toBeUndefined();
    expect(validateWorkflowPolicyResult({ ...result, outputDigest: '' })).toBeUndefined();
  });
});
