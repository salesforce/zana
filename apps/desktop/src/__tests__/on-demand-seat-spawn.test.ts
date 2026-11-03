import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from './on-demand-seat-harness.js';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamLifecycleRecord } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { registerThreadProvider } from '@zana-ai/zcc-server/services/threads/thread-provider-catalog';

import { createTeamLifecycleStore } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { createDesktopNativeRecovery } from '../team-launch-support.js';
import { createDeferredSeatRegistry, type DeferredSeatHooks } from '../on-demand-seat.js';

/**
 * #580 acceptance tests for starting a Squad seat on demand, through the real host.ts
 * launchTeam path with a faked pty layer (the shared on-demand-seat-harness.ts).
 */
const host = await import('../host.js');
const { launchTeam } = host;

const projectDir = realpathSync(mkdtempSync(join(h.root, 'proj-')));
mkdirSync(projectDir, { recursive: true });

const persona = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), baseProfile: 'claude', ...extra });
let seq = 0;
let threadProviderHandles: Array<{ unregister(): void }> = [];

beforeEach(() => {
  threadProviderHandles.forEach(handle => handle.unregister());
  threadProviderHandles = [
    registerThreadProvider('test', { id: 'claude-code', displayName: 'Claude Code',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false,
        supportsThreadRename: false, permissionModes: ['accept-edits', 'auto', 'full'] }, composerActions: [] }),
    registerThreadProvider('test', { id: 'acp-opencode', displayName: 'OpenCode',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false,
        supportsThreadRename: false, permissionModes: ['accept-edits', 'full'] }, composerActions: [] })
  ];
  seq += 1;
  h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
  h.config = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
  h.personas = [persona('orch'), persona('w1'), persona('w2')];
  h.teams = [{
    id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2 }, { personaId: 'w2', label: 'Second' }]
  }];
  h.creates.length = 0;
  h.sessions.clear();
  h.createImpl = null;
  h.afterModernAck = null;
  h.reserveOverride = null;
});

afterAll(() => {
  threadProviderHandles.forEach(handle => handle.unregister());
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

const SLOT_IDS = ['0:w1:0', '0:w1:1', '1:w2:0', 'orchestrator:orch'];
const reqId = () => `req-${seq}-${Math.random().toString(36).slice(2)}`;

const lifecycleFile = () => join(h.root, 'team-lifecycle.json');
const recordFor = (launchRequestId: string): TeamLifecycleRecord => {
  const state = JSON.parse(readFileSync(lifecycleFile(), 'utf8')) as { records: Array<TeamLifecycleRecord & { deferredSeats?: TeamLifecycleRecord['workers'] }> };
  const stored = state.records.find((candidate) => candidate.launchRequestId === launchRequestId);
  expect(stored).toBeDefined();
  // Seats that have not started are stored under their own key (an older app ignores it); read them back among the workers.
  return { ...stored!, workers: [...stored!.workers, ...(stored!.deferredSeats ?? [])] };
};
const worker = (record: TeamLifecycleRecord, slotId: string) => record.workers.find((w) => w.slotId === slotId);
const durableReq = (extra: Record<string, unknown> = {}) => ({
  callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured' as const,
  slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })), ...extra
});
const onDemandTeam = () => {
  h.teams = [{
    id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2, startOnDemand: true }, { personaId: 'w2', label: 'Second' }]
  }];
};
const spawn = (recordId: string, slotId: string) => h.squadOpts.spawnDeferredWorker(recordId, slotId) as Promise<{ ok: boolean; sessionId?: string; message?: string }>;

describe('REQ-2 a launch with an on-demand seat does not spawn that seat', () => {
  it('spawns only the other seats and the coordinator, and records the deferred seats without a session', async () => {
    onDemandTeam();
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    expect(h.creates.map((c) => c.cohort?.slotId).sort()).toEqual(['1:w2:0', 'orchestrator:orch']);
    const record = recordFor(req.launchRequestId);
    for (const slotId of ['0:w1:0', '0:w1:1']) {
      expect(worker(record, slotId)).toMatchObject({ process: 'authorized' });
      expect(worker(record, slotId)?.sessionId).toBeUndefined();
    }
    expect(worker(record, '1:w2:0')?.sessionId).toBeTruthy();
  });
});

describe('REQ-3 a team without startOnDemand spawns every seat as before', () => {
  it('opens all four sessions and gives every worker a session', async () => {
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    expect(h.creates).toHaveLength(4);
    expect(recordFor(req.launchRequestId).workers.every((w) => w.sessionId)).toBe(true);
  });

  it('registers no deferred spawner, so asking to start a running seat creates nothing', async () => {
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = recordFor(req.launchRequestId);
    expect(await spawn(record.id, '0:w1:0')).toMatchObject({ ok: false });
    expect(h.creates).toHaveLength(4);
  });

  it('an explicit startOnDemand: false behaves like an absent field', async () => {
    h.teams[0].slots[0].startOnDemand = false;
    expect((await launchTeam('team1', 'p1', durableReq() as never)).ok).toBe(true);
    expect(h.creates).toHaveLength(4);
  });
});

describe('REQ-4 the spawner starts the seat with the standby prompt', () => {
  it('creates the session once, binds it to the lifecycle record and uses the worker standby prompt', async () => {
    onDemandTeam();
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    const before = h.creates.length;
    const result = await spawn(record.id, '0:w1:0');
    expect(result).toMatchObject({ ok: true, sessionId: expect.any(String) });
    expect(h.creates).toHaveLength(before + 1);
    const created = h.creates.at(-1);
    expect(created.cohort).toMatchObject({ role: 'worker', slotId: '0:w1:0' });
    expect((created.extraArgs ?? []).join('\n')).toContain('Team worker standby.');
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')).toMatchObject({ process: 'running', sessionId: result.sessionId });
    // the sibling on-demand seat is untouched
    expect(worker(recordFor(req.launchRequestId), '0:w1:1')).toMatchObject({ process: 'authorized' });
  });
});

describe('REQ-5 two requests for one seat spawn it once', () => {
  it('shares one spawn between concurrent callers and answers a later caller with the same session', async () => {
    onDemandTeam();
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    const before = h.creates.length;
    const [a, b] = await Promise.all([spawn(record.id, '0:w1:0'), spawn(record.id, '0:w1:0')]);
    expect(h.creates).toHaveLength(before + 1);
    expect(a).toMatchObject({ ok: true });
    expect(b).toEqual(a);
    expect(await spawn(record.id, '0:w1:0')).toEqual(a);
    expect(h.creates).toHaveLength(before + 1);
  });
});

describe('REQ-6 a failed spawn is reported and leaves the seat failed', () => {
  it('returns ok:false, marks the seat spawn-failed and does not retry blindly', async () => {
    onDemandTeam();
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    h.createImpl = () => { throw new Error('spawn boom'); };
    const result = await spawn(record.id, '0:w1:0');
    expect(result).toMatchObject({ ok: false, message: expect.any(String) });
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')).toMatchObject({ process: 'spawn-failed' });
  });
});

describe('REQ-8 an unsupported launch fails before anything is spawned', () => {
  it('fails a Modern team naming the on-demand seats, with no session, member or lifecycle record', async () => {
    onDemandTeam();
    h.teams[0].transport = 'MODERN';
    const req = durableReq();
    const result = await launchTeam('team1', 'p1', req as never);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("Start on demand isn't available for Modern squads yet") });
    expect(JSON.stringify(result)).toContain('w1');
    expect(h.creates).toHaveLength(0);
    expect(h.runtime.createSquadMember).not.toHaveBeenCalled();
  });

  it('fails a launch without durable coordination (goal launch) naming the seats', async () => {
    onDemandTeam();
    const result = await launchTeam('team1', 'p1', { goal: 'ship it' });
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('w1');
    expect(h.creates).toHaveLength(0);
  });

  it('fails an interactive launch without a request at all', async () => {
    onDemandTeam();
    expect(await launchTeam('team1', 'p1')).toMatchObject({ ok: false });
    expect(h.creates).toHaveLength(0);
  });
});

describe('REQ-9 restart and resume', () => {
  it('keeps a never-started seat deferred after a restart and recovers a started one as before', async () => {
    onDemandTeam();
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(true);
    const restarted = createTeamLifecycleStore({ filePath: lifecycleFile() });
    await restarted.reconcileStartup(new Set());
    const after = await restarted.get(record.id);
    expect(after?.workers.find((w) => w.slotId === '0:w1:0')).toMatchObject({ process: 'authorized' });
    expect(after?.workers.find((w) => w.slotId === '0:w1:1')).toMatchObject({ process: 'exited' });
  });

  it('keeps Resume available when the only seats without a snapshot are never-started on-demand seats', () => {
    const snap = (slotId: string) => ({ slotId, role: 'worker', personaId: 'pe', profileId: 'claude', nativeConversationId: 'n' });
    const team = { id: 't', slots: [{ personaId: 'pe', quantity: 1, startOnDemand: true }, { personaId: 'pe', quantity: 1 }] };
    const api = createDesktopNativeRecovery({
      projects: { listProjects: () => [{ id: 'pr' }] as never },
      teams: { list: () => [team] as never },
      personas: { list: () => [{ id: 'pe' }] as never },
      expandTeamSlots: () => [{ slotId: '0:pe:0', role: 'worker' as const, personaId: 'pe' }, { slotId: '1:pe:0', role: 'worker' as const, personaId: 'pe' }],
      resolveTeamProfile: () => 'claude' as never
    });
    const record = { projectId: 'pr', teamId: 't', nativeRecoverySnapshots: [snap('1:pe:0')] } as never;
    expect(api.availability(record)).toEqual({ available: true, restorableSlots: 1, totalSlots: 1 });
  });

  it('still blocks a partial restore when a non-deferred seat lacks a snapshot (existing behaviour)', () => {
    const snap = (slotId: string) => ({ slotId, role: 'worker', personaId: 'pe', profileId: 'claude', nativeConversationId: 'n' });
    const api = createDesktopNativeRecovery({
      projects: { listProjects: () => [{ id: 'pr' }] as never },
      teams: { list: () => [{ id: 't', slots: [{ personaId: 'pe' }, { personaId: 'pe' }] }] as never },
      personas: { list: () => [{ id: 'pe' }] as never },
      expandTeamSlots: () => [{ slotId: '0:pe:0', role: 'worker' as const, personaId: 'pe' }, { slotId: '1:pe:0', role: 'worker' as const, personaId: 'pe' }],
      resolveTeamProfile: () => 'claude' as never
    });
    expect(api.availability({ projectId: 'pr', teamId: 't', nativeRecoverySnapshots: [snap('0:pe:0')] } as never))
      .toMatchObject({ available: false, reason: 'PARTIAL_RESTORE' });
  });
});

describe('REQ-10 the spawner is released when the run ends or is canceled', () => {
  it('refuses to spawn after cancel and creates no session', async () => {
    onDemandTeam();
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    expect((await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId)).ok).toBe(true);
    const before = h.creates.length;
    expect(await spawn(record.id, '0:w1:0')).toMatchObject({ ok: false });
    expect(h.creates).toHaveLength(before);
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')?.process).toBe('canceled');
  });
});

describe('OBL registry obligations (CodeNod correctness)', () => {
  const hooks = (over: Partial<DeferredSeatHooks> = {}): DeferredSeatHooks => ({
    claim: vi.fn(async () => true), sessionOf: vi.fn(async () => 'sess'), start: vi.fn(async () => ({ ok: true as const, sessionId: 'sess' })),
    isStuck: vi.fn(async () => false), close: vi.fn(async () => undefined), reopen: vi.fn(async () => true),
    markFailed: vi.fn(async () => undefined), ...over
  });

  it('OBL-005: two concurrent spawns call start once and share the session', async () => {
    const reg = createDeferredSeatRegistry();
    const h2 = hooks();
    reg.register('r', ['s'], h2);
    const [a, b] = await Promise.all([reg.spawn('r', 's'), reg.spawn('r', 's')]);
    expect(h2.start).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ ok: true, sessionId: 'sess' });
    expect(b).toEqual(a);
  });

  it('OBL-007: a thrown start is reported and the seat is marked failed', async () => {
    const reg = createDeferredSeatRegistry();
    const h2 = hooks({ start: vi.fn(async () => { throw new Error('boom'); }) });
    reg.register('r', ['s'], h2);
    expect(await reg.spawn('r', 's')).toEqual({ ok: false, message: 'boom' });
    expect(h2.markFailed).toHaveBeenCalledWith('s');
  });

  it('REQ-6: a refused start marks the seat failed', async () => {
    const reg = createDeferredSeatRegistry();
    const h2 = hooks({ start: vi.fn(async () => ({ ok: false as const, message: 'no' })) });
    reg.register('r', ['s'], h2);
    expect(await reg.spawn('r', 's')).toEqual({ ok: false, message: 'no' });
    expect(h2.markFailed).toHaveBeenCalledWith('s');
  });

  it('a caller that loses the store claim gets the winner session, or a plain refusal when none', async () => {
    const reg = createDeferredSeatRegistry();
    reg.register('r', ['s'], hooks({ claim: vi.fn(async () => false) }));
    expect(await reg.spawn('r', 's')).toEqual({ ok: true, sessionId: 'sess' });
    reg.register('q', ['s'], hooks({ claim: vi.fn(async () => false), sessionOf: vi.fn(async () => undefined) }));
    expect(await reg.spawn('q', 's')).toMatchObject({ ok: false });
  });

  it('OBL-012 / REQ-3: registers nothing without deferred seats; release forgets the run', async () => {
    const reg = createDeferredSeatRegistry();
    reg.register('none', [], hooks());
    expect(reg.has('none')).toBe(false);
    reg.register('r', ['s'], hooks());
    expect(reg.has('r')).toBe(true);
    reg.release('r');
    expect(reg.has('r')).toBe(false);
    expect(await reg.spawn('r', 's')).toMatchObject({ ok: false });
  });

  it('OBL-002: no start after release when the claim was already pending', async () => {
    const reg = createDeferredSeatRegistry();
    let resolveClaim!: (v: boolean) => void;
    const h2 = hooks({ claim: vi.fn(() => new Promise<boolean>((r) => { resolveClaim = r; })) });
    reg.register('r', ['s'], h2);
    const pending = reg.spawn('r', 's');
    reg.release('r');
    resolveClaim(true);
    await pending;
    expect(h2.start).not.toHaveBeenCalled();
  });
});
