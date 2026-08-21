import { describe, expect, it } from 'vitest';
import {
  LaunchAuthorizationService,
  canTransitionAuthorization
} from '../authorization.js';
import { bindLaunchPrincipal, type LaunchPrincipal } from '../types.js';

const binding = {
  consumerKind: 'terminal' as const,
  initialTaskDigest: 'task', scope: 'local' as const, storeRevision: 'stores',
  projectIdentityDigest: 'project', autonomous: false, expiresAt: 2_000
};

const principal: LaunchPrincipal = {
  kind: 'interactive-user',
  id: 'user:local',
  allowedProjectIds: ['p1'],
  maxConcurrent: 2,
  maxLaunchesPerRun: 3
};

describe('launch authorization', () => {
  it('fails closed for unknown and forged principals', () => {
    const service = new LaunchAuthorizationService({
      resolvePrincipal: (id) => id === principal.id ? principal : undefined,
      now: () => 1_000,
      id: () => 'auth-1'
    });
    expect(service.authorize({ principal: { kind: 'schedule', id: 'missing' }, projectId: 'p1', launchDigest: 'd', binding })).toEqual({
      decision: 'denied', reason: 'unknown principal'
    });
    expect(service.authorize({ principal: { kind: 'schedule', id: principal.id }, projectId: 'p1', launchDigest: 'd', binding })).toEqual({
      decision: 'denied', reason: 'principal kind mismatch'
    });
    expect(service.authorize({ principal: { kind: principal.kind, id: principal.id }, projectId: 'p2', launchDigest: 'd', binding }).decision).toBe('denied');
  });

  it('uses opaque one-way authorization states and rejects replay', () => {
    let now = 1_000;
    const service = new LaunchAuthorizationService({
      resolvePrincipal: () => principal,
      now: () => now,
      id: () => 'auth-1'
    });
    const result = service.authorize({
      principal: { kind: principal.kind, id: principal.id }, projectId: 'p1', launchDigest: 'digest', binding, expiresAt: 1_100
    });
    expect(result.decision).toBe('authorized');
    expect(service.consume('auth-1', 'digest')).toMatchObject({ ok: true, authorization: { state: 'consumed' } });
    expect(service.consume('auth-1', 'digest')).toEqual({ ok: false, reason: 'authorization is consumed' });
    now = 1_200;
    expect(service.authorize({ principal: { kind: principal.kind, id: principal.id }, projectId: 'p1', launchDigest: 'later', binding, expiresAt: 1_100 })).toEqual({
      decision: 'denied', reason: 'authorization already expired'
    });
  });

  it('binds team, slot, persona, evidence, task, consent, scope, and expiry and enforces shared run limits', () => {
    let next = 0;
    const team: LaunchPrincipal = {
      kind: 'team', id: 'team:squad:run-1', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'],
      maxConcurrent: 1, maxLaunchesPerRun: 2
    };
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => team, id: () => `auth-${++next}`, now: () => 100 });
    const teamBinding = {
      ...binding, consumerKind: 'team-slot' as const, personaId: 'reviewer', teamId: 'squad', slotId: 'reviewer:0',
      evidenceDigest: 'evidence', initialTaskDigest: 'task-1',
      consentReservation: { id: 'reservation-1', scope: 'project' }, autonomous: true
    };
    const first = service.authorize({ principal: { kind: 'team', id: team.id }, projectId: 'p1', launchDigest: 'd1', binding: teamBinding, expiresAt: 200 });
    expect(first).toMatchObject({ decision: 'authorized', authorization: { binding: teamBinding, expiresAt: 200 } });
    expect(service.authorize({ principal: { kind: 'team', id: team.id }, projectId: 'p1', launchDigest: 'd2', binding: { ...teamBinding, slotId: 'reviewer:1' } })).toMatchObject({
      decision: 'denied', reason: 'principal concurrent launch limit reached'
    });
    expect(service.consume('auth-1', 'd1')).toMatchObject({ ok: true });
    service.complete('auth-1');
    expect(service.get('auth-1')).toBeUndefined();
    expect(service.authorize({ principal: { kind: 'team', id: team.id }, projectId: 'p1', launchDigest: 'd2', binding: { ...teamBinding, slotId: 'reviewer:1' } }).decision).toBe('authorized');
    expect(service.authorize({ principal: { kind: 'team', id: team.id }, projectId: 'p1', launchDigest: 'd3', binding: { ...teamBinding, slotId: 'reviewer:2' } })).toMatchObject({
      decision: 'denied', reason: 'principal concurrent launch limit reached'
    });
  });

  it('supports multiple concurrent launches for a fixed non-team principal within its budget', () => {
    let next = 0;
    const service = new LaunchAuthorizationService({
      resolvePrincipal: () => principal,
      id: () => `auth-${++next}`
    });
    const ref = { kind: principal.kind, id: principal.id };
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding }).decision).toBe('authorized');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding }).decision).toBe('authorized');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd3', binding })).toMatchObject({
      decision: 'denied', reason: 'principal concurrent launch limit reached'
    });
    service.complete('auth-1');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd3', binding }).decision).toBe('authorized');
  });

  it('reserves concurrent capacity at authorization but charges total budget only on consume', () => {
    let next = 0;
    const bounded: LaunchPrincipal = {
      kind: 'team', id: 'team:bounded', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'],
      maxConcurrent: 2, maxLaunchesPerRun: 1
    };
    const service = new LaunchAuthorizationService({
      resolvePrincipal: () => bounded,
      id: () => `pending-${++next}`,
      now: () => 100
    });
    const teamBinding = {
      ...binding, consumerKind: 'team-slot' as const, teamId: 'squad', slotId: 'slot-1', personaId: 'reviewer'
    };
    const ref = { kind: 'team' as const, id: bounded.id };

    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding: teamBinding }).decision).toBe('authorized');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding: { ...teamBinding, slotId: 'slot-2' } }).decision).toBe('authorized');
    expect(service.consume('pending-1', 'd1')).toMatchObject({ ok: true });
    expect(service.consume('pending-2', 'd2')).toEqual({ ok: false, reason: 'principal launch budget exhausted' });
  });

  it('reconstructs consumed Team run budget and live reservations after restart', () => {
    let next = 0;
    const run: LaunchPrincipal = {
      kind: 'team', id: 'team:squad:caller:request-1', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'],
      maxConcurrent: 2, maxLaunchesPerRun: 2
    };
    const service = new LaunchAuthorizationService({
      resolvePrincipal: () => run,
      id: () => `after-restart-${++next}`,
      now: () => 100
    });
    service.restoreCapacity(run, 1, ['live-auth']);
    const ref = { kind: 'team' as const, id: run.id };
    const teamBinding = {
      ...binding, consumerKind: 'team-slot' as const, teamId: 'squad', slotId: 'slot-2', personaId: 'reviewer'
    };

    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding: teamBinding })).toMatchObject({
      decision: 'authorized', authorization: { id: 'after-restart-1' }
    });
    expect(service.consume('after-restart-1', 'd2')).toMatchObject({ ok: true });
    service.complete('live-auth');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd3', binding: { ...teamBinding, slotId: 'slot-3' } })).toMatchObject({
      decision: 'denied', reason: 'principal launch budget exhausted', usage: { active: 1, launched: 2 }, limit: { concurrent: 2, launchesPerRun: 2 }
    });
  });

  it('returns current usage and limits on concurrent rejection', () => {
    const oneAtATime = { ...principal, maxConcurrent: 1 };
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => oneAtATime, id: () => 'auth-one' });
    const ref = { kind: oneAtATime.kind, id: oneAtATime.id };
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding }).decision).toBe('authorized');
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding })).toMatchObject({
      decision: 'denied', reason: 'principal concurrent launch limit reached', usage: { active: 1, launched: 0 }, limit: { concurrent: 1, launchesPerRun: 3 }
    });
  });

  it('validates preissued principal, project, binding, expiry, and single use', () => {
    let now = 100;
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => principal, now: () => now, id: () => 'issued-auth' });
    const ref = { kind: principal.kind, id: principal.id };
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'digest', binding, expiresAt: 200 }).decision).toBe('authorized');
    expect(service.validatePreissued('issued-auth', { principal: { ...ref, id: 'other' }, projectId: 'p1', binding })).toEqual({ ok: false, reason: 'authorization principal mismatch' });
    expect(service.validatePreissued('issued-auth', { principal: ref, projectId: 'p2', binding })).toEqual({ ok: false, reason: 'authorization project mismatch' });
    expect(service.validatePreissued('issued-auth', { principal: ref, projectId: 'p1', binding: { ...binding, slotId: 'changed' } })).toEqual({ ok: false, reason: 'authorization binding mismatch' });
    expect(service.consumePreissued('issued-auth', { principal: ref, projectId: 'p1', binding })).toMatchObject({ ok: true });
    expect(service.consumePreissued('issued-auth', { principal: ref, projectId: 'p1', binding })).toEqual({ ok: false, reason: 'authorization is consumed' });

    const stale = new LaunchAuthorizationService({ resolvePrincipal: () => principal, now: () => now, id: () => 'stale-auth' });
    expect(stale.authorize({ principal: ref, projectId: 'p1', launchDigest: 'digest', binding, expiresAt: 200 }).decision).toBe('authorized');
    now = 200;
    expect(stale.validatePreissued('stale-auth', { principal: ref, projectId: 'p1', binding })).toEqual({ ok: false, reason: 'authorization is expired' });
  });

  it('lazily releases expired reservations before enforcing concurrent capacity', () => {
    let now = 100;
    let next = 0;
    const oneAtATime = { ...principal, maxConcurrent: 1 };
    const service = new LaunchAuthorizationService({
      resolvePrincipal: () => oneAtATime,
      now: () => now,
      id: () => `auth-${++next}`
    });
    const ref = { kind: oneAtATime.kind, id: oneAtATime.id };
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding, expiresAt: 150 }).decision).toBe('authorized');

    now = 150;
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding, expiresAt: 200 })).toMatchObject({
      decision: 'authorized', authorization: { id: 'auth-2' }
    });
    expect(service.get('auth-1')).toBeUndefined();
  });

  it('bounds retained authorizations and prunes expired entries across principals', () => {
    let now = 100;
    let next = 0;
    const principals = new Map<string, LaunchPrincipal>();
    const service = new LaunchAuthorizationService({
      resolvePrincipal: (id) => principals.get(id),
      now: () => now,
      id: () => `auth-${++next}`,
      maxAuthorizations: 2
    });
    const authorize = (id: string, expiresAt: number) => {
      const candidate = { ...principal, id };
      principals.set(id, candidate);
      return service.authorize({
        principal: { kind: candidate.kind, id }, projectId: 'p1', launchDigest: id, binding, expiresAt
      });
    };

    expect(authorize('principal-1', 150).decision).toBe('authorized');
    expect(authorize('principal-2', 150).decision).toBe('authorized');
    expect(authorize('principal-3', 200)).toMatchObject({
      decision: 'denied', reason: 'authorization store limit reached'
    });

    now = 150;
    expect(authorize('principal-3', 200)).toMatchObject({
      decision: 'authorized', authorization: { id: 'auth-3' }
    });
    expect(service.get('auth-1')).toBeUndefined();
    expect(service.get('auth-2')).toBeUndefined();
    expect(service.hasActivePrincipal('principal-1')).toBe(false);
    expect(service.forgetPrincipal('principal-1')).toBe(true);
  });

  it('releases capacity when validation discovers expiry', () => {
    let now = 100;
    let next = 0;
    const oneAtATime = { ...principal, maxConcurrent: 1 };
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => oneAtATime, now: () => now, id: () => `auth-${++next}` });
    const ref = { kind: oneAtATime.kind, id: oneAtATime.id };
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding, expiresAt: 150 }).decision).toBe('authorized');
    now = 150;
    expect(service.validatePreissued('auth-1', { principal: ref, projectId: 'p1', binding })).toEqual({ ok: false, reason: 'authorization is expired' });
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding, expiresAt: 200 }).decision).toBe('authorized');
  });

  it('rejects team consumers outside main-owned allowedTeamIds', () => {
    const team: LaunchPrincipal = { kind: 'team', id: 'run', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'], maxConcurrent: 2, maxLaunchesPerRun: 2 };
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => team });
    expect(service.authorize({
      principal: { kind: 'team', id: 'run' }, projectId: 'p1', launchDigest: 'd',
      binding: { ...binding, consumerKind: 'team-slot', teamId: 'other', slotId: 'slot' }
    })).toEqual({ decision: 'denied', reason: 'team "other" is not allowed' });
  });

  it('allows only explicit authorization transitions', () => {
    expect(canTransitionAuthorization('authorized', 'consumed')).toBe(true);
    expect(canTransitionAuthorization('authorized', 'expired')).toBe(true);
    expect(canTransitionAuthorization('authorized', 'revoked')).toBe(true);
    for (const terminal of ['consumed', 'expired', 'revoked'] as const) {
      expect(canTransitionAuthorization(terminal, 'authorized')).toBe(false);
      expect(canTransitionAuthorization(terminal, terminal)).toBe(false);
    }
  });

  it('binds team principals only with a main-derived team id', () => {
    const ref = { kind: 'team' as const, id: 'team:squad:run-1' };
    const limits = { id: ref.id, allowedProjectIds: ['p1'], maxConcurrent: 32, maxLaunchesPerRun: 32 };
    expect(bindLaunchPrincipal(ref, limits)).toBeUndefined();
    expect(bindLaunchPrincipal(ref, limits, 'squad')).toEqual({ ...limits, kind: 'team', allowedTeamIds: ['squad'] });
  });

  it('authorizes a restored Team slot only for its host-bound Team id', () => {
    const ref = { kind: 'team' as const, id: 'restore:capability-1' };
    const restored = bindLaunchPrincipal(ref, {
      id: ref.id,
      allowedProjectIds: ['p1'],
      maxConcurrent: 32,
      maxLaunchesPerRun: 32
    }, 'squad');
    expect(restored).toBeDefined();
    const service = new LaunchAuthorizationService({ resolvePrincipal: () => restored });
    const restoredBinding = {
      ...binding,
      consumerKind: 'team-slot' as const,
      teamId: 'squad',
      slotId: 'reviewer:0',
      personaId: 'reviewer'
    };

    expect(service.authorize({
      principal: ref,
      projectId: 'p1',
      launchDigest: 'restored',
      binding: restoredBinding
    }).decision).toBe('authorized');
    expect(service.authorize({
      principal: ref,
      projectId: 'p1',
      launchDigest: 'forged',
      binding: { ...restoredBinding, teamId: 'other', slotId: 'reviewer:1' }
    })).toEqual({ decision: 'denied', reason: 'team "other" is not allowed' });
  });
});
