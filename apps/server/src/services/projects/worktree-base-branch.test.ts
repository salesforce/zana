import { describe, expect, it } from 'vitest';
import { resolveDefaultWorktreeBaseBranch } from './worktree-base-branch.js';

describe('worktree base branch', () => {
  it('prefers origin default when local is equal or behind', () => {
    expect(resolveDefaultWorktreeBaseBranch({
      localDefault: 'main',
      originDefault: 'main',
      relation: 'equal'
    })).toBe('main');
    expect(resolveDefaultWorktreeBaseBranch({
      localDefault: 'main',
      originDefault: 'develop',
      relation: 'local-behind'
    })).toBe('develop');
  });

  it('keeps a diverged or ahead local default', () => {
    expect(resolveDefaultWorktreeBaseBranch({
      localDefault: 'main',
      originDefault: 'develop',
      relation: 'diverged'
    })).toBe('main');
    expect(resolveDefaultWorktreeBaseBranch({
      localDefault: 'main',
      originDefault: 'develop',
      relation: 'local-ahead'
    })).toBe('main');
  });
});
