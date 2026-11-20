import { describe, expect, it, vi } from 'vitest';
import { createTeamProductOps } from './team-product-ops.js';
import { SquadPreviewAdmissionError } from './squad-proposals/service.js';
import { NO_PLAN_STEPS_REASON, resolveSquadPlan } from './team-trigger-semantics.js';
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
  it('forwards planText to the launch start request only when present', async () => {
    const start = vi.fn(async () => ({ ok: true as const, value: { executionId: 'e', state: 'RUNNING' } }));
    const ops = createTeamProductOps({ startTeamJobFromUi: start, getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() });
    await ops.launch({ teamId: 't', projectId: 'p', goal: 'go', planText: 'the plan', mode: 'structured' });
    expect(start).toHaveBeenLastCalledWith(expect.objectContaining({ planText: 'the plan', goal: 'go' }));
    await ops.launch({ teamId: 't', projectId: 'p', goal: 'go', mode: 'structured' });
    expect(start.mock.calls.at(-1)![0]).not.toHaveProperty('planText');
  });
  it('returns successful start when location lookup fails, preventing a retry from duplicating the job', async () => {
    const start = vi.fn(async () => ({ ok: true as const, value: { executionId: 'e', state: 'RUNNING' } }));
    const logError = vi.fn();
    const ops = createTeamProductOps({ resolveLocation: async () => { throw new Error('transient lookup failure'); }, startTeamJobFromUi: start,
      getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn(), logError });
    await expect(ops.launch({ teamId: 't', projectId: 'p', goal: 'go', mode: 'freeform' })).resolves.toEqual({
      ok: true, value: { kind: 'job', id: 'e', state: 'RUNNING' }
    });
    expect(start).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith('team launch location project=p execution=e', expect.any(Error));
    expect(logError.mock.calls[0]![0]).not.toContain('go');
  });
  it('logs trusted preview failure with safe identifiers before returning a sanitized error', async () => {
    const logError = vi.fn();
    const ops = createTeamProductOps({ resolvePreview: async () => { throw new Error('preview failed'); }, startTeamJobFromUi: vi.fn(),
      getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn(), logError });
    await expect(ops.preview!({ teamId: 't', projectId: 'p', goal: 'secret command --token=abc', mode: 'freeform' })).resolves.toMatchObject({
      ok: false, code: 'INVALID', message: 'Launch preview could not validate the plan or target.'
    });
    expect(logError).toHaveBeenCalledWith('team preview project=p team=t', expect.any(Error));
    expect(logError.mock.calls[0]![0]).not.toContain('secret');
    expect(logError.mock.calls[0]![0]).not.toContain('token');
  });
  it('passes admission-error text through the preview response without logging it as a failure', async () => {
    const logError = vi.fn();
    const ops = createTeamProductOps({ resolvePreview: async () => { throw new SquadPreviewAdmissionError('no portable plan steps found'); }, startTeamJobFromUi: vi.fn(),
      getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn(), logError });
    await expect(ops.preview!({ teamId: 't', projectId: 'p', goal: 'prose', mode: 'structured' })).resolves.toEqual({
      ok: false, code: 'INVALID', message: 'no portable plan steps found'
    });
    expect(logError).not.toHaveBeenCalled();
  });
  it('keeps the generic message for a plain Error that mimics an admission message', async () => {
    const ops = createTeamProductOps({ resolvePreview: async () => { throw Object.assign(new Error('ENOENT /private/internal'), { name: 'SquadPreviewAdmissionError' }); }, startTeamJobFromUi: vi.fn(),
      getExecution: vi.fn(), status: vi.fn(), stopJob: vi.fn(), respondToBlocker: vi.fn() });
    await expect(ops.preview!({ teamId: 't', projectId: 'p', goal: 'g', mode: 'structured' })).resolves.toMatchObject({
      message: 'Launch preview could not validate the plan or target.'
    });
  });
  it('parser planError text is path-free for every branch reachable without path-bearing input', () => {
    const absolutePath = /(^|[\s"'(=:])(\/[\w.-]+\/|[A-Za-z]:[\\/]|~\/)/;
    const step = (body: string) => `## Step a: Title\n${body}`;
    const goals = [
      'plain prose with no steps', '', '   ', '```squad-plan\n## Step a: T\n',
      '## Step a: T\n- **Files:** x\n',
      '## Step bad id!: T\n- **Work:** w\n',
      '## Step a\n- **Work:** w\n',
      '## Step a: \n- **Work:** w\n',
      step('- **Bogus label:** x\n- **Work:** w\n'),
      step('- **Work:** w\n- **On failure:** nonsense\n'),
      step('- **Work:** w\n- **On failure:** retry zzz up to 2 with feedback\n'),
      step('- **Work:** w\n- **Not same worker as:** nope\n'),
      step('- **Work:** w\n- **Requires:** garbage\n'),
      step('- **Work:** w\n- **Loop:** x\n'),
      `${step('- **Work:** w\n')}\n## Launch\nUnknown: 1\n`,
      `${step('- **Work:** w\n')}\n## Launch\nChecks: free text\n`
    ];
    let withError = 0;
    for (const goal of goals) {
      const plan = resolveSquadPlan('provided', [goal]);
      if (!plan.planError) continue;
      withError += 1;
      expect(plan.planError).not.toMatch(absolutePath);
      expect(plan.planError.length).toBeGreaterThan(0);
    }
    expect(withError).toBeGreaterThan(8);
    expect(resolveSquadPlan('provided', ['no steps here']).planError).toBe('no executable steps found');
    expect(resolveSquadPlan('provided', ['   ']).planError).toBe(NO_PLAN_STEPS_REASON);
    expect(new SquadPreviewAdmissionError('a\u0000b\n'.padEnd(500, 'x')).message).toHaveLength(400);
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

describe('team status failure reason', () => {
  it('returns failure for FAILED runs with a reason and omits it otherwise', async () => {
    let record = job({ state: 'FAILED', failureReason: 'no portable plan steps found' });
    const ops = createTeamProductOps({ startTeamJobFromUi: vi.fn(), getExecution: async () => record,
      status: async () => record, stopJob: vi.fn(), respondToBlocker: vi.fn() });
    expect(await ops.status('ex-1')).toMatchObject({ ok: true, value: { state: 'FAILED', failure: 'no portable plan steps found' } });
    for (const next of [job({ state: 'FAILED' }), job({ state: 'RUNNING', failureReason: 'stale' })]) {
      record = next;
      const result = await ops.status('ex-1');
      expect(result.ok && result.value).not.toHaveProperty('failure');
    }
  });
});
