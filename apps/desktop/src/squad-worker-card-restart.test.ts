import { describe, expect, it, vi } from 'vitest';
import { restartSquadWorkerCard, type SquadWorkerCardRestartDeps } from './squad-worker-card-restart.js';

const cohort = { cohortId: 'c1', teamId: 't', teamName: 'T', role: 'worker', slotId: 'slot1', executionId: 'e1' };
const session = { id: 's1', projectId: 'p1', status: 'running', cohort };
const record = { id: 'r1', state: 'active', callerPrincipalId: 'u', launchRequestId: 'l1', workers: [{ sessionId: 's1', slotId: 'slot1', cohortId: 'c1', projectId: 'p1', process: 'running' }] };

function deps(over: Partial<SquadWorkerCardRestartDeps> = {}): SquadWorkerCardRestartDeps {
  return {
    getSession: vi.fn((id: string) => (id === 's1' ? session : undefined)) as never,
    listLifecycleRecords: vi.fn(async () => [record]),
    launchIsClosing: vi.fn(async () => false),
    getExecution: vi.fn(async () => ({ state: 'RUNNING', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' })),
    isTerminalExecutionState: (s) => ['COMPLETED', 'STOPPED', 'FAILED'].includes(s),
    restart: vi.fn(async () => ({ ok: true as const })),
    respawnExited: vi.fn(async () => ({ ok: true as const })),
    ...over
  };
}

describe('restartSquadWorkerCard respawn failure', () => {
  it('logs the respawn error with record and slot ids and returns the fixed message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const boom = new Error('boom');
    const d = deps({ getSession: () => ({ ...session, status: 'exited' }) as never, respawnExited: vi.fn(async () => { throw boom; }) });
    const out = await restartSquadWorkerCard(d, 's1');
    expect(out).toMatchObject({ ok: false, reason: 'worker-exited' });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('slot1'), boom);
    expect(spy.mock.calls[0][0]).toContain('r1');
    spy.mockRestore();
  });
});

describe('restartSquadWorkerCard', () => {
  it('restarts a live worker bound to its slot', async () => {
    const d = deps();
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toEqual({ ok: true });
    expect(d.restart).toHaveBeenCalledWith('s1', { maySpawn: expect.any(Function) });
  });
  it.each([undefined, 5, '', 'x'.repeat(300)])('rejects malformed id %s', async (id) => {
    const d = deps();
    await expect(restartSquadWorkerCard(d, id)).resolves.toMatchObject({ ok: false, reason: 'not-found' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('refuses an unknown (foreign) session', async () => {
    const d = deps();
    await expect(restartSquadWorkerCard(d, 'other')).resolves.toMatchObject({ reason: 'not-found' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('leaves non-Squad sessions to the ordinary path', async () => {
    for (const cohortValue of [undefined, { ...cohort, role: 'orchestrator' }, { ...cohort, slotId: undefined }]) {
      const d = deps({ getSession: () => ({ ...session, cohort: cohortValue }) as never });
      await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-squad-worker' });
      expect(d.restart).not.toHaveBeenCalled();
    }
  });
  it('refuses a worker with no lifecycle slot bound to this session (forged cohort)', async () => {
    for (const w of [{ sessionId: 'zzz' }, { slotId: 'zzz' }, { cohortId: 'zzz' }, { projectId: 'zzz' }]) {
      const d = deps({ listLifecycleRecords: async () => [{ id: 'r1', workers: [{ ...record.workers[0], ...w }] }] });
      await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-a-worker' });
      expect(d.restart).not.toHaveBeenCalled();
    }
  });
  it('refuses when the execution record is missing', async () => {
    const d = deps({ getExecution: async () => undefined });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-a-worker' });
  });
  it.each(['COMPLETED', 'STOPPED', 'FAILED'])('refuses a %s run', async (state) => {
    const d = deps({ getExecution: async () => ({ state, callerPrincipalId: 'u', teamLaunchRequestId: 'l1' }) });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'run-finished' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('refuses a closing run', async () => {
    const d = deps({ launchIsClosing: vi.fn(async () => true) });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'run-closing' });
    expect(d.launchIsClosing).toHaveBeenCalledWith('r1');
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('respawns an exited worker through the respawn path, not the plain restarter', async () => {
    const d = deps({ getSession: () => ({ ...session, status: 'exited' }) as never });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toEqual({ ok: true });
    expect(d.respawnExited).toHaveBeenCalledWith('r1', 'slot1');
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('reports a refused or throwing respawn without paths and creates no lookalike', async () => {
    const exited = { getSession: () => ({ ...session, status: 'exited' }) as never };
    let d = deps({ ...exited, respawnExited: async () => ({ ok: false, message: 'failed at /Users/me/x/secret.txt' }) });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ ok: false, reason: 'worker-exited', message: 'failed at secret.txt' });
    d = deps({ ...exited, respawnExited: async () => { throw new Error('boom'); } });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ ok: false, reason: 'worker-exited' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('does not respawn an exited worker of a closing or finished run', async () => {
    const exited = { getSession: () => ({ ...session, status: 'exited' }) as never };
    const closing = deps({ ...exited, launchIsClosing: async () => true });
    await expect(restartSquadWorkerCard(closing, 's1')).resolves.toMatchObject({ reason: 'run-closing' });
    const done = deps({ ...exited, getExecution: async () => ({ state: 'STOPPED', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' }) });
    await expect(restartSquadWorkerCard(done, 's1')).resolves.toMatchObject({ reason: 'run-finished' });
    expect(closing.respawnExited).not.toHaveBeenCalled();
    expect(done.respawnExited).not.toHaveBeenCalled();
  });
  it('passes through restarter refusals', async () => {
    const d = deps({ restart: async () => ({ ok: false, reason: 'busy' }) });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toEqual({ ok: false, reason: 'busy' });
  });
  it('refuses unless exactly one lifecycle record binds the session', async () => {
    const d = deps({ listLifecycleRecords: async () => [record, { ...record, id: 'r2' }] });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-a-worker' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('refuses a non-active record and a terminal slot on a live session', async () => {
    let d = deps({ listLifecycleRecords: async () => [{ ...record, state: 'cancel-pending' }] });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'run-closing' });
    d = deps({ listLifecycleRecords: async () => [{ ...record, workers: [{ ...record.workers[0], process: 'exited' }] }] });
    await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-a-worker' });
    expect(d.restart).not.toHaveBeenCalled();
  });
  it('refuses when the execution is not the run the lifecycle record launched', async () => {
    for (const exec of [{ callerPrincipalId: 'x', teamLaunchRequestId: 'l1' }, { callerPrincipalId: 'u', teamLaunchRequestId: 'x' }]) {
      const d = deps({ getExecution: async () => ({ state: 'RUNNING', ...exec }) });
      await expect(restartSquadWorkerCard(d, 's1')).resolves.toMatchObject({ reason: 'not-a-worker' });
      expect(d.restart).not.toHaveBeenCalled();
    }
  });
  it('hands the restarter a fence that follows launchIsClosing', async () => {
    const closing = vi.fn(async () => false);
    const d = deps({ launchIsClosing: closing });
    await restartSquadWorkerCard(d, 's1');
    const fence = (d.restart as any).mock.calls[0][1].maySpawn;
    await expect(fence()).resolves.toBe(true);
    closing.mockResolvedValue(true);
    await expect(fence()).resolves.toBe(false);
    expect(closing).toHaveBeenLastCalledWith('r1');
  });
  it('bounds and strips paths from restarter failure messages', async () => {
    const d = deps({ restart: async () => ({ ok: false, reason: 'relaunch-failed', message: `boom /Users/me/secret/repo/file.ts ${'x'.repeat(500)}` }) });
    const r = await restartSquadWorkerCard(d, 's1');
    expect(r.ok).toBe(false);
    const m = (r as any).message as string;
    expect(m).not.toContain('/Users/me');
    expect(m).toContain('file.ts');
    expect(m.length).toBeLessThanOrEqual(200);
  });
});
