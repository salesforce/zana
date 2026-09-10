import { describe, expect, it } from 'vitest';
import { projectExecutionProjection } from '../projection.js';
import type { ExecutionRecord } from '../store.js';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';

function record(): ExecutionRecord {
  return {
    id: 'execution-1', callerPrincipalId: 'owner', projectId: 'project-1', teamId: 'team-1', launchKind: 'team', launchDisplay: { label: 'Release execution' }, jobTitle: 'Release train', coordinationMode: 'job-team', origin: 'scheduled', summary: 'Ship safely', requestDigest: 'digest', launchRequestId: 'request', teamLaunchRequestId: 'team-request', request: {
      version: 1,
      launchKind: 'team',
      launchDisplay: { label: 'Release execution' },
      slots: [{ initialTask: 'Ship' }, { initialTask: 'Review' }],
      resolvedModels: [],
      objective: 'Deliver release train',
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
      executionId: 'execution-1', projectId: 'project-1', teamId: 'team-1', launchKind: 'team', launchDisplay: { label: 'Release execution' }, jobTitle: 'Release train', coordinationMode: 'job-team', origin: 'scheduled',
      objective: 'Deliver release train', summary: 'Ship safely', state: 'BLOCKED', attempt: 2,
      orchestratorSessionId: 'orch', coordinator: { status: 'live', sessionId: 'orch' },
      sources: [{ name: 'plan.md', contentDigest: 'sha256:source', extractionWarnings: ['Normalized line endings'] }],
      work: {
        total: 2, completed: 1, counts: { PENDING: 0, READY: 0, CLAIMED: 0, BLOCKED: 1, COMPLETED: 1, FAILED: 0 },
        assignments: [{ workUnitId: 'build', slotId: 'builder', state: 'COMPLETED' }, { workUnitId: 'verify', slotId: 'reviewer', state: 'BLOCKED' }]
      },
      currentBlocker: { id: 'current', workUnitId: 'verify', slotId: 'reviewer', question: 'Use staging?', options: ['Yes', 'No'] },
      blockers: [
        { id: 'old', resolved: true },
        { id: 'current', resolved: false }
      ],
      finalSummary: 'Full coordinator summary', eventCursor: 0, recoveryAttention: false
    });
  });

  it('exposes a completed unit result on its assignment, bounded to 2 KiB, and omits it when absent', () => {
    const input = record();
    input.workUnits![0].result = 'z'.repeat(3_000);
    const assignments = projectExecutionProjection([input], [])[0].work!.assignments;
    const build = assignments.find((a) => a.workUnitId === 'build')!;
    const verify = assignments.find((a) => a.workUnitId === 'verify')!;
    expect(build.result).toHaveLength(2_048);
    expect(verify).not.toHaveProperty('result'); // verify has no stored result
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

  it('projects delivery state for every bounded blocker, not only the newest unresolved blocker', () => {
    const input = record();
    input.blockers!.push({ id: 'newest', workUnitId: 'verify', slotId: 'reviewer', question: 'Proceed?', resolved: false, createdAt: 5 });
    input.deliveries = [
      { id: 'delivery-current', clientRequestId: 'client-current', blockerId: 'current', workUnitId: 'verify', slotId: 'reviewer', payload: { text: 'queued' }, state: 'PENDING', attempt: 0, createdAt: 3, updatedAt: 4 },
      { id: 'delivery-newest', clientRequestId: 'client-newest', blockerId: 'newest', workUnitId: 'verify', slotId: 'reviewer', payload: { text: 'failed' }, state: 'FAILED', attempt: 1, createdAt: 5, updatedAt: 6 }
    ];

    expect(projectExecutionProjection([input], [])[0].blockers).toEqual([
      { id: 'old', resolved: true },
      { id: 'current', resolved: false, deliveryState: 'PENDING' },
      { id: 'newest', resolved: false, deliveryState: 'FAILED' }
    ]);
  });

  it('surfaces a delivery error as a first-line message, never a multi-line stack trace', () => {
    const input = record();
    input.deliveries = [{
      id: 'delivery-1', clientRequestId: 'client-1', blockerId: 'current', workUnitId: 'verify', slotId: 'reviewer',
      payload: { text: 'secret response text' }, state: 'FAILED', attempt: 8, manualRetryCount: 0,
      lastError: '  Cannot apply answer: file locked  \n    at Worker.run (worker.js:42:7)\n    at process._tickCallback',
      createdAt: 3, updatedAt: 4
    }];
    const error = projectExecutionProjection([input], [])[0].currentBlocker?.delivery?.error;
    expect(error).toBe('Cannot apply answer: file locked');
    expect(error).not.toContain('\n');
    expect(error).not.toContain('worker.js');
  });
});
