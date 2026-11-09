import { describe, expect, it } from 'vitest';
import { LaunchAuthorizationService, RESPAWN_APPROVAL_TTL_MS } from '../authorization.js';
import type { LaunchPrincipal } from '../types.js';

/** #579: the launch path revokes and re-issues a pre-issued approval just before it spawns; a respawn approval must stay a respawn. */
const team: LaunchPrincipal = { kind: 'team', id: 'team:squad:run-1', allowedProjectIds: ['p1'], allowedTeamIds: ['squad'], maxConcurrent: 1, maxLaunchesPerRun: 1 };
const ref = { kind: 'team' as const, id: team.id };
const binding = {
  consumerKind: 'team-slot' as const, teamId: 'squad', slotId: '1:worker:0', personaId: 'worker', profileId: 'claude',
  initialTaskDigest: 'task', scope: 'local' as const, storeRevision: 'rev-1', projectIdentityDigest: 'project', autonomous: true, expiresAt: 5_000
};
const expected = { principal: ref, projectId: 'p1', binding };

function endedFirstSession(now = { value: 100 }) {
  let next = 0;
  const service = new LaunchAuthorizationService({ resolvePrincipal: () => team, id: () => `auth-${++next}`, now: () => now.value });
  const first = service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding });
  if (first.decision !== 'authorized') throw new Error('setup');
  service.consume(first.authorization.id, 'd1');
  service.complete(first.authorization.id);
  return { service, firstId: first.authorization.id, now };
}

describe('respawn approval through the launch path', () => {
  it('survives the revoke and re-issue, and its consume still takes no launch and counts the seat once', () => {
    const { service, firstId } = endedFirstSession();
    const respawn = service.authorizeRespawn(firstId, expected);
    if (!respawn.ok) throw new Error(respawn.reason);
    const id = respawn.authorization.id;
    expect(service.isRespawn(id)).toBe(true);
    expect(service.respawnPriorOf(id)).toBe(firstId);
    expect(service.outstandingRespawn(firstId)).toBe(id);
    // an unspent respawn also fills the run's one concurrent slot, so a second is refused either way
    expect(service.authorizeRespawn(firstId, expected)).toMatchObject({ ok: false });
    expect(service.revoke(id)).toBe(true);
    const reissued = service.authorize({ principal: ref, projectId: 'p1', launchDigest: respawn.authorization.launchDigest, binding: respawn.authorization.binding, respawnOf: firstId });
    if (reissued.decision !== 'authorized') throw new Error('re-issue refused');
    expect(service.isRespawn(reissued.authorization.id)).toBe(true);
    expect(service.consume(reissued.authorization.id, respawn.authorization.launchDigest)).toMatchObject({ ok: true });
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'x', binding })).toMatchObject({ decision: 'denied' });
    service.complete(reissued.authorization.id);
    expect(service.isRespawn(reissued.authorization.id)).toBe(false);
    expect(service.authorizeRespawn(firstId, expected)).toMatchObject({ ok: false });
  });

  it('refuses an ordinary authorize that claims to re-issue a respawn nobody revoked', () => {
    const { service, firstId } = endedFirstSession();
    expect(service.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd', binding, respawnOf: firstId })).toMatchObject({
      decision: 'denied', reason: 'respawn authorization is not being re-issued'
    });
  });

  it('lets a respawn that was never spent be minted again once its approval expired', () => {
    const { service, firstId, now } = endedFirstSession();
    const first = service.authorizeRespawn(firstId, expected);
    expect(first).toMatchObject({ ok: true });
    now.value += RESPAWN_APPROVAL_TTL_MS + 1;
    expect(service.outstandingRespawn(firstId)).toBeUndefined();
    expect(service.authorizeRespawn(firstId, expected)).toMatchObject({ ok: true });
  });

  it('refuses when the store is full, the principal is unknown or the project is not allowed', () => {
    let next = 0;
    const roomy: LaunchPrincipal = { ...team, maxConcurrent: 3, maxLaunchesPerRun: 3 };
    const full = new LaunchAuthorizationService({ resolvePrincipal: () => roomy, id: () => `a-${++next}`, now: () => 100, maxAuthorizations: 2 });
    const first = full.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd1', binding });
    if (first.decision !== 'authorized') throw new Error('setup');
    full.consume(first.authorization.id, 'd1');
    full.complete(first.authorization.id);
    full.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd2', binding: { ...binding, slotId: '2:worker:0' } });
    full.authorize({ principal: ref, projectId: 'p1', launchDigest: 'd3', binding: { ...binding, slotId: '3:worker:0' } });
    expect(full.authorizeRespawn(first.authorization.id, expected)).toMatchObject({ ok: false, reason: 'authorization store limit reached' });
    const stranger = new LaunchAuthorizationService({ resolvePrincipal: () => ({ ...roomy, allowedProjectIds: ['other'] }), id: () => 'z', now: () => 100 });
    expect(stranger.authorizeRespawn('x', expected)).toMatchObject({ ok: false });

    const gone = new LaunchAuthorizationService({ resolvePrincipal: () => undefined, id: () => 'g', now: () => 100 });
    expect(gone.authorizeRespawn('x', expected)).toMatchObject({ ok: false });
  });

  it('forgetting the principal drops its consumed approvals and respawn counts', () => {
    const { service, firstId } = endedFirstSession();
    const respawn = service.authorizeRespawn(firstId, expected);
    if (!respawn.ok) throw new Error('setup');
    service.complete(respawn.authorization.id);
    expect(service.forgetPrincipal(team.id)).toBe(true);
    expect(service.authorizeRespawn(firstId, expected)).toMatchObject({ ok: false });
  });
});
