import { describe, expect, it, vi } from 'vitest';
import { createLaunchCoordinator } from '../launch/coordinator.js';
import { preflightLaunch } from '../launch/preflight.js';

const resolved = {
  project: { id: 'p1', path: '/real/project' },
  cwd: '/real/project/sub',
  profile: 'claude',
  persona: { id: 'reviewer', baseProfile: 'claude' },
  config: { version: 1, theme: 'dark' },
  storeRevision: 'projects:7;config:4;personas:2'
};

describe('launch preflight', () => {
  it('derives principal and trusted snapshot in main instead of accepting renderer flags', () => {
    const forged = { projectId: 'p1', profile: 'shell', principal: { kind: 'automation', id: 'root' }, trusted: true };
    const plan = preflightLaunch(forged, {
      principal: () => ({ kind: 'interactive-user', id: 'user:local' }),
      resolve: () => resolved,
      sessionId: () => 'session-1',
      idempotencyKey: () => 'once-1'
    });
    expect(plan.principal).toEqual({ kind: 'interactive-user', id: 'user:local' });
    expect(plan).not.toHaveProperty('trusted');
    expect(plan.resolved).toEqual(resolved);
    expect(plan.sessionId).toBe('session-1');
  });

  it('binds digest to trusted store revision and snapshot', () => {
    const base = { projectId: 'p1', profile: 'claude' };
    const one = preflightLaunch(base, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved });
    const two = preflightLaunch(base, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => ({ ...resolved, storeRevision: 'projects:8' }) });
    expect(one.digest).not.toBe(two.digest);
  });

  it('detaches and freezes request plus resolved state across async preflight work', () => {
    const request = { projectId: 'p1', extraArgs: ['--safe'] };
    const liveResolved = { ...resolved, config: { version: 1, theme: 'dark' as string } };
    const plan = preflightLaunch(request, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => liveResolved
    });
    request.extraArgs.push('--changed');
    liveResolved.config.theme = 'light';
    expect(plan.request.extraArgs).toEqual(['--safe']);
    expect(plan.resolved.config.theme).toBe('dark');
    expect(Object.isFrozen(plan.request.extraArgs)).toBe(true);
    expect(Object.isFrozen(plan.resolved.config)).toBe(true);
  });
});

describe('launch coordinator', () => {
  function harness(spawn = vi.fn(() => ({ id: 'session-1' }))) {
    const transitions: string[] = [];
    const claims = new Set<string>();
    const ledger = {
      claim: vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
        if (claims.has(idempotencyKey)) return { outcome: 'replay' as const, entry: { id: 'ledger-1', state: 'launched' } };
        claims.add(idempotencyKey);
        return { outcome: 'claimed' as const, entry: { id: 'ledger-1', state: 'authorized' } };
      }),
      transition: vi.fn(async (_id: string, state: string) => { transitions.push(state); })
    };
    const authorize = {
      authorize: vi.fn<() => ({ decision: 'authorized'; authorization: { id: string } } | { decision: 'denied'; reason: string })>(() => ({ decision: 'authorized', authorization: { id: 'auth-1' } })),
      consume: vi.fn(() => ({ ok: true as const }))
    };
    return { coordinator: createLaunchCoordinator({ ledger, authorize, spawn }), ledger, transitions, spawn, authorize };
  }

  it('persists committing before spawn and launched after it', async () => {
    const h = harness();
    const result = await h.coordinator.launch({ ...preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved, sessionId: () => 'session-1', idempotencyKey: () => 'once' }) });
    expect(result).toMatchObject({ ok: true, value: { id: 'session-1' } });
    expect(h.transitions).toEqual(['committing', 'launched']);
    expect(h.spawn).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'session-1' }));
  });

  it('exposes authorization and preallocated session identity after durable commit but before spawn', async () => {
    const order: string[] = [];
    const h = harness(vi.fn(() => { order.push('spawn'); return { id: 'session-1' }; }));
    const onCommitted = vi.fn((identity: { ledgerEntryId: string; authorizationId: string; sessionId: string }) => {
      order.push('identity');
      expect(identity).toEqual({ ledgerEntryId: 'ledger-1', authorizationId: 'auth-1', sessionId: 'session-1' });
    });
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger, authorize: h.authorize, spawn: h.spawn, onCommitted
    });

    await coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved,
      sessionId: () => 'session-1', idempotencyKey: () => 'once'
    }));
    expect(order).toEqual(['identity', 'spawn']);
  });

  it('finalizes failed and never spawns when durable identity callback fails', async () => {
    const h = harness();
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger,
      authorize: h.authorize,
      spawn: h.spawn,
      onCommitted: async () => { throw new Error('lifecycle disk full'); }
    });

    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved,
      sessionId: () => 'session-1', idempotencyKey: () => 'once'
    }))).resolves.toMatchObject({ ok: false, code: 'COMMIT_FAILED', message: 'lifecycle disk full' });
    expect(h.transitions).toEqual(['committing', 'failed']);
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('reports durable ledger identity for exit reconciliation after launch', async () => {
    const h = harness();
    const onLaunched = vi.fn();
    const ledger = {
      claim: vi.fn(async () => ({ outcome: 'claimed' as const, entry: { id: 'ledger-exit' } })),
      transition: vi.fn(async () => undefined)
    };
    const tracked = createLaunchCoordinator({ ledger, authorize: h.authorize, spawn: h.spawn, onLaunched });
    await tracked.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }),
      resolve: () => resolved,
      sessionId: () => 'session-1'
    }));
    expect(onLaunched).toHaveBeenCalledWith({ ledgerEntryId: 'ledger-exit', authorizationId: 'auth-1', session: { id: 'session-1' } });
  });

  it('records failed when spawn throws and consumes authorization once', async () => {
    const h = harness(vi.fn(() => { throw new Error('boom'); }));
    const plan = preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved, idempotencyKey: () => 'once' });
    await expect(h.coordinator.launch(plan)).resolves.toMatchObject({ ok: false, code: 'PTY_SPAWN_FAILED' });
    expect(h.transitions).toEqual(['committing', 'failed']);
    await expect(h.coordinator.launch(plan)).resolves.toMatchObject({ ok: false, code: 'REPLAY' });
    expect(h.spawn).toHaveBeenCalledTimes(1);
  });

  it('does not claim or spawn when authorization denies', async () => {
    const h = harness();
    h.authorize.authorize.mockReturnValue({ decision: 'denied', reason: 'no project' });
    const result = await h.coordinator.launch(preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved }));
    expect(result).toMatchObject({ ok: false, code: 'DENIED' });
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('revalidates trusted state at commit and refuses stale preflight', async () => {
    const h = harness();
    const revalidate = vi.fn(async () => ({ ok: false as const, reason: 'store revision changed' }));
    const coordinator = createLaunchCoordinator({
      ledger: {
        claim: vi.fn(async () => ({ outcome: 'claimed' as const, entry: { id: 'ledger-1' } })),
        transition: vi.fn(async () => undefined)
      },
      authorize: h.authorize,
      spawn: h.spawn,
      revalidate
    });
    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved
    }))).resolves.toMatchObject({ ok: false, code: 'STALE_PREFLIGHT', message: 'store revision changed' });
    expect(revalidate).toHaveBeenCalledOnce();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('claims reserved consent at committing and rejects concurrent replay', async () => {
    const h = harness();
    const executionConsent = {
      consume: vi.fn(async () => ({ outcome: 'consumed' as const })),
      release: vi.fn(async () => undefined)
    };
    const claims = new Set<string>();
    const ledger = {
      claim: vi.fn(async ({ idempotencyKey }: { idempotencyKey: string }) => {
        if (claims.has(idempotencyKey)) return { outcome: 'replay' as const, entry: { id: 'ledger-1' } };
        claims.add(idempotencyKey);
        return { outcome: 'claimed' as const, entry: { id: 'ledger-1' } };
      }),
      transition: vi.fn(async () => undefined)
    };
    const coordinator = createLaunchCoordinator({ ledger, authorize: h.authorize, spawn: h.spawn, executionConsent });
    const plan = {
      ...preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved, idempotencyKey: () => 'once' }),
      executionAuthorization: { consentReservation: { id: 'reservation-1' } }
    };
    const [first, replay] = await Promise.all([coordinator.launch(plan), coordinator.launch(plan)]);
    expect([first, replay]).toEqual(expect.arrayContaining([
      expect.objectContaining({ ok: true }), expect.objectContaining({ ok: false, code: 'REPLAY' })
    ]));
    expect(executionConsent.consume).toHaveBeenCalledTimes(1);
  });

  it('keeps consent consumed when durable committing transition fails', async () => {
    const h = harness();
    const executionConsent = { consume: vi.fn(async () => ({ outcome: 'consumed' as const })), release: vi.fn(async () => undefined) };
    const ledger = {
      claim: vi.fn(async () => ({ outcome: 'claimed' as const, entry: { id: 'ledger-1' } })),
      transition: vi.fn(async () => { throw new Error('disk full'); })
    };
    const coordinator = createLaunchCoordinator({ ledger, authorize: h.authorize, spawn: h.spawn, executionConsent });
    const plan = {
      ...preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved }),
      executionAuthorization: { consentReservation: { id: 'reservation-1' } }
    };
    await expect(coordinator.launch(plan)).resolves.toMatchObject({ ok: false, code: 'COMMIT_FAILED' });
    expect(executionConsent.consume).toHaveBeenCalledWith('reservation-1');
    expect(executionConsent.release).not.toHaveBeenCalled();
  });

  it.each(['authorization denial', 'ledger claim failure', 'ledger replay'])(
    'releases reserved consent on pre-commit %s', async (failure) => {
      const h = harness();
      const executionConsent = { consume: vi.fn(), release: vi.fn(async () => undefined) };
      if (failure === 'authorization denial') h.authorize.authorize.mockReturnValue({ decision: 'denied', reason: 'no' });
      const ledger = {
        claim: failure === 'ledger claim failure'
          ? vi.fn(async () => { throw new Error('disk'); })
          : vi.fn(async () => failure === 'ledger replay'
            ? { outcome: 'replay' as const, entry: { id: 'ledger-1' } }
            : { outcome: 'claimed' as const, entry: { id: 'ledger-1' } }),
        transition: vi.fn(async () => undefined)
      };
      const coordinator = createLaunchCoordinator({ ledger, authorize: h.authorize, spawn: h.spawn, executionConsent });
      await coordinator.launch({
        ...preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved }),
        executionAuthorization: { consentReservation: { id: 'reservation-1' } }
      });
      expect(executionConsent.release).toHaveBeenCalledWith('reservation-1');
      expect(h.spawn).not.toHaveBeenCalled();
    }
  );

  it('returns spawned session when launched transition fails and reports ledger error', async () => {
    const h = harness();
    const onLaunched = vi.fn();
    const onLedgerError = vi.fn();
    const ledger = {
      claim: vi.fn(async () => ({ outcome: 'claimed' as const, entry: { id: 'ledger-1' } })),
      transition: vi.fn(async (_id: string, state: string) => {
        if (state === 'launched') throw new Error('disk full after spawn');
      })
    };
    const coordinator = createLaunchCoordinator({
      ledger, authorize: h.authorize, spawn: h.spawn, onLaunched, onLedgerError
    });
    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved
    }))).resolves.toMatchObject({ ok: true, value: { id: 'session-1' } });
    expect(onLaunched).toHaveBeenCalledOnce();
    expect(onLedgerError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ ledgerEntryId: 'ledger-1' }));
  });

  it('does not report spawn failure when post-spawn tracking hook fails', async () => {
    const h = harness();
    const onLedgerError = vi.fn();
    const coordinator = createLaunchCoordinator({
      ledger: {
        claim: vi.fn(async () => ({ outcome: 'claimed' as const, entry: { id: 'ledger-1' } })),
        transition: vi.fn(async () => undefined)
      },
      authorize: h.authorize,
      spawn: h.spawn,
      onLaunched: async () => { throw new Error('tracking failed'); },
      onLedgerError
    });
    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved
    }))).resolves.toMatchObject({ ok: true, value: { id: 'session-1' } });
    expect(onLedgerError).toHaveBeenCalledOnce();
  });

  it('refuses spawn when bound launch deadline elapsed before spawn', async () => {
    const h = harness();
    const plan = preflightLaunch({}, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved,
      now: () => 100, sessionId: () => 'session-1', idempotencyKey: () => 'once'
    });
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger, authorize: h.authorize, spawn: h.spawn, now: () => 201
    });

    await expect(coordinator.launch({ ...plan, binding: { ...plan.binding, deadlineAt: 200 } }))
      .resolves.toMatchObject({ ok: false, code: 'DEADLINE_EXCEEDED' });
    expect(h.spawn).not.toHaveBeenCalled();
    expect(h.transitions).toEqual(['committing', 'failed']);
  });

  it('revalidates cancellation immediately before spawn', async () => {
    const h = harness();
    const beforeSpawn = vi.fn(async () => false);
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger, authorize: h.authorize, spawn: h.spawn, beforeSpawn
    });
    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'team', id: 'team-1' }), resolve: () => resolved
    }))).resolves.toMatchObject({ ok: false, code: 'CANCELED' });
    expect(beforeSpawn).toHaveBeenCalledOnce();
    expect(h.spawn).not.toHaveBeenCalled();
  });

  it('terminates a spawned session when cancellation wins during spawn', async () => {
    const h = harness();
    const terminateSpawned = vi.fn(async () => true);
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger,
      authorize: h.authorize,
      spawn: h.spawn,
      beforeSpawn: async () => true,
      afterSpawn: async () => false,
      terminateSpawned
    });
    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'team', id: 'team-1' }), resolve: () => resolved
    }))).resolves.toMatchObject({ ok: false, code: 'CANCELED' });
    expect(terminateSpawned).toHaveBeenCalledWith({ id: 'session-1' });
  });

  it('preserves spawned ownership and reports retryable cancellation when termination fails', async () => {
    const h = harness();
    const complete = vi.fn();
    const onLaunched = vi.fn();
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger,
      authorize: { ...h.authorize, complete },
      spawn: h.spawn,
      afterSpawn: async () => false,
      terminateSpawned: async () => false,
      onLaunched
    });

    await expect(coordinator.launch(preflightLaunch({}, {
      principal: () => ({ kind: 'team', id: 'team-1' }), resolve: () => resolved
    }))).resolves.toEqual({
      ok: false,
      code: 'CANCEL_PENDING',
      message: 'launch canceled but spawned session cleanup failed; retry cancellation'
    });
    expect(h.transitions).toEqual(['committing', 'launched']);
    expect(onLaunched).toHaveBeenCalledWith(expect.objectContaining({ session: { id: 'session-1' } }));
    expect(complete).not.toHaveBeenCalled();
  });

  it('keeps authorization denial stable when consent cleanup throws', async () => {
    const h = harness();
    h.authorize.authorize.mockReturnValue({ decision: 'denied', reason: 'no project' });
    const coordinator = createLaunchCoordinator({
      ledger: h.ledger,
      authorize: h.authorize,
      spawn: h.spawn,
      executionConsent: {
        consume: vi.fn(),
        release: vi.fn(async () => { throw new Error('cleanup leaked'); })
      }
    });
    await expect(coordinator.launch({
      ...preflightLaunch({}, { principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => resolved }),
      executionAuthorization: { consentReservation: { id: 'reservation-1' } }
    })).resolves.toEqual({ ok: false, code: 'DENIED', message: 'no project' });
  });
});
