import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { h } from './on-demand-seat-harness.js';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { TeamLifecycleRecord } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { registerThreadProvider } from '@zana-ai/zcc-server/services/threads/thread-provider-catalog';
import { SEAT_EXIT_WAIT_MS, SEAT_REST_WAIT_MS } from '../on-demand-seat.js';

/**
 * #579 through the real host.ts launchTeam path with a faked pty layer: a fresh-context seat is refused where it
 * cannot work, is listed without a session id, and is started again under a respawn approval, in place.
 */
const host = await import('../host.js');
const { authorizeTeamLaunch, launchTeam } = host;

const projectDir = realpathSync(mkdtempSync(join(h.root, 'proj-')));
mkdirSync(projectDir, { recursive: true });
const persona = (id: string) => ({ id, name: id.toUpperCase(), baseProfile: 'claude' });
let seq = 0;
let providers: Array<{ unregister(): void }> = [];

beforeEach(() => {
  providers.forEach((handle) => handle.unregister());
  providers = [
    registerThreadProvider('test', { id: 'claude-code', displayName: 'Claude Code',
      capabilities: { supportsServiceTier: false, fork: 'none', supportsThreadArchive: false, supportsThreadRename: false, permissionModes: ['accept-edits', 'auto', 'full'] }, composerActions: [] })
  ];
  seq += 1;
  h.projects = [{ id: 'p1', name: 'Proj', path: projectDir }];
  h.config = { version: 1, theme: 'dark', shell: '/bin/zsh', claudeBinary: 'claude', fontSize: 13, lastProjectId: null };
  h.personas = [persona('orch'), persona('w1')];
  h.teams = [{ id: 'team1', name: 'Team One', orchestratorPersonaId: 'orch', slots: [{ personaId: 'w1', label: 'Engineer', freshContextPerUnit: true }] }];
  h.creates.length = 0;
  h.sessions.clear();
  h.createImpl = null;
});
afterAll(() => {
  providers.forEach((handle) => handle.unregister());
  vi.unstubAllEnvs();
  rmSync(h.root, { recursive: true, force: true });
});

const SLOT_IDS = ['0:w1:0', 'orchestrator:orch'];
const reqId = () => `req-${seq}-${Math.random().toString(36).slice(2)}`;
const recordFor = (launchRequestId: string): TeamLifecycleRecord => {
  const state = JSON.parse(readFileSync(join(h.root, 'team-lifecycle.json'), 'utf8')) as { records: Array<TeamLifecycleRecord & { deferredSeats?: TeamLifecycleRecord['workers'] }> };
  const stored = state.records.find((candidate) => candidate.launchRequestId === launchRequestId)!;
  return { ...stored, workers: [...stored.workers, ...(stored.deferredSeats ?? [])] };
};
const worker = (record: TeamLifecycleRecord, slotId: string) => record.workers.find((w) => w.slotId === slotId);
const preauthorized = (launchRequestId: string) => {
  const tasks = SLOT_IDS.map((slotId) => ({ slotId, initialTask: `task ${slotId}` }));
  const authorized = authorizeTeamLaunch('owner', 'team1', 'p1', launchRequestId, {} as never, tasks as never, 'structured', 'adm');
  if (!authorized.ok) throw new Error(authorized.message);
  return authorized.value.slots;
};
const launchPreauthorized = (launchRequestId: string, extra: Record<string, unknown> = {}) => launchTeam('team1', 'p1', {
  callerPrincipalId: 'owner', launchRequestId, requirePreauthorization: true, admissionDigest: 'adm', coordinationMode: 'structured', ...extra,
  slots: preauthorized(launchRequestId).map(({ slotId, initialTask, authorizationId }) => ({ slotId, initialTask, authorizationId }))
} as never);
const recycle = (recordId: string, slotId: string) => h.squadOpts.recycleSeat(recordId, slotId) as Promise<{ sessionId?: string; final?: true; declined?: true }>;

async function finishRecycleCheck(done: Promise<{ sessionId?: string }>, id: string, first: TeamLifecycleRecord, launchedBefore: number, approvalBefore: string) {
    const result = await done;
    expect(result).toMatchObject({ sessionId: expect.any(String) });
    const after = recordFor(id);
    expect(worker(after, '0:w1:0')).toMatchObject({ process: 'running', deliveredUnitCount: 0, sessionId: result.sessionId });
    expect(worker(after, '0:w1:0')!.authorizationId).not.toBe(approvalBefore);
    // the launch path re-issues the approval just before spawning: it must stay a respawn, so it took no launch of the run's budget
    expect(h.launchAuthorization().isRespawn(worker(after, '0:w1:0')!.authorizationId)).toBe(true);
    expect(h.launchAuthorization().respawnPriorOf(worker(after, '0:w1:0')!.authorizationId)).toBe(approvalBefore);
    expect(after.workers).toHaveLength(first.workers.length);
    expect(after.capacity!.launched).toBe(launchedBefore);
    expect(after.launchResult.workers.filter((w) => w.slotId === '0:w1:0').map((w) => w.sessionId)).toEqual([result.sessionId]);
    expect(h.creates.at(-1)).toMatchObject({ cohort: { slotId: '0:w1:0', role: 'worker' } });
    expect(h.creates.at(-1).resumeSessionId).toBeUndefined();
}

describe('launch checks', () => {
  it('REQ-9: refuses a Modern team and a launch without a plan, naming the seat, and spawns nothing', async () => {
    h.teams[0].transport = 'MODERN';
    const modern = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured', slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: 't' })) } as never);
    expect(modern).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(JSON.stringify(modern)).toContain('Engineer');
    h.teams[0].transport = 'CLI';
    const noPlan = await launchTeam('team1', 'p1');
    expect(noPlan).toMatchObject({ ok: false });
    expect(JSON.stringify(noPlan)).toContain('Engineer');
    expect(h.creates).toHaveLength(0);
  });

  it('REQ-9: refuses a plan whose seats were not pre-authorised', async () => {
    const result = await launchTeam('team1', 'p1', { callerPrincipalId: 'owner', launchRequestId: reqId(), coordinationMode: 'structured', slots: SLOT_IDS.map((slotId) => ({ slotId, initialTask: 't' })) } as never);
    expect(result).toMatchObject({ ok: false, code: 'UNSUPPORTED' });
    expect(h.creates).toHaveLength(0);
  });
});

describe('a fresh-context seat in a pre-authorised plan', () => {
  it('starts at launch like any seat, is listed without a session id, and counts its delivered units from 0', async () => {
    const id = reqId();
    expect((await launchPreauthorized(id, { jobContext: { objective: 'Ship' } })).ok).toBe(true);
    const seat = worker(recordFor(id), '0:w1:0');
    expect(seat).toMatchObject({ process: 'running', deliveredUnitCount: 0 });
    const prompt = JSON.stringify(h.creates.find((c) => c.cohort?.slotId === 'orchestrator:orch'));
    expect(prompt).toContain('Seats that get a new session for each unit');
    expect(prompt).not.toContain(`session \`${seat!.sessionId}\``);
  });

  it('REQ-3/5/6: a recycle detaches the old session, then starts a new one in place under a respawn approval without a new launch', async () => {
    const id = reqId();
    expect((await launchPreauthorized(id)).ok).toBe(true);
    const first = recordFor(id);
    const oldSession = worker(first, '0:w1:0')!.sessionId!;
    const launchedBefore = first.capacity!.launched;
    const approvalBefore = worker(first, '0:w1:0')!.authorizationId;
    // the faked pty layer reports no rest state and no exit, so both bounded waits run out on fake timers
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      const done = recycle(first.id, '0:w1:0');
      await vi.advanceTimersByTimeAsync(SEAT_REST_WAIT_MS);
      expect(worker(recordFor(id), '0:w1:0')).toMatchObject({ process: 'authorized', onDemand: true, capacityReleased: false });
      expect(worker(recordFor(id), '0:w1:0')?.sessionId).toBeUndefined();
      // the old session's exit completes its approval, which frees the run's concurrency
      h.launchAuthorization().complete(approvalBefore);
      await vi.advanceTimersByTimeAsync(SEAT_EXIT_WAIT_MS);
      return await finishRecycleCheck(done, id, first, launchedBefore, approvalBefore);
    } finally { vi.useRealTimers(); }
  });

  it('REQ-11: after the run is cancelled a recycle declines and starts nothing', async () => {
    const id = reqId();
    expect((await launchPreauthorized(id)).ok).toBe(true);
    const record = recordFor(id);
    await host.cancelTeamLaunch('owner', id);
    const creates = h.creates.length;
    await expect(recycle(record.id, '0:w1:0')).resolves.toEqual({ declined: true });
    expect(h.creates).toHaveLength(creates);
  });
});
