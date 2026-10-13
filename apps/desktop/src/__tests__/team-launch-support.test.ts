import { describe, expect, it, vi } from 'vitest';
import {
  createDesktopNativeRecovery, gateInvalidProvidedPlan, recoverSquadStateAtBoot, runSpawnLifecycle, slotRecoveryLaunch,
  sweepUnretainedSquadWorktrees, teamAdmissionRequirements, teamJobFailureResponse
} from '../team-launch-support.js';

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
