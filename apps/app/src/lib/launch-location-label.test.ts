import { describe, expect, it } from 'vitest';
import { launchBranchLabel, launchLocationLabel } from './launch-location-label.js';

const root = { kind: 'project-root', projectId: 'p' } as const;

describe('launchLocationLabel', () => {
  it('names a branchless Project checkout HEAD, never "undefined"', () => {
    const label = launchLocationLabel({ path: 'C:\repo', location: root });
    expect(label).toBe('HEAD — C:\repo (Project)');
    expect(label).not.toContain('undefined');
  });

  it('treats a blank or null branch as missing', () => {
    expect(launchLocationLabel({ branch: '  ', path: '/repo', location: root })).toBe('HEAD — /repo (Project)');
    expect(launchLocationLabel({ branch: null, path: '/repo', location: root })).toBe('HEAD — /repo (Project)');
  });

  it('keeps the branch name when there is one', () => {
    expect(launchLocationLabel({ branch: 'main', path: '/repo', location: root })).toBe('main — /repo (Project)');
  });

  it('marks a user-owned worktree, and never prints undefined if its branch is missing', () => {
    const location = { kind: 'worktree', projectId: 'p', branch: 'feat', ownership: 'user' } as const;
    expect(launchLocationLabel({ branch: 'feat', path: '/wt', location })).toBe('feat — /wt (user-owned)');
    expect(launchLocationLabel({ path: '/wt', location })).toBe('HEAD — /wt (user-owned)');
  });

  it('describes a new worktree without a path', () => {
    const location = { kind: 'new-worktree', projectId: 'p', baseBranch: 'main', isolationSource: 'default' } as const;
    expect(launchLocationLabel({ location })).toBe('New worktree from main — isolation: default; path assigned at launch');
  });
});

describe('launchBranchLabel', () => {
  it('falls back to HEAD', () => {
    expect(launchBranchLabel(undefined)).toBe('HEAD');
    expect(launchBranchLabel('x')).toBe('x');
  });
});
