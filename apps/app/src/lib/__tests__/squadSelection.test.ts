import { describe, it, expect } from 'vitest';
import { reconcileSquadSelection } from '@/views/agents/SquadFlowView';

const g = (...ids: string[]) => ids.map((projectId) => ({ projectId }));

describe('reconcileSquadSelection', () => {
  it('keeps the previous selection when it still exists (sticky)', () => {
    expect(reconcileSquadSelection('b', g('a', 'b', 'c'))).toBe('b');
  });

  it('does not let a newly-added squad steal focus', () => {
    // prev 'a' still present after 'd' appears → stays on 'a'
    expect(reconcileSquadSelection('a', g('a', 'b', 'd'))).toBe('a');
  });

  it('falls back to the first graph when the selection exited', () => {
    expect(reconcileSquadSelection('gone', g('x', 'y'))).toBe('x');
  });

  it('selects the first graph when nothing was selected yet', () => {
    expect(reconcileSquadSelection(undefined, g('first', 'second'))).toBe('first');
  });

  it('returns undefined when there are no graphs', () => {
    expect(reconcileSquadSelection('a', [])).toBeUndefined();
    expect(reconcileSquadSelection(undefined, [])).toBeUndefined();
  });
});
