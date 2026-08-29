import { describe, expect, it } from 'vitest';
import { projectExecutionProjection } from '../execution/projection.js';
import type { ExecutionRecord } from '../execution/store.js';
import type { TerminalSession } from '../../shared/types.js';

function record(): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', launchKind: 'team', launchDisplay: { label: 'Release execution' }, jobTitle: 'Release train', coordinationMode: 'job-team', summary: 'Ship safely', requestDigest: 'digest', launchRequestId: 'request', teamLaunchRequestId: 'team-request', request: {
      version: 1,
      launchKind: 'team',
      launchDisplay: { label: 'Release execution' },
      slots: [{ initialTask: 'Ship' }, { initialTask: 'Review' }],
      resolvedModels: [],
      goal: 'Deliver release train',
      sourceBundle: { contentRef: 'execution-1/sources.json', sources: [{ id: 'source-1', name: 'plan.md', mediaType: 'text/markdown', byteSize: 25_000, contentDigest: 'sha256:source', extractionStatus: 'READY', extractionWarnings: ['Normalized line endings'] }] }
    }, attempt: 2, state: 'BLOCKED', stateVersion: 3, resolvedModels: [],
    workUnits: [
      { id: 'build', title: 'Build', task: 'Implement', dependencies: [], state: 'COMPLETED', assignedSlotId: 'builder', attempt: 1, result: 'done', history: [] },
      { id: 'verify', title: 'Verify', task: 'Test', dependencies: ['build'], state: 'BLOCKED', assignedSlotId: 'reviewer', attempt: 1, history: [] }
    ],
    blockers: [
      { id: 'old', workUnitId: 'build', slotId: 'builder', question: 'Old?', response: 'Done', resolved: true, createdAt: 1, resolvedAt: 2 },
      { id: 'current', workUnitId: 'verify', slotId: 'reviewer', question: 'Use staging?', options: ['Yes', 'No'], resolved: false, createdAt: 3 }
    ],
    finalSummary: 'Full coordinator summary', recoveryDeadlineAt: Date.now() + 10_000, createdAt: 1, updatedAt: 2
  };
}

describe('projectExecutionProjection', () => {
  it('projects non-secret project execution state and finds only a live orchestrator', () => {
    const session = { id: 'orch', status: 'running', cohort: { executionId: 'execution-1', role: 'orchestrator' } } as TerminalSession;
    expect(projectExecutionProjection([record()], [session])[0]).toMatchObject({
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', launchKind: 'team', launchDisplay: { label: 'Release execution' }, jobTitle: 'Release train', coordinationMode: 'job-team',
      goal: 'Deliver release train', summary: 'Ship safely', state: 'BLOCKED', attempt: 2,
      orchestratorSessionId: 'orch', coordinator: { status: 'live', sessionId: 'orch' },
      sources: [{ name: 'plan.md', contentDigest: 'sha256:source', extractionWarnings: ['Normalized line endings'] }],
      work: {
        total: 2, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 1, COMPLETED: 1, FAILED: 0 },
        assignments: [{ workUnitId: 'build', slotId: 'builder', state: 'COMPLETED' }, { workUnitId: 'verify', slotId: 'reviewer', state: 'BLOCKED' }]
      },
      currentBlocker: { id: 'current', workUnitId: 'verify', slotId: 'reviewer', question: 'Use staging?', options: ['Yes', 'No'] },
      finalSummary: 'Full coordinator summary', eventCursor: 0, recoveryAttention: false
    });
  });

  it('does not claim an exited orchestrator as live', () => {
    const session = { id: 'orch', status: 'exited', cohort: { executionId: 'execution-1', role: 'orchestrator' } } as TerminalSession;
    expect(projectExecutionProjection([record()], [session])[0].orchestratorSessionId).toBeUndefined();
    expect(projectExecutionProjection([record()], [session])[0]).toMatchObject({
      coordinator: { status: 'lost' }, recoveryAttention: true, recovery: { status: 'available', deadlineAt: expect.any(Number) }
    });
  });

  it('does not let an unbound recovery monitor suppress recovery attention', () => {
    const input = record();
    const unbound = { id: 'recovery-unbound', status: 'running', cohort: { executionId: input.id, role: 'orchestrator', slotId: 'orchestrator:recovery' } } as TerminalSession;
    expect(projectExecutionProjection([input], [unbound])[0]).toMatchObject({ coordinator: { status: 'lost' }, recoveryAttention: true });
    input.effectiveOwnerPrincipalIds = ['recovery-bound'];
    const bound = { ...unbound, id: 'recovery-bound' } as TerminalSession;
    expect(projectExecutionProjection([input], [bound])[0]).toMatchObject({ coordinator: { status: 'live', sessionId: 'recovery-bound' }, recoveryAttention: false });
  });

  it('projects empty terminal state without optional signal fields', () => {
    const terminal = record();
    terminal.state = 'COMPLETED';
    terminal.request = { version: 1, slots: [], resolvedModels: [] };
    terminal.summary = undefined;
    terminal.finalSummary = undefined;
    terminal.workUnits = undefined;
    terminal.blockers = undefined;
    const projected = projectExecutionProjection([terminal], [
      { id: 'worker', status: 'running', cohort: { executionId: terminal.id, role: 'worker' } } as TerminalSession
    ])[0];
    expect(projected).toMatchObject({
      sources: [], work: { total: 0, completed: 0, assignments: [] }, coordinator: { status: 'complete' }, recoveryAttention: false
    });
    expect(projected).not.toHaveProperty('goal');
    expect(projected).not.toHaveProperty('summary');
    expect(projected).not.toHaveProperty('currentBlocker');
    expect(projected).not.toHaveProperty('finalSummary');
  });

  it('keeps first live orchestrator and returns newest unresolved blocker response', () => {
    const input = record();
    input.blockers!.push({ id: 'newest', workUnitId: 'verify', slotId: 'reviewer', question: 'Proceed?', response: 'Yes', resolved: false, createdAt: 4 });
    const projected = projectExecutionProjection([input], [
      { id: 'first', status: 'running', cohort: { executionId: input.id, role: 'orchestrator' } } as TerminalSession,
      { id: 'second', status: 'idle', cohort: { executionId: input.id, role: 'orchestrator' } } as unknown as TerminalSession
    ])[0];
    expect(projected.orchestratorSessionId).toBe('first');
    expect(projected.currentBlocker).toMatchObject({ id: 'newest', response: 'Yes' });
  });

  it.each([
    ['PENDING', 0, undefined, false],
    ['LEASED', 2, undefined, false],
    ['FAILED', 7, 'x'.repeat(1_500), true],
    ['FAILED', 8, 'terminal failure', true],
    ['DELIVERED', 1, undefined, false]
  ] as const)('projects %s blocker delivery status without payload text', (state, attempt, lastError, retryEligible) => {
    const input = record();
    input.deliveries = [{
      id: 'delivery-1', clientRequestId: 'client-1', blockerId: 'current', workUnitId: 'verify', slotId: 'reviewer',
      payload: { text: 'secret response text' }, state, attempt, manualRetryCount: 0, ...(lastError ? { lastError } : {}), createdAt: 3, updatedAt: 4
    }];
    const blocker = projectExecutionProjection([input], [])[0].currentBlocker;
    expect(blocker?.delivery).toEqual({
      id: 'delivery-1', state, attempt, maxAttempts: 8, retryEligible,
      ...(lastError ? { error: lastError.slice(0, 1_024) } : {})
    });
    expect(JSON.stringify(blocker)).not.toContain('secret response text');
    expect(blocker?.delivery?.error?.length ?? 0).toBeLessThanOrEqual(1_024);
  });
});
