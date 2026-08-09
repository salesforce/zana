import { describe, expect, it } from 'vitest';
import { revalidateLaunchCommit } from '../launch/commit-revalidation.js';
import { preflightLaunch } from '../launch/preflight.js';

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
