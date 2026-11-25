import { describe, expect, it } from 'vitest';
import { launchLocationLabel } from './launch-location-label.js';

describe('launchLocationLabel', () => {
  it('names a branchless Project checkout HEAD, never "undefined"', () => {
    const label = launchLocationLabel({ path: 'C:\repo', location: { kind: 'project-root' } });
    expect(label).toBe('HEAD — C:\repo (Project)');
    expect(label).not.toContain('undefined');
  });

  it('keeps the branch name when there is one', () => {
    expect(launchLocationLabel({ branch: 'main', path: '/repo', location: { kind: 'project-root' } })).toBe('main — /repo (Project)');
  });

  it('marks a user-owned worktree', () => {
    expect(launchLocationLabel({ branch: 'feat', path: '/wt', location: { kind: 'worktree' } })).toBe('feat — /wt (user-owned)');
  });

  it('describes a new worktree without a path', () => {
    expect(launchLocationLabel({ path: '', location: { kind: 'new-worktree', baseBranch: 'main', isolationSource: 'project' } }))
      .toBe('New worktree from main — isolation: project; path assigned at launch');
  });
});
