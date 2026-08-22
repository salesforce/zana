import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { defaultWorkspaceChoice, workspaceToSpawnChoice } from './EnvironmentPicker.js';

describe('environment picker mapping', () => {
  it('passes picker values through as spawn choices', () => {
    expect(workspaceToSpawnChoice({ kind: 'unmanaged' })).toEqual({ kind: 'unmanaged' });
    expect(workspaceToSpawnChoice({ kind: 'worktree', branchSlug: 'feat', baseBranch: 'main' })).toEqual({
      kind: 'worktree',
      branchSlug: 'feat',
      baseBranch: 'main'
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

describe('EnvironmentPicker base branch', () => {
  it('loads project branches when New worktree is selected', () => {
    const source = readFileSync(new URL('./EnvironmentPicker.tsx', import.meta.url), 'utf8');
    expect(source).toContain('/projects/${encodeURIComponent(projectId)}/branches');
    expect(source).toContain('baseBranch');
    expect(source).toContain("kind: 'worktree'");
  });
});
