import { describe, expect, it, vi } from 'vitest';
import { restartSquadWorkerForOwner, type SquadWorkerOwnerRestartDeps } from './squad-worker-card-restart.js';

const cohort = { cohortId: 'c1', teamId: 't', teamName: 'T', role: 'worker', slotId: 'slot1', executionId: 'e1' };
const session = { id: 's1', projectId: 'p1', status: 'running', cohort };
const record = { id: 'r1', state: 'active', callerPrincipalId: 'u', launchRequestId: 'l1', workers: [{ sessionId: 's1', slotId: 'slot1', cohortId: 'c1', projectId: 'p1', process: 'running' }] };

function deps(over: Partial<SquadWorkerOwnerRestartDeps> = {}): SquadWorkerOwnerRestartDeps {
  return {
    getSession: vi.fn((id: string) => (id === 's1' ? session : undefined)) as never,
    listLifecycleRecords: vi.fn(async () => [record]),
    launchIsClosing: vi.fn(async () => false),
    getExecution: vi.fn(async () => ({ state: 'RUNNING', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' })),
    isTerminalExecutionState: (s) => ['COMPLETED', 'STOPPED', 'FAILED'].includes(s),
    restart: vi.fn(async () => ({ ok: true as const })),
    respawnExited: vi.fn(async () => ({ ok: true as const })),
    getWorker: vi.fn(async () => ({ sessionId: 's1', process: 'running' })),
    respawnSeat: vi.fn(async () => ({ ok: true as const, sessionId: 's2' })),
    ...over
  };
}

describe('restartSquadWorkerForOwner', () => {
  it('relaunches a live worker in place through the card path (same fences)', async () => {
    const d = deps();
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toEqual({ ok: true, sessionId: 's1', mode: 'restarted' });
    expect(d.restart).toHaveBeenCalledWith('s1', { maySpawn: expect.any(Function) });
    expect(d.respawnSeat).not.toHaveBeenCalled();
  });

  it('respawns an exited seat through the card path and reports the new session id', async () => {
    const getWorker = vi.fn<SquadWorkerOwnerRestartDeps['getWorker']>()
      .mockResolvedValueOnce({ sessionId: 's1', process: 'exited' })
      .mockResolvedValueOnce({ sessionId: 's9', process: 'running' });
    const d = deps({ getSession: () => ({ ...session, status: 'exited' }) as never, getWorker });
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toEqual({ ok: true, sessionId: 's9', mode: 'respawned' });
    expect(d.respawnExited).toHaveBeenCalledWith('r1', 'slot1');
    expect(d.restart).not.toHaveBeenCalled();
  });

  it('respawns directly when a dead seat has no session record left', async () => {
    const d = deps({ getSession: () => undefined, getWorker: async () => ({ sessionId: 's1', process: 'exited' }) });
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toEqual({ ok: true, sessionId: 's2', mode: 'respawned' });
    expect(d.respawnSeat).toHaveBeenCalledWith('r1', 'slot1');
  });

  it('respawns directly for a dead seat that never had a session', async () => {
    const d = deps({ getWorker: async () => ({ process: 'spawn-failed' }) });
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toMatchObject({ ok: true, mode: 'respawned' });
  });

  it('refuses a closing run before any direct respawn', async () => {
    const d = deps({ getSession: () => undefined, getWorker: async () => ({ sessionId: 's1', process: 'exited' }), launchIsClosing: async () => true });
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toMatchObject({ ok: false, reason: 'run-closing' });
    expect(d.respawnSeat).not.toHaveBeenCalled();
  });

  it('reports a failed or throwing direct respawn with a bounded message', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const base = { getSession: () => undefined, getWorker: async () => ({ sessionId: 's1', process: 'exited' }) };
    await expect(restartSquadWorkerForOwner(deps({ ...base, respawnSeat: async () => ({ ok: false as const, message: 'no room in /Users/x/y/z.log' }) }), 'r1', 'slot1'))
      .resolves.toEqual({ ok: false, reason: 'worker-exited', message: expect.not.stringContaining('/Users') });
    await expect(restartSquadWorkerForOwner(deps({ ...base, respawnSeat: async () => { throw new Error('boom'); } }), 'r1', 'slot1'))
      .resolves.toMatchObject({ ok: false, reason: 'worker-exited', message: 'the worker could not be restarted' });
    spy.mockRestore();
  });

  it('refuses an unknown slot, and a live worker the card path will not restart (no direct respawn of a live seat)', async () => {
    await expect(restartSquadWorkerForOwner(deps({ getWorker: async () => undefined }), 'r1', 'nope')).resolves.toMatchObject({ ok: false, reason: 'not-found' });
    const d = deps({ getSession: () => ({ ...session, cohort: undefined }) as never });
    await expect(restartSquadWorkerForOwner(d, 'r1', 'slot1')).resolves.toMatchObject({ ok: false, reason: 'not-squad-worker' });
    expect(d.respawnSeat).not.toHaveBeenCalled();
  });

  it('passes through card refusals (finished run, closing run) with their message', async () => {
    const finished = deps({ getExecution: async () => ({ state: 'STOPPED', callerPrincipalId: 'u', teamLaunchRequestId: 'l1' }) });
    await expect(restartSquadWorkerForOwner(finished, 'r1', 'slot1')).resolves.toMatchObject({ ok: false, reason: 'run-finished' });
    const failing = deps({ restart: async () => ({ ok: false as const, reason: 'busy' as const }) });
    await expect(restartSquadWorkerForOwner(failing, 'r1', 'slot1')).resolves.toEqual({ ok: false, reason: 'busy', message: 'restart refused: busy' });
  });
});
