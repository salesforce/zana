import { describe, expect, it } from 'vitest';
import { defaultWorkspaceChoice, workspaceToSpawnChoice } from './EnvironmentPicker.js';

describe('environment picker mapping', () => {
  it('passes picker values through as spawn choices', () => {
    expect(workspaceToSpawnChoice({ kind: 'unmanaged' })).toEqual({ kind: 'unmanaged' });
    expect(workspaceToSpawnChoice({ kind: 'worktree', branchSlug: 'feat' })).toEqual({
      kind: 'worktree',
      branchSlug: 'feat'
    });
    expect(workspaceToSpawnChoice({
      kind: 'reuse',
      environmentId: '11111111-1111-4111-8111-111111111111'
    }).kind).toBe('reuse');
  });

  it('defaults the picker from worktreeIsolationDefault', () => {
    expect(defaultWorkspaceChoice(true)).toEqual({ kind: 'worktree' });
    expect(defaultWorkspaceChoice(false)).toEqual({ kind: 'unmanaged' });
  });
});
