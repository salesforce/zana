import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopNativeRecovery, findProposalExecution, gateInvalidProvidedPlan, recoverSquadStateAtBoot, runSpawnLifecycle, slotRecoveryLaunch,
  sweepUnretainedSquadWorktrees, teamAdmissionRequirements, splitProposedGoalSources, teamJobFailureResponse, withProposalLaunch
} from '../team-launch-support.js';

describe('withProposalLaunch', () => {
  const proposal = { id: 'prop-1', proposerKind: 'pty' as const, proposerId: 's1' };
  const started = { ok: true as const, value: { executionId: 'exec-1', state: 'RUNNING' as never } };
  function deps(begin: unknown = { ok: true, value: { proposal } }) {
    return {
      beginLaunch: vi.fn(async () => begin as never),
      markLaunched: vi.fn(async () => undefined),
      releaseLaunch: vi.fn(),
      logError: vi.fn()
    };
  }

  it('runs an ordinary launch without touching any proposal', async () => {
    const d = deps();
    const start = vi.fn(async () => started);
    expect(await withProposalLaunch(d, undefined, 'p1', start)).toBe(started);
    expect(start).toHaveBeenCalledWith(undefined, []);
    expect(d.beginLaunch).not.toHaveBeenCalled();
    expect(d.releaseLaunch).not.toHaveBeenCalled();
  });

  it('records a started Squad and keeps the hold', async () => {
    const d = deps();
    const start = vi.fn(async () => started);
    expect(await withProposalLaunch(d, 'prop-1', 'p1', start)).toBe(started);
    expect(d.beginLaunch).toHaveBeenCalledWith('prop-1', 'p1');
    expect(start).toHaveBeenCalledWith(proposal, []);
    expect(d.markLaunched).toHaveBeenCalledWith('prop-1', 'exec-1');
    expect(d.releaseLaunch).not.toHaveBeenCalled();
  });

  it('hands the start the sources the reviewed card listed', async () => {
    const d = deps({ ok: true, value: { proposal, sourcePaths: ['/home/me/notes.md'] } });
    const start = vi.fn(async () => started);
    await withProposalLaunch(d, 'prop-1', 'p1', start);
    expect(start).toHaveBeenCalledWith(proposal, ['/home/me/notes.md']);
  });

  it('logs a failed launch record but still reports the running Squad', async () => {
    const d = deps();
    d.markLaunched.mockRejectedValue(new Error('disk full'));
    expect(await withProposalLaunch(d, 'prop-1', 'p1', async () => started)).toBe(started);
    expect(d.logError).toHaveBeenCalledWith('squad proposal prop-1 markLaunched', expect.any(Error));
    expect(d.releaseLaunch).not.toHaveBeenCalled();
  });

  it('returns a refused hold without starting', async () => {
    const d = deps({ ok: false, code: 'NOT_PENDING', message: 'already handled' });
    const start = vi.fn(async () => started);
    expect(await withProposalLaunch(d, 'prop-1', 'p1', start)).toEqual({ ok: false, code: 'NOT_PENDING', message: 'already handled' });
    expect(start).not.toHaveBeenCalled();
    expect(d.releaseLaunch).not.toHaveBeenCalled();
  });

  it('releases the hold when the start fails or throws', async () => {
    const d = deps();
    const refused = { ok: false as const, code: 'INVALID_PLAN', message: 'bad plan' };
    expect(await withProposalLaunch(d, 'prop-1', 'p1', async () => refused as never)).toBe(refused);
    expect(d.releaseLaunch).toHaveBeenCalledTimes(1);
    await expect(withProposalLaunch(d, 'prop-1', 'p1', async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    expect(d.releaseLaunch).toHaveBeenCalledTimes(2);
    expect(d.markLaunched).not.toHaveBeenCalled();
  });
});

describe('splitProposedGoalSources', () => {
  const file = (canonicalPath: string) => ({ canonicalPath });
  const project = '/work/proj';

  it('attaches Project files and refuses an outside file the card did not list', () => {
    const inside = file('/work/proj/docs/plan.md');
    expect(splitProposedGoalSources([inside], project, [])).toEqual({ attach: [inside], known: [inside] });
    const outside = file('/Users/me/notes.md');
    expect(splitProposedGoalSources([inside, outside], project, [])).toEqual({ attach: [], known: [], refused: outside });
    // Another reviewed path, a sibling folder with the Project's name as a prefix, and the Project root itself are not the Project.
    expect(splitProposedGoalSources([outside], project, ['/Users/me/other.md']).refused).toBe(outside);
    expect(splitProposedGoalSources([file('/work/proj-two/a.md')], project, []).refused).toBeDefined();
    expect(splitProposedGoalSources([file('/work/proj')], project, []).refused).toBeDefined();
  });

  it('keeps an outside file the card listed out of the attachments, but known for redaction', () => {
    const listed = file('/Users/me/notes.md');
    const inside = file('/work/proj/a.md');
    expect(splitProposedGoalSources([listed, inside], project, ['/Users/me/notes.md'])).toEqual({ attach: [inside], known: [listed, inside] });
  });

  it('treats every file as outside when the Project folder does not resolve', () => {
    const inside = file('/work/proj/a.md');
    expect(splitProposedGoalSources([inside], undefined, []).refused).toBe(inside);
    expect(splitProposedGoalSources([inside], undefined, ['/work/proj/a.md'])).toEqual({ attach: [], known: [inside] });
    expect(splitProposedGoalSources([], undefined, [])).toEqual({ attach: [], known: [] });
  });
});

describe('findProposalExecution', () => {
  const page = (ids: Array<[string, string | undefined, number]>, hasMore: boolean) => ({
    records: ids.map(([id, proposalId, createdAt]) => ({ id, createdAt, ...(proposalId ? { proposal: { id: proposalId } } : {}) }) as never),
    hasMore
  });

  it('pages newest first until it finds the proposal', async () => {
    const listInProject = vi.fn()
      .mockResolvedValueOnce(page([['e3', undefined, 30], ['e2', 'other', 20]], true))
      .mockResolvedValueOnce(page([['e1', 'prop-1', 10]], false));
    expect(await findProposalExecution({ listInProject }, 'p1', 'prop-1')).toBe('e1');
    expect(listInProject).toHaveBeenNthCalledWith(1, 'p1', undefined, 100);
    expect(listInProject).toHaveBeenNthCalledWith(2, 'p1', 20, 100);
  });

  it('stops at the last page, an empty page, and after five pages', async () => {
    expect(await findProposalExecution({ listInProject: vi.fn().mockResolvedValue(page([['e1', undefined, 1]], false)) }, 'p1', 'prop-1')).toBeUndefined();
    expect(await findProposalExecution({ listInProject: vi.fn().mockResolvedValue(page([], true)) }, 'p1', 'prop-1')).toBeUndefined();
    const endless = vi.fn().mockResolvedValue(page([['e', undefined, 5]], true));
    expect(await findProposalExecution({ listInProject: endless }, 'p1', 'prop-1')).toBeUndefined();
    expect(endless).toHaveBeenCalledTimes(5);
  });
});

describe('slotRecoveryLaunch', () => {
  const base = { slotId: 's1', role: 'worker' as const, personaId: 'p1', profile: 'claude' as never };
  it('without recovery is a plain launch', () => {
    const r = slotRecoveryLaunch(base);
    expect(r).toMatchObject({ configuredProfile: 'claude', profile: 'claude', recoveryResume: false });
  });
  it('with mismatched snapshot does not resume', () => {
    const r = slotRecoveryLaunch({ ...base, nativeRecovery: { role: 'worker', personaId: 'other', profileId: 'claude', nativeConversationId: 'n' } });
    expect(r.recoveryResume).toBe(false);
  });
  it('with matching snapshot builds a recovery slot', () => {
    const r = slotRecoveryLaunch({ ...base, nativeRecovery: { role: 'worker', personaId: 'p1', profileId: 'claude', nativeConversationId: 'n' } });
    expect(r.configuredProfile).toBe('claude');
    expect(typeof r.recoveryResume).toBe('boolean');
  });
});

describe('createDesktopNativeRecovery', () => {
  const snap = (slotId: string, personaId = 'pe') => ({ slotId, role: 'worker', personaId, profileId: 'claude', nativeConversationId: 'n' });
  function make(over: any = {}) {
    const resolveTeamProfile = vi.fn(() => 'claude' as never);
    const deps = {
      projects: { listProjects: () => [{ id: 'pr' }] as never },
      teams: { list: () => [{ id: 't' }] as never },
      personas: { list: () => [{ id: 'pe' }] as never },
      expandTeamSlots: () => [{ slotId: 's1', role: 'worker' as const, personaId: 'pe' }, { slotId: 's2', role: 'worker' as const, personaId: 'gone' }],
      resolveTeamProfile,
      ...over
    };
    return { api: createDesktopNativeRecovery(deps), resolveTeamProfile };
  }
  const rec = (over: any = {}) => ({ projectId: 'pr', teamId: 't', nativeRecoverySnapshots: [snap('s1')], ...over }) as never;

  it('returns [] for missing project, team, or snapshots', () => {
    const { api } = make();
    expect(api.compatibleSnapshots(rec({ projectId: 'x' }))).toEqual([]);
    expect(api.compatibleSnapshots(rec({ teamId: 'x' }))).toEqual([]);
    expect(api.compatibleSnapshots(rec({ nativeRecoverySnapshots: [] }))).toEqual([]);
    expect(api.compatibleSnapshots(rec({ nativeRecoverySnapshots: undefined }))).toEqual([]);
    expect(api.availability(rec({ nativeRecoverySnapshots: undefined }))).toEqual({ available: false, restorableSlots: 0 });
  });

  it('resolves profiles only for slots whose persona exists', () => {
    const { api, resolveTeamProfile } = make();
    const out = api.compatibleSnapshots(rec());
    expect(resolveTeamProfile).toHaveBeenCalledTimes(1);
    expect(Array.isArray(out)).toBe(true);
    expect(api.availability(rec())).toEqual({ available: out.length > 0, restorableSlots: out.length });
  });
});

describe('teamAdmissionRequirements', () => {
  it('dedupes and sorts', () => {
    const r = teamAdmissionRequirements(
      [{ mcpServers: ['b', 'a'] }, { mcpServers: ['a'] }, {}],
      [{ requires: { skills: ['z', 'y', 'z'], mcpServers: ['c', 'a'] } }, {}, { requires: {} }]
    );
    expect(r).toEqual({ requiredSkills: ['y', 'z'], personaMcpServers: ['a', 'b'], inventoryMcpServers: ['a', 'b', 'c'] });
  });
  it('handles undefined units', () => {
    expect(teamAdmissionRequirements([], undefined)).toEqual({ requiredSkills: [], personaMcpServers: [], inventoryMcpServers: [] });
  });
});

describe('teamJobFailureResponse', () => {
  it('maps availability unknown, requirement failure, and generic', () => {
    expect(teamJobFailureResponse({ code: 'X', message: 'm', availabilityUnknown: { a: 1 }, requirementFailure: {} }))
      .toEqual({ ok: false, code: 'CAPABILITY_AVAILABILITY_UNKNOWN', message: 'm', availabilityUnknown: { a: 1 } });
    expect(teamJobFailureResponse({ code: 'X', message: 'm', requirementFailure: { r: 1 } }))
      .toEqual({ ok: false, code: 'REQUIREMENT_UNAVAILABLE', message: 'm', requirementFailure: { r: 1 } });
    expect(teamJobFailureResponse({ code: 'X', message: 'm' })).toEqual({ ok: false, code: 'X', message: 'm' });
  });
});

describe('gateInvalidProvidedPlan', () => {
  const args = { planError: 'bad', unattended: false, projectId: 'p', projectName: 'P', launchRequestId: 'lr' };
  const mk = () => ({ inboxStore: { append: vi.fn(async () => undefined) }, planCorrectionLaunchBinding: { beginLaunch: vi.fn() } });
  it('continues when plan valid', async () => {
    const d = mk();
    await expect(gateInvalidProvidedPlan(d, { ...args, planError: undefined })).resolves.toBeUndefined();
    expect(d.planCorrectionLaunchBinding.beginLaunch).not.toHaveBeenCalled();
  });
  it('unattended notifies and refuses', async () => {
    const d = mk();
    await expect(gateInvalidProvidedPlan(d, { ...args, unattended: true })).resolves.toMatchObject({ ok: false, code: 'INVALID_PLAN' });
    expect(d.inboxStore.append).toHaveBeenCalledWith(expect.objectContaining({ projectId: 'p', projectLabel: 'P', notify: 'loud' }));
  });
  it('direct unattended launch copy does not tell the user to run a trigger', async () => {
    const d = mk();
    await gateInvalidProvidedPlan(d, { ...args, unattended: true });
    const comments = (d.inboxStore.append.mock.calls[0] as unknown as [{ comments: string }])[0].comments;
    expect(comments).not.toContain('trigger');
    expect(comments).toContain('bad');
    expect(comments).toContain('freeform');
  });
  it('trigger-driven unattended launch keeps the run-trigger-again copy', async () => {
    const d = mk();
    await gateInvalidProvidedPlan(d, { ...args, unattended: true, viaTrigger: true });
    const comments = (d.inboxStore.append.mock.calls[0] as unknown as [{ comments: string }])[0].comments;
    expect(comments).toContain('run trigger again');
  });
  it('attended parks via binding', async () => {
    const d = mk();
    await expect(gateInvalidProvidedPlan(d, args)).resolves.toBeUndefined();
    expect(d.planCorrectionLaunchBinding.beginLaunch).toHaveBeenCalledWith('lr', 'bad');
  });
  it('unattended propagates inbox failure', async () => {
    const d = mk();
    d.inboxStore.append.mockRejectedValueOnce(new Error('inbox') as never);
    await expect(gateInvalidProvidedPlan(d, { ...args, unattended: true })).rejects.toThrow('inbox');
  });
});

describe('sweepUnretainedSquadWorktrees', () => {
  it('sweeps local projects with retained paths and skips remote', async () => {
    const sweep = vi.fn(async () => undefined);
    await sweepUnretainedSquadWorktrees({
      executionStore: { listUndisposedSquadWorktrees: async () => [
        { projectId: 'a', squadWorktree: { path: '/a/.worktrees/x' } }, { projectId: 'a' }, { projectId: 'b', squadWorktree: { path: '/b/w' } }
      ] },
      projects: { listProjects: () => [{ id: 'a', path: '/a' }, { id: 'r', path: '/r', remote: {} }, { id: 'c', path: '/c' }] },
      sweepManagedWorktrees: sweep, logError: vi.fn()
    });
    expect(sweep).toHaveBeenCalledTimes(2);
    expect(sweep).toHaveBeenCalledWith('/a', '/a/.worktrees', ['/a/.worktrees/x']);
    expect(sweep).toHaveBeenCalledWith('/c', '/c/.worktrees', []);
  });
  it('logs failures', async () => {
    const logError = vi.fn();
    await sweepUnretainedSquadWorktrees({
      executionStore: { listUndisposedSquadWorktrees: async () => { throw new Error('db'); } },
      projects: { listProjects: () => [] }, sweepManagedWorktrees: vi.fn(), logError
    });
    expect(logError).toHaveBeenCalledWith('squadWorktree.bootSweep', expect.any(Error));
  });
});

describe('recoverSquadStateAtBoot', () => {
  it('runs steps in order and logs per-execution errors', async () => {
    const order: string[] = [];
    const logError = vi.fn();
    await recoverSquadStateAtBoot({
      squadFollowUpClaims: { restoreSurvivingClaims: async () => { order.push('claims'); } },
      squadWorktreeRuntime: { replayUndisposedTerminalEffects: async () => { order.push('replay'); } },
      squadExecutionService: { restoreDeadlines: async () => { order.push('deadlines'); } },
      planCorrection: { recoverCancelledExecutions: async () => { order.push('pc'); return [{ executionId: 'e1', error: 'x' }, { executionId: 'e2', error: 'y' }]; } },
      logError
    });
    expect(order).toEqual(['claims', 'replay', 'deadlines', 'pc']);
    expect(logError).toHaveBeenCalledWith('planCorrection.recoverCancelledExecutions:e1', 'x');
    expect(logError).toHaveBeenCalledTimes(2);
  });
  it('stops on step failure', async () => {
    const replay = vi.fn();
    await expect(recoverSquadStateAtBoot({
      squadFollowUpClaims: { restoreSurvivingClaims: async () => { throw new Error('c'); } },
      squadWorktreeRuntime: { replayUndisposedTerminalEffects: replay },
      squadExecutionService: { restoreDeadlines: vi.fn() },
      planCorrection: { recoverCancelledExecutions: vi.fn() },
      logError: vi.fn()
    })).rejects.toThrow('c');
    expect(replay).not.toHaveBeenCalled();
  });
});

describe('runSpawnLifecycle', () => {
  it('runs directly without lock', async () => {
    await expect(runSpawnLifecycle(undefined, async () => 1)).resolves.toBe(1);
    await expect(runSpawnLifecycle({}, async () => 2)).resolves.toBe(2);
  });
  it('wraps in lock when provided', async () => {
    const withSpawnLock = vi.fn(async (fn: () => Promise<number>) => (await fn()) + 10) as never;
    await expect(runSpawnLifecycle({ withSpawnLock }, async () => 1)).resolves.toBe(11);
  });
});
