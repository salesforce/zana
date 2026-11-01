import { describe, expect, it } from 'vitest';
import { isSafeTargetBranch, isSquadExecutionTargetSelector, validateSquadExecutionTarget } from './product.js';

describe('squad execution target selector', () => {
  it('accepts project-root and worktree-by-branch selectors only', () => {
    expect(isSquadExecutionTargetSelector({ kind: 'project-root' })).toBe(true);
    expect(isSquadExecutionTargetSelector({ kind: 'worktree', branch: 'feature/x-1' })).toBe(true);
    expect(isSquadExecutionTargetSelector({ kind: 'project-root', path: '/tmp' })).toBe(false);
    expect(isSquadExecutionTargetSelector({ kind: 'worktree', branch: 'a', path: '/tmp' })).toBe(false);
    expect(isSquadExecutionTargetSelector({ kind: 'path', path: '/tmp' })).toBe(false);
    expect(isSquadExecutionTargetSelector(null)).toBe(false);
    expect(isSquadExecutionTargetSelector([])).toBe(false);
    expect(isSquadExecutionTargetSelector('project-root')).toBe(false);
  });

  it('rejects unsafe branch names', () => {
    for (const bad of ['', '-x', '/x', 'x/', 'x.', 'x.lock', 'a..b', 'a//b', 'a@{1}', 'a b', 'a~1', 'a:b', 'x'.repeat(201), 7]) {
      expect(isSafeTargetBranch(bad)).toBe(false);
    }
    expect(isSafeTargetBranch('main')).toBe(true);
    expect(isSafeTargetBranch('user/feature_1.2')).toBe(true);
  });

  it('keeps legacy semantics when the selector is absent', () => {
    expect(validateSquadExecutionTarget({ worktree: true, onComplete: 'merge' })).toEqual({ ok: true });
    expect(validateSquadExecutionTarget({})).toEqual({ ok: true });
  });

  it('rejects an invalid selector with no fallback', () => {
    expect(validateSquadExecutionTarget({ target: { kind: 'worktree', branch: '../x' } })).toMatchObject({ ok: false });
  });

  it('rejects selector plus generated worktree, and accepts selector plus worktree false', () => {
    expect(validateSquadExecutionTarget({ target: { kind: 'project-root' }, worktree: true }))
      .toEqual({ ok: false, message: 'execution target conflicts with a generated worktree request' });
    expect(validateSquadExecutionTarget({ target: { kind: 'project-root' }, worktree: false }))
      .toEqual({ ok: true, target: { kind: 'project-root' } });
  });

  it('rejects merge/delete auto disposition for a user-owned target but allows leave', () => {
    const target = { kind: 'worktree' as const, branch: 'feat' };
    expect(validateSquadExecutionTarget({ target, onComplete: 'merge' })).toMatchObject({ ok: false });
    expect(validateSquadExecutionTarget({ target, onComplete: 'delete' })).toMatchObject({ ok: false });
    expect(validateSquadExecutionTarget({ target, onComplete: 'leave' })).toEqual({ ok: true, target });
  });
});
