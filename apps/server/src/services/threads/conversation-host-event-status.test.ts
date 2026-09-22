import { describe, expect, it, vi } from 'vitest';
import { conversationLifecycleEventForHostEvent, isNestedConversationTurnCompletion } from './conversation-host-event-status.js';

describe('conversationLifecycleEventForHostEvent', () => {
  it('does not emit a lifecycle event while a provider error is retrying', () => {
    expect(conversationLifecycleEventForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'provider/error',
        willRetry: true,
        message: 'Provider error',
        detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
        errorInfo: { category: 'unauthorized' }
      }
    })).toBeNull();
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: {
        type: 'provider/error',
        willRetry: true
      }
    })).toBeNull();
  });

  it('does not emit a lifecycle event during a reconnecting system error', () => {
    expect(conversationLifecycleEventForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'system/error',
        reconnectAttempt: 2,
        reconnectTotal: 5
      }
    })).toBeNull();
  });

  it('ignores a terminal provider error as timeline evidence', () => {
    expect(conversationLifecycleEventForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'provider/error',
        willRetry: false
      }
    })).toBeNull();
    expect(conversationLifecycleEventForHostEvent({
      kind: 'turn.failed',
      payload: { type: 'provider/error' }
    })).toBeNull();
  });

  it('maps started and completed turns onto lifecycle events', () => {
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/started' }
    })).toEqual({ type: 'run.started' });
    expect(conversationLifecycleEventForHostEvent({ kind: 'thread.started' })).toEqual({ type: 'run.started' });
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/completed' }
    })).toEqual({ type: 'run.succeeded' });
    expect(conversationLifecycleEventForHostEvent({ kind: 'turn.completed' })).toEqual({ type: 'run.succeeded' });
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/completed', status: 'failed' }
    })).toEqual({ type: 'run.failed' });
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/completed', status: 'interrupted' }
    })).toEqual({ type: 'run.succeeded' });
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/completed', parentToolCallId: 'tool-1' },
      nestedTurn: true
    })).toBeNull();
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/started', parentToolCallId: 'tool-1' }
    })).toBeNull();
  });

  it('ignores ordinary in-turn events', () => {
    expect(conversationLifecycleEventForHostEvent({
      kind: 'thread.event',
      payload: { type: 'item/started' }
    })).toBeNull();
  });

  it('detects nested completions from the parent or a persistent turn lookup', () => {
    const findStart = vi.fn(() => ({ payload: {
      type: 'turn/started',
      scope: { kind: 'turn', turnId: 'child' },
      parentToolCallId: 'tool-1'
    } }));
    expect(isNestedConversationTurnCompletion({
      type: 'turn/completed', parentToolCallId: 'tool-1'
    }, findStart)).toBe(true);
    expect(findStart).not.toHaveBeenCalled();
    expect(isNestedConversationTurnCompletion({
      type: 'turn/completed', scope: { kind: 'turn', turnId: 'child' }
    }, findStart)).toBe(true);
    expect(findStart).toHaveBeenCalledExactlyOnceWith('child');
  });

  it('supports wrapped terminal events and wrapped starts', () => {
    expect(isNestedConversationTurnCompletion({ event: {
      type: 'turn/completed', scope: { kind: 'turn', turnId: 'child' }
    } }, () => ({ payload: { event: { parentToolCallId: 'tool-1' } } }))).toBe(true);
  });

  it('does not classify root or unknown turns as nested', () => {
    const completion = { type: 'turn/completed', scope: { kind: 'turn', turnId: 'root' } };
    expect(isNestedConversationTurnCompletion(completion, () => ({ payload: {} }))).toBe(false);
    expect(isNestedConversationTurnCompletion(completion, () => null)).toBe(false);
    expect(isNestedConversationTurnCompletion(completion, () => ({ payload: { parentToolCallId: '  ' } }))).toBe(false);
  });

  it.each([null, [], {}, { scope: { kind: 'thread' } }, { scope: { kind: 'turn', turnId: ' ' } }])(
    'skips the lookup without a usable turn ID: %j', (payload) => {
      const findStart = vi.fn(() => null);
      expect(isNestedConversationTurnCompletion(payload, findStart)).toBe(false);
      expect(findStart).not.toHaveBeenCalled();
    }
  );
});
