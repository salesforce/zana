import { describe, it, expect, vi } from 'vitest';
import { SenderGate, isAuthorizedSender } from './sender-gate.js';
import type { InboundSlackMessage } from '../shared/types.js';

const msg = (user: string | undefined, ts = '1.0'): InboundSlackMessage => ({ user, ts });

describe('isAuthorizedSender', () => {
  it('passes only the configured user', () => {
    expect(isAuthorizedSender(msg('U1'), 'U1')).toBe(true);
    expect(isAuthorizedSender(msg('U2'), 'U1')).toBe(false);
    expect(isAuthorizedSender(msg(undefined), 'U1')).toBe(false);
  });
});

describe('SenderGate', () => {
  it('lets the authorized user through and never audits them', () => {
    const onDrop = vi.fn();
    const gate = new SenderGate({ authedUserId: 'U1', onDrop });
    expect(gate.check(msg('U1'), 'C1')).toBe(true);
    expect(onDrop).not.toHaveBeenCalled();
  });

  it('drops foreign senders and fires onDrop once per rate-limit window', () => {
    let now = 0;
    const onDrop = vi.fn();
    const gate = new SenderGate({ authedUserId: 'U1', onDrop, now: () => now, rateLimitMs: 60_000 });

    expect(gate.check(msg('U2', '1'), 'C1')).toBe(false);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // Same user, within window → still dropped, no second audit.
    now = 30_000;
    expect(gate.check(msg('U2', '2'), 'C1')).toBe(false);
    expect(onDrop).toHaveBeenCalledTimes(1);

    // Past the window → audits again.
    now = 60_001;
    expect(gate.check(msg('U2', '3'), 'C1')).toBe(false);
    expect(onDrop).toHaveBeenCalledTimes(2);
  });

  it('fires the first drop even when the injected clock starts at 0', () => {
    const onDrop = vi.fn();
    const gate = new SenderGate({ authedUserId: 'U1', onDrop, now: () => 0 });
    gate.check(msg('U2'), 'C1');
    expect(onDrop).toHaveBeenCalledTimes(1);
  });
});
