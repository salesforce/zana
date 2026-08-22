import { describe, expect, it } from 'vitest';
import { isValidGitBranchName } from './git-checkout.js';
import {
  buildManagedBranchName,
  resolveEnvironmentMergeBaseBranch,
  resolveEnvironmentWorkspaceDisplayKind,
  spawnEnvironmentChoiceSchema,
  workspaceProvisionTypeSchema
} from './environment.js';
import { workspaceDiffTargetSchema } from './workspace-diff.js';

describe('git branch names', () => {
  it('accepts zcc-prefixed feature names and rejects reserved refs', () => {
    expect(isValidGitBranchName('zcc/fix-login-abc')).toBe(true);
    expect(isValidGitBranchName('main')).toBe(true);
    expect(isValidGitBranchName('HEAD')).toBe(false);
    expect(isValidGitBranchName('feat space')).toBe(false);
    expect(isValidGitBranchName('../escape')).toBe(false);
  });
});

describe('environment helpers', () => {
  it('mints a stable managed branch from slug + thread id', () => {
    expect(buildManagedBranchName({ threadId: 'tid', branchSlug: 'feat' })).toBe('zcc/feat-tid');
    expect(buildManagedBranchName({ threadId: 'tid' })).toBe('zcc/tid');
  });

  it('prefers merge-base then base then default', () => {
    expect(resolveEnvironmentMergeBaseBranch({
      mergeBaseBranch: 'origin/main',
      baseBranch: 'main',
      defaultBranch: 'master'
    })).toBe('origin/main');
    expect(resolveEnvironmentMergeBaseBranch({ defaultBranch: 'main' })).toBe('main');
  });

  it('classifies display kind from provision type before isWorktree', () => {
    expect(resolveEnvironmentWorkspaceDisplayKind({
      workspaceProvisionType: 'managed-worktree',
      isWorktree: false
    })).toBe('managed-worktree');
    expect(resolveEnvironmentWorkspaceDisplayKind({
      workspaceProvisionType: 'unmanaged',
      isWorktree: true
    })).toBe('unmanaged-worktree');
  });

  it('parses spawn environment choices and provision types', () => {
    expect(workspaceProvisionTypeSchema.parse('personal')).toBe('personal');
    expect(spawnEnvironmentChoiceSchema.parse({ kind: 'reuse', environmentId: '11111111-1111-4111-8111-111111111111' }).kind).toBe('reuse');
    expect(workspaceDiffTargetSchema.parse({ type: 'uncommitted' }).type).toBe('uncommitted');
  });
});
