import { describe, expect, it } from 'vitest';
import type { Worktree } from '@zana-ai/zcc-domain/product';
import { NO_TARGET, squadTargetOptions, squadTargetSelector } from '../team-composer-target.js';

const wt = (over: Partial<Worktree>): Worktree => ({ path: '/p', head: 'abc', branch: 'b', detached: false, bare: false, isMain: false, ...over });

describe('squadTargetOptions', () => {
  it('offers default and project root with no worktrees', () => {
    expect(squadTargetOptions([]).map((o) => o.value)).toEqual([NO_TARGET, 'project-root']);
  });
  it('lists linked worktrees by branch, skipping main, detached, bare, unsafe, and duplicates', () => {
    const values = squadTargetOptions([
      wt({ isMain: true, branch: 'main' }),
      wt({ branch: 'feat/a' }),
      wt({ branch: 'feat/a' }),
      wt({ branch: null }),
      wt({ detached: true, branch: 'd' }),
      wt({ bare: true, branch: 'bare' }),
      wt({ branch: '--evil' })
    ]).map((o) => o.value);
    expect(values).toEqual([NO_TARGET, 'project-root', 'worktree:feat/a']);
  });
});

describe('squadTargetSelector', () => {
  it('maps picker values to selectors', () => {
    expect(squadTargetSelector(NO_TARGET)).toBeUndefined();
    expect(squadTargetSelector('project-root')).toEqual({ kind: 'project-root' });
    expect(squadTargetSelector('worktree:feat/a')).toEqual({ kind: 'worktree', branch: 'feat/a' });
    expect(squadTargetSelector('worktree:../x')).toBeUndefined();
    expect(squadTargetSelector('junk')).toBeUndefined();
  });
});
