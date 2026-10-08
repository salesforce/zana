import { describe, expect, it } from 'vitest';
import { threadStartCwd } from './thread-start-cwd.js';

describe('threadStartCwd', () => {
  it('honors the caller cwd for an unmanaged checkout, including a subfolder', () => {
    const env = { path: '/repo', workspaceProvisionType: 'unmanaged' as const };
    expect(threadStartCwd(env, '/repo/packages/a')).toBe('/repo/packages/a');
    expect(threadStartCwd(env, undefined)).toBeUndefined();
  });

  it('runs a managed worktree at its own root instead of the source checkout', () => {
    const env = { path: '/data/worktrees/env-1/repo', workspaceProvisionType: 'managed-worktree' as const };
    expect(threadStartCwd(env, '/repo')).toBe('/data/worktrees/env-1/repo');
    expect(threadStartCwd(env, undefined)).toBe('/data/worktrees/env-1/repo');
  });

  it('runs a personal scratch at its own root', () => {
    const env = { path: '/data/personal-workspaces/env-2', workspaceProvisionType: 'personal' as const };
    expect(threadStartCwd(env, '/repo')).toBe('/data/personal-workspaces/env-2');
  });

  it('lets the host default when a managed environment has no recorded path', () => {
    expect(threadStartCwd({ path: null, workspaceProvisionType: 'managed-worktree' }, '/repo')).toBeUndefined();
  });

  it('passes the caller cwd through when the environment row is missing', () => {
    expect(threadStartCwd(null, '/repo')).toBe('/repo');
    expect(threadStartCwd(undefined, '/repo')).toBe('/repo');
  });
});
