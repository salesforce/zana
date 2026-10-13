import { describe, expect, it, vi } from 'vitest';
import {
  lifecycleClaimOps,
  reconnectCapabilityLaunch,
  restoreCapabilityLaunch,
  type FollowUpClaimOps,
  type RestoreLaunchInput
} from './terminal-restore-launch.js';
import {
  squadWorktreeHasActiveFollowUp,
  restoreSquadWorktreeFollowUp
} from './squad-worktree-lifecycle.js';

const session = { id: 'sess-1' } as never;
const capability = (extra: Record<string, unknown> = {}) => ({
  id: 'cap-1',
  request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24, cohort: { teamId: 'team-1', role: 'worker' } },
  sessionId: 'sess-1',
  remoteTmuxId: 'cc-sess-1',
  followUpExecutionId: 'exec-1',
  createdAt: 1,
  ...extra
}) as never;

function harness(hadClaim = false) {
  const reservations = { consume: vi.fn(), release: vi.fn() };
  const followUp: FollowUpClaimOps = {
    claim: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
    isClaimed: vi.fn().mockReturnValue(hadClaim)
  };
  return { reservations, followUp };
}

function restoreOpts(h: ReturnType<typeof harness>, launch: (i: RestoreLaunchInput) => Promise<never>, cap = capability()) {
  return {
    capability: cap,
    reservationId: 'res-1',
    reservations: h.reservations,
    followUp: h.followUp,
    launch,
    resolveWorktree: vi.fn(async (request) => ({ ok: true as const, value: request })),
    restorePrincipal: vi.fn(() => ({ kind: 'team', id: 'restore:cap-1' })),
    isTeamWorkerRestore: vi.fn(() => true)
  };
}

describe('restoreCapabilityLaunch', () => {
  it('claims, launches with named input, and consumes on success without releasing the claim', async () => {
    const h = harness();
    const launch = vi.fn(async () => ({ ok: true, value: session }) as never);
    const result = await restoreCapabilityLaunch(restoreOpts(h, launch));
    expect(result).toEqual({ ok: true, value: session });
    expect(launch).toHaveBeenCalledWith({
      request: expect.objectContaining({ projectId: 'p1' }),
      principal: { kind: 'team', id: 'restore:cap-1' },
      spawnOpts: { preallocatedSessionId: 'sess-1', retainWorktree: true },
      teamId: 'team-1',
      legacyPersonaFacetCompatibility: true,
      followUpExecutionId: 'exec-1'
    });
    expect(h.reservations.consume).toHaveBeenCalledWith('cap-1', 'res-1');
    expect(h.reservations.release).not.toHaveBeenCalled();
    expect(h.followUp.release).not.toHaveBeenCalled();
  });

  it('releases reservation and follow-up claim when launch returns !ok', async () => {
    const h = harness();
    const failure = { ok: false, code: 'SPAWN', message: 'boom' } as never;
    const result = await restoreCapabilityLaunch(restoreOpts(h, vi.fn(async () => failure)));
    expect(result).toBe(failure);
    expect(h.reservations.release).toHaveBeenCalledWith('cap-1', 'res-1');
    expect(h.reservations.consume).not.toHaveBeenCalled();
    expect(h.followUp.release).toHaveBeenCalledWith('exec-1', 'sess-1');
  });

  it('releases both and rethrows when launch throws', async () => {
    const h = harness();
    await expect(restoreCapabilityLaunch(restoreOpts(h, vi.fn(async () => { throw new Error('crash'); }))))
      .rejects.toThrow('crash');
    expect(h.reservations.release).toHaveBeenCalledWith('cap-1', 'res-1');
    expect(h.followUp.release).toHaveBeenCalledWith('exec-1', 'sess-1');
  });

  it('releases both and rethrows when claim throws', async () => {
    const h = harness();
    (h.followUp.claim as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('claim failed'));
    const launch = vi.fn();
    await expect(restoreCapabilityLaunch(restoreOpts(h, launch as never))).rejects.toThrow('claim failed');
    expect(launch).not.toHaveBeenCalled();
    expect(h.reservations.release).toHaveBeenCalled();
  });

  it('releases both when the worktree resolver fails and does not launch', async () => {
    const h = harness();
    const launch = vi.fn();
    const opts = restoreOpts(h, launch as never);
    const denied = { ok: false, code: 'DENIED', message: 'no worktree' } as never;
    opts.resolveWorktree = vi.fn(async () => denied);
    expect(await restoreCapabilityLaunch(opts)).toBe(denied);
    expect(launch).not.toHaveBeenCalled();
    expect(h.reservations.release).toHaveBeenCalled();
    expect(h.followUp.release).toHaveBeenCalledWith('exec-1', 'sess-1');
  });

  it('keeps a claim that was live before the attempt (startup rebuild) on failure', async () => {
    const h = harness(true);
    await restoreCapabilityLaunch(restoreOpts(h, vi.fn(async () => ({ ok: false, code: 'X', message: 'm' }) as never)));
    expect(h.reservations.release).toHaveBeenCalled();
    expect(h.followUp.release).not.toHaveBeenCalled();
  });

  it('skips claim release and preallocation for a capability with no follow-up or session', async () => {
    const h = harness();
    const cap = capability({ followUpExecutionId: undefined, sessionId: undefined });
    const launch = vi.fn(async () => ({ ok: false, code: 'X', message: 'm' }) as never);
    await restoreCapabilityLaunch(restoreOpts(h, launch, cap));
    expect(launch.mock.calls[0][0].spawnOpts).toBeUndefined();
    expect(h.followUp.release).not.toHaveBeenCalled();
  });
});

describe('reconnectCapabilityLaunch', () => {
  const base = (h: ReturnType<typeof harness>, launch: (i: RestoreLaunchInput) => Promise<never>, legacy = false) => ({
    capability: capability(),
    reservationId: 'res-1',
    reservations: h.reservations,
    followUp: h.followUp,
    legacy,
    launch
  });

  it('launches with reconnect spawn options and consumes on success', async () => {
    const h = harness();
    const launch = vi.fn(async () => ({ ok: true, value: session }) as never);
    await reconnectCapabilityLaunch(base(h, launch));
    expect(launch).toHaveBeenCalledWith(expect.objectContaining({
      principal: { kind: 'automation', id: 'reconnect:cap-1' },
      spawnOpts: { reconnectTmuxId: 'cc-sess-1', resume: true, retainWorktree: true },
      legacyPersonaFacetCompatibility: false,
      followUpExecutionId: 'exec-1'
    }));
    expect(h.reservations.consume).toHaveBeenCalled();
    expect(h.followUp.release).not.toHaveBeenCalled();
  });

  it('uses the legacy principal and releases claim on failure', async () => {
    const h = harness();
    const launch = vi.fn(async () => ({ ok: false, code: 'X', message: 'm' }) as never);
    await reconnectCapabilityLaunch(base(h, launch, true));
    expect(launch.mock.calls[0][0].principal).toEqual({ kind: 'interactive-user', id: 'reconnect:legacy-confirmed' });
    expect(h.reservations.release).toHaveBeenCalled();
    expect(h.followUp.release).toHaveBeenCalledWith('exec-1', 'sess-1');
  });

  it('releases both when launch throws', async () => {
    const h = harness();
    await expect(reconnectCapabilityLaunch(base(h, vi.fn(async () => { throw new Error('x'); })))).rejects.toThrow('x');
    expect(h.reservations.release).toHaveBeenCalled();
    expect(h.followUp.release).toHaveBeenCalled();
  });
});

describe('lifecycleClaimOps + retry (real lifecycle registry)', () => {
  it('failed launch frees the retained worktree, retry re-claims and succeeds', async () => {
    const reservations = { consume: vi.fn(), release: vi.fn() };
    const followUp = lifecycleClaimOps(async (cap) => {
      restoreSquadWorktreeFollowUp(cap.followUpExecutionId!, cap.sessionId!);
    });
    const attempt = (ok: boolean) => reconnectCapabilityLaunch({
      capability: capability({ followUpExecutionId: 'exec-retry', sessionId: 'sess-retry' }),
      reservationId: 'r',
      reservations,
      followUp,
      legacy: false,
      launch: async () => {
        expect(squadWorktreeHasActiveFollowUp('exec-retry')).toBe(true);
        return (ok ? { ok: true, value: session } : { ok: false, code: 'X', message: 'm' }) as never;
      }
    });
    expect((await attempt(false)).ok).toBe(false);
    expect(squadWorktreeHasActiveFollowUp('exec-retry')).toBe(false);
    expect((await attempt(true)).ok).toBe(true);
    expect(squadWorktreeHasActiveFollowUp('exec-retry')).toBe(true);
  });

  it('isClaimed reflects the registry', async () => {
    const ops = lifecycleClaimOps(async () => undefined);
    expect(ops.isClaimed('exec-x', 'sess-x')).toBe(false);
    restoreSquadWorktreeFollowUp('exec-x', 'sess-x');
    expect(ops.isClaimed('exec-x', 'sess-x')).toBe(true);
    await ops.release('exec-x', 'sess-x');
    expect(ops.isClaimed('exec-x', 'sess-x')).toBe(false);
  });
});
