import { describe, expect, it, vi } from 'vitest';
import { clampPolicyToSquadLimits, squadConcurrentCap, withSquadLimits } from '../squad-limits-policy.js';

describe('clampPolicyToSquadLimits', () => {
  it('returns the policy untouched without usable limits', () => {
    const policy = { maxConcurrent: 5 };
    expect(clampPolicyToSquadLimits(policy, undefined)).toBe(policy);
    expect(clampPolicyToSquadLimits(policy, 'junk')).toBe(policy);
    expect(clampPolicyToSquadLimits(undefined, {})).toBeUndefined();
  });
  it('fills absent policy fields from the Squad limits', () => {
    expect(clampPolicyToSquadLimits(undefined, { maxConcurrent: 2, claimWallClockMs: 600_000, claimStallMs: 120_000 }))
      .toEqual({ maxConcurrent: 2, maxClaimWallClockMs: 600_000, maxClaimStallMs: 120_000 });
  });
  it('caps a wider request but keeps a tighter one, preserving unrelated fields', () => {
    const limits = { maxConcurrent: 3, claimWallClockMs: 600_000 };
    expect(clampPolicyToSquadLimits({ maxConcurrent: 10, maxClaimWallClockMs: 60_000, deadlineMs: 5 } as never, limits))
      .toEqual({ maxConcurrent: 3, maxClaimWallClockMs: 60_000, deadlineMs: 5 });
    expect(clampPolicyToSquadLimits({ maxConcurrent: 1, maxClaimWallClockMs: 9_000_000 }, limits))
      .toEqual({ maxConcurrent: 1, maxClaimWallClockMs: 600_000 });
  });
  it('re-sanitizes out-of-range saved values', () => {
    expect(clampPolicyToSquadLimits({ maxConcurrent: 40 }, { maxConcurrent: 500, claimStallMs: 5 }))
      .toEqual({ maxConcurrent: 32, maxClaimStallMs: 60_000 });
  });
});

describe('squadConcurrentCap', () => {
  it('caps by the saved limit only', () => {
    expect(squadConcurrentCap(32, { maxConcurrent: 4 })).toBe(4);
    expect(squadConcurrentCap(2, { maxConcurrent: 4 })).toBe(2);
    expect(squadConcurrentCap(32, undefined)).toBe(32);
    expect(squadConcurrentCap(32, { claimStallMs: 120_000 })).toBe(32);
  });
});

describe('withSquadLimits', () => {
  const make = () => {
    const calls: unknown[][] = [];
    const service = {
      count: 7,
      start: vi.fn(async (...args: unknown[]) => { calls.push(args); return { ok: true }; }),
      status(this: { count: number }) { return this.count; }
    };
    return { service, calls };
  };
  it('applies the named Squad limits on start and forwards opts', async () => {
    const { service, calls } = make();
    const limited = withSquadLimits(service, (id) => (id === 't1' ? { maxConcurrent: 2 } : undefined));
    await limited.start('owner', 'p1', { teamId: 't1', policy: { maxConcurrent: 9, deadlineMs: 1 } }, { reportTo: 'x' });
    expect(calls[0]).toEqual(['owner', 'p1', { teamId: 't1', policy: { maxConcurrent: 2, deadlineMs: 1 } }, { reportTo: 'x' }]);
  });
  it('passes the request through unchanged for an unknown Squad, without limits, or a malformed request', async () => {
    const { service, calls } = make();
    const limited = withSquadLimits(service, () => undefined);
    const request = { teamId: 'nope', policy: { maxConcurrent: 9 } };
    await limited.start('o', 'p', request);
    expect(calls[0][2]).toBe(request);
    await limited.start('o', 'p', { policy: { maxConcurrent: 9 } });
    expect(calls[1][2]).toEqual({ policy: { maxConcurrent: 9 } });
    await limited.start('o', 'p', undefined);
    expect(calls[2][2]).toBeUndefined();
  });
  it('rejects (not throws synchronously) when the limits lookup throws, and does not start', async () => {
    const { service } = make();
    const limited = withSquadLimits(service, () => { throw new Error('teams unreadable'); });
    let pending: Promise<unknown> | undefined;
    expect(() => { pending = limited.start('o', 'p', { teamId: 't1' }); }).not.toThrow();
    await expect(pending).rejects.toThrow('teams unreadable');
    expect(service.start).not.toHaveBeenCalled();
  });
  it('binds other members to the real service', () => {
    const { service } = make();
    const limited = withSquadLimits(service, () => undefined);
    expect(limited.status()).toBe(7);
    expect(limited.count).toBe(7);
  });
});
