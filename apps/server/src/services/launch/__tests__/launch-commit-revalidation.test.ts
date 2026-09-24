import { describe, expect, it } from 'vitest';
import { revalidateLaunchCommit, projectsForStoreRevision } from '../commit-revalidation.js';
import { preflightLaunch } from '../preflight.js';
import { launchDigest } from '../digest.js';

function fixture() {
  const project = { id: 'p1', path: '/repo' };
  const plan = preflightLaunch({ prompt: 'work' }, {
    principal: () => ({ kind: 'schedule', id: 'schedule:1' }),
    resolve: () => ({ project, storeRevision: 'stores:1' }),
    sessionId: () => 'session-1'
  });
  return { plan, project };
}

describe('launch commit revalidation', () => {
  it('accepts unchanged project, stores, task, and available capacity', () => {
    const { plan, project } = fixture();
    expect(revalidateLaunchCommit(plan, {
      project, storeRevision: 'stores:1', liveCount: 2, capacity: 3
    })).toEqual({ ok: true });
  });

  it('accepts an activity timestamp update after preflight', () => {
    const { plan, project } = fixture();
    expect(revalidateLaunchCommit(plan, {
      project: { ...project, lastActiveAt: Date.now() },
      storeRevision: 'stores:1',
      liveCount: 2,
      capacity: 3
    })).toEqual({ ok: true });
  });

  it.each([
    ['project identity changed after preflight', { project: { id: 'p1', path: '/other' } }],
    ['launch stores changed after preflight', { storeRevision: 'stores:2' }],
    ['launch capacity changed after preflight', { liveCount: 3 }]
  ])('rejects %s', (reason, patch) => {
    const { plan, project } = fixture();
    expect(revalidateLaunchCommit(plan, {
      project, storeRevision: 'stores:1', liveCount: 2, capacity: 3, ...patch
    })).toEqual({ ok: false, reason });
  });
});

describe('projectsForStoreRevision', () => {
  // Regression for the Team multi-slot launch failure "launch stores changed
  // after preflight": a concurrent touchProject bumps lastActiveAt between a
  // slot's preflight and commit. The storeRevision digest MUST ignore that
  // activity noise (mirrors projectIdentityDigest) so an already-authorized
  // launch is not invalidated at commit.
  it('yields an identical storeRevision digest when only lastActiveAt differs', () => {
    const base = [
      { id: 'p1', path: '/repo', name: 'Repo' },
      { id: 'p2', path: '/other', name: 'Other' }
    ];
    const preflight = base.map((p, i) => ({ ...p, lastActiveAt: 1_000 + i }));
    const commit = base.map((p, i) => ({ ...p, lastActiveAt: 9_999_999 + i }));

    expect(launchDigest({ projects: projectsForStoreRevision(preflight) }))
      .toBe(launchDigest({ projects: projectsForStoreRevision(commit) }));
  });

  it('still reflects a real identity change (path/name), not just lastActiveAt', () => {
    const preflight = [{ id: 'p1', path: '/repo', lastActiveAt: 1 }];
    const renamed = [{ id: 'p1', path: '/repo-renamed', lastActiveAt: 1 }];

    expect(launchDigest({ projects: projectsForStoreRevision(preflight) }))
      .not.toBe(launchDigest({ projects: projectsForStoreRevision(renamed) }));
  });

  it('strips the lastActiveAt key from every entry', () => {
    const stripped = projectsForStoreRevision([{ id: 'p1', path: '/repo', lastActiveAt: 5 }]);
    expect(stripped).toEqual([{ id: 'p1', path: '/repo' }]);
    expect('lastActiveAt' in stripped[0]).toBe(false);
  });
});

describe('storeRevision fence end-to-end (preflight -> commit)', () => {
  // Mirrors the production launch coordinator (host.ts): the caller computes
  // binding.storeRevision at preflight and the current storeRevision at commit
  // both via launchDigest({ projects: projectsForStoreRevision(list), ... }).
  // This proves the helper is actually wired into the fence so a concurrent
  // touchProject (lastActiveAt bump) between a slot's preflight and commit does
  // NOT trip "launch stores changed after preflight".
  function computeStoreRevision(projects: readonly { id: string; path: string; lastActiveAt?: number }[]): string {
    return launchDigest({ projects: projectsForStoreRevision(projects), config: { theme: 'dark' } });
  }

  function planFor(projects: readonly { id: string; path: string; lastActiveAt?: number }[]) {
    const project = projects[0];
    return preflightLaunch({ prompt: 'work' }, {
      principal: () => ({ kind: 'schedule', id: 'schedule:1' }),
      resolve: () => ({ project, storeRevision: computeStoreRevision(projects) }),
      sessionId: () => 'session-1'
    });
  }

  it('accepts commit when only lastActiveAt changed between preflight and commit', () => {
    const atPreflight = [
      { id: 'p1', path: '/repo', lastActiveAt: 1_000 },
      { id: 'p2', path: '/other', lastActiveAt: 2_000 }
    ];
    const plan = planFor(atPreflight);
    // A sibling slot spawn / renderer touchProject bumps lastActiveAt on both.
    const atCommit = atPreflight.map((p) => ({ ...p, lastActiveAt: 9_999_999 }));
    const result = revalidateLaunchCommit(plan, {
      project: { ...atCommit[0] },
      storeRevision: computeStoreRevision(atCommit),
      liveCount: 1,
      capacity: 3
    });
    expect(result).toEqual({ ok: true });
  });

  it('still rejects commit when a real project identity (path) changed', () => {
    const atPreflight = [
      { id: 'p1', path: '/repo', lastActiveAt: 1_000 },
      { id: 'p2', path: '/other', lastActiveAt: 2_000 }
    ];
    const plan = planFor(atPreflight);
    // The BOUND project (p1) is unchanged, so projectIdentityDigest still
    // matches; a SIBLING project's path moved, which is a real store change the
    // storeRevision fence must catch (not a lastActiveAt bump).
    const atCommit = [
      { id: 'p1', path: '/repo', lastActiveAt: 9_999_999 },
      { id: 'p2', path: '/other-moved', lastActiveAt: 9_999_999 }
    ];
    const result = revalidateLaunchCommit(plan, {
      project: { ...atCommit[0] },
      storeRevision: computeStoreRevision(atCommit),
      liveCount: 1,
      capacity: 3
    });
    expect(result).toEqual({ ok: false, reason: 'launch stores changed after preflight' });
  });
});
