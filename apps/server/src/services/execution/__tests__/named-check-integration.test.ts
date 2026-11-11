import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionService } from '../service.js';
import { createExecutionStore } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { resolveAllLaunch } from '@zana-ai/zcc-domain/launch-options';

const work = { id: 'a', title: 'A', task: 'Work', dependencies: [], readOnly: true, checks: ['verify'], onFailure: { kind: 'retry' as const, stepId: 'a', maxRetries: 1 } };
const request = { version: 1 as const, teamId: 't', launchRequestId: 'l', slots: [{ initialTask: 'Work' }], workUnits: [work] };
async function fixture(run: (ctx: ReturnType<typeof context>) => Promise<void>, over: Record<string, unknown> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'execution-checks-'));
  const ctx = context(dir, over);
  try { await run(ctx); } finally { ctx.service.dispose(); await rm(dir, { recursive: true, force: true }); }
}
function context(dir: string, over: Record<string, unknown>) {
  const store = createExecutionStore({ filePath: join(dir, 'store.json'), id: () => 'e' });
  const launchTeam = vi.fn(async () => ({ ok: true }));
  const resolveNamedChecks = vi.fn(async (_project: string, refs: readonly string[]) => refs.map(reference => ({ reference, name: reference.slice(6), command: 'owner-command' })));
  const runNamedCheck = vi.fn(async (_record: unknown, reference: string) => ({ name: reference.slice(6), status: 'passed', exitCode: 0, output: 'ok', untrusted: true }));
  const service = new ExecutionService({ store, artifacts: createExecutionArtifactStore({ filePath: join(dir, 'artifacts.json') }), launchTeam,
    authorizeTeamLaunch: () => ({ ok: true, value: { teamId: 't', projectId: 'p', slots: [], context: { version: 1, principalId: 'owner', authorizedAt: 1, expiresAt: 2, slots: [] } } }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 's', sessionId: 'worker', projectId: 'p' }] }), cancelTeamLaunch: async () => ({ ok: true }), replyToSession: () => true,
    resolveNamedChecks, runNamedCheck, ...over } as never);
  const binding = { executionId: 'e', projectId: 'p', role: 'worker' as const, slotId: 's' };
  return { service, store, binding, launchTeam, resolveNamedChecks, runNamedCheck, filePath: join(dir, 'store.json') };
}
async function claim(ctx: ReturnType<typeof context>) {
  expect((await ctx.service.start('owner', 'p', request)).ok).toBe(true);
  await ctx.service.claimWork(ctx.binding, 'a');
  const unit = (await ctx.store.get('e'))!.workUnits![0];
  return { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
}

describe('named-check execution integration', () => {
  it('legacy coordinator authority loss while checks run rejects completion', async () => {
    let lead = 'lead';
    let settle!: () => void;
    await fixture(async ctx => {
      await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
      const pending = ctx.service.completeByCoordinator('lead', 'p', 'e', 'done');
      await vi.waitFor(() => expect(settle).toBeDefined());
      lead = 'replacement';
      settle();
      expect(await pending).toMatchObject({ ok: false });
      expect((await ctx.store.get('e'))!.state).toBe('RUNNING');
    }, { getTeamLaunch: async () => ({ orchestratorSessionId: lead, workers: [] }), runNamedCheck: async () => {
      await new Promise<void>(resolve => { settle = resolve; });
      return { name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true };
    } });
  });
  it('queued no-DAG stop cancels without waiting for unrelated runner', async () => {
    let settle!: () => void;
    await fixture(async ctx => {
      await ctx.service.start('owner', 'p', request);
      await ctx.service.claimWork(ctx.binding, 'a');
      const unit = (await ctx.store.get('e'))!.workUnits![0];
      const workerCompletion = ctx.service.completeWork(ctx.binding, 'a', 'done', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true);
      await vi.waitFor(() => expect(settle).toBeDefined());
      // Separate run using the same service lane; store ids are host-controlled.
      const record = (await ctx.store.get('e'))!;
      const raw = JSON.parse(await readFile(ctx.filePath, 'utf8'));
      raw.records.push({ ...raw.records[0], id: 'other', workUnits: undefined, resolvedLaunch: resolveAllLaunch({ launch: { checks: ['verify'] } }) });
      await writeFile(ctx.filePath, JSON.stringify(raw));
      const other = { ...ctx.binding, executionId: 'other', role: 'orchestrator' as const, slotId: 'lead' };
      const queued = ctx.service.completeByCoordinatorBinding(other, 'other', 'done');
      await new Promise(resolve => setTimeout(resolve, 20));
      const stop = ctx.service.stop('owner', 'p', 'other', record.stateVersion);
      try {
        await vi.waitFor(async () => expect((await ctx.store.get('other'))!.state).toBe('STOPPED'), { timeout: 500 });
        expect(await queued).toMatchObject({ ok: false });
      } finally { settle(); await workerCompletion; await stop; }
    }, { runNamedCheck: async () => {
      await new Promise<void>(resolve => { settle = resolve; });
      return { name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true };
    } });
  });

  it('changed no-DAG execution version rejects late successful receipt', async () => {
    let settle!: () => void;
    await fixture(async ctx => {
      await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
      const pending = ctx.service.completeByCoordinatorBinding({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, 'e', 'done');
      await vi.waitFor(() => expect(settle).toBeDefined());
      const record = (await ctx.store.get('e'))!;
      await ctx.store.transition('e', record.stateVersion, 'BLOCKED', 'warning', 'changed');
      settle();
      expect(await pending).toMatchObject({ ok: false });
      expect((await ctx.store.get('e'))!.state).toBe('BLOCKED');
    }, { runNamedCheck: async () => {
      await new Promise<void>(resolve => { settle = resolve; });
      return { name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true };
    } });
  });
  it.each(['bound', 'legacy'])('no-DAG %s completion accepts only successful frozen check receipt', async path => fixture(async ctx => {
    await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
    const outcome = path === 'bound'
      ? await ctx.service.completeByCoordinatorBinding({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, 'e', 'done')
      : await ctx.service.completeByCoordinator('lead', 'p', 'e', 'done');
    expect(outcome).toMatchObject({ ok: true, value: { state: 'COMPLETED' } });
    expect(ctx.runNamedCheck).toHaveBeenCalledWith(expect.objectContaining({ resolvedChecks: [{ reference: 'check:verify', name: 'verify', command: 'owner-command' }] }), 'check:verify', expect.any(AbortSignal));
  }, { getTeamLaunch: async () => ({ orchestratorSessionId: 'lead', workers: [] }) }));

  it('denies unauthorized no-DAG completion without running checks', async () => fixture(async ctx => {
    await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
    expect(await ctx.service.completeByCoordinator('intruder', 'p', 'e', 'done')).toMatchObject({ ok: false, code: 'DENIED' });
    expect(await ctx.service.completeByCoordinatorBinding(ctx.binding, 'e', 'done')).toMatchObject({ ok: false });
    expect(ctx.runNamedCheck).not.toHaveBeenCalled();
  }));

  it.each(['missing', 'rejected', 'malformed'])('no-DAG check %s fails closed', async mode => fixture(async ctx => {
    await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
    if (mode === 'missing') {
      const raw = JSON.parse(await readFile(ctx.filePath, 'utf8'));
      raw.records[0].resolvedChecks = [];
      await writeFile(ctx.filePath, JSON.stringify(raw));
    } else if (mode === 'rejected') ctx.runNamedCheck.mockRejectedValueOnce(new Error('runner failed'));
    else ctx.runNamedCheck.mockResolvedValueOnce({ name: 'wrong', status: 'passed', exitCode: 0, output: '', untrusted: true } as never);
    expect(await ctx.service.completeByCoordinatorBinding({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, 'e', 'done')).toMatchObject({ ok: false });
    expect((await ctx.store.get('e'))!.state).not.toBe('COMPLETED');
  }));

  it('no-DAG stop aborts and drains pending check; late pass cannot complete', async () => {
    let signal!: AbortSignal;
    let settle!: () => void;
    await fixture(async ctx => {
      await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
      const pending = ctx.service.completeByCoordinatorBinding({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, 'e', 'done');
      await vi.waitFor(() => expect(signal).toBeDefined());
      const record = (await ctx.store.get('e'))!;
      const stop = ctx.service.stop('owner', 'p', 'e', record.stateVersion);
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      settle();
      expect(await pending).toMatchObject({ ok: false });
      expect(await stop).toMatchObject({ ok: true, value: { state: 'STOPPED' } });
    }, { runNamedCheck: async (_record: unknown, _reference: string, value: AbortSignal) => {
      signal = value;
      await new Promise<void>(resolve => { settle = resolve; });
      return { name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true };
    } });
  });

  it.each(['bound', 'legacy'])('no-DAG %s coordinator completion runs frozen global checks', async path => fixture(async ctx => {
    expect(await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] })).toMatchObject({ ok: true });
    const outcome = path === 'bound'
      ? await ctx.service.completeByCoordinatorBinding({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, 'e', 'done')
      : await ctx.service.completeByCoordinator('lead', 'p', 'e', 'done');
    expect(outcome).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
    expect((await ctx.store.get('e'))!.state).not.toBe('COMPLETED');
  }, { getTeamLaunch: async () => ({ orchestratorSessionId: 'lead', workers: [] }), runNamedCheck: async () => ({ name: 'verify', status: 'failed', exitCode: 1, output: 'bad', untrusted: true }) }));

  it.each(['complete', 'transition'])('store %s cannot bypass global checks without trusted receipt', async path => fixture(async ctx => {
    await ctx.service.start('owner', 'p', { ...request, workUnits: undefined, checks: ['verify'] });
    const record = (await ctx.store.get('e'))!;
    await expect(path === 'complete'
      ? ctx.store.completeExecution('e', record.stateVersion, 'done')
      : ctx.store.transition('e', record.stateVersion, 'COMPLETED', 'info', 'done')).rejects.toThrow('required named checks have not passed');
  }));

  it('successful retry clears prior failed-check structured output, retains feedback and counters', async () => fixture(async ctx => {
    const first = await claim(ctx);
    ctx.runNamedCheck.mockResolvedValueOnce({ name: 'verify', status: 'failed', exitCode: 1, output: 'failed-receipt', untrusted: true } as never);
    await ctx.service.completeWork(ctx.binding, 'a', 'done', first, true);
    const failed = (await ctx.store.get('e'))!.workUnits![0];
    await ctx.service.claimWork(ctx.binding, 'a');
    const current = (await ctx.store.get('e'))!.workUnits![0];
    await ctx.service.completeWork(ctx.binding, 'a', 'fixed', { claimId: current.claimId!, claimGeneration: current.claimGeneration! }, true);
    const completed = (await ctx.store.get('e'))!.workUnits![0];
    expect(completed.structuredResult).toBeUndefined();
    expect(completed.retryFeedback).toEqual(failed.retryFeedback);
    expect(completed.failureRetry).toEqual(failed.failureRetry);
  }));

  it('queues simultaneous check completions instead of failing runner saturation', async () => {
    let active = 0;
    const releases: Array<() => void> = [];
    await fixture(async ctx => {
      await ctx.service.start('owner', 'p', { ...request, workUnits: [work, { ...work, id: 'b' }] });
      await ctx.service.claimWork(ctx.binding, 'a');
      const peer = { ...ctx.binding, slotId: 'peer' };
      await ctx.service.claimWork(peer, 'b');
      const record = (await ctx.store.get('e'))!;
      const pending = record.workUnits!.map(unit => ctx.service.completeWork(unit.id === 'a' ? ctx.binding : peer, unit.id, 'done', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true));
      await vi.waitFor(() => expect(releases.length).toBe(1));
      expect((await ctx.store.get('e'))!.workUnits!.every(unit => unit.state === 'CLAIMED')).toBe(true);
      releases[0]();
      await vi.waitFor(() => expect(releases.length).toBe(2));
      releases[1]();
      expect((await Promise.all(pending)).every(outcome => outcome.ok)).toBe(true);
      expect((await ctx.store.get('e'))!.workUnits!.every(unit => !unit.failureRetry)).toBe(true);
    }, { runNamedCheck: async () => {
      if (active) throw new Error('Named-check concurrency limit reached');
      active++;
      await new Promise<void>(resolve => releases.push(resolve));
      active--;
      return { name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true };
    } });
  });
  it('admits only effective launch checks plus unit checks, not shadowed plan checks', async () => fixture(async ctx => {
    expect(await ctx.service.start('owner', 'p', { ...request, checks: [], planLaunch: { checks: ['unknown'] } })).toMatchObject({ ok: true });
    expect(ctx.resolveNamedChecks).toHaveBeenCalledWith('p', ['check:verify']);
  }, { resolveLaunchOptions: (_project: string, input: { checks?: string[]; planLaunch?: { checks?: string[] } }) => resolveAllLaunch({ launch: { checks: input.checks }, plan: input.planLaunch }) }));

  it('retains full bounded failed-check receipt beyond 8192 bytes through reload', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
    const unit = (await ctx.store.get('e'))!.workUnits![0];
    expect(unit.structuredResult).toMatchObject({ result: { output: 'x'.repeat(12000) + 'TRAILING_SENTINEL' } });
    expect(JSON.parse(unit.retryFeedback!.body).result.output).toBe('x'.repeat(12000) + 'TRAILING_SENTINEL');
    expect((await createExecutionStore({ filePath: ctx.filePath }).get('e'))!.workUnits![0].structuredResult).toEqual(unit.structuredResult);
  }, { runNamedCheck: async () => ({ name: 'verify', status: 'failed', exitCode: 1, output: 'x'.repeat(12000) + 'TRAILING_SENTINEL', untrusted: true }) }));

  it('engine check receipts use runner bounds, not worker 64 KiB output cap', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
    const reloaded = (await createExecutionStore({ filePath: ctx.filePath }).get('e'))!.workUnits![0];
    expect(JSON.parse(reloaded.retryFeedback!.body).result.output).toBe('x'.repeat(100000) + 'TRAILING_SENTINEL');
  }, { runNamedCheck: async () => ({ name: 'verify', status: 'failed', exitCode: 1, output: 'x'.repeat(100000) + 'TRAILING_SENTINEL', untrusted: true }) }));

  it.each(['release', 'reclaim', 'reassign'])('%s aborts and drains old check before next claim dispatch', async operation => {
    let signal!: AbortSignal;
    let settle!: (value: unknown) => void;
    let drained = false;
    await fixture(async ctx => {
      const fence = await claim(ctx);
      const pending = ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true);
      await vi.waitFor(() => expect(signal).toBeDefined());
      let reopened: Promise<unknown>;
      if (operation === 'release') reopened = ctx.service.releaseWork(ctx.binding, 'a', fence, true);
      else {
        await ctx.store.reclaimExpiredClaims('e', [{ workUnitId: 'a', ...fence, reason: 'dead', force: true }]);
        if (operation === 'reassign') {
          const current = (await ctx.store.get('e'))!;
          reopened = ctx.service.reassignWorkFromBoard('owner', 'p', 'e', current.stateVersion, 'a', 's');
        } else reopened = ctx.service.claimWork(ctx.binding, 'a');
      }
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      expect(drained).toBe(false);
      expect((await ctx.store.get('e'))!.workUnits![0].state).toBe('READY');
      settle({ name: 'verify', status: 'cancelled', exitCode: null, output: '', untrusted: true });
      drained = true;
      await reopened;
      expect(await pending).toMatchObject({ ok: false });
    }, { runNamedCheck: (_record: unknown, _reference: string, value: AbortSignal) => { signal = value; return new Promise(resolve => { settle = resolve; }); } });
  });

  it('dispatch preserves current live check, then drains reclaimed runner rejection', async () => {
    let signal!: AbortSignal;
    let reject!: (error: Error) => void;
    await fixture(async ctx => {
      const fence = await claim(ctx);
      const pending = ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true);
      await vi.waitFor(() => expect(signal).toBeDefined());
      const coordinator = { ...ctx.binding, role: 'orchestrator' as const, slotId: 'lead' };
      expect(await ctx.service.dispatchReady(coordinator)).toMatchObject({ ok: true });
      expect(signal.aborted).toBe(false);
      await ctx.store.reclaimExpiredClaims('e', [{ workUnitId: 'a', ...fence, reason: 'dead', force: true }]);
      const dispatch = ctx.service.dispatchReady(coordinator);
      await vi.waitFor(() => expect(signal.aborted).toBe(true));
      expect((await ctx.store.get('e'))!.workUnits![0].state).toBe('READY');
      reject(new Error('aborted'));
      expect(await pending).toMatchObject({ ok: false });
      expect(await dispatch).toMatchObject({ ok: true });
    }, { runNamedCheck: (_record: unknown, _reference: string, value: AbortSignal) => { signal = value; return new Promise((_resolve, fail) => { reject = fail; }); } });
  });

  it('runs unit and global checks once each and keeps frozen resolution on replay', async () => fixture(async ctx => {
    const input = { ...request, checks: ['global', 'verify'] };
    expect((await ctx.service.start('owner', 'p', input)).ok).toBe(true);
    expect((await ctx.service.start('owner', 'p', input)).ok).toBe(true);
    expect(ctx.resolveNamedChecks).toHaveBeenCalledTimes(1);
    await ctx.service.claimWork(ctx.binding, 'a');
    const unit = (await ctx.store.get('e'))!.workUnits![0];
    await ctx.service.completeWork(ctx.binding, 'a', 'done', { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! }, true);
    expect(ctx.runNamedCheck.mock.calls.map(call => call[1])).toEqual(['check:global', 'check:verify']);
  }));
  it('rejects malformed passed runner result rather than trusting status alone', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
  }, { runNamedCheck: async () => ({ status: 'passed', exitCode: 0, output: '', untrusted: true }) }));
  it('checks preserve worker output schema validation and engine failures bypass it safely', async () => fixture(async ctx => {
    const input = { ...request, workUnits: [{ ...work, output: { version: 1 as const, schema: { type: 'string' as const } } }] };
    expect((await ctx.service.start('owner', 'p', input)).ok).toBe(true);
    await ctx.service.claimWork(ctx.binding, 'a');
    const unit = (await ctx.store.get('e'))!.workUnits![0];
    const fence = { claimId: unit.claimId!, claimGeneration: unit.claimGeneration! };
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true, 123)).toMatchObject({ ok: false, code: 'TYPED_OUTPUT_REPAIR' });
    expect(ctx.runNamedCheck).not.toHaveBeenCalled();
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true, 'worker-output')).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
  }, { runNamedCheck: async () => ({ name: 'verify', status: 'failed', exitCode: 1, output: 'failure', untrusted: true }) }));
  it('reclaim while check pending never authorizes late completion', async () => {
    let release!: (value: unknown) => void;
    await fixture(async ctx => {
      const fence = await claim(ctx);
      const pending = ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      await ctx.store.reclaimExpiredClaims('e', [{ workUnitId: 'a', ...fence, reason: 'dead', force: true }]);
      release({ name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true });
      expect(await pending).toMatchObject({ ok: false });
      expect((await ctx.store.get('e'))!.workUnits![0].state).toBe('READY');
    }, { runNamedCheck: () => new Promise(resolve => { release = resolve; }) });
  });
  it('rejects unknown checks before claim or spawn', async () => fixture(async ctx => {
    expect(await ctx.service.start('owner', 'p', request)).toMatchObject({ ok: false, code: 'ADMISSION_FAILED' });
    expect(ctx.launchTeam).not.toHaveBeenCalled();
    expect(await ctx.store.get('e')).toBeUndefined();
  }, { resolveNamedChecks: async () => { throw new Error('Unknown check: verify'); } }));
  it('fails closed with missing resolver or runner', async () => {
    for (const missing of ['resolveNamedChecks', 'runNamedCheck']) await fixture(async ctx => {
      expect(await ctx.service.start('owner', 'p', request)).toMatchObject({ ok: false, code: 'ADMISSION_FAILED' });
      expect(ctx.launchTeam).not.toHaveBeenCalled();
    }, { [missing]: undefined });
  });
  it('runs checks before completion using frozen command and deduplicates concurrent completion', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    const replies = await Promise.all([ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true), ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)]);
    expect(replies.every(reply => reply.ok)).toBe(true);
    expect(ctx.runNamedCheck).toHaveBeenCalledTimes(1);
    expect(ctx.runNamedCheck).toHaveBeenCalledWith(expect.objectContaining({ resolvedChecks: [{ reference: 'check:verify', name: 'verify', command: 'owner-command' }] }), 'check:verify', expect.any(AbortSignal));
    expect((await ctx.store.get('e'))!.workUnits![0].state).toBe('COMPLETED');
  }));
  it('nonzero check output enters atomic retry without worker output declaration', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    const result = await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true);
    expect(result).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
    expect((await ctx.store.get('e'))!).toMatchObject({ state: 'RUNNING', workUnits: [{ state: 'READY', retryFeedback: { kind: 'structured' } }] });
  }, { runNamedCheck: async () => ({ name: 'verify', status: 'failed', exitCode: 1, output: 'fix it', untrusted: true }) }));
  it('stale claim cannot launch check', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', { ...fence, claimGeneration: 999 }, true)).toMatchObject({ ok: false });
    expect(ctx.runNamedCheck).not.toHaveBeenCalled();
  }));
  it('rejects role alias collision before spawn', async () => fixture(async ctx => {
    const input = { ...request, workUnits: [{ ...work, checks: [], routing: { version: 1 as const, requiredRole: 'alias' } }], resolvedModels: [{ slotId: 's1', personaId: 'persona', label: 'alias', provider: 'p' }, { slotId: 's2', personaId: 'alias', provider: 'p' }] };
    expect(await ctx.service.start('owner', 'p', input)).toMatchObject({ ok: false });
    expect(ctx.launchTeam).not.toHaveBeenCalled();
  }, { resolveTeamModelSnapshots: () => [{ slotId: 's1', personaId: 'persona', label: 'alias', provider: 'p' }, { slotId: 's2', personaId: 'alias', provider: 'p' }] }));
  it('names-only discovery rejects objects and missing hook', async () => fixture(async ctx => {
    await expect(ctx.service.listNamedChecks('p')).rejects.toThrow('discovery');
  }));
  it('names-only discovery returns sorted deduplicated strings', async () => fixture(async ctx => {
    await expect(ctx.service.listNamedChecks('p')).resolves.toEqual(['alpha', 'verify']);
  }, { listNamedCheckNames: () => ['verify', 'alpha', 'verify'] }));
  it.each([
    { listNamedCheckNames: () => [{ name: 'verify', command: 'secret' }] },
    { listNamedCheckNames: () => ['invalid name'] },
    { listNamedCheckNames: () => [], isRegisteredProject: () => false }
  ])('rejects unsafe discovery %j', async over => fixture(async ctx => {
    await expect(ctx.service.listNamedChecks('p')).rejects.toThrow();
  }, over));
  it.each(['timeout', 'output-limit', 'cancelled', 'spawn-error'])('routes %s through engine failure', async status => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
  }, { runNamedCheck: async () => ({ name: 'verify', status, exitCode: null, output: 'untrusted', untrusted: true }) }));
  it('runner rejection fails closed', async () => fixture(async ctx => {
    const fence = await claim(ctx);
    expect(await ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true)).toMatchObject({ ok: false, code: 'CHECK_FAILED' });
  }, { runNamedCheck: async () => { throw new Error('secret-command'); } }));
  it('rejects incomplete trusted resolution', async () => fixture(async ctx => {
    expect(await ctx.service.start('owner', 'p', request)).toMatchObject({ ok: false, code: 'ADMISSION_FAILED' });
  }, { resolveNamedChecks: () => [] }));
  it('resolves inferred-plan checks before plan dispatch and freezes registered snapshot', async () => fixture(async ctx => {
    expect((await ctx.service.start('owner', 'p', { ...request, workUnits: undefined })).ok).toBe(true);
    expect(await ctx.service.registerPlan({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, [work])).toMatchObject({ ok: true });
    expect((await ctx.store.get('e'))!.resolvedChecks).toEqual([{ reference: 'check:verify', name: 'verify', command: 'owner-command' }]);
  }));
  it('registration rejects unknown inferred-plan checks without storing work', async () => fixture(async ctx => {
    expect((await ctx.service.start('owner', 'p', { ...request, workUnits: undefined })).ok).toBe(true);
    expect(await ctx.service.registerPlan({ ...ctx.binding, role: 'orchestrator', slotId: 'lead' }, [work])).toMatchObject({ ok: false });
    expect((await ctx.store.get('e'))!.workUnits).toBeUndefined();
  }, { resolveNamedChecks: () => [] }));
  it('stop during pending check prevents completion', async () => {
    let release!: (value: unknown) => void;
    await fixture(async ctx => {
      const fence = await claim(ctx);
      const pending = ctx.service.completeWork(ctx.binding, 'a', 'done', fence, true);
      await vi.waitFor(() => expect(release).toBeTypeOf('function'));
      const record = (await ctx.store.get('e'))!;
      await ctx.service.stop('owner', 'p', 'e', record.stateVersion);
      release({ name: 'verify', status: 'passed', exitCode: 0, output: '', untrusted: true });
      expect(await pending).toMatchObject({ ok: false });
      expect((await ctx.store.get('e'))!.state).toBe('STOPPED');
    }, { runNamedCheck: () => new Promise(resolve => { release = resolve; }) });
  });
});
