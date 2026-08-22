import { describe, expect, it } from 'vitest';
import { deriveRepoDirName, isLegacyWorktreePath, isZccManagedWorkspacePath, resolveManagedTargetPath, resolvePersonalTargetPath } from './worktree-paths.js';

describe('worktree paths', () => {
  it('derives a repo directory name from local, url, and scp sources', () => {
    expect(deriveRepoDirName('/Users/me/code/zana-command-center')).toBe('zana-command-center');
    expect(deriveRepoDirName('https://github.com/acme/demo.git')).toBe('demo');
    expect(deriveRepoDirName('git@github.com:acme/demo.git')).toBe('demo');
  });

  it('places managed and personal workspaces under the host data dir', () => {
    const managed = resolveManagedTargetPath({
      dataDir: '/Users/me/.zcc',
      environmentId: 'env-1',
      sourcePath: '/repos/demo'
    });
    expect(managed).toBe('/Users/me/.zcc/worktrees/env-1/demo');
    expect(resolvePersonalTargetPath({ dataDir: '/Users/me/.zcc', environmentId: 'env-1' }))
      .toBe('/Users/me/.zcc/personal-workspaces/env-1');
    expect(isZccManagedWorkspacePath({ dataDir: '/Users/me/.zcc', path: managed })).toBe(true);
    expect(isZccManagedWorkspacePath({ dataDir: '/Users/me/.zcc', path: '/Users/me/code/demo' })).toBe(false);
  });

  it('recognizes leftover ~/zcc-worktrees as unmanaged legacy checkouts', () => {
    expect(isLegacyWorktreePath('/Users/me', '/Users/me/zcc-worktrees/proj/task')).toBe(true);
    expect(isLegacyWorktreePath('/Users/me', '/Users/me/.zcc/worktrees/env/demo')).toBe(false);
  });
});
