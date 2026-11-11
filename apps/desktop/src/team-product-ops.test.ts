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
  it('fails closed on unavailable or failed trusted preview', async () => {
    const deps = { startTeamJobFromUi: vi.fn(), getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() };
    const input = { teamId: 't', projectId: 'p', goal: 'go', mode: 'freeform' as const };
    expect(await createTeamProductOps(deps).preview!(input)).toMatchObject({ ok: false, code: 'UNAVAILABLE' });
    expect(await createTeamProductOps({ ...deps, resolvePreview: async () => { throw new Error('/private/internal'); } }).preview!(input)).toMatchObject({ ok: false, code: 'INVALID', message: 'Launch preview could not validate the plan or target.' });
  });
  it('previews via trusted resolver and forwards token; returns actual launch location', async () => {
    const location = { kind: 'project-root' as const, projectId: 'p' };
    const preview = vi.fn(async () => ({ location, path: '/actual', previewToken: 'opaque' } as never));
    const start = vi.fn(async () => ({ ok: true as const, value: { executionId: 'e', state: 'RUNNING' } }));
    const ops = createTeamProductOps({ resolvePreview: preview, resolveLocation: async () => ({ location, path: '/actual', branch: 'main' }), startTeamJobFromUi: start, getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() });
    expect(await ops.preview!({ teamId: 't', projectId: 'p', goal: 'go', mode: 'freeform' })).toMatchObject({ ok: true, value: { previewToken: 'opaque', path: '/actual' } });
    expect(await ops.launch({ teamId: 't', projectId: 'p', goal: 'go', mode: 'freeform', previewToken: 'opaque' })).toMatchObject({ ok: true, value: { id: 'e', state: 'RUNNING', location, path: '/actual', branch: 'main' } });
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ previewToken: 'opaque' }));
  });
  it('forwards every explicit launch option without dropping false or empty values', async () => {
    const start = vi.fn(async () => ({ ok: true as const, value: { executionId: 'e', state: 'RUNNING' } }));
    const ops = createTeamProductOps({ startTeamJobFromUi: start, getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() });
    const options = { worktree: false, push: false, checks: [], onComplete: 'leave' as const, failurePolicyDefault: 'fail-run' as const, target: { kind: 'project-root' as const } };
    await ops.launch({ teamId: 't', projectId: 'p', goal: 'go', ...options });
    expect(start).toHaveBeenCalledWith(expect.objectContaining(options));
  });
  it.each(['COMPLETED', 'FAILED', 'STOPPED'] as const)('returns the persisted assembled result at %s without preview truncation', async (state) => {
    const assembledResult = {
      version: 1 as const, outcome: 'partial' as const, summary: 'Persisted result',
      units: [{ id: 'w1', title: 'Work', state: 'COMPLETED' as const, result: 'full output'.repeat(1000) }],
      failures: [{ workUnitId: 'w2', code: 'VALIDATION_FAILED' }],
      artifacts: [{ name: 'report.md', mediaType: 'text/markdown', contentDigest: 'sha256:123' }],
      verification: [{ workUnitId: 'w1', checks: ['pnpm test'] }],
      usage: { version: 1 as const, completeness: 'unavailable' as const, observationCount: 0, gapCount: 0, byRole: [] },
      digest: 'sha256:456'
    };
    const record = job({ state, assembledResult, finalSummary: 'Different final summary' });
    const ops = createTeamProductOps({ startTeamJobFromUi: vi.fn(), getExecution: async () => job(),
      status: async () => record, stopJob: vi.fn(), respondToBlocker: vi.fn() });
    expect(await ops.status('ex-1')).toMatchObject({ ok: true, value: { result: assembledResult } });
  });

  it('uses only persisted finalSummary for legacy terminal results and omits absent or nonterminal results', async () => {
    let record = job({ state: 'COMPLETED', finalSummary: 'Legacy final output' });
    const ops = createTeamProductOps({ startTeamJobFromUi: vi.fn(), getExecution: async () => record,
      status: async () => record, stopJob: vi.fn(), respondToBlocker: vi.fn() });
    expect(await ops.status('ex-1')).toMatchObject({ ok: true, value: { result: 'Legacy final output' } });
    for (const next of [job({ state: 'COMPLETED' }), job({ finalSummary: 'Not terminal' })]) {
      record = next;
      const result = await ops.status('ex-1');
      expect(result.ok && result.value).not.toHaveProperty('result');
    }
  });

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
      teamId: 't1', projectId: 'p1', goal: '### a: A <!-- executable-step -->', mode: 'structured', title: 'Ship'
    })).resolves.toEqual({ ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } });
    await expect(ops.launch({
      teamId: 't1', projectId: 'p1', goal: 'ship', mode: 'freeform', title: 'Infer', summary: 'Context'
    })).resolves.toEqual({ ok: true, value: { kind: 'job', id: 'ex-1', state: 'RUNNING' } });
    expect(startTeamJobFromUi).toHaveBeenNthCalledWith(1, expect.objectContaining({ coordinationMode: 'structured' }));
    expect(startTeamJobFromUi).toHaveBeenNthCalledWith(2, expect.objectContaining({
      coordinationMode: 'freeform', title: 'Infer', summary: 'Context'
    }));
  });

  it('defaults a missing mode to freeform and surfaces INVALID_PLAN for a prose structured goal', async () => {
    const startTeamJobFromUi = vi.fn(async (input: { coordinationMode?: string }) => input.coordinationMode === 'structured'
      ? { ok: false as const, code: 'INVALID_PLAN', message: 'provided structured plan is invalid' }
      : { ok: true as const, value: { executionId: 'ex-1', state: 'RUNNING' } });
    const ops = createTeamProductOps({
      startTeamJobFromUi,
      getExecution: async () => undefined,
      status: async () => undefined,
      stopJob: vi.fn(),
      respondToBlocker: vi.fn()
    });
    const prose = { teamId: 't1', projectId: 'p1', goal: 'ship it' };
    await expect(ops.launch(prose as never)).resolves.toMatchObject({ ok: true });
    expect(startTeamJobFromUi).toHaveBeenLastCalledWith(expect.objectContaining({ coordinationMode: 'freeform' }));
    await expect(ops.launch({ ...prose, mode: 'structured' })).resolves.toEqual({
      ok: false, code: 'INVALID_PLAN', message: 'provided structured plan is invalid'
    });
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
