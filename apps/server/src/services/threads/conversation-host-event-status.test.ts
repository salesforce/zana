import { describe, expect, it } from 'vitest';
import { conversationStatusForHostEvent } from './conversation-host-event-status.js';

describe('conversationStatusForHostEvent', () => {
  it('keeps the thread active while a provider error is retrying', () => {
    expect(conversationStatusForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'provider/error',
        willRetry: true,
        message: 'Provider error',
        detail: 'Claude Code API retry 5/10 after 9168ms: HTTP 401 authentication_failed',
        errorInfo: { category: 'unauthorized' }
      }
    })).toBe('active');
    expect(conversationStatusForHostEvent({
      kind: 'thread.event',
      payload: {
        type: 'provider/error',
        willRetry: true
      }
    })).toBe('active');
  });

  it('keeps the thread active during a reconnecting system error', () => {
    expect(conversationStatusForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'system/error',
        reconnectAttempt: 2,
        reconnectTotal: 5
      }
    })).toBe('active');
  });

  it('marks a terminal provider error as error', () => {
    expect(conversationStatusForHostEvent({
      kind: 'turn.failed',
      payload: {
        type: 'provider/error',
        willRetry: false
      }
    })).toBe('error');
    expect(conversationStatusForHostEvent({
      kind: 'turn.failed',
      payload: { type: 'provider/error' }
    })).toBe('error');
  });

  it('maps started and completed turns', () => {
    expect(conversationStatusForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/started' }
    })).toBe('active');
    expect(conversationStatusForHostEvent({ kind: 'thread.started' })).toBe('active');
    expect(conversationStatusForHostEvent({
      kind: 'thread.event',
      payload: { type: 'turn/completed' }
    })).toBe('idle');
    expect(conversationStatusForHostEvent({ kind: 'turn.completed' })).toBe('idle');
  });

  it('ignores ordinary in-turn events', () => {
    expect(conversationStatusForHostEvent({
      kind: 'thread.event',
      payload: { type: 'item/started' }
    })).toBeNull();
  });
});
