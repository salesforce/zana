import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from './on-demand-seat-harness.js';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
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

  it('through the engine path (pre-issued authorisations) revokes the unused one and starts the seat later', async () => {
    onDemand(0);
    const launchRequestId = reqId();
    const tasks = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }));
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, {}, tasks as never, 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured', slots } as never);
    expect(launched).toMatchObject({ ok: true });
    const record = recordFor(launchRequestId);
    expect(worker(record, '0:w1:0')?.sessionId).toBeUndefined();
    const late = await spawn(record.id, '0:w1:0');
    expect(late).toMatchObject({ ok: true });
    expect(worker(recordFor(launchRequestId), '0:w1:0')?.sessionId).toBeTruthy();
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
    const launchRequestId = reqId();
    const tasks = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }));
    const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, { deadlineMs: 60_000 }, tasks as never, 'structured', 'adm');
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) return;
    const slots = authorized.value.slots.map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }));
    const launched = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured', policy: { deadlineMs: 60_000 }, slots } as never);
    expect(launched).toMatchObject({ ok: true });
    const record = recordFor(launchRequestId);
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

  it('A2: after a restart (no spawner for the run) the seat is failed once with a plain reason', async () => {
    onDemand(0);
    const req = durableReq();
    await launchTeam('team1', 'p1', req as never);
    const record = recordFor(req.launchRequestId);
    await host.cancelTeamLaunch(req.callerPrincipalId, req.launchRequestId);
    expect((await spawn(record.id, '0:w1:1')).ok).toBe(false);
    expect(worker(recordFor(req.launchRequestId), '0:w1:1')?.process).toBe('canceled');
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
