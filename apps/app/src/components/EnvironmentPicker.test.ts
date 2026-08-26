import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  defaultWorkspaceChoice,
  EXISTING_WORKTREE_DISABLED_REASON,
  NEW_WORKTREE_DISABLED_REASON,
  resolveExistingWorktreeDisabledReason,
  resolveNewWorktreeDisabledReason,
  snapWorkspaceChoice,
  workspaceToSpawnChoice
} from './EnvironmentPicker.js';

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

describe('worktree disabled reasons', () => {
  it('disables New worktree when the project has no local branches', () => {
    expect(resolveNewWorktreeDisabledReason([])).toBe(NEW_WORKTREE_DISABLED_REASON);
    expect(resolveNewWorktreeDisabledReason(['main'])).toBeNull();
  });

  it('disables Existing worktree when none are ready', () => {
    expect(resolveExistingWorktreeDisabledReason(0)).toBe(EXISTING_WORKTREE_DISABLED_REASON);
    expect(resolveExistingWorktreeDisabledReason(2)).toBeNull();
  });

  it('snaps New worktree and Existing worktree back to Work locally when disabled', () => {
    expect(snapWorkspaceChoice({ kind: 'worktree' }, {
      newWorktreeDisabled: true,
      existingWorktreeDisabled: false
    })).toEqual({ kind: 'unmanaged' });
    expect(snapWorkspaceChoice({
      kind: 'reuse',
      environmentId: '11111111-1111-4111-8111-111111111111'
    }, {
      newWorktreeDisabled: false,
      existingWorktreeDisabled: true
    })).toEqual({ kind: 'unmanaged' });
    expect(snapWorkspaceChoice({ kind: 'unmanaged' }, {
      newWorktreeDisabled: true,
      existingWorktreeDisabled: true
    })).toEqual({ kind: 'unmanaged' });
  });

  it('rewrites a stale reuse id to the first ready worktree', () => {
    expect(snapWorkspaceChoice({
      kind: 'reuse',
      environmentId: '11111111-1111-4111-8111-111111111111'
    }, {
      newWorktreeDisabled: false,
      existingWorktreeDisabled: false,
      reuseIds: ['22222222-2222-4222-8222-222222222222']
    })).toEqual({
      kind: 'reuse',
      environmentId: '22222222-2222-4222-8222-222222222222'
    });
  });
});

describe('EnvironmentPicker menu', () => {
  const source = readFileSync(new URL('./EnvironmentPicker.tsx', import.meta.url), 'utf8');

  it('keeps Work locally, New worktree, and Existing worktree as stable rows', () => {
    expect(source).toContain("label: 'Work locally'");
    expect(source).toContain("label: 'New worktree'");
    expect(source).toContain("label: 'Existing worktree'");
    expect(source).not.toContain('This checkout');
    expect(source).toContain('disabled: newWorktreeDisabledReason !== null');
    expect(source).toContain('disabled: existingWorktreeDisabledReason !== null');
  });

  it('loads project branches on mount so New worktree can disable with a reason', () => {
    expect(source).toContain('/projects/${encodeURIComponent(projectId)}/branches');
    expect(source).toContain('baseBranch');
    expect(source).toContain("kind: 'worktree'");
    expect(source).not.toContain("value.kind !== 'worktree'");
  });

  it('lists reuse targets in a second picklist after Existing worktree is chosen', () => {
    expect(source).toContain("value.kind === 'reuse' && environments.length > 0");
    expect(source).toContain('ariaLabel="Existing worktree"');
    expect(source).not.toContain('...environments.map');
  });
});

describe('PopoverPicklist descriptions', () => {
  it('renders an optional description line, compact trigger, and warning tone', () => {
    const source = readFileSync(
      new URL('../../../../packages/ui/src/popover-picklist.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain('description?: string');
    expect(source).toContain('compactLabel?: string');
    expect(source).toContain("tone?: 'default' | 'warning'");
    expect(source).toContain('launch-model-picker-option-description');
    expect(source).toContain('selected?.compactLabel ?? selected?.label');
    expect(source).toContain("selected?.tone === 'warning'");
  });
});
