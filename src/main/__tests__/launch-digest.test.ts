import { describe, expect, it } from 'vitest';
import { canonicalJson, launchDigest, taskDigest } from '../launch/digest.js';
import { finalizeLaunchPreflight, preflightLaunch } from '../launch/preflight.js';

describe('launch digest', () => {
  it('is stable across object key order and excludes envelope ids and timestamps', () => {
    const left = {
      authorizationId: 'auth-1',
      createdAt: 10,
      request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24, extraArgs: ['--a', '--b'] }
    };
    const right = {
      createdAt: 999,
      request: { rows: 24, extraArgs: ['--a', '--b'], cols: 80, profile: 'claude', projectId: 'p1' },
      authorizationId: 'auth-2'
    };

    expect(canonicalJson({ z: 1, a: { y: 2, x: 3 } })).toBe('{"a":{"x":3,"y":2},"z":1}');
    expect(launchDigest(left)).toBe(launchDigest(right));
    expect(launchDigest(left)).toMatch(/^launch-v1:[a-f0-9]{64}$/);
  });

  it('keeps arrays ordered and changes when effective launch intent changes', () => {
    const base = { request: { projectId: 'p1', profile: 'claude', cols: 80, rows: 24, extraArgs: ['--a', '--b'] } };
    expect(launchDigest(base)).not.toBe(launchDigest({ request: { ...base.request, extraArgs: ['--b', '--a'] } }));
    expect(launchDigest(base)).not.toBe(launchDigest({ request: { ...base.request, projectId: 'p2' } }));
  });

  it('binds execution evidence, consent, and actual scope into canonical launch digest', () => {
    const plan = preflightLaunch({ projectId: 'p1' }, {
      principal: () => ({ kind: 'interactive-user', id: 'u' }), resolve: () => ({ project: { id: 'p1' } }),
      sessionId: () => 'session-1', idempotencyKey: () => 'key-1'
    });
    const local = finalizeLaunchPreflight(plan, {
      decision: 'allowed', scope: 'local', targetDigest: 'target', evidenceDigest: 'evidence',
      consentReservation: { id: 'reservation-1', scope: 'project' }
    });
    const remote = finalizeLaunchPreflight(plan, {
      decision: 'allowed', scope: 'remote', targetDigest: 'target', evidenceDigest: 'evidence',
      consentReservation: { id: 'reservation-2', scope: 'one-launch' }
    });
    expect(local.digest).not.toBe(remote.digest);
    expect(local.digest).not.toBe(plan.digest);
  });

  it('binds initial task and autonomous mutation into preflight digest', () => {
    const deps = { principal: () => ({ kind: 'team' as const, id: 'run' }), resolve: () => ({ project: { id: 'p1' }, storeRevision: 'r1' }), sessionId: () => 's', idempotencyKey: () => 'k' };
    const normal = preflightLaunch({ prompt: 'task' }, { ...deps, binding: () => ({ consumerKind: 'team-slot', personaId: 'p', teamId: 't', slotId: '0', scope: 'local', autonomous: false }) });
    const autonomous = preflightLaunch({ prompt: 'task' }, { ...deps, binding: () => ({ consumerKind: 'team-slot', personaId: 'p', teamId: 't', slotId: '0', scope: 'local', autonomous: true }) });
    const changedTask = preflightLaunch({ prompt: 'other' }, { ...deps, binding: () => ({ consumerKind: 'team-slot', personaId: 'p', teamId: 't', slotId: '0', scope: 'local', autonomous: false }) });
    expect(normal.digest).not.toBe(autonomous.digest);
    expect(normal.digest).not.toBe(changedTask.digest);
    expect(normal.binding.initialTaskDigest).toMatch(/^launch-v1:/);
  });

  it('digests exact initial task text and bytes', () => {
    expect(taskDigest('build café')).toBe(taskDigest(new TextEncoder().encode('build café')));
    expect(taskDigest('build café')).not.toBe(taskDigest('build cafe'));
    expect(taskDigest(new Uint8Array([0, 1, 2]))).not.toBe(taskDigest(new Uint8Array([0, 1, 3])));
    expect(taskDigest('build café')).toMatch(/^launch-v1:[a-f0-9]{64}$/);
  });
});
