import { describe, expect, it } from 'vitest';
import {
  canDispatch,
  isHostOfflineError,
  isHostRpcTimeout,
  NEXT_TURN_MAX_CONCURRENT
} from './conversation-dispatch-checkpoint.js';

const allow = {
  archived: false,
  queuePaused: false,
  pendingInteraction: false,
  hostOnline: true,
  sendAfter: null,
  liveActiveCount: 0
};

describe('canDispatch', () => {
  it('allows an unblocked next-turn row', () => {
    expect(canDispatch(allow)).toEqual({ kind: 'allow' });
  });

  it('rejects archived threads', () => {
    expect(canDispatch({ ...allow, archived: true })).toEqual({
      kind: 'reject',
      reason: 'thread-archived'
    });
  });

  it('delays paused, pending, offline, future, and concurrency cases', () => {
    expect(canDispatch({ ...allow, queuePaused: true })).toMatchObject({
      kind: 'delay',
      reason: 'queue-paused'
    });
    expect(canDispatch({ ...allow, pendingInteraction: true })).toMatchObject({
      kind: 'delay',
      reason: 'pending-interaction'
    });
    expect(canDispatch({ ...allow, hostOnline: false })).toMatchObject({
      kind: 'delay',
      reason: 'host-offline'
    });
    expect(canDispatch({ ...allow, sendAfter: 9, now: 4 })).toMatchObject({
      kind: 'delay',
      reason: 'send-after',
      sendAfter: 9
    });
    expect(canDispatch({ ...allow, liveActiveCount: NEXT_TURN_MAX_CONCURRENT })).toMatchObject({
      kind: 'delay',
      reason: 'concurrency-cap'
    });
    expect(canDispatch({ ...allow, threadActive: true })).toMatchObject({
      kind: 'delay',
      reason: 'thread-active'
    });
  });
});

describe('host error helpers', () => {
  it('detects host-unavailable timeouts vs generic offline', () => {
    const timeout = { code: 'host-unavailable', message: 'host x RPC timed out' };
    const offline = { code: 'host-unavailable', name: 'HostUnavailableError', message: 'not connected' };
    expect(isHostRpcTimeout(timeout)).toBe(true);
    expect(isHostRpcTimeout(offline)).toBe(false);
    expect(isHostOfflineError(timeout)).toBe(true);
    expect(isHostOfflineError(offline)).toBe(true);
    expect(isHostOfflineError({ message: 'nope' })).toBe(false);
  });
});
