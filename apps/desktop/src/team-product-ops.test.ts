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
    request: { version: 1, teamId: 't1', launchRequestId: 'ui:1', goal: 'ship', slots: [] },
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
  it('maps structured launch to startTeamJobFromUi and freeform to launchAutonomousTeam', async () => {
    const startTeamJobFromUi = vi.fn(async () => ({ ok: true as const, value: { executionId: 'ex-1', state: 'RUNNING' } }));
    const launchAutonomousTeam = vi.fn(async () => ({ ok: true as const, value: { runId: 'run-1' } }));
    const ops = createTeamProductOps({
      startTeamJobFromUi,
      launchAutonomousTeam,
      stopAutonomousRun: vi.fn(),
      listAutonomousRuns: () => [],
      getExecution: async () => undefined,
      status: async () => undefined,
      stopJob: vi.fn(),
      respondToBlocker: vi.fn()
    });
    await expect(ops.launch({
      teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'structured', title: 'Ship'
    })).resolves.toEqual({ ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } });
    await expect(ops.launch({
      teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'freeform'
    })).resolves.toEqual({ ok: true, value: { kind: 'run', id: 'run-1', state: 'running' } });
  });

  it('answers a single open blocker and refuses autonomous answer', async () => {
    const record = job();
    const respondToBlocker = vi.fn(async () => ({ ok: true as const, value: job({ stateVersion: 3 }) }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      launchAutonomousTeam: vi.fn(),
      stopAutonomousRun: vi.fn(),
      listAutonomousRuns: () => [{
        runId: 'run-1', teamId: 't1', projectId: 'p1', goal: 'g', state: 'running'
      }],
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
    await expect(ops.answer({ id: 'run-1', message: 'yes' })).resolves.toMatchObject({
      ok: false,
      code: 'UNAVAILABLE'
    });
  });

  it('stops jobs and autonomous runs', async () => {
    const record = job();
    const stopJob = vi.fn(async () => ({ ok: true as const, value: job({ state: 'STOPPED' }) }));
    const stopAutonomousRun = vi.fn(() => ({ ok: true as const, value: true as const }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      launchAutonomousTeam: vi.fn(),
      stopAutonomousRun,
      listAutonomousRuns: () => [{
        runId: 'run-1', teamId: 't1', projectId: 'p1', goal: 'g', state: 'stopped'
      }],
      getExecution: async (id) => id === 'ex-1' ? record : undefined,
      status: async () => record,
      stopJob,
      respondToBlocker: vi.fn()
    });
    await expect(ops.stop('ex-1')).resolves.toMatchObject({ ok: true, value: { kind: 'job', state: 'STOPPED' } });
    await expect(ops.stop('run-1')).resolves.toMatchObject({ ok: true });
    expect(stopAutonomousRun).toHaveBeenCalledWith('run-1');
  });

  it('returns reconciled status and distinguishes a missing open blocker', async () => {
    const record = job({ blockers: [] });
    const status = vi.fn(async () => job({ state: 'STOPPED', blockers: [] }));
    const ops = createTeamProductOps({
      startTeamJobFromUi: vi.fn(),
      launchAutonomousTeam: vi.fn(),
      stopAutonomousRun: vi.fn(),
      listAutonomousRuns: () => [],
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
