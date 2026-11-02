import { describe, expect, it } from 'vitest';
import { assignmentText } from '../service.js';
import type { ExecutionDispatchAssignment, ExecutionRecord } from '../store.js';

// Review round 1 fixes for #581 (F3/A6, F4): the heartbeat advice in the worker's assignment text.

describe('heartbeat advice in the assignment text (#581 F3/A6, F4)', () => {
  const assignment = (over: Partial<ExecutionDispatchAssignment> = {}): ExecutionDispatchAssignment =>
    ({ workUnitId: 'a', slotId: 'slot-1', title: 'A', task: 'do a', claimId: 'c-1', claimGeneration: 1, ...over });
  const record = (policy?: Record<string, unknown>) => ({ request: { policy }, workUnits: [] } as unknown as ExecutionRecord);

  it('a first delivery tells the worker to start at 1', () => {
    expect(assignmentText(record(), assignment())).toContain('(start at 1)');
  });

  it('a redelivery after earlier heartbeats names the next count, so heartbeats are not no-ops', () => {
    expect(assignmentText(record(), assignment({ turnCount: 6 }))).toContain('(start at 7)');
  });

  it('shows the run\'s own stall ceiling instead of a fixed 10 minutes', () => {
    expect(assignmentText(record({ maxClaimStallMs: 120_000 }), assignment())).toContain('no progress for 2 minutes is taken back');
    expect(assignmentText(record(), assignment())).toContain('no progress for 10 minutes is taken back');
  });
});
