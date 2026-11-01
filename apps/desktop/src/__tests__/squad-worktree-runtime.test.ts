import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SQUAD_WORKTREE_ACTION,
  createSquadWorktreeRuntime,
  isWithinSquadWorktreeBase,
  squadWorktreeBaseRoot,
  squadWorktreeSlug,
  trustedSquadWorktreeRoot
} from '../squad-worktree-runtime.js';
import { InboxActionOperatorError } from '../inbox-actions/registry.js';
import { claimSquadWorktreeFollowUp, releaseSquadWorktreeFollowUp } from '../squad-worktree-lifecycle.js';

const ROOT = '/p';
const WT = '/p/.worktrees/w';
let seq = 0;
const claimed: Array<[string, string]> = [];

afterEach(() => {
  for (const [e, s] of claimed.splice(0)) releaseSquadWorktreeFollowUp(e, s);
});

function claim(executionId: string) {
  claimSquadWorktreeFollowUp(executionId, 's1');
  claimed.push([executionId, 's1']);
}

function rec(over: Record<string, unknown> = {}): any {
  return {
    id: `exec-${++seq}`,
    projectId: 'proj',
    teamId: 'team',
    state: 'COMPLETED',
    stateVersion: 3,
    jobTitle: 'Job',
    callerPrincipalId: 'caller',
    teamLaunchRequestId: 'launch',
    request: {},
    squadWorktree: { path: WT, branch: 'zcc/w', baseBranch: 'main' },
    ...over
  };
}

const okCancel = { ok: true, value: { lifecycleState: 'canceled', pendingSessionIds: [] } };

function setup(over: { realpath?: (p: string) => string; exists?: boolean; project?: any; team?: any; personas?: any[]; settings?: any; config?: any } = {}) {
  const project = over.project === undefined ? { id: 'proj', name: 'Proj', path: ROOT } : over.project;
  const team = over.team === undefined ? { id: 'team', orchestratorPersonaId: 'per' } : over.team;
  const deps: any = {
    executionStore: {
      get: vi.fn(),
      getInProject: vi.fn(),
      setSquadWorktree: vi.fn(async (_id: string, _v: number, w: any) => ({ id: 'set', squadWorktree: w })),
      markSquadWorktreeTerminalEffects: vi.fn(async () => undefined),
      disposeSquadWorktree: vi.fn(async () => undefined),
      listUndisposedSquadWorktrees: vi.fn(async () => [])
    },
    inboxStore: {
      append: vi.fn(async () => ({ id: 'e1' })),
      appendOnce: vi.fn(async () => ({ id: 'e2' }))
    },
    inboxActionRegistry: { bind: vi.fn(), markUnavailable: vi.fn() },
    projects: { listProjects: () => (project ? [project] : []) },
    teams: { list: () => (team ? [team] : []) },
    personas: { list: () => over.personas ?? [{ id: 'per' }] },
    config: { getConfig: () => over.config ?? {} },
    getProjectSettings: vi.fn(async () => over.settings ?? {}),
    resolveTeamProfile: vi.fn(() => 'codex'),
    cancelTeamLaunch: vi.fn(async () => okCancel),
    launchFollowUpTerminal: vi.fn(async () => ({ ok: true, value: { id: 'sess' } })),
    git: {
      getGitStatus: vi.fn(async () => ({ branch: 'zcc/w' })),
      setWorktreePushProtection: vi.fn(async () => ({ ok: true })),
      createWorktree: vi.fn(async (_r: string, target: string, branch: string) => ({ ok: true, path: target, branch })),
      mergeWorktree: vi.fn(async () => ({ ok: true })),
      removeWorktree: vi.fn(async () => ({ ok: true })),
      worktreeState: vi.fn(async () => ({ dirty: false, commits: 0 })),
      isGitRepo: vi.fn(async () => true),
      sanitizeBranchSlug: vi.fn((v: string) => v)
    },
    fs: {
      existsSync: vi.fn(() => over.exists ?? true),
      realpathSync: over.realpath ?? ((p: string) => p)
    }
  };
  const runtime = createSquadWorktreeRuntime(deps);
  return { deps, runtime };
}

/** Make store.get always return the given record. */
function serve(deps: any, record: any) {
  deps.executionStore.get.mockImplementation(async () => record);
  deps.executionStore.getInProject.mockImplementation(async () => record);
}

describe('path helpers', () => {
  const real = (p: string) => p;
  const missing = () => { throw new Error('ENOENT'); };

  it('squadWorktreeBaseRoot returns realpath or undefined', () => {
    expect(squadWorktreeBaseRoot('/p', real)).toBe('/p/.worktrees');
    expect(squadWorktreeBaseRoot('/p', missing)).toBeUndefined();
    expect(typeof squadWorktreeBaseRoot('/definitely/not/here')).toBe('undefined');
  });

  it('isWithinSquadWorktreeBase and trustedSquadWorktreeRoot gate on base presence and containment', () => {
    expect(isWithinSquadWorktreeBase('/p/.worktrees/a', '/p', real)).toBe(true);
    expect(isWithinSquadWorktreeBase('/p/other', '/p', real)).toBe(false);
    expect(isWithinSquadWorktreeBase('/p/.worktrees/a', '/p', missing)).toBe(false);
    expect(trustedSquadWorktreeRoot('/p/.worktrees/a', '/p', real)).toBe('/p/.worktrees');
    expect(trustedSquadWorktreeRoot('/elsewhere', '/p', real)).toBeNull();
    expect(trustedSquadWorktreeRoot('/p/.worktrees/a', '/p', missing)).toBeNull();
  });

  it('squadWorktreeSlug uses sanitized slug or falls back', () => {
    expect(squadWorktreeSlug('t', 'e', (v) => `s-${v}`)).toBe('s-t-e');
    expect(squadWorktreeSlug('t', 'a/b c', () => null)).toBe('squad-a_b_c');
    expect(squadWorktreeSlug('t', 'x', () => undefined)).toBe('squad-x');
  });
});

describe('prepareSquadWorktree', () => {
  it('returns initial when execution vanished, current when version moved', async () => {
    const { deps, runtime } = setup();
    const initial = rec({ squadWorktree: undefined });
    deps.executionStore.get.mockResolvedValueOnce(undefined);
    expect(await runtime.prepareSquadWorktree(initial, {})).toBe(initial);
    const moved = { ...initial, stateVersion: 9 };
    deps.executionStore.get.mockResolvedValueOnce(moved);
    expect(await runtime.prepareSquadWorktree(initial, {})).toBe(moved);
  });

  it('stays in project root when isolation is off or project/team missing', async () => {
    const r = rec({ squadWorktree: undefined });
    let s = setup();
    serve(s.deps, r);
    expect(await s.runtime.prepareSquadWorktree(r, {})).toBe(r);
    expect(s.deps.git.createWorktree).not.toHaveBeenCalled();

    s = setup({ project: null });
    serve(s.deps, r);
    expect(await s.runtime.prepareSquadWorktree(r, { worktree: true })).toBe(r);

    s = setup({ team: null });
    serve(s.deps, r);
    expect(await s.runtime.prepareSquadWorktree(r, { worktree: true })).toBe(r);
  });

  it('reattaches a retained worktree and re-enables push protection', async () => {
    const r = rec();
    const { deps, runtime } = setup();
    serve(deps, r);
    expect(await runtime.prepareSquadWorktree(r, {})).toBe(r);
    expect(deps.git.setWorktreePushProtection).toHaveBeenCalledWith(ROOT, WT, true);
  });

  it.each([
    ['project missing', () => setup({ project: null }), (r: any) => r],
    ['realpath differs', () => setup({ realpath: (p) => (p === WT ? '/p/.worktrees/other' : p) }), (r: any) => r],
    ['outside base', () => setup(), (r: any) => ({ ...r, squadWorktree: { ...r.squadWorktree, path: '/p/elsewhere' } })],
    ['branch mismatch', () => { const s = setup(); s.deps.git.getGitStatus.mockResolvedValue({ branch: 'x' }); return s; }, (r: any) => r],
    ['status missing', () => { const s = setup(); s.deps.git.getGitStatus.mockResolvedValue(undefined); return s; }, (r: any) => r],
    ['protection fails', () => { const s = setup(); s.deps.git.setWorktreePushProtection.mockResolvedValue({ ok: false }); return s; }, (r: any) => r]
  ])('reattach fails when %s', async (_n, mk, tweak) => {
    const base = rec();
    const r = tweak(base);
    const { deps, runtime } = mk();
    serve(deps, r);
    await expect(runtime.prepareSquadWorktree(r, {})).rejects.toThrow('WORKTREE_UNAVAILABLE');
  });

  it('reattach fails when durable record changed mid-flight', async () => {
    const r = rec();
    for (const latest of [undefined, { ...r, stateVersion: 99 }, { ...r, squadWorktree: undefined }, { ...r, squadWorktree: { ...r.squadWorktree, path: '/x' } }, { ...r, squadWorktree: { ...r.squadWorktree, branch: 'other' } }]) {
      const { deps, runtime } = setup();
      deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValue(latest);
      await expect(runtime.prepareSquadWorktree(r, {})).rejects.toThrow('WORKTREE_UNAVAILABLE');
    }
  });

  it('creates a worktree using config/team/project policy and persists it', async () => {
    const r = rec({ squadWorktree: undefined });
    const { deps, runtime } = setup({ config: { worktreeIsolationDefault: true } });
    // get: initial, beforeCreate, latest
    serve(deps, r);
    deps.git.getGitStatus.mockResolvedValue({ branch: 'main' });
    const out: any = await runtime.prepareSquadWorktree(r, {});
    expect(deps.git.createWorktree).toHaveBeenCalledWith(ROOT, `${ROOT}/.worktrees/team-${r.id}`, `zcc/team-${r.id}`, `${ROOT}/.worktrees`, true);
    expect(out.squadWorktree).toEqual({ path: `${ROOT}/.worktrees/team-${r.id}`, branch: `zcc/team-${r.id}`, baseBranch: 'main' });
  });

  it('create: ineligible project falls back with a deduped notice', async () => {
    const r = rec({ squadWorktree: undefined });
    const { deps, runtime } = setup();
    deps.git.isGitRepo.mockResolvedValue(false);
    serve(deps, r);
    expect(await runtime.prepareSquadWorktree(r, { worktree: true })).toBe(r);
    expect(deps.inboxStore.appendOnce).toHaveBeenCalledWith(expect.objectContaining({ dedupeKey: `squad-worktree-fallback:${r.id}`, executionId: r.id }));
    expect(deps.git.createWorktree).not.toHaveBeenCalled();
  });

  it('create: stale or concurrently-changed state before createWorktree short-circuits', async () => {
    const r = rec({ squadWorktree: undefined });
    let s = setup();
    s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(undefined);
    expect(await s.runtime.prepareSquadWorktree(r, { worktree: true })).toBe(r);

    s = setup();
    const moved = { ...r, stateVersion: 8 };
    s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(moved);
    expect(await s.runtime.prepareSquadWorktree(r, { worktree: true })).toBe(moved);

    s = setup();
    const other = { ...r, squadWorktree: { path: '/p/.worktrees/q', branch: 'other', baseBranch: 'main' } };
    s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(other);
    expect(await s.runtime.prepareSquadWorktree(r, { worktree: true })).toBe(other);
    expect(s.deps.git.createWorktree).not.toHaveBeenCalled();
  });

  it('create: createWorktree failure posts unavailable notice and uses project root', async () => {
    const r = rec({ squadWorktree: undefined });
    const { deps, runtime } = setup();
    serve(deps, r);
    deps.git.createWorktree.mockResolvedValue({ ok: false, reason: 'boom' });
    expect(await runtime.prepareSquadWorktree(r, { worktree: true })).toBe(r);
    expect(deps.inboxStore.appendOnce).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad worktree unavailable' }));
  });

  it('create: rejects escaped paths and missing base branch', async () => {
    const r = rec({ squadWorktree: undefined });
    let s = setup();
    serve(s.deps, r);
    s.deps.git.createWorktree.mockResolvedValue({ ok: true, path: '/evil', branch: 'b' });
    await expect(s.runtime.prepareSquadWorktree(r, { worktree: true })).rejects.toThrow('escaped');

    s = setup();
    serve(s.deps, r);
    s.deps.git.getGitStatus.mockResolvedValue(undefined);
    await expect(s.runtime.prepareSquadWorktree(r, { worktree: true })).rejects.toThrow('base branch is unavailable');
  });

  it('create: does not persist when state moved or a worktree was recorded meanwhile', async () => {
    const r = rec({ squadWorktree: undefined });
    for (const latest of [undefined, { ...r, stateVersion: 8 }, { ...r, squadWorktree: { path: WT, branch: 'b', baseBranch: 'm' } }]) {
      const { deps, runtime } = setup();
      deps.git.getGitStatus.mockResolvedValue({ branch: 'main' });
      deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(r).mockResolvedValueOnce(latest);
      const out = await runtime.prepareSquadWorktree(r, { worktree: true });
      expect(out).toBe(latest ?? r);
      expect(deps.executionStore.setSquadWorktree).not.toHaveBeenCalled();
    }
  });

  it('create: sanitize fallback slug is used for branch', async () => {
    const r = rec({ squadWorktree: undefined, id: 'weird id!' });
    const { deps, runtime } = setup();
    serve(deps, r);
    deps.git.sanitizeBranchSlug.mockReturnValue(null);
    deps.git.getGitStatus.mockResolvedValue({ branch: 'main' });
    await runtime.prepareSquadWorktree(r, { worktree: true });
    expect(deps.git.createWorktree).toHaveBeenCalledWith(ROOT, `${ROOT}/.worktrees/squad-weird_id_`, 'zcc/squad-weird_id_', expect.any(String), true);
  });
});

describe('handleSquadWorktreeTerminal', () => {
  it('ignores stale, non-terminal, and already-processed records', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    deps.executionStore.get.mockResolvedValueOnce(undefined);
    await runtime.handleSquadWorktreeTerminal(r);
    deps.executionStore.get.mockResolvedValueOnce({ ...r, stateVersion: 4 });
    await runtime.handleSquadWorktreeTerminal(r);
    deps.executionStore.get.mockResolvedValueOnce({ ...r, squadWorktree: undefined });
    await runtime.handleSquadWorktreeTerminal(r);
    deps.executionStore.get.mockResolvedValueOnce({ ...r, state: 'RUNNING' });
    await runtime.handleSquadWorktreeTerminal(r);
    const done = rec({ terminalWorktreeEffectsStateVersion: 3 });
    serve(deps, done);
    await runtime.handleSquadWorktreeTerminal(done);
    expect(deps.cancelTeamLaunch).not.toHaveBeenCalled();
  });

  it('does nothing while a follow-up agent owns the worktree', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    claim(r.id);
    await runtime.handleSquadWorktreeTerminal(r);
    expect(deps.cancelTeamLaunch).not.toHaveBeenCalled();
  });

  it('keeps guard when cohort teardown is unconfirmed', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    deps.cancelTeamLaunch.mockResolvedValue({ ok: true, value: { lifecycleState: 'canceling', pendingSessionIds: ['x'] } });
    // Nothing applied yet: no outcome, so a report-back waits for the call that applies it.
    await expect(runtime.handleSquadWorktreeTerminal(r)).resolves.toBeUndefined();
    expect(deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
    expect(deps.executionStore.markSquadWorktreeTerminalEffects).not.toHaveBeenCalled();
  });

  it('stops when state changes during teardown or worktree record disappears', async () => {
    const r = rec();
    const { deps, runtime } = setup();
    deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(undefined);
    await runtime.handleSquadWorktreeTerminal(r);
    expect(deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
  });

  it('marks effects done without git work when checkout is already gone', async () => {
    const { deps, runtime } = setup({ exists: false });
    const r = rec();
    serve(deps, r);
    await expect(runtime.handleSquadWorktreeTerminal(r)).resolves.toBe('missing');
    expect(deps.executionStore.markSquadWorktreeTerminalEffects).toHaveBeenCalledWith(r.id, 3);
    expect(deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
  });

  it('throws when push guard cannot be disabled', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    deps.git.setWorktreePushProtection.mockResolvedValue({ ok: false, reason: 'locked' });
    await expect(runtime.handleSquadWorktreeTerminal(r)).rejects.toThrow('could not disable squad worktree push guard: locked');
  });

  it('retains with a notice by default (leave) and for FAILED merge requests', async () => {
    for (const over of [{}, { request: { onComplete: 'merge' }, state: 'FAILED' }]) {
      const { deps, runtime } = setup();
      const r = rec(over);
      serve(deps, r);
      await expect(runtime.handleSquadWorktreeTerminal(r)).resolves.toBe('kept');
      expect(deps.git.mergeWorktree).not.toHaveBeenCalled();
      expect(deps.inboxStore.appendOnce).toHaveBeenCalledWith(expect.objectContaining({ subject: 'Squad worktree retained' }));
      expect(deps.executionStore.markSquadWorktreeTerminalEffects).toHaveBeenCalledWith(r.id, 3);
    }
  });

  it('merges and removes on COMPLETED + merge, without a retained notice', async () => {
    const { deps, runtime } = setup();
    const r = rec({ request: { onComplete: 'merge' } });
    serve(deps, r);
    await expect(runtime.handleSquadWorktreeTerminal(r)).resolves.toBe('merged');
    expect(deps.git.mergeWorktree).toHaveBeenCalledWith(ROOT, WT, 'main');
    expect(deps.git.removeWorktree).toHaveBeenCalledWith(ROOT, WT, false);
    expect(deps.inboxStore.appendOnce).not.toHaveBeenCalled();
    expect(deps.executionStore.markSquadWorktreeTerminalEffects).toHaveBeenCalledTimes(1);
  });

  it('falls back to retained notice when merge or remove fails', async () => {
    let s = setup();
    const r = rec({ request: { onComplete: 'merge' } });
    serve(s.deps, r);
    s.deps.git.mergeWorktree.mockResolvedValue({ ok: false });
    // A failed merge keeps the worktree, and says so.
    await expect(s.runtime.handleSquadWorktreeTerminal(r)).resolves.toBe('kept');
    expect(s.deps.git.removeWorktree).not.toHaveBeenCalled();
    expect(s.deps.inboxStore.appendOnce).toHaveBeenCalled();

    s = setup();
    serve(s.deps, r);
    s.deps.git.removeWorktree.mockResolvedValue({ ok: false });
    await s.runtime.handleSquadWorktreeTerminal(r);
    expect(s.deps.inboxStore.appendOnce).toHaveBeenCalled();
  });

  it('merge path: no baseBranch or no project retains; state loss aborts', async () => {
    const noBase = rec({ request: { onComplete: 'merge' }, squadWorktree: { path: WT, branch: 'zcc/w' } });
    let s = setup();
    serve(s.deps, noBase);
    await s.runtime.handleSquadWorktreeTerminal(noBase);
    expect(s.deps.git.mergeWorktree).not.toHaveBeenCalled();
    expect(s.deps.inboxStore.appendOnce).toHaveBeenCalled();

    const r = rec({ request: { onComplete: 'merge' } });
    s = setup({ project: null });
    serve(s.deps, r);
    await s.runtime.handleSquadWorktreeTerminal(r);
    expect(s.deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
    expect(s.deps.inboxStore.appendOnce).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'proj' }));

    // beforeMerge disappears -> retained notice (no merge)
    s = setup();
    s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(r).mockResolvedValueOnce(undefined);
    await s.runtime.handleSquadWorktreeTerminal(r);
    expect(s.deps.git.mergeWorktree).not.toHaveBeenCalled();
    expect(s.deps.inboxStore.appendOnce).toHaveBeenCalled();
  });

  it('merge path: follow-up claimed before merge aborts; state loss after merge aborts', async () => {
    const r = rec({ request: { onComplete: 'merge' } });
    let s = setup();
    serve(s.deps, r);
    // Claim appears once cancelTeamLaunch has run (after the initial check).
    s.deps.cancelTeamLaunch.mockImplementation(async () => { claim(r.id); return okCancel; });
    await s.runtime.handleSquadWorktreeTerminal(r);
    expect(s.deps.git.mergeWorktree).not.toHaveBeenCalled();
    releaseSquadWorktreeFollowUp(r.id, 's1');

    const r2 = rec({ request: { onComplete: 'merge' } });
    s = setup();
    // get: first, latest, beforeMerge, beforeRemove(undefined)
    s.deps.executionStore.get
      .mockResolvedValueOnce(r2).mockResolvedValueOnce(r2).mockResolvedValueOnce(r2).mockResolvedValueOnce(undefined);
    await s.runtime.handleSquadWorktreeTerminal(r2);
    expect(s.deps.git.mergeWorktree).toHaveBeenCalled();
    expect(s.deps.git.removeWorktree).not.toHaveBeenCalled();
    expect(s.deps.executionStore.markSquadWorktreeTerminalEffects).not.toHaveBeenCalled();
  });
});

describe('replayUndisposedTerminalEffects', () => {
  it('handles only records eligible for replay', async () => {
    const { deps, runtime } = setup();
    const eligible = rec();
    const done = rec({ terminalWorktreeEffectsStateVersion: 3 });
    const running = rec({ state: 'RUNNING' });
    deps.executionStore.listUndisposedSquadWorktrees.mockResolvedValue([done, running, eligible]);
    serve(deps, eligible);
    await runtime.replayUndisposedTerminalEffects();
    expect(deps.cancelTeamLaunch).toHaveBeenCalledTimes(1);
    expect(deps.executionStore.markSquadWorktreeTerminalEffects).toHaveBeenCalledWith(eligible.id, 3);
  });
});

describe('inbox / details actions', () => {
  const action = (r: any, phase: string) => JSON.stringify({ executionId: r.id, phase, stateVersion: r.stateVersion });

  it('rejects malformed refs', async () => {
    const { runtime } = setup();
    await expect(runtime.handleInboxAction({ ref: 'not json' })).rejects.toThrow('invalid squad worktree action');
    await expect(runtime.handleInboxAction({ ref: JSON.stringify({ phase: 'choose', stateVersion: 1 }) })).rejects.toThrow('invalid');
    await expect(runtime.handleInboxAction({ ref: JSON.stringify({ executionId: 'e', phase: 'choose', stateVersion: 1.5 }) })).rejects.toThrow('invalid');
  });

  it('treats stale or missing records as operator-visible unavailability', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    deps.executionStore.get.mockResolvedValue(undefined);
    await expect(runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'leave' } }))
      .rejects.toBeInstanceOf(InboxActionOperatorError);
    deps.executionStore.get.mockResolvedValue({ ...r, stateVersion: 9 });
    await expect(runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'leave' } })).rejects.toThrow('resumed or changed state');
    deps.executionStore.get.mockResolvedValue({ ...r, dismissedAt: 1 });
    await expect(runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'leave' } })).rejects.toThrow('unavailable');
  });

  it('leave disposes the worktree as left', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    await runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'leave' } });
    expect(deps.executionStore.disposeSquadWorktree).toHaveBeenCalledWith(r.id, 3, 'left');
  });

  it('rejects unknown option, missing project', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    await expect(runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'bogus' }))
      .rejects.toThrow('unknown squad worktree action');
    await expect(runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 })).rejects.toThrow('unknown');

    const s = setup({ project: null });
    serve(s.deps, r);
    await expect(s.runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'delete' }))
      .rejects.toThrow('project is unavailable');
  });

  describe('delete confirm step', () => {
    it('appends a fresh confirmation and keeps the entry pending', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      const out = await runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'delete' });
      expect(out).toEqual({ keepPending: true });
      expect(deps.inboxStore.append).toHaveBeenCalledWith(expect.objectContaining({ hostActionRequired: true, executionId: r.id }));
      expect(deps.inboxActionRegistry.bind).toHaveBeenCalledWith(
        { id: 'e1' },
        { kind: SQUAD_WORKTREE_ACTION, ref: JSON.stringify({ executionId: r.id, phase: 'confirm', stateVersion: 3 }) }
      );
    });

    it('is refused while a follow-up is active', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      claim(r.id);
      await expect(runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'delete' }))
        .rejects.toThrow('active follow-up');
    });
  });

  describe('delete / force', () => {
    const run = (runtime: any, r: any, optionId: string) =>
      runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'confirm', stateVersion: 3 }, { optionId });

    it('deletes a clean worktree and invalidates both inbox actions', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      await run(runtime, r, 'confirm-delete');
      expect(deps.git.removeWorktree).toHaveBeenCalledWith(ROOT, WT, false);
      expect(deps.executionStore.disposeSquadWorktree).toHaveBeenCalledWith(r.id, 3, 'deleted');
      expect(deps.inboxActionRegistry.markUnavailable).toHaveBeenCalledTimes(2);
    });

    it('refuses dirty or unmerged unless forced', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      deps.git.worktreeState.mockResolvedValue({ dirty: true, commits: 0 });
      await expect(run(runtime, r, 'confirm-delete')).rejects.toThrow('uncommitted changes');
      deps.git.worktreeState.mockResolvedValue({ dirty: false, commits: 2 });
      await expect(run(runtime, r, 'confirm-delete')).rejects.toThrow('unmerged commits');
      expect(deps.git.removeWorktree).not.toHaveBeenCalled();
      await run(runtime, r, 'force-delete');
      expect(deps.git.removeWorktree).toHaveBeenCalledWith(ROOT, WT, true);
    });

    it('refuses while follow-up active', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      claim(r.id);
      await expect(run(runtime, r, 'confirm-delete')).rejects.toThrow('active follow-up');
    });

    it('reports confirmation unavailable when worktree vanished before or after checks', async () => {
      let s = setup({ realpath: (p) => { if (p === WT) throw new Error('ENOENT'); return p; } });
      const r = rec();
      serve(s.deps, r);
      await expect(run(s.runtime, r, 'confirm-delete')).rejects.toThrow('confirmation is unavailable');

      // Second recheck fails: record changes after worktreeState.
      s = setup();
      s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce(r).mockResolvedValue(undefined);
      await expect(run(s.runtime, r, 'confirm-delete')).rejects.toBeInstanceOf(InboxActionOperatorError);
      expect(s.deps.git.removeWorktree).not.toHaveBeenCalled();
    });

    it('surfaces removeWorktree failure with and without message and does not dispose', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      deps.git.removeWorktree.mockResolvedValue({ ok: false, message: 'busy' });
      await expect(run(runtime, r, 'confirm-delete')).rejects.toThrow('busy');
      deps.git.removeWorktree.mockResolvedValue({ ok: false });
      await expect(run(runtime, r, 'confirm-delete')).rejects.toThrow('could not delete squad worktree');
      expect(deps.executionStore.disposeSquadWorktree).not.toHaveBeenCalled();
    });
  });

  describe('instruct', () => {
    const run = (runtime: any, r: any, text?: string) =>
      runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'instruct', text });

    it('launches follow-up with persona profile and wires lifecycle callbacks', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      await run(runtime, r, '  do more  ');
      const [request, lifecycle, execId] = deps.launchFollowUpTerminal.mock.calls[0];
      expect(execId).toBe(r.id);
      expect(request).toMatchObject({ projectId: 'proj', profile: 'codex', personaId: 'per', title: 'Follow-up: Job', worktreeInfo: { path: WT, branch: 'zcc/w' } });
      expect(request.prompt).toContain('do more');
      expect(await lifecycle.maySpawn()).toBe(true);
      expect(await lifecycle.claimRunning()).toBe(true);
      const spawn = vi.fn(async () => 'spawned');
      expect(await lifecycle.withSpawnLock(spawn)).toBe('spawned');
      lifecycle.onSessionCreated({ id: 'sess-1' });
      claimed.push([r.id, 'sess-1']);
      // Active claim now blocks further spawns.
      await expect(lifecycle.withSpawnLock(spawn)).rejects.toThrow('active follow-up');
      await expect(run(runtime, r, 'again')).rejects.toThrow('active follow-up');
    });

    it('defaults to claude with no persona', async () => {
      const { deps, runtime } = setup({ team: { id: 'team' } });
      const r = rec();
      serve(deps, r);
      await run(runtime, r, 'go');
      expect(deps.launchFollowUpTerminal.mock.calls[0][0].profile).toBe('claude');
      expect(deps.launchFollowUpTerminal.mock.calls[0][0].personaId).toBeUndefined();
      expect(deps.resolveTeamProfile).not.toHaveBeenCalled();
    });

    it('requires non-empty instruction', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      await expect(run(runtime, r, '   ')).rejects.toThrow('agent instruction is required');
      await expect(run(runtime, r, undefined)).rejects.toThrow('agent instruction is required');
    });

    it.each([
      ['project missing', () => setup({ project: null })],
      ['remote project', () => setup({ project: { id: 'proj', name: 'P', path: ROOT, remote: {} } })],
      ['quick agent', () => setup({ project: { id: 'proj', name: 'P', path: ROOT, quickAgent: true } })],
      ['project path changed', () => setup({ realpath: (p) => (p === ROOT ? '/real' : p) })],
      ['worktree realpath throws', () => setup({ realpath: (p) => { if (p === WT) throw new Error('x'); return p; } })],
      ['worktree path resolves elsewhere', () => setup({ realpath: (p) => (p === WT ? '/p/.worktrees/z' : p) })],
      ['git branch mismatch', () => { const s = setup(); s.deps.git.getGitStatus.mockResolvedValue({ branch: 'nope' }); return s; }],
      ['git status missing', () => { const s = setup(); s.deps.git.getGitStatus.mockResolvedValue(undefined); return s; }]
    ])('maps retained-worktree failure (%s) to operator error', async (_n, mk) => {
      const { deps, runtime } = mk();
      const r = rec();
      serve(deps, r);
      await expect(run(runtime, r, 'x')).rejects.toBeInstanceOf(InboxActionOperatorError);
      expect(deps.launchFollowUpTerminal).not.toHaveBeenCalled();
    });

    it('surfaces launch failure message', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      deps.launchFollowUpTerminal.mockResolvedValue({ ok: false, message: 'no spawn' });
      await expect(run(runtime, r, 'x')).rejects.toThrow('no spawn');
    });

    it('spawn guards return false / throw once state moves or worktree disappears', async () => {
      const { deps, runtime } = setup();
      const r = rec();
      serve(deps, r);
      await run(runtime, r, 'x');
      const lifecycle = deps.launchFollowUpTerminal.mock.calls[0][1];

      deps.executionStore.get.mockResolvedValue({ ...r, stateVersion: 99 });
      expect(await lifecycle.maySpawn()).toBe(false);
      expect(await lifecycle.claimRunning()).toBe(false);
      await expect(lifecycle.withSpawnLock(async () => 'x')).rejects.toBeInstanceOf(InboxActionOperatorError);

      // Record is current but the worktree is gone.
      serve(deps, r);
      deps.git.getGitStatus.mockResolvedValue(undefined);
      expect(await lifecycle.maySpawn()).toBe(false);
      await expect(lifecycle.withSpawnLock(async () => 'x')).rejects.toThrow('Retained Squad worktree or branch is unavailable.');
    });
  });
});

describe('squadWorktreeAction (Squad details IPC)', () => {
  it('returns CONFLICT for missing or stale records', async () => {
    const { deps, runtime } = setup();
    deps.executionStore.getInProject.mockResolvedValueOnce(undefined);
    expect(await runtime.squadWorktreeAction('proj', 'e', 3, 'leave')).toMatchObject({ ok: false, code: 'CONFLICT' });
    deps.executionStore.getInProject.mockResolvedValueOnce(rec({ stateVersion: 4 }));
    expect(await runtime.squadWorktreeAction('proj', 'e', 3, 'leave')).toMatchObject({ ok: false, code: 'CONFLICT' });
  });

  it('runs leave / instruct / delete / force-delete mappings', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'leave')).toEqual({ ok: true, value: true });
    expect(deps.executionStore.disposeSquadWorktree).toHaveBeenCalledWith(r.id, 3, 'left');
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', 'do it')).toEqual({ ok: true, value: true });
    expect(deps.launchFollowUpTerminal).toHaveBeenCalled();
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'delete')).toEqual({ ok: true, value: true });
    expect(deps.git.removeWorktree).toHaveBeenCalledWith(ROOT, WT, false);
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'force-delete')).toEqual({ ok: true, value: true });
    expect(deps.git.removeWorktree).toHaveBeenLastCalledWith(ROOT, WT, true);
  });

  it('maps operator errors to CONFLICT, other errors to UNAVAILABLE, non-Error to default message', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    claim(r.id);
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', 'x')).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct')).toMatchObject({ ok: false, code: 'CONFLICT' });
    releaseSquadWorktreeFollowUp(r.id, 's1');
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', '')).toMatchObject({ ok: false, code: 'UNAVAILABLE', message: 'agent instruction is required' });
    deps.executionStore.getInProject.mockRejectedValue('weird');
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'leave')).toEqual({ ok: false, code: 'UNAVAILABLE', message: 'squad worktree action failed' });
  });
});

/**
 * squad-bugs: retained follow-up success / denial / race. A fake launcher honors
 * the lifecycle contract exactly as `launchAuthorizedTerminal` does (maySpawn,
 * claimRunning, withSpawnLock, onSessionCreated) and counts real spawns.
 */
describe('retained follow-up lifecycle (squad-bugs)', () => {
  const run = (runtime: any, r: any, text = 'go') =>
    runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'instruct', text });

  function honoringLauncher(deps: any, onBeforeSpawn?: () => Promise<void> | void) {
    const spawns: string[] = [];
    deps.launchFollowUpTerminal.mockImplementation(async (_request: any, lifecycle: any) => {
      if (!(await lifecycle.maySpawn())) return { ok: false, message: 'cancelled before spawn' };
      if (!(await lifecycle.claimRunning())) return { ok: false, message: 'cancelled before claim' };
      await onBeforeSpawn?.();
      return lifecycle.withSpawnLock(async () => {
        const session = { id: `sess-${spawns.length + 1}` };
        spawns.push(session.id);
        lifecycle.onSessionCreated(session);
        claimed.push([_request.executionId ?? lifecycleExecutionId(deps), session.id]);
        return { ok: true, value: session };
      });
    });
    return spawns;
  }
  const lifecycleExecutionId = (deps: any) => deps.launchFollowUpTerminal.mock.calls.at(-1)[2];

  it('success spawns exactly one follow-up in the retained worktree', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    const spawns = honoringLauncher(deps);
    await run(runtime, r);
    expect(spawns).toHaveLength(1);
    expect(deps.launchFollowUpTerminal.mock.calls[0][0].worktreeInfo).toMatchObject({ path: WT, branch: 'zcc/w' });
  });

  it('a denied structured-execution preflight reaches the operator as an operator error carrying the reason', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    const reason = 'Structured execution unavailable: persona cannot register plans';
    deps.launchFollowUpTerminal.mockResolvedValue({ ok: false, message: reason });
    const failure = await run(runtime, r).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(InboxActionOperatorError);
    expect((failure as Error).message).toContain(reason);
    expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', 'go')).toMatchObject({ ok: false, code: 'CONFLICT', message: expect.stringContaining(reason) });
  });

  it('sanitizes and bounds the surfaced denial reason without retrying under another persona', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    deps.launchFollowUpTerminal.mockResolvedValue({ ok: false, message: `bad\u0007\nreason ${'x'.repeat(400)}` });
    const failure = await run(runtime, r).catch((error: unknown) => error) as Error;
    expect(failure).toBeInstanceOf(InboxActionOperatorError);
    expect(failure.message).toMatch(/^Follow-up agent was not launched: bad reason x+…$/);
    expect(failure.message.length).toBeLessThanOrEqual('Follow-up agent was not launched: '.length + 300);
    expect(deps.launchFollowUpTerminal).toHaveBeenCalledTimes(1);
    deps.launchFollowUpTerminal.mockResolvedValue({ ok: false, message: ' \n ' });
    await expect(run(runtime, r)).rejects.toThrow('Follow-up agent was not launched: launch was refused');
  });

  it('a missing coordinator persona refuses with no spawn instead of dropping to a bare profile', async () => {
    const { deps, runtime } = setup({ personas: [] });
    const r = rec();
    serve(deps, r);
    await expect(run(runtime, r)).rejects.toThrow("coordinator persona is no longer available");
    expect(deps.launchFollowUpTerminal).not.toHaveBeenCalled();
  });

  it('a deleted Squad refuses with no spawn', async () => {
    const { deps, runtime } = setup({ team: null });
    const r = rec();
    serve(deps, r);
    await expect(run(runtime, r)).rejects.toBeInstanceOf(InboxActionOperatorError);
    expect(deps.launchFollowUpTerminal).not.toHaveBeenCalled();
  });

  describe('explicit follow-up persona', () => {
    const team = { id: 'team', orchestratorPersonaId: 'per', slots: [{ personaId: 'wrk', quantity: 1 }] };
    const runAs = (runtime: any, r: any, personaId: string) =>
      runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'instruct', text: 'go', personaId });

    it('spawns exactly one retained-cwd terminal as a Squad roster persona', async () => {
      const { deps, runtime } = setup({ team, personas: [{ id: 'per' }, { id: 'wrk' }] });
      const r = rec();
      serve(deps, r);
      const spawns = honoringLauncher(deps);
      await runAs(runtime, r, 'wrk');
      expect(spawns).toHaveLength(1);
      expect(deps.launchFollowUpTerminal.mock.calls[0][0]).toMatchObject({ personaId: 'wrk', profile: 'codex', worktreeInfo: { path: WT } });
      expect(deps.resolveTeamProfile.mock.calls[0][2]).toMatchObject({ id: 'wrk' });
    });

    it('refuses a persona outside the roster or no longer configured, with no spawn', async () => {
      const { deps, runtime } = setup({ team, personas: [{ id: 'per' }, { id: 'other' }] });
      const r = rec();
      serve(deps, r);
      await expect(runAs(runtime, r, 'other')).rejects.toThrow('not a member of this Squad');
      await expect(runAs(runtime, r, 'wrk')).rejects.toThrow('selected persona is no longer available');
      expect(deps.launchFollowUpTerminal).not.toHaveBeenCalled();
    });

    const action = (r: any, phase: string) => JSON.stringify({ executionId: r.id, phase, stateVersion: r.stateVersion });
    it('Inbox host action forwards a valid personaId and rejects malformed ones', async () => {
      const { deps, runtime } = setup({ team, personas: [{ id: 'per' }, { id: 'wrk' }] });
      const r = rec();
      serve(deps, r);
      await runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'instruct', text: 'go', personaId: 'wrk' } });
      expect(deps.launchFollowUpTerminal.mock.calls[0][0].personaId).toBe('wrk');
      for (const personaId of ['', '   ', 'x'.repeat(201), 5 as unknown as string]) {
        await expect(runtime.handleInboxAction({ ref: action(r, 'choose'), input: { optionId: 'instruct', text: 'go', personaId } })).rejects.toThrow('invalid squad worktree action');
      }
    });

    it('Squad-details IPC forwards the pick for instruct only and maps refusals to CONFLICT', async () => {
      const { deps, runtime } = setup({ team, personas: [{ id: 'per' }, { id: 'wrk' }] });
      const r = rec();
      serve(deps, r);
      expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', 'go', 'wrk')).toEqual({ ok: true, value: true });
      expect(deps.launchFollowUpTerminal.mock.calls[0][0].personaId).toBe('wrk');
      releaseSquadWorktreeFollowUp(r.id, 'sess');
      expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'instruct', 'go', 'ghost')).toMatchObject({ ok: false, code: 'CONFLICT', message: expect.stringContaining('not a member') });
      expect(await runtime.squadWorktreeAction('proj', r.id, 3, 'leave', undefined, 'ghost')).toEqual({ ok: true, value: true });
    });
  });

  it('a resume between preflight and spawn spawns zero follow-ups', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    const spawns = honoringLauncher(deps, () => {
      // Execution resumed while the launcher was preparing: stateVersion advanced.
      deps.executionStore.get.mockResolvedValue({ ...r, stateVersion: 4, state: 'RUNNING' });
    });
    await expect(run(runtime, r)).rejects.toBeInstanceOf(InboxActionOperatorError);
    expect(spawns).toHaveLength(0);
  });

  it('two concurrent instructs spawn exactly one follow-up and refuse the other as active', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    const spawns = honoringLauncher(deps);
    const results = await Promise.allSettled([run(runtime, r, 'a'), run(runtime, r, 'b')]);
    expect(spawns).toHaveLength(1);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason).toBeInstanceOf(InboxActionOperatorError);
  });

  it('a retained worktree that vanished before spawn spawns zero follow-ups', async () => {
    const { deps, runtime } = setup();
    const r = rec();
    serve(deps, r);
    const spawns = honoringLauncher(deps, () => { deps.git.getGitStatus.mockResolvedValue(undefined); });
    await expect(run(runtime, r)).rejects.toBeInstanceOf(InboxActionOperatorError);
    expect(spawns).toHaveLength(0);
  });
});

describe('trusted registered target (squad-bugs B8)', () => {
  const USER_WT = '/p/checkouts/feat';
  const userWt = { path: USER_WT, head: 'abc', branch: 'feat', detached: false, bare: false, isMain: false };
  const mainWt = { path: ROOT, head: 'abc', branch: 'main', detached: false, bare: false, isMain: true };

  function targetSetup(over: Parameters<typeof setup>[0] & { worktrees?: any[]; trusted?: (p: string) => boolean } = {}) {
    const s = setup(over);
    s.deps.git.listWorktrees = vi.fn(async () => over.worktrees ?? [mainWt, userWt]);
    s.deps.git.gitCommonDir = vi.fn(async () => '/p/.git');
    s.deps.git.getGitStatus.mockImplementation(async (path: string) => ({ branch: path === ROOT ? 'main' : 'feat', detached: false }));
    if (over.trusted) s.deps.isTrustedWorkspacePath = over.trusted;
    // Rebuild with the extended deps.
    return { deps: s.deps, runtime: createSquadWorktreeRuntime(s.deps) };
  }
  const fresh = (target: any, extra: Record<string, unknown> = {}) =>
    rec({ state: 'STARTING', squadWorktree: undefined, request: { target, ...extra } });
  const userRecord = (target: any, worktree: any) => rec({ request: { target }, squadWorktree: worktree });

  it('binds the project root as a user-owned target without creating a worktree', async () => {
    const { deps, runtime } = targetSetup();
    const r = fresh({ kind: 'project-root' });
    serve(deps, r);
    await runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } });
    expect(deps.executionStore.setSquadWorktree).toHaveBeenCalledWith(r.id, 3, { path: ROOT, branch: 'main', ownership: 'user', targetKind: 'project-root' });
    expect(deps.git.createWorktree).not.toHaveBeenCalled();
    expect(deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
  });

  it('binds a project-contained worktree of the same repo by branch', async () => {
    const { deps, runtime } = targetSetup();
    const r = fresh({ kind: 'worktree', branch: 'feat' });
    serve(deps, r);
    await runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: 'feat' } });
    expect(deps.executionStore.setSquadWorktree).toHaveBeenCalledWith(r.id, 3, { path: USER_WT, branch: 'feat', ownership: 'user', targetKind: 'worktree' });
  });

  it('accepts a worktree in a main-managed workspace and rejects an arbitrary outside path', async () => {
    const outside = { ...userWt, path: '/elsewhere/feat' };
    let s = targetSetup({ worktrees: [mainWt, outside], trusted: (p) => p.startsWith('/elsewhere') });
    let r = fresh({ kind: 'worktree', branch: 'feat' });
    serve(s.deps, r);
    await s.runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: 'feat' } });
    expect(s.deps.executionStore.setSquadWorktree).toHaveBeenCalled();

    s = targetSetup({ worktrees: [mainWt, outside] });
    r = fresh({ kind: 'worktree', branch: 'feat' });
    serve(s.deps, r);
    await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: 'feat' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    expect(s.deps.executionStore.setSquadWorktree).not.toHaveBeenCalled();
    expect(s.deps.git.createWorktree).not.toHaveBeenCalled();
  });

  it.each([
    ['unknown branch', (s: any) => s.deps.git.listWorktrees.mockResolvedValue([mainWt])],
    ['main checkout named as worktree', (s: any) => s.deps.git.listWorktrees.mockResolvedValue([{ ...mainWt, branch: 'feat' }])],
    ['detached worktree', (s: any) => s.deps.git.listWorktrees.mockResolvedValue([mainWt, { ...userWt, detached: true }])],
    ['different repository', (s: any) => s.deps.git.gitCommonDir.mockImplementation(async (p: string) => (p === ROOT ? '/p/.git' : '/other/.git'))],
    ['missing common dir', (s: any) => s.deps.git.gitCommonDir.mockResolvedValue(null)],
    ['branch moved under the worktree', (s: any) => s.deps.git.getGitStatus.mockResolvedValue({ branch: 'other', detached: false })],
    ['realpath escapes the project', (s: any) => { s.deps.fs.realpathSync = (p: string) => (p === USER_WT ? '/escape/feat' : p); }],
    ['worktree resolves to the project root', (s: any) => { s.deps.fs.realpathSync = (p: string) => (p === USER_WT ? ROOT : p); }]
  ])('rejects %s with no generated fallback', async (_name, mutate) => {
    const s = targetSetup();
    mutate(s);
    const runtime = createSquadWorktreeRuntime(s.deps);
    const r = fresh({ kind: 'worktree', branch: 'feat' });
    serve(s.deps, r);
    await expect(runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: 'feat' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    expect(s.deps.executionStore.setSquadWorktree).not.toHaveBeenCalled();
    expect(s.deps.git.createWorktree).not.toHaveBeenCalled();
  });

  it('rejects remote, quick-agent, missing projects, a detached root, and missing git ops', async () => {
    for (const project of [{ id: 'proj', path: ROOT, remote: { host: 'h' } }, { id: 'proj', path: ROOT, quickAgent: true }, null]) {
      const s = targetSetup({ project });
      const r = fresh({ kind: 'project-root' });
      serve(s.deps, r);
      await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    }
    let s = targetSetup();
    s.deps.git.getGitStatus.mockResolvedValue({ branch: null, detached: true });
    let r = fresh({ kind: 'project-root' });
    serve(s.deps, r);
    await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    s = setup();
    r = fresh({ kind: 'project-root' });
    serve(s.deps, r);
    await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
  });

  it('re-applies admission rules: conflicting generated flag or auto disposition rejects', async () => {
    const { deps, runtime } = targetSetup();
    const r = fresh({ kind: 'project-root' });
    serve(deps, r);
    await expect(runtime.prepareSquadWorktree(r, { worktree: true, target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    await expect(runtime.prepareSquadWorktree(r, { onComplete: 'delete', target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    await expect(runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: '../x' } as any })).rejects.toThrow('TARGET_UNAVAILABLE');
    expect(deps.executionStore.setSquadWorktree).not.toHaveBeenCalled();
  });

  it('uses persisted target conflicts when partial selector request omits worktree and disposition', async () => {
    for (const request of [
      { worktree: true, target: { kind: 'project-root' } },
      { onComplete: 'delete', target: { kind: 'project-root' } }
    ] as const) {
      const { deps, runtime } = targetSetup();
      const r = fresh({ kind: 'project-root' }, request);
      serve(deps, r);
      await expect(runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
      expect(deps.executionStore.setSquadWorktree).not.toHaveBeenCalled();
    }
  });

  it('never rebinds a generated worktree record to a user target, and refuses a racing bind', async () => {
    let s = targetSetup();
    let r = rec({ state: 'STARTING', request: { target: { kind: 'project-root' } } });
    serve(s.deps, r);
    await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');

    s = targetSetup();
    r = fresh({ kind: 'project-root' });
    s.deps.executionStore.get.mockResolvedValueOnce(r).mockResolvedValueOnce({ ...r, stateVersion: 4 });
    await expect(s.runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
  });

  it('reattaches a recorded user target only when it still resolves identically', async () => {
    const recorded = { path: USER_WT, branch: 'feat', ownership: 'user', targetKind: 'worktree' };
    let s = targetSetup();
    let r = userRecord({ kind: 'worktree', branch: 'feat' }, recorded);
    serve(s.deps, r);
    expect(await s.runtime.prepareSquadWorktree(r, { target: { kind: 'worktree', branch: 'feat' } })).toBe(r);
    expect(s.deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
    expect(await s.runtime.revalidateUserTarget(r)).toEqual(recorded);

    s = targetSetup();
    r = userRecord({ kind: 'worktree', branch: 'feat' }, { ...recorded, path: '/p/checkouts/old' });
    serve(s.deps, r);
    await expect(s.runtime.prepareSquadWorktree(r, {})).rejects.toThrow('TARGET_UNAVAILABLE');
    await expect(s.runtime.revalidateUserTarget(rec())).rejects.toThrow('TARGET_UNAVAILABLE');
    await expect(s.runtime.revalidateUserTarget(userRecord(undefined, recorded))).rejects.toThrow('TARGET_UNAVAILABLE');
  });

  it('rejects a supplied selector that differs from durable user target before revalidation', async () => {
    const { deps, runtime } = targetSetup();
    const r = userRecord({ kind: 'worktree', branch: 'feat' }, {
      path: USER_WT, branch: 'feat', ownership: 'user', targetKind: 'worktree'
    });
    serve(deps, r);
    await expect(runtime.prepareSquadWorktree(r, { target: { kind: 'project-root' } })).rejects.toThrow('TARGET_UNAVAILABLE');
    expect(deps.git.getGitStatus).not.toHaveBeenCalled();
  });

  it('terminal handling never push-guards, merges, or removes a user target', async () => {
    const { deps, runtime } = targetSetup();
    const r = userRecord({ kind: 'project-root' }, { path: ROOT, branch: 'main', ownership: 'user', targetKind: 'project-root' });
    r.request.onComplete = 'merge';
    serve(deps, r);
    await expect(runtime.handleSquadWorktreeTerminal(r)).resolves.toBe('kept');
    expect(deps.git.setWorktreePushProtection).not.toHaveBeenCalled();
    expect(deps.git.mergeWorktree).not.toHaveBeenCalled();
    expect(deps.git.removeWorktree).not.toHaveBeenCalled();
    expect(deps.executionStore.markSquadWorktreeTerminalEffects).toHaveBeenCalledWith(r.id, 3);
  });

  it('refuses delete, force-delete, and the delete confirmation for a user target', async () => {
    const { deps, runtime } = targetSetup();
    const r = userRecord({ kind: 'worktree', branch: 'feat' }, { path: USER_WT, branch: 'feat', ownership: 'user', targetKind: 'worktree' });
    serve(deps, r);
    for (const [phase, optionId] of [['choose', 'delete'], ['confirm', 'confirm-delete'], ['confirm', 'force-delete']]) {
      await expect(runtime.runSquadWorktreeAction({ executionId: r.id, phase: phase as any, stateVersion: 3 }, { optionId }))
        .rejects.toThrow('never deletes');
    }
    expect(deps.git.removeWorktree).not.toHaveBeenCalled();
    expect(deps.executionStore.disposeSquadWorktree).not.toHaveBeenCalled();
  });

  it('a follow-up in a user target runs in the revalidated checkout', async () => {
    const { deps, runtime } = targetSetup();
    const r = userRecord({ kind: 'worktree', branch: 'feat' }, { path: USER_WT, branch: 'feat', ownership: 'user', targetKind: 'worktree' });
    serve(deps, r);
    await runtime.runSquadWorktreeAction({ executionId: r.id, phase: 'choose', stateVersion: 3 }, { optionId: 'instruct', text: 'go' });
    expect(deps.launchFollowUpTerminal.mock.calls[0][0]).toMatchObject({ worktreeInfo: { path: USER_WT, branch: 'feat', ownership: 'user' } });
  });
});
