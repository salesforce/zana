/**
 * ScreenScanBlockedDetector tests (LAS-07). The detector recovers the `blocked`
 * ("needs-you") state for non-Claude, non-hook agents (OpenCode/cursor/pi) that go
 * QUIET at a permission prompt — which `OutputActivityMonitor` would otherwise read
 * as `idle`. We assert: settle-then-scan, the working-edge buffer clear (a dismissed
 * prompt can't re-match), ANSI stripping, the bounded tail, per-session isolation, a
 * throwing `detect` can't wedge the path, and — the real payoff — the end-to-end
 * fusion through a live AgentStatusTracker + OutputActivityMonitor + the actual
 * OpenCodeProvider pattern against captured ground-truth prompt text.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AgentState } from '../../shared/types.js';
import {
  ScreenScanBlockedDetector,
  DEFAULT_SETTLE_AFTER_MS,
  RECENT_TEXT_CAP,
  stripAnsi,
  type ScreenScanBlockedDeps
} from '../screen-scan-blocked-detector.js';
import { AgentStatusTracker } from '../agent-status.js';
import { OutputActivityMonitor, DEFAULT_IDLE_AFTER_MS } from '../output-activity.js';
import { OpenCodeProvider } from '../harness/opencode-provider.js';

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

/**
 * The exact permission-prompt screen OpenCode paints, captured live via node-pty
 * (matches the binary's own `M(q,T("△")),M(q,T("Permission required"))` +
 * `options:{once:"Allow once",always:"Allow always"}` source strings).
 */
const OC_BLOCKED_SCREEN = [
  '△ Permission required',
  '  # Shell command',
  '$ echo hello > /tmp/oc_perm_test.txt',
  '  Allow once   Allow always   Reject',
  'ctrl+f fullscreen  ⇆ select  enter confirm'
].join('\n');

/**
 * The SECOND OpenCode blocking surface: the interactive question (`ask` tool /
 * QuestionV2) card, keyed off the select-footer `enter submit` + `esc dismiss`
 * key-hint pair (the binary composes it as `r("enter ")+"submit"` /
 * `r("esc ")+"dismiss"`, so both phrases render contiguously).
 */
const OC_QUESTION_SCREEN = [
  'How would you like to spend a free weekend?',
  '  1. Hiking in the mountains',
  '  2. Reading at home',
  '  5. Type your own answer',
  '↑↓ select  enter submit  esc dismiss'
].join('\n');

function makeDetector(overrides: Partial<ScreenScanBlockedDeps> = {}) {
  const blocked: string[] = [];
  const clock = makeClock();
  const deps: ScreenScanBlockedDeps = {
    sink: { markBlocked: (id) => blocked.push(id) },
    // Default detect: the OpenCode pattern, so tests exercise the real gate.
    detect: (_id, text) => {
      const t = text.toLowerCase();
      return t.includes('permission required') && t.includes('reject');
    },
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    ...overrides
  };
  const detector = new ScreenScanBlockedDetector(deps);
  return { detector, blocked, clock };
}

describe('stripAnsi', () => {
  it('removes OSC, CSI, charset and control sequences, keeps text', () => {
    const raw = '\x1b]0;title\x07\x1b[1;31mhello\x1b[0m\x1b(Bworld\x1b[2J';
    expect(stripAnsi(raw)).toBe('helloworld');
  });
  it('preserves newlines and tabs, blanks other control bytes', () => {
    expect(stripAnsi('a\nb\tc\x00d')).toBe('a\nb\tc d');
  });
});

describe('ScreenScanBlockedDetector', () => {
  let ctx: ReturnType<typeof makeDetector>;
  beforeEach(() => {
    ctx = makeDetector();
  });

  it('marks blocked when the settled screen matches the prompt pattern', () => {
    ctx.detector.observe('s1', OC_BLOCKED_SCREEN);
    expect(ctx.blocked).toEqual([]); // nothing until it settles
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']);
  });

  it('does NOT mark blocked for ordinary output (no prompt)', () => {
    ctx.detector.observe('s1', 'Reading files and thinking about permission models...');
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual([]);
  });

  it('scans only the SETTLED screen, not mid-stream', () => {
    ctx.detector.observe('s1', '△ Permission required'); // partial, no button yet
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS - 1);
    ctx.detector.observe('s1', '  Allow once   Reject'); // rest arrives, re-arms
    expect(ctx.blocked).toEqual([]); // still not settled
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']); // whole prompt present at settle
  });

  it('clears stale buffer on the working edge (a dismissed prompt cannot re-match)', () => {
    ctx.detector.observe('s1', OC_BLOCKED_SCREEN);
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']); // blocked once

    // User answers → harness repaints with fresh, prompt-free output.
    ctx.detector.observe('s1', 'Running the command now...');
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']); // NOT marked again — stale text was dropped
  });

  it('ignores empty chunks (a bare flush is not activity)', () => {
    ctx.detector.observe('s1', '');
    expect(ctx.clock.pending()).toBe(0);
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual([]);
  });

  it('bounds the retained tail to RECENT_TEXT_CAP', () => {
    // Prime a huge chunk of filler, THEN append the prompt in the SAME active
    // window (no intervening settle) so it all lands in one buffer; the head is
    // trimmed but the (recent) prompt survives.
    ctx.detector.observe('s1', 'x'.repeat(RECENT_TEXT_CAP * 2));
    ctx.detector.observe('s1', '\n' + OC_BLOCKED_SCREEN);
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']); // trailing prompt retained past the cap
  });

  it('tracks sessions independently', () => {
    ctx.detector.observe('s1', OC_BLOCKED_SCREEN);
    ctx.detector.observe('s2', 'just working, no prompt here');
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS);
    expect(ctx.blocked).toEqual(['s1']); // only s1 blocked
  });

  it('reads settleAfterMs live from the injected getter', () => {
    const custom = makeDetector({ settleAfterMs: () => 500 });
    custom.detector.observe('s1', OC_BLOCKED_SCREEN);
    custom.clock.advance(499);
    expect(custom.blocked).toEqual([]);
    custom.clock.advance(1);
    expect(custom.blocked).toEqual(['s1']);
  });

  it('a throwing detect callback cannot wedge the path', () => {
    const boom = makeDetector({
      detect: () => {
        throw new Error('bad provider pattern');
      }
    });
    boom.detector.observe('s1', OC_BLOCKED_SCREEN);
    expect(() => boom.clock.advance(DEFAULT_SETTLE_AFTER_MS)).not.toThrow();
    expect(boom.blocked).toEqual([]);
  });

  it('remove() cancels a pending settle timer (no blocked after removal)', () => {
    ctx.detector.observe('s1', OC_BLOCKED_SCREEN);
    expect(ctx.clock.pending()).toBe(1);
    ctx.detector.remove('s1');
    expect(ctx.clock.pending()).toBe(0);
    ctx.clock.advance(DEFAULT_SETTLE_AFTER_MS * 2);
    expect(ctx.blocked).toEqual([]);
  });

  it('remove() of an unknown session is a no-op', () => {
    expect(() => ctx.detector.remove('nope')).not.toThrow();
  });
});

/**
 * The real payoff: the full fusion path exactly as `index.ts` wires it — an
 * AgentStatusTracker fed by BOTH the OutputActivityMonitor (working/idle) and the
 * ScreenScanBlockedDetector (blocked), driving through the REAL OpenCodeProvider
 * pattern. This proves the OpenCode "goes quiet at the prompt" failure mode now
 * surfaces as `blocked`, and that answering it auto-clears back to `working`.
 */
describe('ScreenScanBlockedDetector × AgentStatusTracker × OutputActivity (OpenCode)', () => {
  // The real AgentStatusTracker debounces emits with its OWN internal
  // setTimeout(250ms), which the injected fake clock can't reach. So drive the
  // whole fusion on vitest's fake timers: the tracker's debounce, the
  // output-activity idle timer, and the scan settle timer all advance together.
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeFusion() {
    const tracker = new AgentStatusTracker();
    const provider = new OpenCodeProvider();
    const activity = new OutputActivityMonitor({
      sink: tracker,
      idleAfterMs: () => DEFAULT_IDLE_AFTER_MS,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h)
    });
    const scan = new ScreenScanBlockedDetector({
      sink: tracker,
      detect: (_id, text) => provider.detectBlockedPrompt('opencode', text),
      settleAfterMs: () => DEFAULT_IDLE_AFTER_MS,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h)
    });
    // Feed a chunk through BOTH detectors, exactly like the pty `data` handler.
    const feed = (id: string, data: string) => {
      activity.observe(id, data);
      scan.observe(id, data);
    };
    const states: AgentState[] = [];
    tracker.on('status', (_id, state) => states.push(state));
    return { tracker, feed, states };
  }

  it('OpenCode going quiet at a permission prompt surfaces as `blocked`, not `idle`', () => {
    const f = makeFusion();
    // Agent streams its reasoning → working (flush the 250ms emit debounce).
    f.feed('oc', "I'll run the shell command as requested.");
    vi.advanceTimersByTime(300);
    expect(f.tracker.get('oc')).toBe('working');

    // Then paints the permission prompt in one burst and goes SILENT (the exact
    // OpenCode behavior verified via node-pty: 0 bytes until the user answers).
    f.feed('oc', '\x1b[2J' + OC_BLOCKED_SCREEN);
    // Let the shared settle/idle window elapse (with NO further output) plus the
    // emit debounce, so both the idle settle and the blocked scan land.
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS + 300);

    // output-activity settled to `idle`, but the sticky blocked overlay wins.
    expect(f.tracker.get('oc')).toBe('blocked');
  });

  it('answering the prompt (output resumes) auto-clears blocked → working', () => {
    const f = makeFusion();
    f.feed('oc', 'thinking...');
    f.feed('oc', '\x1b[2J' + OC_BLOCKED_SCREEN);
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS + 300);
    expect(f.tracker.get('oc')).toBe('blocked');

    // User picks "Allow once" → OpenCode repaints and streams again.
    f.feed('oc', '\x1b[2JRunning: echo hello ... done.');
    vi.advanceTimersByTime(300);
    expect(f.tracker.get('oc')).toBe('working'); // resumed output cleared blocked
  });

  it('OpenCode going quiet at an interactive QUESTION also surfaces as `blocked`', () => {
    const f = makeFusion();
    f.feed('oc', "Let me ask a quick question.");
    vi.advanceTimersByTime(300);
    expect(f.tracker.get('oc')).toBe('working');

    // Paints the question card and goes silent (same behavior as the permission
    // prompt — the gap this closes: it used to settle to `idle`, reading as "done").
    f.feed('oc', '\x1b[2J' + OC_QUESTION_SCREEN);
    vi.advanceTimersByTime(DEFAULT_IDLE_AFTER_MS + 300);
    expect(f.tracker.get('oc')).toBe('blocked');
  });
});
