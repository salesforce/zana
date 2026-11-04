import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_ACTIVE_WRAP_UPS,
  MAX_CONCURRENT_SUMMARIES,
  oneLine,
  SETTLE_MS,
  TURN_TIMEOUT_MS,
  WrapUpCloseService,
  type WrapUpCloseDeps,
  type WrapUpSession
} from './wrap-up-close.js';
import type { SessionCloseNote, SummarizeForCloseResult } from './close-summary.js';

const note = (over: Partial<SessionCloseNote> = {}): SessionCloseNote => ({ body: '## Did\n- a', unfinished: false, asksUser: false, ...over });
const okSummary = (over: Partial<SessionCloseNote> = {}): SummarizeForCloseResult => ({ ok: true, title: 'Agent', note: note(over) });

function make(over: Partial<WrapUpCloseDeps> = {}) {
  const sessions = new Map<string, WrapUpSession>();
  const states = new Map<string, string>();
  const add = (id: string, state = 'idle', s: Partial<WrapUpSession> = {}) => {
    sessions.set(id, { projectId: 'p', profile: 'claude', status: 'running', title: `T-${id}`, remote: false, ...s });
    states.set(id, state);
  };
  const deps = {
    getInstructions: vi.fn(() => 'Wrap up.\n1. Do it.\n\n2. Done.'),
    getSession: vi.fn((id: string) => sessions.get(id) ?? null),
    hasTranscript: vi.fn((profile: string) => profile !== 'shell'),
    isTypeable: vi.fn((profile: string) => profile === 'claude'),
    getAgentState: vi.fn((id: string) => states.get(id) ?? 'unknown'),
    reply: vi.fn(() => true),
    markNeedsYou: vi.fn(),
    summarizeForClose: vi.fn(async (): Promise<SummarizeForCloseResult> => okSummary()),
    recordClose: vi.fn(async () => ({ summarized: 1 as const, followedUp: 0 as const })),
    recordKeptOpen: vi.fn(async () => ({ recorded: 1 as const })),
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (h: NodeJS.Timeout) => clearTimeout(h),
    log: vi.fn(),
    ...over
  } satisfies WrapUpCloseDeps;
  const svc = new WrapUpCloseService(deps);
  const set = (id: string, state: string) => { states.set(id, state); svc.observe(id, state); };
  return { svc, deps, sessions, states, add, set };
}

const settle = () => vi.advanceTimersByTimeAsync(SETTLE_MS);

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('oneLine', () => {
  it('collapses every whitespace run, newlines included', () => {
    expect(oneLine('  a\n\n1.  b\t c \n')).toBe('a 1. b c');
  });
});

describe('WrapUpCloseService wrap-up of a resting local Claude agent', () => {
  it('types one line, waits for the turn and rest, then records wrapped and is closeable', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    expect(deps.reply).toHaveBeenCalledTimes(1);
    expect(deps.reply).toHaveBeenCalledWith('s1', 'Wrap up. 1. Do it. 2. Done.');
    expect(svc.isWrappingUp('s1')).toBe(true);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
    expect(deps.recordClose).toHaveBeenCalledWith('p', 's1', 'Agent', note(), 'wrapped');
    expect(svc.isWrappingUp('s1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not finish when the rest is shorter than the settle time and the agent works again', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000);
    set('s1', 'working');
    await settle();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    set('s1', 'done');
    set('s1', 'idle'); // a flip between resting states keeps the running wait
    await settle();
    expect(await p).toMatchObject({ summarized: 1 });
    expect(deps.recordClose).toHaveBeenCalledTimes(1);
  });

  it('re-checks the state when the settle timer fires', async () => {
    const { svc, deps, add, set, states } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    states.set('s1', 'working'); // flipped without an observed event
    await settle();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    set('s1', 'idle');
    await settle();
    await p;
    expect(deps.recordClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the agent open and marks it needs-you when the summary says it asks the user', async () => {
    const { svc, deps, add, set } = make({ summarizeForClose: vi.fn(async () => okSummary({ asksUser: true })) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'asks-you' }] });
    expect(deps.markNeedsYou).toHaveBeenCalledWith('s1');
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'Agent', 'asks-you', note({ asksUser: true }));
    expect(deps.recordClose).not.toHaveBeenCalled();
  });

  it('summarises and keeps it open, without markNeedsYou, when the agent stays blocked after the send', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'asks-you' }] });
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'Agent', 'asks-you', note());
    expect(deps.markNeedsYou).not.toHaveBeenCalled();
  });

  it('still keeps it open, reporting the failure, when the summary fails after a block', async () => {
    const { svc, deps, add, set } = make({ summarizeForClose: vi.fn(async () => ({ ok: false, reason: 'summary-failed' }) as const) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, failures: [{ reason: 'summary-failed' }], keptOpen: [{ sessionId: 's1', reason: 'asks-you' }] });
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'T-s1', 'asks-you', undefined);
  });

  it('writes no asks-you note when the prompt is answered while the summary runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set, states } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await settle();
    expect(deps.summarizeForClose).toHaveBeenCalledTimes(1);
    states.set('s1', 'working'); // the person answered the prompt
    release();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('writes no asks-you note when a key moves while the summary of a block runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set, sessions } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1', 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await settle();
    sessions.get('s1')!.lastKeyInputAt = 2;
    release();
    expect(await p).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('resolves as gone when the session disappears while the summary of a block runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set, sessions } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await settle();
    sessions.delete('s1');
    release();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('treats a block that lifts before the settle time as not finished', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'blocked');
    await vi.advanceTimersByTimeAsync(SETTLE_MS - 1000);
    set('s1', 'working');
    await settle();
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
    set('s1', 'idle');
    await settle();
    await p;
    expect(deps.recordClose).toHaveBeenCalledWith('p', 's1', 'Agent', note(), 'wrapped');
  });
});

describe('WrapUpCloseService yielding to the human', () => {
  it('keeps it open as typed, with no summary, when lastKeyInputAt moved by the settle time', async () => {
    const { svc, deps, add, set, sessions } = make();
    add('s1', 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    sessions.get('s1')!.lastKeyInputAt = 2; // typed, but no status event
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
  });

  it('stops at once when the human types mid-run (checked on every status change)', async () => {
    const { svc, deps, add, set, sessions } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    sessions.get('s1')!.lastKeyInputAt = 5;
    set('s1', 'working');
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a working agent open as typed, typing nothing, when a key moved before it rested', async () => {
    const { svc, deps, add, set, sessions } = make();
    add('s1', 'working', { lastKeyInputAt: 1 });
    const p = svc.run('p', ['s1']);
    sessions.get('s1')!.lastKeyInputAt = 2; // the person typed a new instruction while it worked
    set('s1', 'idle');
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('writes no record and keeps it open as typed when a key moves while the summary runs', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set, sessions } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1', 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(deps.summarizeForClose).toHaveBeenCalledTimes(1);
    sessions.get('s1')!.lastKeyInputAt = 2; // typed while the summary was being written
    release();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.recordClose).not.toHaveBeenCalled();
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('writes no record and keeps it open as typed when the agent starts working again during the summary', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set, states } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    states.set('s1', 'working');
    release();
    expect(await p).toMatchObject({ summarized: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.recordClose).not.toHaveBeenCalled();
  });

  it('types nothing and keeps it open as typed when a draft is pending at the click', async () => {
    const { svc, deps, add } = make();
    add('s1', 'idle', { draftPending: true });
    expect(await svc.run('p', ['s1'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
  });
});

describe('WrapUpCloseService state at the click', () => {
  it('waits for a working agent to rest before typing', async () => {
    const { svc, deps, add, set } = make();
    add('s1', 'working');
    const p = svc.run('p', ['s1']);
    expect(deps.reply).not.toHaveBeenCalled();
    set('s1', 'unknown'); // ignored
    expect(deps.reply).not.toHaveBeenCalled();
    set('s1', 'idle');
    expect(deps.reply).toHaveBeenCalledTimes(1);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await p).toMatchObject({ summarized: 1 });
  });

  it('takes the blocked path when a working agent turns blocked first', async () => {
    const { svc, deps, add, set } = make();
    add('s1', 'working');
    const p = svc.run('p', ['s1']);
    set('s1', 'blocked');
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.recordClose).toHaveBeenCalledWith('p', 's1', 'Agent', note(), 'waiting-on-prompt');
  });

  it('keeps a pending draft safe when a working agent rests with one', async () => {
    const { svc, deps, add, set, sessions } = make();
    add('s1', 'working');
    const p = svc.run('p', ['s1']);
    sessions.get('s1')!.draftPending = true;
    set('s1', 'idle');
    expect(await p).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    expect(deps.reply).not.toHaveBeenCalled();
  });

  it('writes no record and keeps it open as typed when a key moves while a no-wrap-up summary runs', async () => {
    for (const [state, profile] of [['blocked', 'claude'], ['idle', 'codex']] as const) {
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const { svc, deps, add, sessions } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
      add('s1', state, { profile, lastKeyInputAt: 1 });
      const p = svc.run('p', ['s1']);
      await vi.advanceTimersByTimeAsync(0);
      expect(deps.summarizeForClose).toHaveBeenCalledTimes(1);
      sessions.get('s1')!.lastKeyInputAt = 2; // for example, the person answered the prompt
      release();
      expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
      expect(deps.recordClose).not.toHaveBeenCalled();
    }
  });

  it('records waiting-on-prompt for a blocked agent, without typing', async () => {
    const { svc, deps, add } = make();
    add('s1', 'blocked');
    expect(await svc.run('p', ['s1'])).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.recordClose).toHaveBeenCalledWith('p', 's1', 'Agent', note(), 'waiting-on-prompt');
  });

  it('records no-wrap-up for an unknown agent, a Codex session and a remote Claude session', async () => {
    const { svc, deps, add } = make();
    add('u', 'unknown');
    add('c', 'idle', { profile: 'codex' });
    add('r', 'idle', { remote: true });
    const res = await svc.run('p', ['u', 'c', 'r']);
    expect(res).toEqual({ summarized: 3, followedUp: 0, keptOpen: [] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.recordClose.mock.calls.map((c) => c[4])).toEqual(['no-wrap-up', 'no-wrap-up', 'no-wrap-up']);
  });

  it('skips a foreign-project, gone, exited or shell session, which stays closeable', async () => {
    const { svc, deps, add } = make();
    add('f', 'idle', { projectId: 'other' });
    add('x', 'idle', { status: 'exited' });
    add('sh', 'unknown', { profile: 'shell' });
    expect(await svc.run('p', ['f', 'gone', 'x', 'sh'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('counts a false reply as gone: closeable, nothing recorded', async () => {
    const { svc, deps, add } = make({ reply: vi.fn(() => false) });
    add('s1');
    expect(await svc.run('p', ['s1'])).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('WrapUpCloseService failures', () => {
  it('is still closeable, with its failure, when the summary fails or is empty', async () => {
    const results: SummarizeForCloseResult[] = [{ ok: false, reason: 'summary-failed' }, { ok: false, reason: 'empty' }, { ok: false, reason: 'ineligible' }];
    const { svc, deps, add } = make({ summarizeForClose: vi.fn(async () => results.shift()!) });
    add('a', 'blocked');
    add('b', 'blocked');
    add('c', 'blocked');
    expect(await svc.run('p', ['a', 'b', 'c'])).toEqual({
      summarized: 0,
      followedUp: 0,
      failures: [{ reason: 'summary-failed' }, { reason: 'empty' }],
      keptOpen: []
    });
    expect(deps.recordClose).not.toHaveBeenCalled();
  });

  it('closes after the wrap-up even when the summary fails', async () => {
    const { svc, add, set } = make({ summarizeForClose: vi.fn(async () => ({ ok: false, reason: 'summary-failed' }) as const) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, failures: [{ reason: 'summary-failed' }], keptOpen: [] });
  });

  it('adds up counts and concatenates write failures from the record calls', async () => {
    const { svc, add, set } = make({
      recordClose: vi.fn(async () => ({ summarized: 1 as const, followedUp: 1 as const, failures: [{ reason: 'write-failed' as const, detail: 'disk' }] })),
      summarizeForClose: vi.fn(async () => okSummary({ unfinished: true }))
    });
    add('a');
    add('b');
    const p = svc.run('p', ['a', 'b', 'a']);
    for (const id of ['a', 'b']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    expect(await p).toEqual({
      summarized: 2,
      followedUp: 2,
      failures: [{ reason: 'write-failed', detail: 'disk' }, { reason: 'write-failed', detail: 'disk' }],
      keptOpen: []
    });
  });

  it('survives a throwing record call: closeable, logged, timers released', async () => {
    const { svc, deps, add, set } = make({ recordClose: vi.fn(async () => { throw new Error('boom'); }) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('failed: boom'));
    expect(svc.isWrappingUp('s1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('logs a non-Error throw', async () => {
    const { svc, deps, add } = make({ summarizeForClose: vi.fn(async () => { throw 'plain'; }) });
    add('s1', 'blocked');
    await svc.run('p', ['s1']);
    expect(deps.log).toHaveBeenCalledWith(expect.stringContaining('failed: plain'));
  });
});

describe('WrapUpCloseService timeout, forget and repeat runs', () => {
  it('keeps a still-busy agent open after 15 minutes, with no summary', async () => {
    const { svc, deps, add } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'timeout' }] });
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'T-s1', 'timeout');
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('times out a working agent that was never asked: nothing is typed', async () => {
    const { svc, deps, add } = make();
    add('s1', 'working');
    const p = svc.run('p', ['s1']);
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'timeout' }] });
    expect(deps.reply).not.toHaveBeenCalled();
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'T-s1', 'timeout');
  });

  it('falls back to the session id as title when the session vanished before the timeout', async () => {
    const { svc, deps, add, sessions } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    sessions.delete('s1');
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
    await p;
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 's1', 'timeout');
  });

  it('does not time out once the summary has started', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const { svc, deps, add, set } = make({ summarizeForClose: vi.fn(async () => { await gate; return okSummary(); }) });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
    svc.observe('s1', 'working'); // ignored while finishing
    svc.forget('s1'); // ignored while finishing
    release();
    expect(await p).toMatchObject({ summarized: 1 });
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
  });

  it('forget mid-run resolves the session as gone and releases the timers', async () => {
    const { svc, add } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    svc.forget('s1');
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
    expect(svc.isWrappingUp('s1')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    svc.forget('s1'); // unknown id is a no-op
    svc.observe('s1', 'idle');
  });

  it('resolves as gone when the session disappears mid-run', async () => {
    const { svc, add, set, sessions } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    sessions.delete('s1');
    set('s1', 'working');
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
  });

  it('resolves as gone when the session disappears before a working agent rests, or before the settle ends', async () => {
    const a = make();
    a.add('s1', 'working');
    const pa = a.svc.run('p', ['s1']);
    a.sessions.delete('s1');
    a.set('s1', 'idle');
    expect(await pa).toMatchObject({ summarized: 0 });
    const b = make();
    b.add('s1');
    const pb = b.svc.run('p', ['s1']);
    b.set('s1', 'working');
    b.set('s1', 'idle');
    b.sessions.delete('s1');
    await settle();
    expect(await pb).toMatchObject({ summarized: 0 });
    expect(b.deps.summarizeForClose).not.toHaveBeenCalled();
  });

  it('does not type a second time for a repeat run, and awaits the same outcome counted once', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const first = svc.run('p', ['s1']);
    const second = svc.run('p', ['s1']);
    expect(deps.reply).toHaveBeenCalledTimes(1);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(await first).toMatchObject({ summarized: 1 });
    expect(await second).toEqual({ summarized: 0, followedUp: 0, keptOpen: [] });
  });

  it('reports the kept-open reason to a repeat run too', async () => {
    const { svc, add } = make();
    add('s1', 'idle', { draftPending: false });
    const first = svc.run('p', ['s1']);
    const second = svc.run('p', ['s1']);
    await vi.advanceTimersByTimeAsync(TURN_TIMEOUT_MS);
    expect(await first).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'timeout' }] });
    expect(await second).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'timeout' }] });
  });
});

describe('WrapUpCloseService races (Geoff review on #545)', () => {
  const deferredRecord = () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const recordClose = vi.fn(async () => { await gate; return { summarized: 1 as const, followedUp: 0 as const }; });
    return { recordClose, release };
  };

  it('keeps the agent open as typed when a key moves while the close record is written', async () => {
    const { recordClose, release } = deferredRecord();
    const { svc, add, set, sessions } = make({ recordClose });
    add('s1', 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    expect(recordClose).toHaveBeenCalledTimes(1);
    sessions.get('s1')!.lastKeyInputAt = 2;
    release();
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
  });

  it('keeps the agent open as typed when it starts working again while the close record is written', async () => {
    const { recordClose, release } = deferredRecord();
    const { svc, add, set, states } = make({ recordClose });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    states.set('s1', 'working');
    release();
    expect(await p).toMatchObject({ keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
  });

  it('keeps a no-wrap-up agent open as typed when a key moves or it works while its record is written', async () => {
    for (const change of ['key', 'working'] as const) {
      const { recordClose, release } = deferredRecord();
      const { svc, add, sessions, states } = make({ recordClose });
      add('s1', 'idle', { profile: 'codex', lastKeyInputAt: 1 });
      const p = svc.run('p', ['s1']);
      await vi.advanceTimersByTimeAsync(0);
      expect(recordClose).toHaveBeenCalledTimes(1);
      if (change === 'key') sessions.get('s1')!.lastKeyInputAt = 2;
      else states.set('s1', 'working');
      release();
      expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'typed' }] });
    }
  });

  it('still closes when nothing changed during the record write', async () => {
    const { recordClose, release } = deferredRecord();
    const { svc, add, set } = make({ recordClose });
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'working');
    set('s1', 'idle');
    await settle();
    release();
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
  });

  it('finishes a fast turn the debounced status never showed as working, through the turn hooks', async () => {
    const { svc, deps, add } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    expect(deps.reply).toHaveBeenCalledTimes(1);
    svc.onTurnStarted('s1'); // UserPromptSubmit
    svc.onTurnFinished('s1'); // Stop, with the status still idle: no status event at all
    await settle();
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
    expect(deps.recordClose).toHaveBeenCalledWith('p', 's1', 'Agent', note(), 'wrapped');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('treats a prompt straight after the send as the turn having started', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    set('s1', 'blocked'); // "working" debounced away
    await settle();
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'asks-you' }] });
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'Agent', 'asks-you', note());
  });

  it('ignores a Stop that arrives before the wrap-up turn began, and turn hooks for unknown sessions', async () => {
    const { svc, deps, add } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    svc.onTurnFinished('s1'); // a late Stop from an earlier turn
    svc.onTurnStarted('nope');
    svc.onTurnFinished('nope');
    await settle();
    expect(deps.summarizeForClose).not.toHaveBeenCalled();
    expect(svc.isWrappingUp('s1')).toBe(true);
    svc.forget('s1');
    await p;
  });
});

describe('WrapUpCloseService second review on #545', () => {
  it(`types into at most ${MAX_ACTIVE_WRAP_UPS} agents at once, registering the rest at the click`, async () => {
    const { svc, deps, add, set } = make();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) add(id);
    const p = svc.run('p', ids);
    expect(deps.reply).toHaveBeenCalledTimes(MAX_ACTIVE_WRAP_UPS);
    for (const id of ids) expect(svc.isWrappingUp(id)).toBe(true); // auto-close and heartbeat already spare e and f
    set('a', 'working');
    set('a', 'idle');
    await settle();
    expect(deps.reply).toHaveBeenCalledTimes(MAX_ACTIVE_WRAP_UPS + 1); // a finished: e took its slot
    expect(deps.reply).toHaveBeenLastCalledWith('e', expect.any(String));
    for (const id of ['b', 'c', 'd', 'e']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    set('f', 'working');
    set('f', 'idle');
    await settle();
    expect(await p).toMatchObject({ summarized: 6, keptOpen: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a waiting agent open as typed, untouched, when the person types into it before its slot frees', async () => {
    const { svc, deps, add, set, sessions } = make();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) add(id, 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ids);
    sessions.get('e')!.lastKeyInputAt = 2; // typed into the waiting agent
    set('e', 'working');
    for (const id of ['a', 'b', 'c', 'd']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    const res = await p;
    expect(res.keptOpen).toEqual([{ sessionId: 'e', reason: 'typed' }]);
    expect(deps.reply).not.toHaveBeenCalledWith('e', expect.any(String));
  });

  it('also measures typing from the click for an agent whose slot frees later', async () => {
    const { svc, deps, add, set, sessions } = make();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) add(id, 'idle', { lastKeyInputAt: 1 });
    const p = svc.run('p', ids);
    sessions.get('e')!.lastKeyInputAt = 2; // no status event for e
    set('a', 'working');
    set('a', 'idle');
    await settle(); // a frees its slot; e is checked against the click, not the slot time
    expect(deps.reply).not.toHaveBeenCalledWith('e', expect.any(String));
    for (const id of ['b', 'c', 'd']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    expect((await p).keptOpen).toEqual([{ sessionId: 'e', reason: 'typed' }]);
  });

  it('releases a waiting agent that exits or goes away', async () => {
    const { svc, deps, add, set } = make();
    const ids = ['a', 'b', 'c', 'd', 'e'];
    for (const id of ids) add(id);
    const p = svc.run('p', ids);
    svc.forget('e');
    expect(svc.isWrappingUp('e')).toBe(false);
    for (const id of ['a', 'b', 'c', 'd']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    await p;
    expect(deps.reply).toHaveBeenCalledTimes(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('starts a waiting agent that went away before its slot freed as gone, and one that turned blocked on the blocked path', async () => {
    const { svc, deps, add, set, sessions, states } = make();
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    for (const id of ids) add(id);
    const p = svc.run('p', ids);
    sessions.delete('e');
    states.set('f', 'blocked');
    for (const id of ['a', 'b', 'c', 'd']) { set(id, 'working'); set(id, 'idle'); }
    await settle();
    await p;
    expect(deps.reply).toHaveBeenCalledTimes(4);
    expect(deps.recordClose).toHaveBeenCalledWith('p', 'f', 'Agent', note(), 'waiting-on-prompt');
  });

  it('still closes a forced no-wrap-up agent that was already working at the click', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const recordClose = vi.fn(async () => { await gate; return { summarized: 1 as const, followedUp: 0 as const }; });
    const { svc, add } = make({ recordClose });
    add('s1', 'working', { profile: 'codex' });
    const p = svc.run('p', ['s1']);
    await vi.advanceTimersByTimeAsync(0);
    release();
    expect(await p).toEqual({ summarized: 1, followedUp: 0, keptOpen: [] });
  });

  it('keeps the agent open with a turn-error note when an API error ends the wrap-up turn', async () => {
    const { svc, deps, add, set } = make();
    add('s1');
    const p = svc.run('p', ['s1']);
    svc.onTurnFailed('s1'); // sent, before any working
    expect(await p).toEqual({ summarized: 0, followedUp: 0, keptOpen: [{ sessionId: 's1', reason: 'turn-error' }] });
    expect(deps.recordKeptOpen).toHaveBeenCalledWith('p', 's1', 'T-s1', 'turn-error');
    const second = make();
    second.add('s2');
    const q = second.svc.run('p', ['s2']);
    second.set('s2', 'working');
    second.svc.onTurnFailed('s2'); // active
    expect((await q).keptOpen).toEqual([{ sessionId: 's2', reason: 'turn-error' }]);
    void set;
  });

  it('ignores an API-error stop for a session that is not mid wrap-up', async () => {
    const { svc, deps, add } = make();
    add('s1', 'working');
    const p = svc.run('p', ['s1']); // pre: never typed into
    svc.onTurnFailed('s1');
    svc.onTurnFailed('nope');
    expect(deps.recordKeptOpen).not.toHaveBeenCalled();
    svc.forget('s1');
    await p;
  });
});

describe('WrapUpCloseService summary concurrency', () => {
  it('runs at most 5 summary calls in flight across two concurrent runs of 4 agents each', async () => {
    let inFlight = 0;
    let peak = 0;
    const gates: Array<() => void> = [];
    const { svc, deps, add } = make({
      summarizeForClose: vi.fn(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise<void>((resolve) => gates.push(resolve));
        inFlight--;
        return okSummary();
      })
    });
    const ids = Array.from({ length: 8 }, (_, i) => `s${i}`);
    ids.forEach((id) => add(id, 'blocked'));
    const a = svc.run('p', ids.slice(0, 4));
    const b = svc.run('p', ids.slice(4));
    for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
    expect(deps.summarizeForClose).toHaveBeenCalledTimes(MAX_CONCURRENT_SUMMARIES);
    while (gates.length) {
      gates.shift()!();
      await vi.advanceTimersByTimeAsync(0);
    }
    for (let i = 0; i < 20 && gates.length; i++) { gates.shift()!(); await vi.advanceTimersByTimeAsync(0); }
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.summarized + rb.summarized).toBe(8);
    expect(peak).toBe(MAX_CONCURRENT_SUMMARIES);
    expect(vi.getTimerCount()).toBe(0);
  });
});
