import { describe, expect, it } from 'vitest';
import { resolveThreadListIndicator, threadListIndicatorState } from './thread-list-indicator.js';

describe('resolveThreadListIndicator', () => {
  it('ranks unread errors above runtime work', () => {
    expect(resolveThreadListIndicator({
      hasUnreadError: true,
      hasPendingInteraction: true,
      isPlanModeActive: true,
      isRuntimeActive: true,
      isWorkflowActive: true,
      isBackgroundCommandActive: true
    })).toBe('unread-error');
  });

  it('surfaces plan mode ahead of the spinner', () => {
    expect(resolveThreadListIndicator({
      hasUnreadError: false,
      hasPendingInteraction: false,
      isPlanModeActive: true,
      isRuntimeActive: true,
      isWorkflowActive: false,
      isBackgroundCommandActive: false
    })).toBe('plan-mode');
  });
});

describe('threadListIndicatorState', () => {
  it('marks an unread error thread', () => {
    expect(threadListIndicatorState({
      status: 'error',
      lastReadSeq: 1,
      maxSeq: 4
    }).hasUnreadError).toBe(true);
  });
});
