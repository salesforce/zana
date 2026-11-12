import { describe, expect, it } from 'vitest';

import * as launch from './launch-options.js';

describe('launch options', () => {
  it('keeps no-declaration defaults unchanged', () => {
    expect(launch?.resolveAllLaunch({})).toEqual({
      worktree: { value: false, source: 'default' },
      onComplete: { value: 'leave', source: 'default' },
      push: { value: false, source: 'default' },
      checks: { value: [], source: 'default' },
      failurePolicyDefault: { value: 'fail-run', source: 'default' }
    });
  });

  it('resolves distinct inputs without losing false or empty values', () => {
    expect(launch?.resolveLaunch({ launch: false, plan: true, squad: true, fallback: true, default: true }))
      .toEqual({ value: false, source: 'launch' });
    expect(launch?.resolveLaunch({ plan: [], squad: ['test'], default: ['lint'] }))
      .toEqual({ value: [], source: 'plan' });
    expect(launch?.resolveLaunch({ squad: false, fallback: true, default: true }))
      .toEqual({ value: false, source: 'squad' });
    expect(launch?.resolveLaunch({ fallback: true, default: false })).toEqual({ value: true, source: 'default' });
    expect(launch?.resolveLaunch({ default: false })).toEqual({ value: false, source: 'default' });
  });

  it('resolves all five values and preserves legacy isolation fallback', () => {
    expect(launch?.resolveAllLaunch({
      launch: { push: false, checks: [] },
      plan: { push: true, onComplete: 'delete', failurePolicyDefault: 'fail-run' },
      squad: { worktreeIsolation: true, worktreeOnComplete: 'merge', push: true, checks: ['test'] },
      fallback: { worktree: false }
    })).toEqual({
      worktree: { value: true, source: 'squad' }, onComplete: { value: 'delete', source: 'plan' },
      push: { value: false, source: 'launch' }, checks: { value: [], source: 'launch' },
      failurePolicyDefault: { value: 'fail-run', source: 'plan' }
    });
    expect(launch?.resolveAllLaunch({ fallback: { worktree: true } })?.worktree)
      .toEqual({ value: true, source: 'default' });
    expect(launch?.resolveAllLaunch({ plan: { worktree: false, checks: ['lint'] }, squad: { push: true, failurePolicyDefault: 'fail-run' } }))
      .toMatchObject({ worktree: { value: false, source: 'plan' }, checks: { value: ['lint'], source: 'plan' }, push: { value: true, source: 'squad' }, failurePolicyDefault: { value: 'fail-run', source: 'squad' } });
  });

  it('lets explicit targets override implicit isolation and squad disposition', () => {
    expect(launch?.resolveAllLaunch({ launch: { target: { kind: 'project-root' } }, plan: { worktree: true }, squad: { worktreeIsolation: true, worktreeOnComplete: 'merge' }, fallback: { worktree: true } }))
      .toMatchObject({ worktree: { value: false, source: 'launch' }, onComplete: { value: 'leave', source: 'default' } });
    expect(launch?.resolveAllLaunch({ launch: { target: { kind: 'worktree', branch: 'feat/x' }, worktree: false, onComplete: 'leave' } }))
      .toMatchObject({ worktree: { value: false, source: 'launch' }, onComplete: { value: 'leave', source: 'launch' } });
  });

  it.each([{ kind: 'project-root' as const }, { kind: 'worktree' as const, branch: 'feat/x' }])('validates winning cleanup for user-owned target %j', (target) => {
    expect(launch.resolveAllLaunch({ launch: { target, onComplete: 'leave' }, plan: { onComplete: 'merge' }, squad: { worktreeOnComplete: 'delete' } }).onComplete)
      .toEqual({ value: 'leave', source: 'launch' });
    expect(() => launch.resolveAllLaunch({ launch: { target }, plan: { onComplete: 'merge' } })).toThrow();
    expect(() => launch.resolveAllLaunch({ launch: { target, onComplete: 'delete' }, plan: { onComplete: 'leave' } })).toThrow();
    expect(launch.resolveAllLaunch({ launch: { target }, squad: { worktreeOnComplete: 'merge' } }).onComplete)
      .toEqual({ value: 'leave', source: 'default' });
  });

  it.each([
    { launch: { target: { kind: 'project-root' }, worktree: true } },
    { launch: { target: { kind: 'project-root' }, onComplete: 'merge' } },
    { launch: { target: { kind: 'project-root' } }, plan: { onComplete: 'delete' } },
    { launch: { target: { kind: 'worktree', branch: '../escape' } } }
  ])('rejects target conflicts: %j', (input) => {
    expect(() => launch?.resolveAllLaunch(input as never)).toThrow();
  });

  it('strictly validates declarations and bounded check references', () => {
    expect(launch?.launchOptionsSchema.safeParse({ worktree: false, onComplete: 'merge', push: true, checks: ['lint', '_test-2'], failurePolicyDefault: 'fail-run', target: { kind: 'project-root' } }).success).toBe(true);
    expect(launch?.planLaunchSchema.safeParse({}).success).toBe(true);
    expect(launch?.squadLaunchSchema.safeParse({ worktreeIsolation: false, worktreeOnComplete: 'leave', push: false, checks: [], failurePolicyDefault: 'fail-run' }).success).toBe(true);
    for (const input of [{ cwd: '/tmp' }, { resolvedLaunch: {} }, { push: 'true' }, { failurePolicyDefault: 'retry' }, { checks: ['check:lint'] }, { checks: ['run command'] }, { checks: ['a'.repeat(101)] }, { checks: Array(101).fill('lint') }, { target: { kind: 'project-root', path: '/tmp' } }]) {
      expect(launch?.launchOptionsSchema.safeParse(input).success).toBe(false);
    }
    expect(launch?.planLaunchSchema.safeParse({ target: { kind: 'project-root' } }).success).toBe(false);
    expect(launch?.squadLaunchSchema.safeParse({ worktree: true }).success).toBe(false);
  });

  it('validates resolved snapshots structurally and clones check lists', () => {
    const checks = ['lint'];
    const resolved = launch?.resolveAllLaunch({ launch: { checks } });
    checks.push('test');
    expect(resolved?.checks.value).toEqual(['lint']);
    expect(launch?.resolvedLaunchSchema.safeParse(resolved).success).toBe(true);
    expect(launch?.resolvedLaunchSchema.safeParse({ ...resolved, push: { value: true, source: 'project' } }).success).toBe(false);
    expect(launch?.resolvedLaunchSchema.safeParse({ ...resolved, target: {} }).success).toBe(false);
  });
});
