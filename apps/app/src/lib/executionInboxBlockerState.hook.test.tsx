/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ExecutionBoardProjection } from '@zana-ai/zcc-domain/product';
import { useExecutionInboxBlockerState } from './executionInboxBlockerState.js';

const entry = { projectId: 'proj-1', executionId: 'exec-1', blockerId: 'blocker-1' };

function snapshotWith(resolved: boolean): { execution: ExecutionBoardProjection } {
  return {
    execution: {
      blockers: [{ id: 'blocker-1', resolved }]
    } as ExecutionBoardProjection
  };
}

describe('useExecutionInboxBlockerState', () => {
  let snapshot: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    snapshot = vi.fn();
    (window as unknown as { cc: unknown }).cc = { executionBoard: { snapshot } };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stops polling once the blocker resolves, instead of hammering the snapshot endpoint forever', async () => {
    let resolved = false;
    snapshot.mockImplementation(async () => snapshotWith(resolved));
    vi.useFakeTimers({ shouldAdvanceTime: true });

    const { result, unmount } = renderHook(() => useExecutionInboxBlockerState(entry, false));

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(result.current).toBe('actionable');

    resolved = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(result.current).toBe('resolved');

    const callsAtResolution = snapshot.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); });
    expect(snapshot).toHaveBeenCalledTimes(callsAtResolution);

    unmount();
  });
});
