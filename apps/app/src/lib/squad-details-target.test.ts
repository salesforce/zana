import { describe, expect, it } from 'vitest';
import { setPendingSquadDetailsTarget, takePendingSquadDetailsTarget } from './squad-details-target';

describe('squad details target handoff', () => {
  it('returns null when nothing is pending', () => {
    expect(takePendingSquadDetailsTarget()).toBeNull();
  });

  it('hands the target over once, then clears it', () => {
    setPendingSquadDetailsTarget({ projectId: 'p1', executionId: 'e1' });
    expect(takePendingSquadDetailsTarget()).toEqual({ projectId: 'p1', executionId: 'e1' });
    expect(takePendingSquadDetailsTarget()).toBeNull();
  });

  it('keeps only the latest target', () => {
    setPendingSquadDetailsTarget({ projectId: 'p1', executionId: 'e1' });
    setPendingSquadDetailsTarget({ projectId: 'p2', executionId: 'e2' });
    expect(takePendingSquadDetailsTarget()).toEqual({ projectId: 'p2', executionId: 'e2' });
  });
});
