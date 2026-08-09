import { describe, it, expect, beforeEach } from 'vitest';
import * as testTap from '../test-tap.js';

/**
 * Proves the two production-safety invariants of the gated test tap
 * (`src/main/test-tap.ts`), which sits on the `safeSend` hot path:
 *
 *  1. INERT until `enable()` — the exported `record`/`recordLog` bindings are
 *     shared no-ops before `enable()`, so a production boot (ZCC_E2E unset →
 *     `enable()` never called) captures NOTHING and allocates NOTHING on the
 *     fan-out path. This is the whole justification for shipping the tap
 *     always-compiled (Rule 3 / Rule 5).
 *  2. BOUNDED ring — once enabled, the ring never grows past `TAP_RING_CAP`
 *     (Rule 5), and `seq` stays monotonic across `reset()` so a mid-run reset
 *     can't produce a stale, colliding cursor.
 *
 * NOTE: `enable()` is a one-way, idempotent, process-global switch (it also
 * installs a console shim). We deliberately run every enabled-state assertion
 * in a SINGLE test after the inert assertions, since a module cannot be
 * "un-enabled" — `reset()` only clears the ring.
 */
describe('test-tap — inert-until-enabled + bounded ring', () => {
  beforeEach(() => {
    testTap.reset();
  });

  it('is a true no-op before enable(): 10k records leave the ring empty', () => {
    expect(testTap.isEnabled()).toBe(false);
    // The exported binding must literally be the shared no-op (allocation-free).
    expect(testTap.record.length).toBe(2); // (channel, args)
    for (let i = 0; i < 10_000; i++) {
      testTap.record('terminals:onData', ['id', 'chunk']);
      testTap.recordLog('error', 'ctx', 'boom');
    }
    const drained = testTap.drain(0);
    expect(drained.entries).toHaveLength(0);
    expect(drained.cursor).toBe(0);
    expect(testTap.snapshot()).toEqual({ seq: 0, size: 0, cap: testTap.TAP_RING_CAP });
  });

  it('captures + caps + stays monotonic once enabled', () => {
    testTap.enable();
    expect(testTap.isEnabled()).toBe(true);

    // enable() is idempotent — a second call must not re-arm or double-shim.
    testTap.enable();

    testTap.record('inbox:onAppended', [{ id: 1 }]);
    testTap.recordLog('warn', 'scheduler', 'skipped');
    let drained = testTap.drain(0);
    expect(drained.entries).toHaveLength(2);
    expect(drained.entries[0]).toMatchObject({
      kind: 'event',
      channel: 'inbox:onAppended',
      args: [{ id: 1 }]
    });
    expect(drained.entries[1]).toMatchObject({
      kind: 'log',
      channel: 'log:warn',
      args: ['scheduler', 'skipped']
    });
    // cursor-drain: draining from the last cursor yields nothing new.
    expect(testTap.drain(drained.cursor).entries).toHaveLength(0);

    // Bounded: push well past the cap, ring size clamps to TAP_RING_CAP.
    const overflow = testTap.TAP_RING_CAP + 500;
    for (let i = 0; i < overflow; i++) testTap.record('terminals:onData', [i]);
    const snap = testTap.snapshot();
    expect(snap.size).toBe(testTap.TAP_RING_CAP);
    // Oldest evicted: the whole-ring drain's first entry is NOT the earliest seq.
    const all = testTap.drain(0).entries;
    expect(all).toHaveLength(testTap.TAP_RING_CAP);
    expect(all[0].seq).toBeGreaterThan(1);

    // Monotonic seq survives reset: cursor after reset >= size just drained.
    const seqBeforeReset = testTap.snapshot().seq;
    testTap.reset();
    const afterReset = testTap.snapshot();
    expect(afterReset.size).toBe(0);
    expect(afterReset.seq).toBe(seqBeforeReset); // seq NOT rewound
    testTap.record('x', []);
    expect(testTap.snapshot().seq).toBe(seqBeforeReset + 1);
  });

  it('safeClone degrades unserializable args instead of throwing', () => {
    testTap.enable();
    testTap.reset();
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    // Must not throw into the caller (safeSend must never break).
    expect(() => testTap.record('cycle', [circular])).not.toThrow();
    const bigint = 10n;
    expect(() => testTap.record('bigint', [bigint])).not.toThrow();
    const entries = testTap.drain(0).entries;
    expect(entries).toHaveLength(2);
    // Circular JSON fails → String(arg) placeholder ('[object Object]').
    expect(typeof entries[0].args[0]).toBe('string');
    expect(typeof entries[1].args[0]).toBe('string');
  });
});
