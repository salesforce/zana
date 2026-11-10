import { describe, expect, it, vi } from 'vitest';
import { LaunchAuthorizationService, MAX_RESPAWNS_PER_SLOT } from '../authorization.js';
import type { LaunchPrincipal } from '../types.js';

/** #579: the single-use approval for a fresh session of a seat whose first session ended. */
const team: LaunchPrincipal = {
  kind: 'team', id: 'team:squad:run-1', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'], maxConcurrent: 1, maxLaunchesPerRun: 1
};
const ref = { kind: 'team' as const, id: team.id };
const binding = {
  consumerKind: 'team-slot' as const, teamId: 'squad', slotId: '1:worker:0', personaId: 'worker', profileId: 'claude',
  initialTaskDigest: 'task', scope: 'local' as const, storeRevision: 'rev-1', projectIdentityDigest: 'project',
  autonomous: true, expiresAt: 5_000, deadlineAt: 4_000
};
const expectedFor = (over: Partial<typeof binding> = {}) => ({ principal: ref, projectId: 'p1', binding: { ...binding, ...over } });

function setup(principal: LaunchPrincipal = team) {
  let next = 0;
  const service = new LaunchAuthorizationService({ resolvePrincipal: () => principal, id: () => `auth-${++next}`, now: () => 100 });
  const first = service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding });
  if (first.decision !== 'authorized') throw new Error('setup');
  return { service, firstId: first.authorization.id };
}

/** The first session: approval authorized, consumed, then completed when the session exits. */
function endedFirstSession(principal?: LaunchPrincipal) {
  const ctx = setup(principal);
  expect(ctx.service.consume(ctx.firstId, 'd1')).toMatchObject({ ok: true });
  ctx.service.complete(ctx.firstId);
  return ctx;
}

describe('REQ-5 authorizeRespawn', () => {
  it('mints one single-use approval with the same binding and no deadline, after the prior one completed', () => {
    const { service, firstId } = endedFirstSession();
    const result = service.authorizeRespawn(firstId, expectedFor());
    expect(result).toMatchObject({ ok: true, authorization: { state: 'authorized', projectId: 'p1' } });
    if (!result.ok) return;
    expect(result.authorization.id).not.toBe(firstId);
    expect(result.authorization.binding).toEqual({ ...binding, deadlineAt: undefined });
    expect(result.authorization.binding.deadlineAt).toBeUndefined();
    expect(service.authorizeRespawn(firstId, expectedFor())).toMatchObject({ ok: false });
  });

  it('does not count a respawn toward the run launch cap', () => {
    const { service, firstId } = endedFirstSession();
    const respawn = service.authorizeRespawn(firstId, expectedFor());
    if (!respawn.ok) throw new Error(`respawn refused: ${respawn.reason}`);
    // maxLaunchesPerRun is 1 and the first session already used it: a plain consume would be refused.
    expect(service.consumePreissued(respawn.authorization.id, expectedFor({ deadlineAt: undefined }))).toMatchObject({ ok: true });
    service.complete(respawn.authorization.id);
    const second = service.authorizeRespawn(respawn.authorization.id, expectedFor({ deadlineAt: undefined }));
    expect(second).toMatchObject({ ok: true });
  });

  it('refuses a prior that was never consumed, is unknown, or is not a team-slot approval', () => {
    const { service, firstId } = setup();
    service.complete(firstId);
    expect(service.authorizeRespawn(firstId, expectedFor())).toMatchObject({ ok: false });
    expect(service.authorizeRespawn('nope', expectedFor())).toMatchObject({ ok: false });
    const terminal = new LaunchAuthorizationService({
      resolvePrincipal: () => ({ kind: 'interactive-user', id: 'user:local', allowedProjectIds: ['p1'], maxConcurrent: 2, maxLaunchesPerRun: 3 }),
      id: () => 'term-1', now: () => 100
    });
    const tBinding = { ...binding, consumerKind: 'terminal' as const };
    terminal.authorize({ principal: { kind: 'interactive-user', id: 'user:local' }, projectId: 'p1', launchDigest: 'd', binding: tBinding });
    terminal.consume('term-1', 'd');
    terminal.complete('term-1');
    expect(terminal.authorizeRespawn('term-1', { principal: { kind: 'interactive-user', id: 'user:local' }, projectId: 'p1', binding: tBinding })).toMatchObject({ ok: false });
  });

  it.each([
    ['another principal', { principal: { kind: 'team' as const, id: 'team:other' }, projectId: 'p1', binding }],
    ['another project', { principal: ref, projectId: 'p2', binding }],
    ['another persona', expectedFor({ personaId: 'reviewer' })],
    ['another slot', expectedFor({ slotId: '2:worker:0' })],
    ['another store revision', expectedFor({ storeRevision: 'rev-2' })],
    ['another task digest', expectedFor({ initialTaskDigest: 'other' })],
    ['another scope', expectedFor({ scope: 'remote' })]
  ])('refuses a respawn for %s', (_name, expected) => {
    const { service, firstId } = endedFirstSession();
    expect(service.authorizeRespawn(firstId, expected)).toMatchObject({ ok: false });
  });

  it('refuses while the prior session approval is still active (maxConcurrent holds)', () => {
    const { service, firstId } = setup();
    service.consume(firstId, 'd1');
    expect(service.authorizeRespawn(firstId, expectedFor())).toMatchObject({ ok: false });
  });

  it('caps respawns per slot and clears the count when the principal is forgotten', () => {
    const roomy: LaunchPrincipal = { ...team, maxLaunchesPerRun: 1 };
    const { service, firstId } = endedFirstSession(roomy);
    let prior = firstId;
    for (let i = 0; i < MAX_RESPAWNS_PER_SLOT; i += 1) {
      const result = service.authorizeRespawn(prior, expectedFor({ deadlineAt: i === 0 ? binding.deadlineAt : undefined }));
      if (!result.ok) throw new Error(`respawn ${i + 1} refused: ${result.reason}`);
      expect(service.consumePreissued(result.authorization.id, { principal: ref, projectId: 'p1', binding: result.authorization.binding })).toMatchObject({ ok: true });
      service.complete(result.authorization.id);
      prior = result.authorization.id;
    }
    expect(service.authorizeRespawn(prior, expectedFor({ deadlineAt: undefined }))).toMatchObject({ ok: false });
    expect(service.forgetPrincipal(team.id)).toBe(true);
    expect(service.authorizeRespawn(prior, expectedFor({ deadlineAt: undefined }))).toMatchObject({ ok: false });
  });
});

describe('REQ-5 today\'s launches never respawn', () => {
  it('authorize, consume and complete behave as before and never call authorizeRespawn', () => {
    const { service, firstId } = setup();
    const spy = vi.spyOn(service, 'authorizeRespawn');
    expect(service.consume(firstId, 'd1')).toMatchObject({ ok: true });
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding: { ...binding, slotId: '2:worker:0' } })).toMatchObject({
      decision: 'denied', reason: 'principal launch budget exhausted'
    });
    service.complete(firstId);
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding: { ...binding, slotId: '2:worker:0' } })).toMatchObject({
      decision: 'denied', reason: 'principal launch budget exhausted'
    });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('COR-002 / REQ-5 a respawn needs the prior session to have completed, even with spare concurrency', () => {
  it('refuses while the prior approval is consumed but not complete()d, when maxConcurrent would allow a second', () => {
    const roomy: LaunchPrincipal = { ...team, maxConcurrent: 2, maxLaunchesPerRun: 2 };
    const { service, firstId } = setup(roomy);
    expect(service.consume(firstId, 'd1')).toMatchObject({ ok: true });
    expect(service.authorizeRespawn(firstId, expectedFor())).toMatchObject({ ok: false });
    service.complete(firstId);
    expect(service.authorizeRespawn(firstId, expectedFor())).toMatchObject({ ok: true });
  });
});

describe('forgetPrincipal keeps another run\'s re-issue marker (F-rotating)', () => {
  it('does not drop the pending re-issue of a different principal', () => {
    const other: LaunchPrincipal = { ...team, id: 'team:squad:run-2' };
    const otherRef = { kind: 'team' as const, id: other.id };
    let next = 0;
    const service = new LaunchAuthorizationService({
      resolvePrincipal: (id) => (id === other.id ? other : team), id: () => `auth-${++next}`, now: () => 100
    });
    const first = service.authorize({ principal: otherRef, projectId: 'p1', launchDigest: 'd1', binding });
    if (first.decision !== 'authorized') throw new Error('setup');
    service.consume(first.authorization.id, 'd1');
    service.complete(first.authorization.id);
    const respawn = service.authorizeRespawn(first.authorization.id, { principal: otherRef, projectId: 'p1', binding });
    if (!respawn.ok) throw new Error('setup respawn');
    service.revoke(respawn.authorization.id);
    const mine = service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'x', binding });
    if (mine.decision === 'authorized') service.complete(mine.authorization.id);
    expect(service.forgetPrincipal(team.id)).toBe(true);
    const reissued = service.authorize({ principal: otherRef, projectId: 'p1', launchDigest: respawn.authorization.launchDigest, binding: respawn.authorization.binding, respawnOf: first.authorization.id });
    expect(reissued.decision).toBe('authorized');
    expect(service.isRespawn(reissued.decision === 'authorized' ? reissued.authorization.id : '')).toBe(true);
  });
});
