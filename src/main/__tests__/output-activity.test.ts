/**
 * OutputActivityMonitor tests (B6). The monitor turns raw output activity into
 * working/idle reports for agents that don't emit OSC status glyphs (codex /
 * cursor). We assert: edge-detected `working`, silence → `idle`, timer re-arm on
 * every chunk, empty-chunk no-op, live threshold read, and per-session isolation.
 * A fake clock (injected setTimer/clearTimer) keeps it deterministic.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { AgentState } from '../../shared/types.js';
import {
  OutputActivityMonitor,
  DEFAULT_IDLE_AFTER_MS,
  type OutputActivityDeps
} from '../output-activity.js';

/** A minimal fake timer wheel: schedule handles, advance the clock manually. */
function makeClock() {
  let seq = 0;
  const timers = new Map<NodeJS.Timeout, { fn: () => void; at: number }>();
  let nowMs = 0;
  return {
    setTimer: (fn: () => void, ms: number) => {
      const handle = ++seq as unknown as NodeJS.Timeout;
      timers.set(handle, { fn, at: nowMs + ms });
      return handle;
    },
    clearTimer: (handle: NodeJS.Timeout) => {
      timers.delete(handle);
    },
    advance: (ms: number) => {
      nowMs += ms;
      for (const [handle, t] of [...timers]) {
        if (t.at <= nowMs) {
          timers.delete(handle);
          t.fn();
        }
      }
    },
    pending: () => timers.size
  };
}

function makeMonitor(overrides: Partial<OutputActivityDeps> = {}) {
  const reports: Array<[string, AgentState]> = [];
  const clock = makeClock();
  const deps: OutputActivityDeps = {
    sink: { report: (id, state) => reports.push([id, state]) },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides
  };
  const monitor = new OutputActivityMonitor(deps);
  return { monitor, reports, clock };
}

describe('OutputActivityMonitor', () => {
  let ctx: ReturnType<typeof makeMonitor>;
  beforeEach(() => {
    ctx = makeMonitor();
  });

  it('reports `working` on the first output chunk (edge)', () => {
    ctx.monitor.observe('s1', 'hello');
    expect(ctx.reports).toEqual([['s1', 'working']]);
  });

  it('does NOT re-report `working` on subsequent chunks while working', () => {
    ctx.monitor.observe('s1', 'a');
    ctx.monitor.observe('s1', 'b');
    ctx.monitor.observe('s1', 'c');
    expect(ctx.reports).toEqual([['s1', 'working']]);
  });

  it('reports `idle` after the silence threshold elapses', () => {
    ctx.monitor.observe('s1', 'working now');
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS);
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'idle']
    ]);
  });

  it('re-arms the silence timer on every chunk (no premature idle)', () => {
    ctx.monitor.observe('s1', 'a');
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS - 1); // just shy of idle
    ctx.monitor.observe('s1', 'b'); // resets the timer
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS - 1); // still shy after reset
    expect(ctx.reports).toEqual([['s1', 'working']]); // not idle yet
    ctx.clock.advance(1); // now the full window has elapsed since 'b'
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'idle']
    ]);
  });

  it('a new chunk after idle re-reports `working` (full cycle)', () => {
    ctx.monitor.observe('s1', 'a');
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS); // → idle
    ctx.monitor.observe('s1', 'b'); // → working again
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'idle'],
      ['s1', 'working']
    ]);
  });

  it('ignores empty chunks (a bare flush is not activity)', () => {
    ctx.monitor.observe('s1', '');
    expect(ctx.reports).toEqual([]);
    expect(ctx.clock.pending()).toBe(0);
  });

  it('reads idleAfterMs live from the injected getter', () => {
    const custom = makeMonitor({ idleAfterMs: () => 500 });
    custom.monitor.observe('s1', 'x');
    custom.clock.advance(499);
    expect(custom.reports).toEqual([['s1', 'working']]);
    custom.clock.advance(1);
    expect(custom.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'idle']
    ]);
  });

  it('tracks sessions independently', () => {
    ctx.monitor.observe('s1', 'a');
    ctx.monitor.observe('s2', 'b');
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s2', 'working']
    ]);
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS);
    expect(ctx.reports).toContainEqual(['s1', 'idle']);
    expect(ctx.reports).toContainEqual(['s2', 'idle']);
  });

  it('remove() cancels a pending silence timer (no idle after removal)', () => {
    ctx.monitor.observe('s1', 'a');
    expect(ctx.clock.pending()).toBe(1);
    ctx.monitor.remove('s1');
    expect(ctx.clock.pending()).toBe(0);
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS * 2);
    expect(ctx.reports).toEqual([['s1', 'working']]); // no trailing idle
  });

  it('reports `waiting` on silence when no first event has been seen', () => {
    ctx.monitor.onTurnStart('s1');
    expect(ctx.reports).toEqual([['s1', 'working']]);
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS);
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'waiting']
    ]);
  });

  it('transitions from `waiting` back to `working` on the first output', () => {
    ctx.monitor.onTurnStart('s1');
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS);
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'waiting']
    ]);
    ctx.monitor.observe('s1', 'real response output');
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'waiting'],
      ['s1', 'working']
    ]);
    ctx.clock.advance(DEFAULT_IDLE_AFTER_MS);
    expect(ctx.reports).toEqual([
      ['s1', 'working'],
      ['s1', 'waiting'],
      ['s1', 'working'],
      ['s1', 'idle']
    ]);
  });

  it('remove() of an unknown session is a no-op', () => {
    expect(() => ctx.monitor.remove('nope')).not.toThrow();
  });
});
