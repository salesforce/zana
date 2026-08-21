import { describe, it, expect, vi } from 'vitest';
import {
  StreamRelay,
  StreamUnavailableError,
  drainSseFrames,
  type StreamEndpointDef,
  type StreamTarget,
  type StreamTransport,
  type StreamDoneReason
} from '../stream-relay.js';

/**
 * A controllable fake transport: the relay's `open` calls `factory` for each
 * subscription, handing back an object whose `push`/`end` drive the wired
 * `onFrame`/`onDone`. `closed` records the idempotent close so teardown asserts.
 */
interface FakeTransport {
  push(raw: string): void;
  end(reason: StreamDoneReason): void;
  closed: boolean;
}

function makeRelay(
  overrides: Partial<{
    endpoints: StreamEndpointDef[];
    maxPerExtension: number;
    maxTotal: number;
    maxFrameBytes: number;
    maxFramesPerSec: number;
    idleTtlMs: number;
    now: () => number;
  }> = {}
) {
  const frames: Array<{ subId: string; frame: unknown }> = [];
  const dones: Array<{ subId: string; reason: StreamDoneReason }> = [];
  const logs: string[] = [];
  const transports: FakeTransport[] = [];

  const target: StreamTarget = { socketPath: '/tmp/fake.sock', path: '/events' };
  const defaultEndpoints: StreamEndpointDef[] = [
    { id: 'ep.ok', label: 'ok endpoint', resolveTarget: () => target },
    { id: 'ep.null', label: 'unavailable endpoint', resolveTarget: () => null },
    {
      id: 'ep.throws',
      label: 'throwing endpoint',
      resolveTarget: () => {
        throw new Error('resolve boom');
      }
    }
  ];

  const relay = new StreamRelay({
    endpoints: overrides.endpoints ?? defaultEndpoints,
    sink: {
      frame: (subId, frame) => frames.push({ subId, frame }),
      done: (subId, reason) => dones.push({ subId, reason })
    },
    log: (m) => logs.push(m),
    // Deterministic ids so assertions can name subscriptions.
    makeId: (() => {
      let n = 0;
      return () => `sub-${++n}`;
    })(),
    now: overrides.now,
    open: (_t, onFrame, onDone) => {
      const t: FakeTransport & StreamTransport = {
        closed: false,
        push: (raw) => onFrame(raw),
        end: (reason) => onDone(reason),
        close() {
          this.closed = true;
        }
      };
      transports.push(t);
      return t;
    },
    maxPerExtension: overrides.maxPerExtension,
    maxTotal: overrides.maxTotal,
    maxFrameBytes: overrides.maxFrameBytes,
    maxFramesPerSec: overrides.maxFramesPerSec,
    idleTtlMs: overrides.idleTtlMs
  });

  return { relay, frames, dones, logs, transports };
}

describe('StreamRelay — subscribe / resolve confinement', () => {
  it('an unknown endpoint handle throws StreamUnavailableError (never connects)', () => {
    const { relay, transports } = makeRelay();
    expect(() => relay.subscribe('alpha', 'ep.nope')).toThrow(StreamUnavailableError);
    expect(transports).toHaveLength(0);
  });

  it('a handle whose target resolves null throws (endpoint not available)', () => {
    const { relay, transports } = makeRelay();
    expect(() => relay.subscribe('alpha', 'ep.null')).toThrow(/not available/);
    expect(transports).toHaveLength(0);
  });

  it('a resolveTarget that throws is caught and surfaced as unavailable', () => {
    const { relay } = makeRelay();
    expect(() => relay.subscribe('alpha', 'ep.throws')).toThrow(/resolve failed/);
  });

  it('a good handle opens exactly one transport and returns an opaque subId', () => {
    const { relay, transports } = makeRelay();
    const subId = relay.subscribe('alpha', 'ep.ok');
    expect(subId).toBe('sub-1');
    expect(transports).toHaveLength(1);
    expect(relay.size()).toBe(1);
  });
});

describe('StreamRelay — bounds (Rule 5)', () => {
  it('enforces the per-extension cap', () => {
    const { relay } = makeRelay({ maxPerExtension: 2, maxTotal: 100 });
    relay.subscribe('alpha', 'ep.ok');
    relay.subscribe('alpha', 'ep.ok');
    expect(() => relay.subscribe('alpha', 'ep.ok')).toThrow(/per-extension subscription cap/);
    // A different extension is unaffected by alpha's per-ext count.
    expect(() => relay.subscribe('beta', 'ep.ok')).not.toThrow();
  });

  it('enforces the global cap across extensions', () => {
    const { relay } = makeRelay({ maxPerExtension: 100, maxTotal: 2 });
    relay.subscribe('alpha', 'ep.ok');
    relay.subscribe('beta', 'ep.ok');
    expect(() => relay.subscribe('gamma', 'ep.ok')).toThrow(/global subscription cap/);
  });

  it('drops an oversized frame (never delivered to the sink)', () => {
    const { relay, frames, transports, logs } = makeRelay({ maxFrameBytes: 20 });
    relay.subscribe('alpha', 'ep.ok');
    transports[0].push(JSON.stringify({ pad: 'x'.repeat(100) })); // > 20 bytes
    expect(frames).toHaveLength(0);
    expect(logs.some((l) => /exceeding/.test(l))).toBe(true);
  });

  it('drops frames past the per-second rate cap (drop, not queue)', () => {
    let t = 1000;
    const { relay, frames, transports } = makeRelay({ maxFramesPerSec: 3, now: () => t });
    relay.subscribe('alpha', 'ep.ok');
    for (let i = 0; i < 10; i++) transports[0].push(JSON.stringify({ i }));
    expect(frames).toHaveLength(3); // only the budget delivered
    // Next 1s window resets the budget.
    t = 2001;
    for (let i = 0; i < 10; i++) transports[0].push(JSON.stringify({ i }));
    expect(frames).toHaveLength(6);
  });

  it('drops a non-JSON heartbeat and a non-object frame; delivers valid objects', () => {
    const { relay, frames, transports } = makeRelay();
    relay.subscribe('alpha', 'ep.ok');
    transports[0].push(': keep-alive comment'); // non-JSON heartbeat
    transports[0].push('42'); // JSON but not an object
    transports[0].push(JSON.stringify({ ok: true })); // valid
    expect(frames).toHaveLength(1);
    expect(frames[0].frame).toEqual({ ok: true });
  });
});

describe('StreamRelay — teardown / lifecycle (Rule 3)', () => {
  it('unsubscribe is ownership-checked: another ext cannot close your sub', () => {
    const { relay, transports } = makeRelay();
    const subId = relay.subscribe('alpha', 'ep.ok');
    relay.unsubscribe('beta', subId); // wrong owner — no-op
    expect(transports[0].closed).toBe(false);
    expect(relay.size()).toBe(1);
    relay.unsubscribe('alpha', subId); // real owner
    expect(transports[0].closed).toBe(true);
    expect(relay.size()).toBe(0);
  });

  it('a terminal done from the transport closes the sub and fires the sink once', () => {
    const { relay, dones, transports } = makeRelay();
    const subId = relay.subscribe('alpha', 'ep.ok');
    transports[0].end({ ok: true });
    expect(dones).toEqual([{ subId, reason: { ok: true } }]);
    expect(transports[0].closed).toBe(true);
    expect(relay.size()).toBe(0);
    // A second terminal is ignored (sub already gone).
    transports[0].end({ ok: false, error: 'late' });
    expect(dones).toHaveLength(1);
  });

  it('closeForModule releases every subscription an extension holds', () => {
    const { relay, transports } = makeRelay({ maxPerExtension: 10 });
    relay.subscribe('alpha', 'ep.ok');
    relay.subscribe('alpha', 'ep.ok');
    relay.subscribe('beta', 'ep.ok');
    relay.closeForModule('alpha');
    expect(transports[0].closed).toBe(true);
    expect(transports[1].closed).toBe(true);
    expect(transports[2].closed).toBe(false); // beta untouched
    expect(relay.size()).toBe(1);
  });

  it('idle TTL tears the subscription down with an error done', () => {
    vi.useFakeTimers();
    try {
      const { relay, dones, transports } = makeRelay({ idleTtlMs: 5000 });
      const subId = relay.subscribe('alpha', 'ep.ok');
      vi.advanceTimersByTime(5001);
      expect(dones).toEqual([{ subId, reason: { ok: false, error: 'idle timeout' } }]);
      expect(transports[0].closed).toBe(true);
      expect(relay.size()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('disposeAll closes everything and rejects further subscribes', () => {
    const { relay, transports } = makeRelay({ maxPerExtension: 10 });
    relay.subscribe('alpha', 'ep.ok');
    relay.subscribe('beta', 'ep.ok');
    relay.disposeAll();
    expect(transports.every((t) => t.closed)).toBe(true);
    expect(relay.size()).toBe(0);
    expect(() => relay.subscribe('alpha', 'ep.ok')).toThrow(/relay disposed/);
  });
});

describe('drainSseFrames — SSE framing helper', () => {
  it('splits complete events and returns the unconsumed remainder', () => {
    const events: string[] = [];
    const rest = drainSseFrames('data: a\n\ndata: b\n\ndata: par', (e) => events.push(e));
    expect(events).toEqual(['a', 'b']);
    expect(rest).toBe('data: par');
  });

  it('normalizes CRLF and joins multi-line data payloads; skips comment-only events', () => {
    const events: string[] = [];
    drainSseFrames('data: line1\r\ndata: line2\r\n\r\n: heartbeat\n\n', (e) => events.push(e));
    expect(events).toEqual(['line1\nline2']);
  });
});
