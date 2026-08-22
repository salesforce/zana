import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExecutionStore } from '../execution/store.js';

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-execution-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

function request() {
  return {
    callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
    requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
    request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
  };
}

describe('execution store', () => {
  it('claims once, replays equal input, and rejects changed input', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    expect((await store.claim(request())).outcome).toBe('claimed');
    expect((await store.claim(request())).outcome).toBe('replay');
    expect((await store.claim({ ...request(), requestDigest: 'changed' })).outcome).toBe('conflict');
  }));

  it('persists ordered events and rejects stale or invalid transitions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    await expect(store.transition(running.id, 1, 'COMPLETED', 'info', 'Done')).rejects.toThrow('stale execution state');
    await expect(store.transition(running.id, 2, 'READY', 'info', 'Back')).rejects.toThrow('invalid execution transition');
    const events = await store.events('session-1', 'project-1', claimed.record.id);
    expect(events.events.map((event) => [event.sequence, event.state, event.stateVersion, event.kind])).toEqual([[1, 'READY', 0, undefined], [2, 'STARTING', 1, 'transition'], [3, 'RUNNING', 2, 'transition']]);
  }));

  it('confines list and events to caller principal and project', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    expect(await store.list('other-session', 'project-1')).toEqual([]);
    expect(await store.list('session-1', 'other-project')).toEqual([]);
    expect(await store.events('other-session', 'project-1', claimed.record.id)).toEqual({ events: [] });
  }));

  it('keeps active records and paginates bounded event reads', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxRecords: 1 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    const page = await store.events('session-1', 'project-1', running.id, 0, 2);
    expect(page.events).toHaveLength(2);
    expect(page.nextSequence).toBe(2);
    expect(await store.get(running.id)).toMatchObject({ state: 'RUNNING' });
  }));

  it('does not evict event history younger than minimum retention under count pressure', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 2 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    expect(await store.events('session-1', 'project-1', running.id, 0)).toMatchObject({
      events: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }]
    });
  }));

  it('keeps recent history even when configured event capacity is one', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 1 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    expect(await store.events('session-1', 'project-1', claimed.record.id, 1)).toMatchObject({
      events: [{ sequence: 2 }, { sequence: 3 }]
    });
  }));

  it('keeps producer and lifecycle event sequences monotonic under retention protection', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', maxEvents: 2 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.producerEvent(starting.id, { id: 'producer-1', type: 'progress', severity: 'info', summary: 'Progress' });
    const running = await store.transition(starting.id, 1, 'RUNNING', 'info', 'Running');
    await store.producerEvent(running.id, { id: 'producer-2', type: 'outcome', severity: 'info', summary: 'Done' });
    expect((await store.events('session-1', 'project-1', running.id)).events.map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5]);
  }));

  it('persists replayable producer role, attention, progress, and references', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    await store.producerEvent(claimed.record.id, {
      id: 'event-1', slotId: 'slot-1', producerRole: 'worker', type: 'progress', severity: 'info', summary: 'Half done',
      attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }]
    });
    expect(await store.events('session-1', 'project-1', claimed.record.id)).toMatchObject({ events: [
      {}, { id: 'event-1', producerRole: 'worker', attention: false, progress: { completed: 1, total: 2 }, references: [{ label: 'result', uri: 'artifact://result.json' }] }
    ] });
  }));

  it('does not allow another execution to evict protected recent events', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let index = 0; return () => `execution-${++index}`; })(), maxEvents: 1 });
    const first = await store.claim(request());
    const second = await store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' });
    if (first.outcome !== 'claimed' || second.outcome !== 'claimed') throw new Error('expected claims');
    expect(await store.events('session-1', 'project-1', first.record.id, 1)).toMatchObject({ events: [] });
  }));

  it('requires resync for a future event cursor', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    expect(await store.events('session-1', 'project-1', claimed.record.id, 9)).toEqual({ events: [], resyncRequired: true });
  }));

  it('retains active records and preserves newest terminal history', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: (() => { let i = 0; return () => `execution-${++i}`; })(), maxRecords: 3 });
    const active = await store.claim(request());
    const blocked = await store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' });
    const newerBlocked = await store.claim({ ...request(), launchRequestId: 'request-3', requestDigest: 'digest-3' });
    if (active.outcome !== 'claimed' || blocked.outcome !== 'claimed' || newerBlocked.outcome !== 'claimed') throw new Error('expected claims');
    const starting = await store.transition(blocked.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(starting.id, 1, 'BLOCKED', 'warning', 'Blocked');
    const newerStarting = await store.transition(newerBlocked.record.id, 0, 'STARTING', 'info', 'Starting');
    await store.transition(newerStarting.id, 1, 'BLOCKED', 'warning', 'Blocked');
    expect(await store.get(active.record.id)).toMatchObject({ state: 'READY' });
    expect(await store.get(blocked.record.id)).toMatchObject({ state: 'BLOCKED' });
    expect(await store.get(newerBlocked.record.id)).toMatchObject({ state: 'BLOCKED' });
  }));

  it('rejects new claims when active execution capacity is exhausted', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, maxRecords: 1 });
    await store.claim(request());
    await expect(store.claim({ ...request(), launchRequestId: 'request-2', requestDigest: 'digest-2' })).rejects.toThrow('active record limit');
  }));

  it('persists resolved model snapshots with the execution attempt', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claim = await store.claim({ ...request(), resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model', reasoning: 'high' }] });
    expect(claim).toMatchObject({ record: { resolvedModels: [{ slotId: 'slot-1', provider: 'provider', model: 'model', reasoning: 'high' }] } });
  }));

  it('records one immutable host-issued authorization context', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const context = { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [{ slotId: 'slot-1', personaId: 'persona-1', authorizationIdDigest: 'sha256:auth' }] };
    const recorded = await store.setAuthorizationContext(starting.id, starting.stateVersion, context, 'sha256:context');
    expect(recorded).toMatchObject({ authorizationContext: context, authorizationContextDigest: 'sha256:context' });
    await expect(store.setAuthorizationContext(recorded.id, recorded.stateVersion, context, 'sha256:other')).rejects.toThrow('invalid execution authorization context');
  }));

  it('persists one prepared launch intent before dispatch', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1', now: () => 10 });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const prepared = await store.prepareLaunchIntent(starting.id, starting.stateVersion, { version: 1, authorizationContextDigest: 'sha256:context', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: 'sha256:task' }] });
    expect(prepared.launchIntent).toMatchObject({ preparedAt: 10 });
    await expect(store.prepareLaunchIntent(prepared.id, prepared.stateVersion, { version: 1, authorizationContextDigest: 'sha256:context', slots: [{ slotId: 'slot-1', personaId: 'persona-1', initialTaskDigest: 'sha256:task' }] })).rejects.toThrow('invalid execution launch intent');
  }));

  it('retries only a pre-dispatch blocked execution with a fresh Team launch request', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const claimed = await store.claim(request());
    if (claimed.outcome !== 'claimed') throw new Error('expected claim');
    const starting = await store.transition(claimed.record.id, 0, 'STARTING', 'info', 'Starting');
    const blocked = await store.transition(starting.id, starting.stateVersion, 'BLOCKED', 'warning', 'Authorization denied');
    const retry = await store.beginRetry(blocked.id, blocked.stateVersion);
    expect(retry).toMatchObject({ id: 'execution-1', attempt: 2, state: 'STARTING', teamLaunchRequestId: 'execution-1:attempt:2', request: request().request });
    await expect(store.beginRetry(retry.id, retry.stateVersion)).rejects.toThrow('retry is not allowed');
  }));
});
