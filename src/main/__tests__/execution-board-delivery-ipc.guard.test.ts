import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('execution board delivery retry IPC contract', () => {
  it('accepts only project, execution, state version, blocker, and delivery identity', () => {
    const ipc = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const preload = readFileSync(new URL('../../preload/index.ts', import.meta.url), 'utf8');
    expect(ipc).toContain('IPC.executionBoard.retryDelivery');
    expect(ipc).toContain('expectedStateVersion, blockerId, deliveryId');
    expect(ipc).toContain('isExecutionProjectAllowed(win, projectId)');
    expect(preload).toContain('retryDelivery: (projectId, executionId, expectedStateVersion, blockerId, deliveryId)');
    expect(preload).not.toContain('retryDelivery: (projectId, executionId, expectedStateVersion, blockerId, deliveryId, slotId');
  });

  it('keeps compatibility parsing for old slot/message and new blocker/client/message shapes', () => {
    const ipc = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const compat = readFileSync(new URL('../execution/message-compat.ts', import.meta.url), 'utf8');
    expect(ipc).toContain('resolveExecutionMessageArgs');
    expect(compat).toContain('execution slot has multiple unresolved blockers; select exact blocker');
  });
});
