import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  createSquadWorkerRestarter,
  relaunchSquadWorker,
  squadWorkerAutonomous,
  squadWorkerDurableCoordination,
  type SquadWorkerRestartDeps
} from '../squad-worker-restart.js';

let root: string;
let worktree: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'swr-')));
  worktree = join(root, '.worktrees', 'squad');
  mkdirSync(worktree, { recursive: true });
});
afterEach(() => {
  vi.useRealTimers();
  rmSync(root, { recursive: true, force: true });
});

const cohort = { cohortId: 'c1', teamId: 't', teamName: 'T', role: 'worker' as const, executionId: 'e1', slotId: 's1' };
const session = (over: Partial<TerminalSession> = {}): TerminalSession => ({
  id: 'w1', projectId: 'p1', title: 'W', profile: 'claude', cwd: root, status: 'running', createdAt: 1,
  restoreCapabilityId: 'cap1', cohort, ...over
} as TerminalSession);

function makeDeps(over: Partial<SquadWorkerRestartDeps> = {}, sess: TerminalSession | null = session()) {
  const capability = { id: 'cap1', sessionId: 'w1', request: { projectId: 'p1', cohort }, followUpExecutionId: undefined };
  const deps = {
    getSession: vi.fn(() => sess ?? undefined),
    getProject: vi.fn(() => ({ path: root, remote: undefined })),
    getExecution: vi.fn(async () => ({ squadWorktree: { path: worktree, branch: 'zcc/x' }, coordinationMode: 'job-team' as const })),
    teamLaunchEnabled: vi.fn(() => false),
    restoreCapabilities: {
      reserve: vi.fn(() => ({ capability, reservationId: 'r1' })),
      consume: vi.fn(),
      release: vi.fn()
    },
    followUp: { claim: vi.fn(async () => {}), release: vi.fn(async () => {}), isClaimed: vi.fn(() => false) },
    restorePrincipal: vi.fn(() => ({ kind: 'team', id: 'restore:cap1' })),
    isTeamWorkerRestore: vi.fn(() => true),
    launchAuthorizedTerminal: vi.fn(async () => ({ ok: true as const, value: session() })),
    closeSession: vi.fn(async () => {}),
    onRelaunched: vi.fn(),
    ...over
  } as unknown as SquadWorkerRestartDeps & Record<string, any>;
  return deps;
}

describe('coordination helpers', () => {
  it('matches the team launch formulas', () => {
    expect(squadWorkerAutonomous('autonomous-team', false)).toBe(true);
    expect(squadWorkerAutonomous('freeform', true)).toBe(true);
    expect(squadWorkerAutonomous('freeform', false)).toBe(false);
    expect(squadWorkerAutonomous('job-team', true)).toBe(false);
    expect(squadWorkerDurableCoordination('job-team')).toBe(true);
    expect(squadWorkerDurableCoordination('structured')).toBe(true);
    expect(squadWorkerDurableCoordination('freeform')).toBe(true);
    expect(squadWorkerDurableCoordination('interactive-team')).toBe(false);
  });
});

describe('restart refusals', () => {
  const cases: Array<[string, Partial<TerminalSession> | undefined, string]> = [
    ['missing', undefined, 'not-found'],
    ['exited', { status: 'exited' }, 'not-found'],
    ['orchestrator', { cohort: { ...cohort, role: 'orchestrator' } }, 'not-a-worker'],
    ['no cohort', { cohort: undefined }, 'not-a-worker'],
    ['no slot', { cohort: { ...cohort, slotId: undefined } }, 'not-a-worker'],
    ['no execution', { cohort: { ...cohort, executionId: undefined } }, 'not-a-worker'],
    ['remote tmux', { remoteTmuxId: 'tm' }, 'remote'],
    ['workspace env', { workspaceEnvironmentId: 'env' }, 'remote'],
    ['sandbox env', { environment: 'sandbox' }, 'remote'],
    ['no capability', { restoreCapabilityId: undefined }, 'no-capability']
  ];
  it.each(cases)('refuses %s', async (_name, over, reason) => {
    const deps = makeDeps({}, over === undefined ? null : session(over));
    const restarter = createSquadWorkerRestarter(deps);
    expect(await restarter.restart('w1')).toMatchObject({ ok: false, reason });
    expect(deps.closeSession).not.toHaveBeenCalled();
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('refuses a remote project', async () => {
    const deps = makeDeps({ getProject: vi.fn(() => ({ path: root, remote: { host: 'h' } })) as never });
    expect(await createSquadWorkerRestarter(deps).restart('w1')).toMatchObject({ ok: false, reason: 'remote' });
  });
});

describe('restart flow', () => {
  it('reports busy for a second restart and times out without an exit', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ exitTimeoutMs: 50 });
    const restarter = createSquadWorkerRestarter(deps);
    const first = restarter.restart('w1');
    expect(restarter.isRestarting('w1')).toBe(true);
    expect(await restarter.restart('w1')).toMatchObject({ ok: false, reason: 'busy' });
    await vi.advanceTimersByTimeAsync(60);
    expect(await first).toMatchObject({ ok: false, reason: 'exit-timeout' });
    expect(restarter.isRestarting('w1')).toBe(false);
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('fails when closing the session throws', async () => {
    const deps = makeDeps({ closeSession: vi.fn(async () => { throw new Error('tmux gone'); }) });
    const restarter = createSquadWorkerRestarter(deps);
    expect(await restarter.restart('w1')).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'tmux gone' });
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('relaunches after the exit and never finalizes', async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    await vi.advanceTimersByTimeAsync(0);
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual({ ok: true });
    expect(finalize).not.toHaveBeenCalled();
    expect(deps.onRelaunched).toHaveBeenCalledWith(expect.objectContaining({ id: 'w1' }));
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('waits for the tmux kill to finish before relaunching', async () => {
    vi.useFakeTimers();
    let finishKill!: () => void;
    const deps = makeDeps({ closeSession: vi.fn(() => new Promise<void>((resolve) => { finishKill = resolve; })) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    await vi.advanceTimersByTimeAsync(0);
    // The PTY (tmux client) exits before kill-session has returned.
    restarter.onSessionExit('w1', vi.fn(async () => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    finishKill();
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual({ ok: true });
    expect(deps.launchAuthorizedTerminal).toHaveBeenCalledTimes(1);
  });

  it('never re-attaches to a session that is still running', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ sessionGone: vi.fn(async () => false) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    await vi.advanceTimersByTimeAsync(0);
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'the old session is still running' });
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('finalizes the exit when the relaunch fails', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ launchAuthorizedTerminal: vi.fn(async () => ({ ok: false as const, code: 'DENIED', message: 'nope' })) as never });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'DENIED: nope' });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(deps.onRelaunched).not.toHaveBeenCalled();
  });

  it('finalizes the exit when the relaunch throws, even if finalize rejects', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ launchAuthorizedTerminal: vi.fn(async () => { throw new Error('boom'); }) as never });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => { throw new Error('late'); });
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'boom' });
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('runs finalize at once for a normal exit', () => {
    const restarter = createSquadWorkerRestarter(makeDeps());
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('other', finalize);
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('dispose drops held finalizers and resolves pending restarts as failed', async () => {
    vi.useFakeTimers();
    const deps = makeDeps();
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    restarter.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed' });
    expect(finalize).not.toHaveBeenCalled();
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    expect(restarter.isRestarting('w1')).toBe(false);
  });
});

describe('restart failures release the held-back exit (CodeNod #509)', () => {
  it('runs the held-back exit once when closing the session fails after the exit arrived', async () => {
    vi.useFakeTimers();
    let failClose!: (error: Error) => void;
    const deps = makeDeps({ closeSession: vi.fn(() => new Promise<void>((_resolve, reject) => { failClose = reject; })) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    await vi.advanceTimersByTimeAsync(0);
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0); // the relaunch is waiting for the close
    failClose(new Error('kill failed'));
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'kill failed' });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('times out a restart whose tmux check never answers and runs the held-back exit', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ restartTimeoutMs: 500, sessionGone: vi.fn(() => new Promise<boolean>(() => {})) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(500);
    expect(await result).toMatchObject({ ok: false, reason: 'restart-timeout', message: 'the restart did not finish within 1 s' });
    expect(finalize).toHaveBeenCalledTimes(1);
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('times out a stalled relaunch, then closes the session if it arrives late', async () => {
    vi.useFakeTimers();
    let launched!: (value: unknown) => void;
    const deps = makeDeps({ restartTimeoutMs: 1_000, launchAuthorizedTerminal: vi.fn(() => new Promise((resolve) => { launched = resolve; })) as never });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.launchAuthorizedTerminal).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await result).toMatchObject({ ok: false, reason: 'restart-timeout' });
    expect(finalize).toHaveBeenCalledTimes(1);
    launched({ ok: true, value: session() });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onRelaunched).not.toHaveBeenCalled();
    expect(deps.closeSession).toHaveBeenCalledTimes(2);
    expect(deps.closeSession).toHaveBeenLastCalledWith('w1');
    expect(finalize).toHaveBeenCalledTimes(1);
  });

  it('does not relaunch once disposed, even when the tmux check answers afterwards', async () => {
    vi.useFakeTimers();
    let gone!: (value: boolean) => void;
    const deps = makeDeps({ sessionGone: vi.fn(() => new Promise<boolean>((resolve) => { gone = resolve; })) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(async () => {});
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.sessionGone).toHaveBeenCalledWith('w1');
    restarter.dispose();
    gone(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'disposed' });
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });

  it('leaves a relaunch that finishes after dispose to the shutdown path', async () => {
    vi.useFakeTimers();
    let launched!: (value: unknown) => void;
    const deps = makeDeps({ launchAuthorizedTerminal: vi.fn(() => new Promise((resolve) => { launched = resolve; })) as never });
    const restarter = createSquadWorkerRestarter(deps);
    void restarter.restart('w1');
    restarter.onSessionExit('w1', vi.fn(async () => {}));
    await vi.advanceTimersByTimeAsync(0);
    restarter.dispose();
    launched({ ok: true, value: session() });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onRelaunched).not.toHaveBeenCalled();
    expect(deps.closeSession).toHaveBeenCalledTimes(1);
  });
});

describe('restart edge cases from the independent review', () => {
  it('abandons the relaunch and runs the newer exit path when the relaunched process exits before the hand-over', async () => {
    vi.useFakeTimers();
    let launched!: (value: unknown) => void;
    const deps = makeDeps({ launchAuthorizedTerminal: vi.fn(() => new Promise((resolve) => { launched = resolve; })) as never });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const firstExit = vi.fn(async () => {});
    restarter.onSessionExit('w1', firstExit);
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.launchAuthorizedTerminal).toHaveBeenCalledTimes(1);
    const secondExit = vi.fn(async () => {});
    restarter.onSessionExit('w1', secondExit); // the relaunched process died while the launch waited
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'the relaunched session exited' });
    expect(secondExit).toHaveBeenCalledTimes(1);
    expect(firstExit).not.toHaveBeenCalled();
    launched({ ok: true, value: session() });
    await vi.advanceTimersByTimeAsync(0);
    expect(deps.onRelaunched).not.toHaveBeenCalled();
    expect(deps.launchAuthorizedTerminal).toHaveBeenCalledTimes(1);
    expect(deps.closeSession).toHaveBeenCalledTimes(2);
  });

  it('still settles the restart when onRelaunched throws', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ onRelaunched: vi.fn(() => { throw new Error('registry'); }) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    restarter.onSessionExit('w1', vi.fn(async () => {}));
    await vi.advanceTimersByTimeAsync(0);
    expect(await result).toEqual({ ok: true });
    expect(restarter.isRestarting('w1')).toBe(false);
  });

  it('settles a failed restart even when the held-back exit path never finishes', async () => {
    vi.useFakeTimers();
    const deps = makeDeps({ exitTimeoutMs: 200, sessionGone: vi.fn(async () => false) });
    const restarter = createSquadWorkerRestarter(deps);
    const result = restarter.restart('w1');
    const finalize = vi.fn(() => new Promise<void>(() => {}));
    restarter.onSessionExit('w1', finalize);
    await vi.advanceTimersByTimeAsync(0);
    expect(finalize).toHaveBeenCalledTimes(1);
    let settled = false;
    void result.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(199);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ ok: false, reason: 'relaunch-failed', message: 'the old session is still running' });
  });
});

describe('relaunchSquadWorker', () => {
  it('re-confines the worktree and launches with the team spawn options', async () => {
    const deps = makeDeps();
    const result = await relaunchSquadWorker(deps, session());
    expect(result.ok).toBe(true);
    expect(deps.getExecution).toHaveBeenCalledWith('p1', 'e1');
    expect(deps.launchAuthorizedTerminal).toHaveBeenCalledWith(
      { projectId: 'p1', cohort, worktreeInfo: { path: worktree, branch: 'zcc/x' } },
      { kind: 'team', id: 'restore:cap1' },
      {
        preallocatedSessionId: 'w1', retainWorktree: false,
        coordinationMode: 'job-team', autonomous: false, suppressPersonaInitialPrompt: true, tabNamerPrompt: null
      },
      't',
      undefined, undefined, undefined, undefined, true, undefined, undefined
    );
    expect(deps.restoreCapabilities.consume).toHaveBeenCalledWith('cap1', 'r1');
  });

  it('uses the cohort mode and team-launch setting for a freeform worker', async () => {
    const deps = makeDeps({
      getExecution: vi.fn(async () => undefined) as never,
      teamLaunchEnabled: vi.fn(() => true)
    });
    const sess = session({ cohort: { ...cohort, coordinationMode: 'freeform' } });
    await relaunchSquadWorker(deps, sess);
    expect(deps.launchAuthorizedTerminal.mock.calls[0][0]).toEqual({ projectId: 'p1', cohort });
    expect(deps.launchAuthorizedTerminal.mock.calls[0][2]).toMatchObject({ coordinationMode: 'freeform', autonomous: true, suppressPersonaInitialPrompt: true });
  });

  it('leaves the request unchanged when the execution has no squad worktree', async () => {
    const deps = makeDeps({ getExecution: vi.fn(async () => ({ coordinationMode: 'structured' })) as never });
    await relaunchSquadWorker(deps, session());
    expect(deps.launchAuthorizedTerminal.mock.calls[0][0]).toEqual({ projectId: 'p1', cohort });
  });

  it('refuses a worktree outside the retained base and never falls back to the project root', async () => {
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'swr-out-')));
    try {
      const deps = makeDeps({ getExecution: vi.fn(async () => ({ squadWorktree: { path: outside, branch: 'b' } })) as never });
      expect(await relaunchSquadWorker(deps, session())).toMatchObject({ ok: false, code: 'WORKTREE_UNAVAILABLE' });
      expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
      expect(deps.restoreCapabilities.release).toHaveBeenCalledWith('cap1', 'r1');
    } finally { rmSync(outside, { recursive: true, force: true }); }
  });

  it.each([
    ['missing worktree path', { getExecution: vi.fn(async () => ({ squadWorktree: { path: join(root, '.worktrees', 'gone'), branch: 'b' } })) }],
    ['execution lookup failure', { getExecution: vi.fn(async () => { throw new Error('db'); }) }],
    ['unknown project', { getProject: vi.fn(() => undefined) }],
    ['remote project', { getProject: vi.fn(() => ({ path: root, remote: { host: 'h' } })) }]
  ])('reports WORKTREE_UNAVAILABLE for %s', async (_name, over) => {
    const deps = makeDeps(over as never);
    expect(await relaunchSquadWorker(deps, session())).toMatchObject({ ok: false, code: 'WORKTREE_UNAVAILABLE' });
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
  });

  it('is DENIED when the capability cannot be reserved or is missing', async () => {
    const deps = makeDeps({ restoreCapabilities: { reserve: vi.fn(() => undefined), consume: vi.fn(), release: vi.fn() } as never });
    expect(await relaunchSquadWorker(deps, session())).toMatchObject({ ok: false, code: 'DENIED' });
    expect(await relaunchSquadWorker(deps, session({ restoreCapabilityId: undefined }))).toMatchObject({ ok: false, code: 'DENIED' });
    expect(deps.launchAuthorizedTerminal).not.toHaveBeenCalled();
  });

  it('skips the execution lookup for a session without an execution', async () => {
    const deps = makeDeps();
    await relaunchSquadWorker(deps, session({ cohort: undefined }));
    expect(deps.getExecution).not.toHaveBeenCalled();
    expect(deps.launchAuthorizedTerminal.mock.calls[0][2]).toMatchObject({ coordinationMode: 'interactive-team', autonomous: false, suppressPersonaInitialPrompt: false });
  });
});
