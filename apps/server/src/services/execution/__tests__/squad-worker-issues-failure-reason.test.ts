import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { failsOnFailedSlot, SquadExecutionService } from '../service.js';
import { boundReason, createExecutionStore, joinFailedSlotReasons, MAX_FAILURE_REASON, type ExecutionRecord } from '../store.js';
import { createExecutionArtifactStore } from '../artifact-store.js';
import { executionBoardProjection } from '../projection.js';

// Acceptance tests for REQ-1, REQ-2 (server side), REQ-3, REQ-10, REQ-11, REQ-12 and the
// run-warning event used by REQ-20. Red until the failure-reason-field and eager-failed-slots units land.

async function fixture(run: (filePath: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'zcc-swi-failure-reason-'));
  try { await run(join(dir, 'executions.json')); } finally { await rm(dir, { recursive: true, force: true }); }
}

const storeRequest = {
  callerPrincipalId: 'session-1', projectId: 'project-1', teamId: 'team-1', jobTitle: 'Ship feature',
  requestDigest: 'digest-1', launchRequestId: 'request-1', resolvedModels: [],
  request: { version: 1 as const, slots: [{ initialTask: 'Run tests' }], resolvedModels: [] }
};

const request = {
  version: 1 as const, teamId: 'team-1', launchRequestId: 'request-1', summary: 'Build release',
  slots: [{ initialTask: 'Run tests' }]
};

async function running(store: ReturnType<typeof createExecutionStore>): Promise<ExecutionRecord> {
  let record = (await store.claim(storeRequest)).record;
  record = await store.transition(record.id, record.stateVersion, 'STARTING', 'info', 'start');
  return store.transition(record.id, record.stateVersion, 'RUNNING', 'info', 'run');
}

function deps(filePath: string, over: Record<string, unknown> = {}) {
  return {
    store: createExecutionStore({ filePath, id: () => 'execution-1' }),
    artifacts: createExecutionArtifactStore({ filePath: `${filePath}.artifacts`, id: () => 'artifact-1' }),
    authorizeTeamLaunch: () => ({ ok: true as const, value: {
      teamId: 'team-1', projectId: 'project-1', slots: [],
      context: { version: 1 as const, principalId: 'team:team-1:session-1:request-1', authorizedAt: 10, expiresAt: 20, slots: [] }
    } }),
    launchTeam: async () => ({ ok: true }),
    getTeamLaunch: async () => ({ workers: [{ slotId: 'slot-1', sessionId: 'worker-1', projectId: 'project-1', task: 'unknown', process: 'running' }] }),
    cancelTeamLaunch: async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }),
    replyToSession: () => true,
    resolveExactNativeRecoverySnapshots: (record: ExecutionRecord) => record.nativeRecoverySnapshots ?? [],
    ...over
  } as unknown as ConstructorParameters<typeof SquadExecutionService>[0];
}

/** launchTeam result carrying failed slots; typed loosely because the dependency type does not declare `value`. */
function launchedWith(failedSlots: Array<{ slotId: string; personaId: string; reason: string }>) {
  return { ok: true, value: { failedSlots } };
}

describe('boundReason (REQ-3)', () => {
  it('strips control characters', () => {
    expect(boundReason('bad\u0000\u0007thing\u001b[31m happened\r\nnext')).not.toMatch(/[\u0000-\u0008\u000b-\u001f\u007f]/);
  });

  it('reduces absolute paths to their basename', () => {
    const out = boundReason('spawn failed: /Users/alice/secret-project/bin/worker.sh not found; C:\\Users\\bob\\app\\run.exe too');
    expect(out).toContain('worker.sh');
    expect(out).not.toContain('/Users/alice');
    expect(out).not.toContain('secret-project');
    expect(out).not.toContain('C:\\Users\\bob');
  });

  it('caps the text at 2048 characters by default and at a smaller explicit max', () => {
    expect(MAX_FAILURE_REASON).toBe(2048);
    expect(boundReason('x'.repeat(5000)).length).toBeLessThanOrEqual(2048);
    expect(boundReason('y'.repeat(900), 500).length).toBeLessThanOrEqual(500);
  });

  it('keeps ordinary non-ASCII text and short text unchanged', () => {
    expect(boundReason('Таск не запустился: 起動失敗')).toBe('Таск не запустился: 起動失敗');
  });
});

describe('store.transition to FAILED persists failureReason (REQ-1, REQ-3)', () => {
  it('sets a sanitized, bounded failureReason from the transition summary and reloads it', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store);
    const failed = await store.transition(record.id, record.stateVersion, 'FAILED', 'error', `worker crashed at /home/bob/work/proj/run.js\u0000 ${'z'.repeat(1900)}`);
    expect(failed.failureReason).toBeDefined();
    expect(failed.failureReason!.length).toBeLessThanOrEqual(2048);
    expect(failed.failureReason).toContain('run.js');
    expect(failed.failureReason).not.toContain('/home/bob');
    expect(failed.failureReason).not.toContain('\u0000');
    expect((await createExecutionStore({ filePath }).get(record.id))?.failureReason).toBe(failed.failureReason);
  }));

  it('does not set failureReason for non-failed transitions', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store);
    const blocked = await store.transition(record.id, record.stateVersion, 'BLOCKED', 'warning', 'waiting');
    expect(blocked.failureReason).toBeUndefined();
  }));

  it('loads an older stored record without failureReason (existing-user path)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store);
    const failed = await store.transition(record.id, record.stateVersion, 'FAILED', 'error', 'old failure');
    const raw = JSON.parse(await readFile(filePath, 'utf8'));
    const text = JSON.stringify(raw, (key, value) => (key === 'failureReason' ? undefined : value));
    await writeFile(filePath, text);
    const loaded = await createExecutionStore({ filePath }).get(failed.id);
    expect(loaded).toMatchObject({ id: failed.id, state: 'FAILED' });
    expect(loaded?.failureReason).toBeUndefined();
  }));

  it('exposes failureReason on the board projection (REQ-2)', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store);
    const failed = await store.transition(record.id, record.stateVersion, 'FAILED', 'error', 'launch failed: no model');
    expect(executionBoardProjection(failed)).toMatchObject({ failureReason: 'launch failed: no model' });
  }));
});

describe('store.warning (REQ-11, REQ-20)', () => {
  it('appends a structured warning event with the kind and slot, without changing state', async () => fixture(async (filePath) => {
    const store = createExecutionStore({ filePath, id: () => 'execution-1' });
    const record = await running(store);
    const after = await store.warning(record.id, { kind: 'worker-warning', slotId: 'slot-2', summary: 'Worker slot-2 exited (1): bad model' });
    expect(after.state).toBe('RUNNING');
    const { events } = await store.events('session-1', 'project-1', record.id);
    expect(events.some((event) => event.severity === 'warning' && event.summary.includes('slot-2'))).toBe(true);
  }));
});

describe('joinFailedSlotReasons (REQ-2, REQ-3)', () => {
  const long = (slotId: string) => ({ slotId, reason: `${slotId} `.repeat(300) });
  it('always fits the budget, keeping every slot id visible and counting what it dropped', () => {
    const joined = joinFailedSlotReasons([long('slot-1'), long('slot-2'), long('slot-3'), long('slot-4'), long('slot-5')], 600);
    expect(joined.length).toBeLessThanOrEqual(600);
    expect(joined).toContain('slot-1: ');
    expect(joined).toMatch(/\+\d+ more$/);
  });
  it('cuts a first entry that alone exceeds the budget and counts the rest', () => {
    const joined = joinFailedSlotReasons([long('slot-1'), long('slot-2')], 100);
    expect(joined.length).toBeLessThanOrEqual(100);
    expect(joined).toMatch(/\+1 more$/);
    expect(joinFailedSlotReasons([{ slotId: 1, reason: 2 }, {}])).toBe('unknown slot: unknown reason; unknown slot: unknown reason');
  });
  it('joins short reasons verbatim with no suffix', () => {
    expect(joinFailedSlotReasons([{ slotId: 'a', reason: 'x' }, { slotId: 'b', reason: 'y' }])).toBe('a: x; b: y');
  });
  it('keeps the default result within the store cap for two 1200-char reasons', () => {
    const joined = joinFailedSlotReasons([{ slotId: 's1', reason: 'a'.repeat(1200) }, { slotId: 's2', reason: 'b'.repeat(1200) }]);
    expect(joined.length).toBeLessThanOrEqual(MAX_FAILURE_REASON);
    expect(joined).toContain('s2: ');
  });
});

describe('failsOnFailedSlot (REQ-10, REQ-11)', () => {
  it.each([['structured', true], ['freeform', false], ['job-team', true], ['interactive-team', true], ['autonomous-team', true], [undefined, true]] as const)('%s -> %s', (mode, expected) => {
    expect(failsOnFailedSlot(mode)).toBe(expected);
  });
});

describe('oversized failed-slot reasons (REQ-2, REQ-11)', () => {
  const huge = [{ slotId: 'slot-2', personaId: 'qa', reason: 'a'.repeat(1200) }, { slotId: 'slot-3', personaId: 'qa', reason: 'b'.repeat(1200) }];
  it('fails a structured run with its real reasons instead of an invalid-summary error', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith(huge) });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    const record = await (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store.get('execution-1');
    expect(record?.state).toBe('FAILED');
    expect(record?.failureReason).toContain('slot-2: aaa');
    expect(record?.failureReason).not.toContain('invalid execution event summary');
    service.dispose();
  }));
  it('records the freeform launch warning instead of losing it', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith(huge) });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'freeform' } as never);
    const store = (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store;
    const { events } = await store.events('session-1', 'project-1', 'execution-1');
    const warning = events.find((event) => event.severity === 'warning' && event.summary.startsWith('Launch continued'));
    expect(warning?.summary).toContain('slot-2: aaa');
    service.dispose();
  }));
  it('fails the same oversized slots at reconcile for a structured run', async () => fixture(async (filePath) => {
    let lifecycle: unknown = { workers: [{ slotId: 'slot-1', sessionId: 's1', projectId: 'project-1', process: 'running' }] };
    const d = deps(filePath, { launchTeam: async () => launchedWith([]), getTeamLaunch: async () => lifecycle });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    lifecycle = { workers: [{ slotId: 'slot-1', sessionId: 's1', projectId: 'project-1', process: 'running' }], launchResult: { failedSlots: huge } };
    const record = await service.status('session-1', 'project-1', 'execution-1');
    expect(record).toMatchObject({ state: 'FAILED' });
    expect((record as ExecutionRecord).failureReason).toContain('slot-2: aaa');
    service.dispose();
  }));
});

describe('failed slots settle at launch (REQ-10, REQ-11, REQ-12)', () => {
  const slots = [{ slotId: 'slot-2', personaId: 'qa', reason: 'spawn failed' }];

  it('fails a structured run immediately with the slot reasons, with no status caller', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith(slots) });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    const record = await (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store.get('execution-1');
    expect(record?.state).toBe('FAILED');
    expect(record?.failureReason).toContain('slot-2');
    expect(record?.failureReason).toContain('spawn failed');
    service.dispose();
  }));

  it('cleans up a structured run failed by a failed slot', async () => fixture(async (filePath) => {
    const cancelTeamLaunch = vi.fn(async () => ({ ok: true, value: { canceledSessionIds: ['worker-1'], pendingSessionIds: [] } }));
    const service = new SquadExecutionService(deps(filePath, { launchTeam: async () => launchedWith(slots), cancelTeamLaunch }));
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    expect(cancelTeamLaunch).toHaveBeenCalledWith('session-1', 'request-1');
    service.dispose();
  }));

  it('continues a freeform run and records a launch-warning event with the failed slot', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith(slots) });
    const service = new SquadExecutionService(d);
    const started = await service.start('session-1', 'project-1', { ...request, coordinationMode: 'freeform' } as never);
    expect(started).toMatchObject({ ok: true, value: { state: 'RUNNING' } });
    const store = (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store;
    const { events } = await store.events('session-1', 'project-1', 'execution-1');
    expect(events.some((event) => event.severity === 'warning' && event.summary.includes('slot-2'))).toBe(true);
    service.dispose();
  }));

  it('strips control characters from failed slot reasons that reach the warning', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith([{ slotId: 'slot-2', personaId: 'qa', reason: 'boom\u001b[2J\u0000 at /Users/x/y/z.js' }]) });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', { ...request, coordinationMode: 'freeform' } as never);
    const store = (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store;
    const { events } = await store.events('session-1', 'project-1', 'execution-1');
    const text = events.map((event) => event.summary).join('\n');
    expect(text).toContain('slot-2');
    expect(text).not.toMatch(/[\u0000\u001b]/);
    expect(text).not.toContain('/Users/x');
    service.dispose();
  }));

  it('leaves a launch with no failed slots running with no warning (existing-user path)', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => launchedWith([]) });
    const service = new SquadExecutionService(d);
    const started = await service.start('session-1', 'project-1', { ...request, coordinationMode: 'structured' } as never);
    expect(started).toMatchObject({ ok: true, value: { state: 'RUNNING' } });
    service.dispose();
  }));
});

describe('launch failure keeps its reason (REQ-1)', () => {
  it('stores failureReason when the team launch returns not ok', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => ({ ok: false, code: 'TEAM_LAUNCH_FAILED', message: 'no worker could start at /opt/zana/bin/spawn' }) });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const record = await (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store.get('execution-1');
    expect(record?.state).toBe('FAILED');
    expect(record?.failureReason).toContain('no worker could start');
    expect(record?.failureReason).not.toContain('/opt/zana');
    service.dispose();
  }));

  it('stores failureReason when the team launch throws', async () => fixture(async (filePath) => {
    const d = deps(filePath, { launchTeam: async () => { throw new Error('exploded'); } });
    const service = new SquadExecutionService(d);
    await service.start('session-1', 'project-1', request);
    const record = await (d as unknown as { store: ReturnType<typeof createExecutionStore> }).store.get('execution-1');
    expect(record?.failureReason).toContain('exploded');
    service.dispose();
  }));
});
