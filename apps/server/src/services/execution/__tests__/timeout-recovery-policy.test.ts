import { describe, expect, it } from 'vitest';
import { timeoutRecoveryBlockReason } from '../timeout-recovery-policy.js';
import { projectExecutionProjection } from '../projection.js';
import type { ExecutionRecord, ExecutionWorkUnit } from '../store.js';

const unit = (over: Partial<ExecutionWorkUnit>): ExecutionWorkUnit => ({
  id: 'u', title: 'U', task: 't', dependencies: [], state: 'BLOCKED', attempt: 1, history: [], ...over
} as ExecutionWorkUnit);

describe('timeoutRecoveryBlockReason', () => {
  it('allows runs with no work units', () => {
    expect(timeoutRecoveryBlockReason({})).toBeUndefined();
    expect(timeoutRecoveryBlockReason({ workUnits: [] })).toBeUndefined();
  });
  it('allows read-only work, finished or not', () => {
    expect(timeoutRecoveryBlockReason({ workUnits: [unit({ readOnly: true }), unit({ id: 'v', readOnly: true, state: 'COMPLETED' })] })).toBeUndefined();
  });
  it('blocks unfinished mutating work', () => {
    expect(timeoutRecoveryBlockReason({ workUnits: [unit({})] })).toContain('unfinished mutating work');
  });
  it('blocks completed mutating work', () => {
    expect(timeoutRecoveryBlockReason({ workUnits: [unit({ state: 'COMPLETED' })] })).toContain('completed mutating work');
  });
});

describe('timeoutRecovery projection', () => {
  const stopped = (workUnits: ExecutionWorkUnit[], extra: Partial<ExecutionRecord> = {}) => ({
    id: 'e', callerPrincipalId: 'o', projectId: 'p', teamId: 't', jobTitle: 'J', attempt: 1, state: 'STOPPED',
    timeoutReason: 'unresolved-blocker', stateVersion: 1, resolvedModels: [], workUnits, blockers: [], createdAt: 1, updatedAt: 2,
    request: { version: 1, slots: [], resolvedModels: [] }, ...extra
  }) as unknown as ExecutionRecord;
  const project = (r: ExecutionRecord) => projectExecutionProjection([r], [])[0].timeoutRecovery;

  it('exposes the same verdict as the backend predicate', () => {
    expect(project(stopped([unit({ readOnly: true })]))).toEqual({ available: true });
    expect(project(stopped([]))).toEqual({ available: true });
    const mutating = stopped([unit({})]);
    expect(project(mutating)).toEqual({ available: false, reason: timeoutRecoveryBlockReason(mutating) });
  });
  it('is omitted for non-timeout runs', () => {
    expect(project(stopped([unit({})], { timeoutReason: undefined }))).toBeUndefined();
    expect(project(stopped([unit({})], { state: 'FAILED' } as Partial<ExecutionRecord>))).toBeUndefined();
  });
});
