import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyOscTitle,
  extractLastOscTitle,
  stripTitleGlyph,
  AgentStatusTracker,
  SUBAGENT_CHILD_CAP
} from '../agent-status.js';

describe('classifyOscTitle', () => {
  it('maps a leading braille spinner glyph to working', () => {
    expect(classifyOscTitle('⠹ Cooking…')).toBe('working');
    expect(classifyOscTitle('⠀ idle-looking braille')).toBe('working');
    expect(classifyOscTitle('⣿ tail of range')).toBe('working');
  });

  it('maps a leading ✳ (U+2733) to idle', () => {
    expect(classifyOscTitle('✳ my-project')).toBe('idle');
  });

  it('tolerates leading whitespace before the marker', () => {
    expect(classifyOscTitle('  ⠹ working')).toBe('working');
  });

  it('returns null for titles with no agent signal', () => {
    expect(classifyOscTitle('~/code/my-project')).toBeNull();
    expect(classifyOscTitle('zsh')).toBeNull();
    expect(classifyOscTitle('')).toBeNull();
  });
});

describe('stripTitleGlyph', () => {
  it('strips a leading braille spinner glyph + space', () => {
    expect(stripTitleGlyph('⠹ Cooking…')).toBe('Cooking…');
  });

  it('strips a leading ✳ idle marker + space', () => {
    expect(stripTitleGlyph('✳ Fix the login bug')).toBe('Fix the login bug');
  });

  it('tolerates leading whitespace before the glyph', () => {
    expect(stripTitleGlyph('  ✳ Task title')).toBe('Task title');
  });

  it('returns the trimmed text unchanged when there is no glyph', () => {
    expect(stripTitleGlyph('~/code/my-project')).toBe('~/code/my-project');
  });

  it('returns empty when the title is only a glyph', () => {
    expect(stripTitleGlyph('✳')).toBe('');
    expect(stripTitleGlyph('⠹ ')).toBe('');
  });
});

describe('extractLastOscTitle', () => {
  it('extracts an OSC 2 title terminated by BEL', () => {
    expect(extractLastOscTitle('\x1b]2;hello\x07')).toBe('hello');
  });

  it('extracts an OSC 0 title terminated by ST (ESC backslash)', () => {
    expect(extractLastOscTitle('\x1b]0;hello\x1b\\')).toBe('hello');
  });

  it('returns the LAST title when a chunk sets several', () => {
    const chunk = '\x1b]2;⠹ a\x07 output \x1b]2;⠹ b\x07 more \x1b]2;✳ done\x07';
    expect(extractLastOscTitle(chunk)).toBe('✳ done');
  });

  it('returns null when the chunk has no title sequence', () => {
    expect(extractLastOscTitle('just some plain output\r\n')).toBeNull();
  });
});

describe('AgentStatusTracker (debounced emits)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('emits a debounced status change from an OSC-title data chunk', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, string]> = [];
    tracker.on('status', (id, state) => seen.push([id, state]));

    tracker.observeData('s1', '\x1b]2;⠹ Working…\x07');
    expect(seen).toEqual([]); // not yet — debounced
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([['s1', 'working']]);
    expect(tracker.get('s1')).toBe('working');
  });

  it('coalesces a burst into a single emit of the final state', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, string]> = [];
    tracker.on('status', (id, state) => seen.push([id, state]));

    // Spinner frames then settle to idle, all within one window.
    tracker.report('s1', 'working');
    tracker.report('s1', 'working');
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([['s1', 'idle']]);
  });

  it('does not emit when the state is unchanged', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'working'); // same state again
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['working']);
  });

  it('emits separate transitions across windows', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['working', 'idle']);
  });

  it('clears pending timers on remove', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    tracker.remove('s1');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([]);
    expect(tracker.get('s1')).toBe('unknown');
  });

  it('emits a title event from an idle OSC title (the auto-rename source)', () => {
    const tracker = new AgentStatusTracker();
    const titles: Array<[string, string]> = [];
    tracker.on('title', (id, title) => titles.push([id, title]));

    tracker.observeData('s1', '\x1b]2;✳ Fix the login bug\x07');
    expect(titles).toEqual([['s1', 'Fix the login bug']]);
  });

  it('does NOT emit a title from a working spinner title', () => {
    const tracker = new AgentStatusTracker();
    const titles: string[] = [];
    tracker.on('title', (_id, title) => titles.push(title));

    tracker.observeData('s1', '\x1b]2;⠹ Cooking…\x07');
    expect(titles).toEqual([]);
  });

  it('emits a title only when the idle summary changes', () => {
    const tracker = new AgentStatusTracker();
    const titles: string[] = [];
    tracker.on('title', (_id, title) => titles.push(title));

    tracker.observeData('s1', '\x1b]2;✳ Same task\x07');
    tracker.observeData('s1', '\x1b]2;✳ Same task\x07'); // re-emitted each idle frame
    tracker.observeData('s1', '\x1b]2;✳ New task\x07');
    expect(titles).toEqual(['Same task', 'New task']);
  });

  it('ignores data chunks with no agent signal', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.observeData('s1', 'plain output, no OSC title\r\n');
    tracker.observeData('s1', '\x1b]2;~/some/cwd\x07'); // title, but no marker
    vi.advanceTimersByTime(250);

    expect(seen).toEqual([]);
  });
});

describe('AgentStatusTracker (snapshot)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('is empty for a fresh tracker', () => {
    expect(new AgentStatusTracker().snapshot()).toEqual([]);
  });

  it('returns the debounced emitted state for every tracked session', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    tracker.report('s2', 'idle');
    vi.advanceTimersByTime(250);

    expect(new Map(tracker.snapshot())).toEqual(new Map([['s1', 'working'], ['s2', 'idle']]));
  });

  it('reflects the latest emitted state, not a pending one', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle'); // queued but not yet flushed

    expect(new Map(tracker.snapshot()).get('s1')).toBe('working');
    vi.advanceTimersByTime(250);
    expect(new Map(tracker.snapshot()).get('s1')).toBe('idle');
  });

  it('drops a removed session', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.remove('s1');

    expect(tracker.snapshot()).toEqual([]);
  });
});

describe('AgentStatusTracker (sub-agent live count)', () => {
  it('increments on start and emits the running count', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, number]> = [];
    tracker.on('subagents', (id, count) => seen.push([id, count]));

    tracker.subagentStarted('s1');
    tracker.subagentStarted('s1');

    expect(seen).toEqual([['s1', 1], ['s1', 2]]);
    expect(tracker.subagents('s1')).toBe(2);
  });

  it('decrements on stop and clamps at zero', () => {
    const tracker = new AgentStatusTracker();
    const seen: number[] = [];
    tracker.on('subagents', (_id, count) => seen.push(count));

    tracker.subagentStarted('s1');
    tracker.subagentStopped('s1');
    tracker.subagentStopped('s1'); // unmatched stop — no emit, stays 0

    expect(seen).toEqual([1, 0]);
    expect(tracker.subagents('s1')).toBe(0);
  });

  it('clearSubagents resets a live count to zero and emits once', () => {
    const tracker = new AgentStatusTracker();
    const seen: number[] = [];
    tracker.on('subagents', (_id, count) => seen.push(count));

    tracker.subagentStarted('s1');
    tracker.subagentStarted('s1');
    tracker.clearSubagents('s1');
    tracker.clearSubagents('s1'); // already zero — no second emit

    expect(seen).toEqual([1, 2, 0]);
    expect(tracker.subagents('s1')).toBe(0);
  });

  it('does NOT change the resolved agent state', () => {
    const tracker = new AgentStatusTracker();
    const statuses: string[] = [];
    tracker.on('status', (_id, state) => statuses.push(state));

    tracker.subagentStarted('s1');
    tracker.subagentStopped('s1');

    // Sub-agent activity rides its own event; it never touches `status`.
    expect(statuses).toEqual([]);
    expect(tracker.get('s1')).toBe('unknown');
  });

  it('subagentSnapshot returns only sessions with a live count', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1');
    tracker.subagentStarted('s1');
    tracker.subagentStarted('s2');
    tracker.subagentStopped('s2'); // back to 0 — excluded

    expect(new Map(tracker.subagentSnapshot())).toEqual(new Map([['s1', 2]]));
  });

  it('is empty for a fresh tracker', () => {
    expect(new AgentStatusTracker().subagentSnapshot()).toEqual([]);
    expect(new AgentStatusTracker().subagents('nope')).toBe(0);
  });
});

describe('AgentStatusTracker (sub-agent child records)', () => {
  it('appends a running child with identity on start and emits subagentChildren', () => {
    const tracker = new AgentStatusTracker();
    const seen: Array<[string, number]> = [];
    tracker.on('subagentChildren', (id, children) => seen.push([id, children.length]));

    tracker.subagentStarted('s1', { description: 'Review diff', subagentType: 'code-reviewer' });

    const children = tracker.subagentChildren('s1');
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({
      description: 'Review diff',
      subagentType: 'code-reviewer',
      status: 'running'
    });
    expect(children[0].id).toBe('s1:0');
    expect(seen).toEqual([['s1', 1]]);
  });

  it('keeps the count in parity with the child records', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1', { subagentType: 'a' });
    tracker.subagentStarted('s1', { subagentType: 'b' });
    expect(tracker.subagents('s1')).toBe(2);
    expect(tracker.subagentChildren('s1')).toHaveLength(2);
  });

  it('tracks a child even when identity is absent (count parity preserved)', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1'); // no identity payload
    const children = tracker.subagentChildren('s1');
    expect(children).toHaveLength(1);
    expect(children[0].description).toBeUndefined();
    expect(children[0].subagentType).toBeUndefined();
    expect(children[0].status).toBe('running');
    expect(tracker.subagents('s1')).toBe(1);
  });

  it('marks the OLDEST running child done on stop (FIFO correlation)', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1', { subagentType: 'first' });
    tracker.subagentStarted('s1', { subagentType: 'second' });

    tracker.subagentStopped('s1');

    const children = tracker.subagentChildren('s1');
    expect(children.find((c) => c.subagentType === 'first')?.status).toBe('done');
    expect(children.find((c) => c.subagentType === 'second')?.status).toBe('running');
    // count still drops in lockstep
    expect(tracker.subagents('s1')).toBe(1);
  });

  it('stamps stoppedAt on the child it marks done', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1', { subagentType: 'x' });
    tracker.subagentStopped('s1');
    const child = tracker.subagentChildren('s1')[0];
    expect(child.status).toBe('done');
    expect(typeof child.stoppedAt).toBe('number');
  });

  it('clearSubagents drains the child array too', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1', { subagentType: 'x' });
    tracker.subagentStarted('s1', { subagentType: 'y' });
    tracker.clearSubagents('s1');
    expect(tracker.subagentChildren('s1')).toEqual([]);
    expect(tracker.subagents('s1')).toBe(0);
  });

  it('caps retained children at SUBAGENT_CHILD_CAP, evicting done first', () => {
    const tracker = new AgentStatusTracker();
    // Start CAP+10 children; immediately stop each so they are 'done'.
    for (let i = 0; i < SUBAGENT_CHILD_CAP + 10; i++) {
      tracker.subagentStarted('s1', { subagentType: `t${i}` });
      tracker.subagentStopped('s1');
    }
    const children = tracker.subagentChildren('s1');
    expect(children.length).toBeLessThanOrEqual(SUBAGENT_CHILD_CAP);
  });

  it('evicts done children before a running one when over cap', () => {
    const tracker = new AgentStatusTracker();
    // A flood of started+stopped (done) children first…
    for (let i = 0; i < SUBAGENT_CHILD_CAP + 20; i++) {
      tracker.subagentStarted('s1', { subagentType: `t${i}` });
      tracker.subagentStopped('s1');
    }
    // …then one still-running child started LAST (so FIFO-stop never touches it).
    tracker.subagentStarted('s1', { subagentType: 'long-runner' });
    const children = tracker.subagentChildren('s1');
    expect(children.length).toBeLessThanOrEqual(SUBAGENT_CHILD_CAP);
    // The running child survived; done children were the ones evicted.
    expect(children.some((c) => c.subagentType === 'long-runner' && c.status === 'running')).toBe(true);
  });

  it('subagentChildSnapshot returns only sessions with child records', () => {
    const tracker = new AgentStatusTracker();
    tracker.subagentStarted('s1', { subagentType: 'x' });
    tracker.subagentStarted('s2', { subagentType: 'y' });
    tracker.clearSubagents('s2');

    const snap = new Map(tracker.subagentChildSnapshot());
    expect(snap.has('s1')).toBe(true);
    expect(snap.has('s2')).toBe(false);
  });

  it('is empty for a fresh tracker', () => {
    expect(new AgentStatusTracker().subagentChildSnapshot()).toEqual([]);
    expect(new AgentStatusTracker().subagentChildren('nope')).toEqual([]);
  });
});

describe('AgentStatusTracker (Notification-hook blocked overlay)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('markBlocked overrides the OSC idle glyph (the core bug)', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    // Claude shows the ✳ idle glyph even while waiting on the user…
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);
    expect(seen).toEqual(['idle']);

    // …but the Notification hook tells us it's actually blocked.
    tracker.markBlocked('s1');
    vi.advanceTimersByTime(250);
    expect(seen).toEqual(['idle', 'blocked']);
    expect(tracker.get('s1')).toBe('blocked');

    // A later idle reading must NOT clear blocked — same glyph the whole wait.
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);
    expect(tracker.get('s1')).toBe('blocked');
  });

  it('a working spinner clears a sticky blocked overlay', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.markBlocked('s1');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'working'); // agent resumed producing output
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['blocked', 'working']);
  });

  it('clearBlocked falls back to the latest OSC reading', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'idle');
    tracker.markBlocked('s1');
    vi.advanceTimersByTime(250);
    expect(tracker.get('s1')).toBe('blocked');

    tracker.clearBlocked('s1'); // user answered / turn ended
    vi.advanceTimersByTime(250);
    expect(tracker.get('s1')).toBe('idle');
    expect(seen).toEqual(['blocked', 'idle']);
  });

  it('clearBlocked on a session that was never blocked is a no-op', () => {
    const tracker = new AgentStatusTracker();
    const seen: string[] = [];
    tracker.on('status', (_id, state) => seen.push(state));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.clearBlocked('s1');
    vi.advanceTimersByTime(250);

    expect(seen).toEqual(['working']);
  });
});

describe('AgentStatusTracker (cursor-replay ring buffer)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('since(0) on an empty tracker returns snapshot mode with empty snapshot', () => {
    const tracker = new AgentStatusTracker();
    const result = tracker.since(0);
    expect(result.mode).toBe('snapshot');
    if (result.mode === 'snapshot') {
      expect(result.snapshot).toEqual([]);
    }
    expect(result.headSeq).toBe(0);
  });

  it('since(0) after N transitions replays all N events in order', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);
    tracker.report('s2', 'blocked');
    vi.advanceTimersByTime(250);

    const result = tracker.since(0);
    expect(result.mode).toBe('replay');
    if (result.mode === 'replay') {
      expect(result.events).toHaveLength(3);
      expect(result.events[0][1]).toBe('s1'); // sessionId
      expect(result.events[0][2]).toBe('working'); // state
      expect(result.events[1][1]).toBe('s1');
      expect(result.events[1][2]).toBe('idle');
      expect(result.events[2][1]).toBe('s2');
      expect(result.events[2][2]).toBe('blocked');
      // Verify ascending seq
      expect(result.events[0][0]).toBeLessThan(result.events[1][0]);
      expect(result.events[1][0]).toBeLessThan(result.events[2][0]);
    }
    expect(result.headSeq).toBeGreaterThan(0);
  });

  it('since(k) returns only events with seq > k', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);
    tracker.report('s2', 'blocked');
    vi.advanceTimersByTime(250);

    const first = tracker.since(0);
    expect(first.mode).toBe('replay');
    if (first.mode !== 'replay') return;
    const midSeq = first.events[1][0]; // seq of the second transition

    const result = tracker.since(midSeq);
    expect(result.mode).toBe('replay');
    if (result.mode === 'replay') {
      expect(result.events).toHaveLength(1);
      expect(result.events[0][1]).toBe('s2');
      expect(result.events[0][2]).toBe('blocked');
    }
  });

  it('overflow past RING_CAP returns snapshot mode for old cursors', () => {
    const tracker = new AgentStatusTracker();
    // Emit > RING_CAP (500) transitions to force overflow
    for (let i = 0; i < 510; i++) {
      tracker.report(`s${i % 5}`, i % 2 === 0 ? 'working' : 'idle');
      vi.advanceTimersByTime(250);
    }

    // The oldest seq in the ring is now > 10 (we overflowed)
    const result = tracker.since(5);
    expect(result.mode).toBe('snapshot');
    if (result.mode === 'snapshot') {
      expect(result.snapshot).toBeDefined();
    }
    expect(result.headSeq).toBeGreaterThan(500);
  });

  it('bogus sinceSeq (negative) returns snapshot mode', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);

    const result = tracker.since(-5);
    expect(result.mode).toBe('snapshot');
    if (result.mode === 'snapshot') {
      expect(result.snapshot).toEqual([['s1', 'working']]);
    }
    expect(result.headSeq).toBeGreaterThan(0);
  });

  it('bogus sinceSeq (NaN) returns snapshot mode', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    const result = tracker.since(NaN);
    expect(result.mode).toBe('snapshot');
    if (result.mode === 'snapshot') {
      expect(result.snapshot).toEqual([['s1', 'idle']]);
    }
  });

  it('sinceSeq > headSeq returns snapshot mode', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);

    const first = tracker.since(0);
    const futureSeq = first.headSeq + 100;

    const result = tracker.since(futureSeq);
    expect(result.mode).toBe('snapshot');
    if (result.mode === 'snapshot') {
      expect(result.snapshot).toEqual([['s1', 'working']]);
    }
  });

  it('status event carries seq as third argument', () => {
    const tracker = new AgentStatusTracker();
    const seqs: number[] = [];
    tracker.on('status', (_id, _state, seq) => seqs.push(seq));

    tracker.report('s1', 'working');
    vi.advanceTimersByTime(250);
    tracker.report('s1', 'idle');
    vi.advanceTimersByTime(250);

    expect(seqs).toHaveLength(2);
    expect(seqs[0]).toBeGreaterThan(0);
    expect(seqs[1]).toBeGreaterThan(seqs[0]);
  });

  it('seq advances only on real emitted transitions, not pending ones', () => {
    const tracker = new AgentStatusTracker();
    tracker.report('s1', 'working');
    const before = tracker.since(0);

    // Queue another transition but don't flush
    tracker.report('s1', 'idle');
    const after = tracker.since(0);

    // seq should be unchanged because the transition hasn't flushed
    expect(after.headSeq).toBe(before.headSeq);

    // Now flush
    vi.advanceTimersByTime(250);
    const flushed = tracker.since(0);
    expect(flushed.headSeq).toBeGreaterThan(after.headSeq);
  });
});
