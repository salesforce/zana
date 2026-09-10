import { describe, expect, it, vi } from 'vitest';
import { createTeamProductOps } from './team-product-ops.js';
import type { ExecutionRecord } from '@zana-ai/zcc-server/services/execution/store';

function job(partial: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    id: 'ex-1',
    projectId: 'p1',
    teamId: 't1',
    callerPrincipalId: 'interactive:local',
    state: 'RUNNING',
    stateVersion: 2,
    attempt: 1,
    createdAt: 1,
    updatedAt: 1,
    jobTitle: 'Ship',
    teamLaunchRequestId: 'ui:1',
    request: { version: 1, teamId: 't1', launchRequestId: 'ui:1', objective: 'ship', slots: [] },
    blockers: [{
      id: 'b1',
      workUnitId: 'w1',
      slotId: 's1',
      question: 'ok?',
      resolved: false,
      createdAt: 1
    }],
    ...partial
  } as ExecutionRecord;
}

describe('createTeamProductOps', () => {
  it('maps both launch modes to one durable execution path', async () => {
    const startTeamJobFromUi = vi.fn(async () => ({ ok: true as const, value: { executionId: 'ex-1', state: 'RUNNING' } }));
    const ops = createTeamProductOps({
      startTeamJobFromUi,
      getExecution: async () => undefined,
      status: async () => undefined,
      stopJob: vi.fn(),
      respondToBlocker: vi.fn()
    });
    await expect(ops.launch({
      teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'structured', title: 'Ship'
    })).resolves.toEqual({ ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } });
    await expect(ops.launch({
      teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'freeform', title: 'Infer', summary: 'Context'
    })).resolves.toEqual({ ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } });
    expect(startTeamJobFromUi).toHaveBeenNthCalledWith(1, expect.objectContaining({ coordinationMode: 'structured' }));
    expect(startTeamJobFromUi).toHaveBeenNthCalledWith(2, expect.objectContaining({
      coordinationMode: 'freeform', title: 'Infer', summary: 'Context'
    }));
  });

  it('answers a single open blocker through durable execution control', async () => {
    const record = job();
    const respondToBlocker = vi.fn(async () => ({ ok: true as const, value: job({ stateVersion: 3 }) }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      getExecution: async (id) => id === 'ex-1' ? record : undefined,
      status: async () => record,
      stopJob: vi.fn(),
      respondToBlocker
    });
    const answered = await ops.answer({ id: 'ex-1', message: 'yes' });
    expect(answered.ok).toBe(true);
    expect(respondToBlocker).toHaveBeenCalledWith(
      'interactive:local', 'p1', 'ex-1', 2, 'b1', expect.any(String), 'yes'
    );
  });

  it('stops executions through durable execution control', async () => {
    const record = job();
    const stopJob = vi.fn(async () => ({ ok: true as const, value: job({ state: 'STOPPED' }) }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      getExecution: async (id) => id === 'ex-1' ? record : undefined,
      status: async () => record,
      stopJob,
      respondToBlocker: vi.fn()
    });
    await expect(ops.stop('ex-1')).resolves.toMatchObject({ ok: true, value: { kind: 'job', state: 'STOPPED' } });
  });

  it('returns reconciled status and distinguishes a missing open blocker', async () => {
    const record = job({ blockers: [] });
    const status = vi.fn(async () => job({ state: 'STOPPED', blockers: [] }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      getExecution: async () => record,
      status,
      stopJob: vi.fn(),
      respondToBlocker: vi.fn()
    });

    await expect(ops.status('ex-1')).resolves.toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    expect(status).toHaveBeenCalledWith('interactive:local', 'p1', 'ex-1');
    await expect(ops.answer({ id: 'ex-1', message: 'yes' })).resolves.toMatchObject({
      ok: false,
      message: 'no open blocker to answer'
    });
  });
});
