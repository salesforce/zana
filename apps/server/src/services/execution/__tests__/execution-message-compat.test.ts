import { describe, expect, it } from 'vitest';
import { resolveExecutionMessageArgs } from '../message-compat.js';

const blocker = (id: string, slotId = 'slot-1') => ({ id, slotId, workUnitId: `work-${id}`, question: 'Q?', resolved: false, createdAt: 1 });

describe('execution message IPC compatibility', () => {
  it('preserves new exact blocker/client/message arguments', () => {
    expect(resolveExecutionMessageArgs('execution-1', 4, [], ['blocker-1', 'client-1', 'Answer']))
      .toEqual({ blockerId: 'blocker-1', clientRequestId: 'client-1', message: 'Answer' });
  });

  it('derives exact blocker from legacy slot/message only when unambiguous', () => {
    expect(resolveExecutionMessageArgs('execution-1', 4, [blocker('blocker-1')], ['slot-1', 'Answer']))
      .toEqual({ blockerId: 'blocker-1', clientRequestId: 'execution-1:4:blocker-1', message: 'Answer' });
    expect(resolveExecutionMessageArgs('execution-1', 4, [blocker('one'), blocker('two')], ['slot-1', 'Answer']))
      .toEqual({ error: 'execution slot has multiple unresolved blockers; select exact blocker' });
    expect(resolveExecutionMessageArgs('execution-1', 4, [blocker('other', 'slot-2')], ['slot-1', 'Answer']))
      .toBeUndefined();
  });
});
