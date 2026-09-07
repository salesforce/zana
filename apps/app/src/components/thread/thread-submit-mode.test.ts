import { describe, expect, it } from 'vitest';
import { resolveThreadSubmitMode } from './thread-submit-mode.js';

describe('resolveThreadSubmitMode', () => {
  it('is ready when idle or recovering from error', () => {
    expect(resolveThreadSubmitMode({ displayStatus: 'idle', waitingOnUser: false })).toEqual({ kind: 'ready' });
    expect(resolveThreadSubmitMode({ displayStatus: 'error', waitingOnUser: false })).toEqual({ kind: 'ready' });
  });

  it('queues while active or reconnecting', () => {
    expect(resolveThreadSubmitMode({ displayStatus: 'active', waitingOnUser: false })).toEqual({ kind: 'queue' });
    expect(resolveThreadSubmitMode({ displayStatus: 'host-reconnecting', waitingOnUser: false })).toEqual({ kind: 'queue' });
  });

  it('blocks pending interactions and stopping, and is stop-only while waiting for the host', () => {
    expect(resolveThreadSubmitMode({ displayStatus: 'active', waitingOnUser: true })).toEqual({
      kind: 'blocked',
      reason: 'pending-interaction'
    });
    expect(resolveThreadSubmitMode({ displayStatus: 'stopping', waitingOnUser: false })).toEqual({
      kind: 'blocked',
      reason: 'stopping'
    });
    expect(resolveThreadSubmitMode({ displayStatus: 'waiting-for-host', waitingOnUser: false })).toEqual({
      kind: 'stop-only'
    });
  });
});
