import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from './on-demand-seat-harness.js';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamLifecycleRecord } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { registerThreadProvider } from '@zana-ai/zcc-server/services/threads/thread-provider-catalog';

const host = await import('../host.js');
const { authorizeTeamLaunch, launchTeam } = host;

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
  const stored = state.records.find((candidate) => candidate.launchRequestId === launchRequestId)!;
  // Seats that have not started are stored under their own key (an older app ignores it); read them back among the workers.
  return { ...stored, workers: [...stored.workers, ...(stored.deferredSeats ?? [])] };
};
const worker = (record: TeamLifecycleRecord, slotId: string) => record.workers.find((w) => w.slotId === slotId);
const durableReq = (extra: Record<string, unknown> = {}) => ({
  callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured' as const,
  slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` })), ...extra
});
const spawn = (recordId: string, slotId: string) => h.squadOpts.spawnDeferredWorker(recordId, slotId) as Promise<{ ok: boolean; sessionId?: string; message?: string }>;
const onDemand = (...rows: number[]) => {
  h.teams = [{ id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch',
    slots: [{ personaId: 'w1', quantity: 2, ...(rows.includes(0) ? { startOnDemand: true } : {}) }, { personaId: 'w2', label: 'Second', ...(rows.includes(1) ? { startOnDemand: true } : {}) }] }];
};

describe('late start of an on-demand seat through the real launch path (#580)', () => {
  it('mints a fresh authorisation for the late session instead of reusing the expired launch one', async () => {
    onDemand(0);
    const req = durableReq({ requirePreauthorization: undefined });
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = recordFor(req.launchRequestId);
    const launchAuth = worker(record, '0:w1:0')?.authorizationId;
    const started = await spawn(record.id, '0:w1:0');
    expect(started.ok).toBe(true);
    const bound = worker(recordFor(req.launchRequestId), '0:w1:0');
    expect(bound?.authorizationId).toBeTruthy();
    expect(bound?.authorizationId).not.toBe(launchAuth);
    expect(recordFor(req.launchRequestId).launchResult.workers.map((w) => w.slotId)).toContain('0:w1:0');
  });

  it('names the seat by its label (or persona) in the refusal and spawns nothing', async () => {
    onDemand(1);
    h.teams[0].transport = 'MODERN';
    const result = await launchTeam('team1', 'p1', durableReq() as never);
    expect(result).toMatchObject({ ok: false });
    expect(JSON.stringify(result)).toContain('Second');
    expect(h.creates).toHaveLength(0);
  });

  it('lists a waiting seat in the coordinator prompt and does not give it a session id', async () => {
    onDemand(0);
    const req = durableReq({ jobContext: { objective: 'Ship' } });
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const coordinatorCreate = h.creates.find((c) => c.cohort?.slotId === 'orchestrator:orch');
    const text = JSON.stringify(coordinatorCreate);
    expect(text).toContain('Seats that start when their first unit is ready');
    expect(text).toContain('0:w1:0');
  });

  it('records two on-demand rows independently and lets the second start without the first', async () => {
    onDemand(0, 1);
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(true);
    const record = recordFor(req.launchRequestId);
    expect(h.creates.map((c) => c.cohort?.slotId)).toEqual(['orchestrator:orch']);
    expect((await spawn(record.id, '1:w2:0')).ok).toBe(true);
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')).toMatchObject({ process: 'authorized' });
  });

  it('a failed late spawn marks the seat failed and releases the spawner entry for later calls', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    h.createImpl = () => { throw new Error('boom'); };
    expect((await spawn(record.id, '0:w1:0')).ok).toBe(false);
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')?.process).toBe('spawn-failed');
    h.createImpl = null;
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(true);
  });

  it('fails closed: a pre-authorised plan with an on-demand seat is refused before anything is spawned, naming the seat', async () => {
    onDemand(0);
    const launchRequestId = reqId();
    const tasks = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }));
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, {}, tasks as never, 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured', slots } as never);
    expect(launched).toMatchObject({ ok: false, code: 'UNSUPPORTED', message: expect.stringMatching(/pre-authorized plan.*turn it off for: w1/) });
    expect(h.creates).toHaveLength(0);
  });

  it('skips an on-demand seat whose persona is unknown, like any other seat', async () => {
    onDemand(0);
    h.personas = [persona('orch'), persona('w2')];
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    expect(worker(record, '0:w1:0')).toBeUndefined();
  });

  it('cancelling a run that has already ended is harmless', async () => {
    onDemand(0);
    expect((await host.cancelTeamLaunch('nobody', 'no-such-request')).ok).toBe(false);
  });
});

describe('review round 1: late seat, deadline and cleanup (#580)', () => {
  it('F5/A1: a seat started after the launch deadline still starts (its authorisation does not inherit it)', async () => {
    onDemand(0);
    const req = durableReq({ policy: { deadlineMs: 60_000 } });
    const launched = await launchTeam('team1', 'p1', req as never);
    expect(launched).toMatchObject({ ok: true });
    const record = recordFor(req.launchRequestId);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 3 * 60 * 60 * 1000);
    try {
      expect(await spawn(record.id, '0:w1:0')).toMatchObject({ ok: true, sessionId: expect.any(String) });
    } finally { vi.useRealTimers(); }
  });

  it('F3: a launch whose coordinator fails to start forgets the spawner', async () => {
    onDemand(0);
    h.createImpl = (opts: any) => {
      if (opts.cohort?.role === 'orchestrator') throw new Error('coordinator boom');
      const session = { id: opts.preallocatedSessionId ?? opts.sessionId ?? `s${h.creates.length}`, status: 'running', projectId: opts.projectId, cohort: opts.cohort };
      h.sessions.set(session.id, session);
      return session;
    };
    const req = durableReq();
    expect((await launchTeam('team1', 'p1', req as never)).ok).toBe(false);
    const record = recordFor(req.launchRequestId);
    const before = h.creates.length;
    h.createImpl = null;
    expect(await spawn(record.id, '0:w1:0')).toEqual({ ok: false, message: 'no seat is waiting to start for this run' });
    expect(h.creates).toHaveLength(before);
  });

  it('A2/N3: a start for a live run that has lost its spawner (as after a restart) fails the seat once, with the plain reason', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    // A restart loses the in-memory spawner while the record stays active. Re-reading the lifecycle file with a
    // fresh process-level registry is not possible in one process, so ask the way the engine would for a run
    // the registry has released (the terminal hook), which leaves the stored record active until teardown.
    await h.squadOpts.onTerminal({ callerPrincipalId: req.callerPrincipalId, teamLaunchRequestId: req.launchRequestId, id: 'exec', projectId: 'p1', state: 'COMPLETED' }).catch(() => undefined);
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(false);
    const seat = worker(recordFor(req.launchRequestId), '0:w1:1');
    expect(seat).toMatchObject({ process: 'spawn-failed', exitReason: expect.stringContaining('app restarted') });
    // asking again settles nothing new
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(false);
  });

  it('A12: a start that arrives while the run is being canceled (a started seat still closing) leaves the restart message off', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    // the run is canceling but a started seat has not exited yet, so the record stays cancel-pending
    h.sessions.get([...h.sessions.keys()][0])!.status = 'running';
    await h.squadOpts.onTerminal({ callerPrincipalId: req.callerPrincipalId, teamLaunchRequestId: req.launchRequestId, id: 'exec', projectId: 'p1', state: 'COMPLETED' }).catch(() => undefined);
    const stored = JSON.parse(readFileSync(lifecycleFile(), 'utf8'));
    const entry = stored.records.find((r: { id: string }) => r.id === record.id);
    entry.state = 'cancel-pending';
    writeFileSync(lifecycleFile(), JSON.stringify(stored));
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(false);
    expect(worker(recordFor(req.launchRequestId), '0:w1:1')?.exitReason).toBeUndefined();
    expect(worker(recordFor(req.launchRequestId), '0:w1:1')?.process).toBe('authorized');
  });

  it('A10: a start refused because the machine is at its live-session limit leaves the seat waiting, and it starts once there is room', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    // the coordinator and the running seat already fill the smallest allowed session limit (2)
    expect(h.sessions.size).toBeGreaterThanOrEqual(2);
    h.config = { ...h.config, maxLiveSessions: 2 };
    const refused = await spawn(record.id, '0:w1:0');
    expect(refused).toMatchObject({ ok: false, message: expect.stringMatching(/capacity changed/) });
    expect(worker(recordFor(req.launchRequestId), '0:w1:0')?.process).toBe('authorized');
    h.config = { ...h.config, maxLiveSessions: 50 };
    expect((await spawn(record.id, '0:w1:0')).ok).toBe(true);
  });

  it('F3: a run that reaches a terminal state (completed, failed, stopped, dismissed) forgets the spawner', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    await h.squadOpts.onTerminal({ callerPrincipalId: req.callerPrincipalId, teamLaunchRequestId: req.launchRequestId, id: 'exec', projectId: 'p1', state: 'COMPLETED' }).catch(() => undefined);
    const before = h.creates.length;
    expect(await spawn(record.id, '0:w1:0')).toEqual({ ok: false, message: 'no seat is waiting to start for this run' });
    expect(h.creates).toHaveLength(before);
  });
});
