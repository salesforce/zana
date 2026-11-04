import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ApiErrorResumeConfig, ApiErrorResumeRule } from '@zana-ai/zcc-domain/product';
import {
  ApiErrorResumeService,
  openRegexSession,
  type ApiErrorResumeDeps,
  type RegexMatchResult
} from './api-error-resume.js';

const rule = (o: Partial<ApiErrorResumeRule> = {}): ApiErrorResumeRule => ({
  id: 'r1', match: 'Provider anthropic not found', matchMode: 'contains',
  message: 'continue', delaySeconds: 20, enabled: true, ...o
});

function setup(over: { config?: Partial<ApiErrorResumeConfig>; regex?: RegexMatchResult[] } = {}) {
  const state = {
    config: { enabled: true, rules: [rule()], maxPerWindow: 3, windowMinutes: 15, ...over.config } as ApiErrorResumeConfig | undefined,
    session: { projectId: 'p', title: 'Agent', status: 'running', lastInputAt: 1 as number | undefined } as { projectId: string; title: string; status: string; lastInputAt?: number } | null,
    agent: 'idle',
    replyOk: true,
    regex: [...(over.regex ?? [])]
  };
  const matchRegex = vi.fn(async (_text: string, _pattern: string, _flags: string): Promise<RegexMatchResult> =>
    state.regex.shift() ?? 'no-match');
  const disposeRegex = vi.fn();
  const deps = {
    getConfig: () => state.config,
    getSession: () => state.session,
    getAgentState: () => state.agent,
    reply: vi.fn(() => state.replyOk),
    markNeedsYou: vi.fn(),
    pushInbox: vi.fn(),
    openRegex: vi.fn(() => ({ match: matchRegex, dispose: disposeRegex })),
    now: () => Date.now(),
    setTimer: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimer: (h: NodeJS.Timeout) => clearTimeout(h),
    log: vi.fn()
  } satisfies ApiErrorResumeDeps;
  return { state, deps, matchRegex, disposeRegex, svc: new ApiErrorResumeService(deps) };
}
const err = { error: 'Provider ANTHROPIC not found', text: '' };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-21T10:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

describe('matching', () => {
  it('contains ignores case and sends after the delay', async () => {
    const { svc, deps } = setup();
    await svc.onApiErrorStop('abcdef123456', err);
    expect(deps.reply).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20000);
    expect(deps.reply).toHaveBeenCalledWith('abcdef123456', 'continue');
    expect(deps.log).toHaveBeenCalledWith('[api-error-resume] session=abcdef12 rule=r1 attempt 1/3');
  });
  it('regex match / no-match', async () => {
    const r = rule({ matchMode: 'regex', match: 'foo.*bar' });
    const a = setup({ config: { rules: [r] }, regex: ['match'] });
    expect(await a.svc.findRule('x', [r], { retry: false })).toEqual({ rule: r, skipped: [] });
    expect(a.matchRegex).toHaveBeenCalledWith('x', 'foo.*bar', 'i');
    const b = setup({ regex: ['no-match'] });
    expect((await b.svc.findRule('x', [r], { retry: false })).rule).toBeUndefined();
    const cs = rule({ matchMode: 'regex', match: 'Foo.*', caseSensitive: true });
    await b.svc.findRule('x', [cs], { retry: false });
    expect(b.matchRegex).toHaveBeenLastCalledWith('x', 'Foo.*', '');
  });
  it('timeout skips the rule, tries the next, and notifies once per day', async () => {
    const slow = rule({ id: 'slow', matchMode: 'regex', match: '(a+)+$' });
    const ok = rule({ id: 'ok' });
    const { svc, deps } = setup({ config: { rules: [slow, ok] }, regex: ['timeout', 'timeout', 'timeout'] });
    await svc.onApiErrorStop('s1', err);
    await svc.onApiErrorStop('s1', err);
    expect(deps.pushInbox).toHaveBeenCalledTimes(2); // dedupeKey does the daily collapse
    const keys = deps.pushInbox.mock.calls.map(c => (c[0] as { dedupeKey: string }).dedupeKey);
    expect(new Set(keys)).toEqual(new Set(['api-error-resume:slow:slow:2026-10-21']));
    expect((deps.pushInbox.mock.calls[0][0] as { comments: string }).comments).toContain('took too long to check');
    vi.advanceTimersByTime(20000);
    expect(deps.reply).toHaveBeenCalledTimes(1);
  });
  it('invalid is skipped without notice', async () => {
    const bad = rule({ id: 'bad', matchMode: 'regex', match: '(' });
    const { svc, deps } = setup({ regex: ['invalid'] });
    expect(await svc.findRule('x', [bad], { retry: true })).toEqual({ skipped: [{ ruleId: 'bad', reason: 'invalid' }] });
    expect(deps.pushInbox).not.toHaveBeenCalled();
  });
  it('unavailable is retried 3 times, then skipped; with retry:false skipped at once', async () => {
    const r = rule({ id: 'x', matchMode: 'regex', match: 'abcd' });
    const a = setup({ regex: ['unavailable', 'unavailable', 'unavailable', 'unavailable'] });
    const p = a.svc.findRule('t', [r], { retry: true });
    await vi.advanceTimersByTimeAsync(3000);
    expect(await p).toEqual({ skipped: [{ ruleId: 'x', reason: 'unavailable' }] });
    expect(a.matchRegex).toHaveBeenCalledTimes(4);
    const b = setup({ regex: ['unavailable'] });
    expect(await b.svc.findRule('t', [r], { retry: false })).toEqual({ skipped: [{ ruleId: 'x', reason: 'unavailable' }] });
    expect(b.matchRegex).toHaveBeenCalledTimes(1);
    const c = setup({ regex: ['unavailable', 'match'] });
    const q = c.svc.findRule('t', [r], { retry: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await q).rule).toBe(r);
  });
  it('opens one regex session per check, reuses it for every rule and retry, and disposes it', async () => {
    const r1 = rule({ id: 'a', matchMode: 'regex', match: 'aaaa' });
    const r2 = rule({ id: 'b', matchMode: 'regex', match: 'bbbb' });
    const s = setup({ regex: ['no-match', 'unavailable', 'match'] });
    const p = s.svc.findRule('t', [r1, r2], { retry: true });
    await vi.advanceTimersByTimeAsync(1000);
    expect((await p).rule).toBe(r2);
    expect(s.deps.openRegex).toHaveBeenCalledTimes(1);
    expect(s.matchRegex).toHaveBeenCalledTimes(3);
    expect(s.disposeRegex).toHaveBeenCalledTimes(1);
    await s.svc.check('nothing', [rule()]);
    expect(s.disposeRegex).toHaveBeenCalledTimes(2);
  });
  it('the first matching rule wins and disabled rules are ignored', async () => {
    const a = rule({ id: 'a', match: 'not found', message: 'one' });
    const off = rule({ id: 'off', match: 'not found', enabled: false });
    const b = rule({ id: 'b', match: 'not found', message: 'two' });
    const { svc } = setup();
    expect((await svc.findRule('not found', [off, a, b], { retry: false })).rule).toBe(a);
    expect((await svc.findRule('not found', [off], { retry: false })).rule).toBeUndefined();
  });
});

describe('early exits', () => {
  it.each([
    ['no config', (s: ReturnType<typeof setup>) => { s.state.config = undefined; }],
    ['disabled', (s: ReturnType<typeof setup>) => { s.state.config!.enabled = false; }],
    ['no session', (s: ReturnType<typeof setup>) => { s.state.session = null; }],
    ['exited', (s: ReturnType<typeof setup>) => { s.state.session!.status = 'exited'; }]
  ])('%s sends nothing', async (_n, tweak) => {
    const s = setup();
    tweak(s);
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    expect(s.deps.log).toHaveBeenCalled();
  });
  it('no rule matched sends nothing', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', { error: 'other', text: '' });
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).not.toHaveBeenCalled();
  });
});

describe('fire-time guards', () => {
  it.each([
    ['the user typed', (s: ReturnType<typeof setup>) => { s.state.session!.lastInputAt = 99; }],
    ['working', (s: ReturnType<typeof setup>) => { s.state.agent = 'working'; }],
    ['blocked', (s: ReturnType<typeof setup>) => { s.state.agent = 'blocked'; }],
    ['exited', (s: ReturnType<typeof setup>) => { s.state.session!.status = 'exited'; }],
    ['session gone', (s: ReturnType<typeof setup>) => { s.state.session = null; }],
    ['rule removed', (s: ReturnType<typeof setup>) => { s.state.config!.rules = []; }],
    ['rule disabled', (s: ReturnType<typeof setup>) => { s.state.config!.rules[0].enabled = false; }],
    ['feature disabled', (s: ReturnType<typeof setup>) => { s.state.config!.enabled = false; }],
    ['config gone', (s: ReturnType<typeof setup>) => { s.state.config = undefined; }]
  ])('does not send when %s', async (_n, tweak) => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    tweak(s);
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).not.toHaveBeenCalled();
  });
  it.each(['done', 'waiting'])('sends when the agent is %s', async st => {
    const s = setup();
    s.state.agent = st;
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
  });
  it('a reply returning false records no send', async () => {
    const s = setup({ config: { maxPerWindow: 1 } });
    s.state.replyOk = false;
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    s.state.replyOk = true;
    await s.svc.onApiErrorStop('s1', err);
    expect(s.deps.markNeedsYou).not.toHaveBeenCalled();
  });
  it('cancel clears the pending timer; a new stop replaces the old one', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    s.svc.cancel('s1');
    s.svc.cancel('s1');
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    await s.svc.onApiErrorStop('s1', err);
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
  });
  it('forget clears timer and send history', async () => {
    const s = setup({ config: { maxPerWindow: 1 } });
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    s.svc.forget('s1');
    await s.svc.onApiErrorStop('s1', err);
    expect(s.deps.markNeedsYou).not.toHaveBeenCalled();
    s.svc.forget('s1');
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
  });
});

describe('cancel while matching, rested state, edited rules', () => {
  const slowRegex = () => {
    const slow = rule({ matchMode: 'regex', match: 'foo.*bar' });
    const s = setup({ config: { rules: [slow] } });
    const waiting: ((r: RegexMatchResult) => void)[] = [];
    s.matchRegex.mockImplementation(() => new Promise<RegexMatchResult>((r) => { waiting.push(r); }));
    return { s, release: (r: RegexMatchResult) => waiting.splice(0).forEach((w) => w(r)) };
  };
  it('a cancel during the match stops the stale error from arming', async () => {
    const { s, release } = slowRegex();
    const stopped = s.svc.onApiErrorStop('s1', err);
    s.svc.cancel('s1');
    release('match');
    await stopped;
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    expect(s.deps.log).toHaveBeenCalledWith(expect.stringContaining('a new turn started'));
  });
  it('a forget during the match stops it too, and a later stop still works', async () => {
    const { s, release } = slowRegex();
    const stopped = s.svc.onApiErrorStop('s1', err);
    s.svc.forget('s1');
    release('match');
    await stopped;
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    const again = s.svc.onApiErrorStop('s1', err);
    release('match');
    await again;
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
  });
  it('a newer stop supersedes an older one still matching', async () => {
    const { s, release } = slowRegex();
    const first = s.svc.onApiErrorStop('s1', err);
    const second = s.svc.onApiErrorStop('s1', err);
    release('match');
    await Promise.all([first, second]);
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
  });
  it('a newer stop that matches no rule disarms the earlier resume', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    await s.svc.onApiErrorStop('s1', { error: 'other', text: 'sign-in required' });
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).not.toHaveBeenCalled();
  });
  it('rests on an API error until the next turn, even with the feature off', async () => {
    const s = setup();
    s.state.config = undefined;
    expect(s.svc.restedOnApiError('s1')).toBe(false);
    await s.svc.onApiErrorStop('s1', err);
    expect(s.svc.restedOnApiError('s1')).toBe(true);
    s.svc.cancel('s1');
    expect(s.svc.restedOnApiError('s1')).toBe(false);
    await s.svc.onApiErrorStop('s1', err);
    s.svc.forget('s1');
    expect(s.svc.restedOnApiError('s1')).toBe(false);
  });
  it('stays rested while a resume is armed', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    expect(s.svc.restedOnApiError('s1')).toBe(true);
  });
  it('does not send when the rule was edited during the wait', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    s.state.config!.rules[0] = { ...s.state.config!.rules[0], match: 'something else entirely' };
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    expect(s.deps.log).toHaveBeenCalledWith(expect.stringContaining('rule edited'));
  });
  it('does not send when a regex rule turned case-sensitive during the wait', async () => {
    const r = rule({ matchMode: 'regex', match: 'provider .* not found' });
    const s = setup({ config: { rules: [r] }, regex: ['match'] });
    await s.svc.onApiErrorStop('s1', err);
    s.state.config!.rules[0] = { ...r, caseSensitive: true };
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).not.toHaveBeenCalled();
    expect(s.deps.log).toHaveBeenCalledWith(expect.stringContaining('rule edited'));
  });
  it('still sends when only the message changed during the wait', async () => {
    const s = setup();
    await s.svc.onApiErrorStop('s1', err);
    s.state.config!.rules[0] = { ...s.state.config!.rules[0], message: 'go on' };
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledWith('s1', 'go on');
  });
});

describe('cap', () => {
  it('trips on the 4th, notifies once per window, and recovers after the window', async () => {
    const s = setup();
    for (let i = 0; i < 3; i++) {
      await s.svc.onApiErrorStop('s1', err);
      vi.advanceTimersByTime(20000);
    }
    expect(s.deps.reply).toHaveBeenCalledTimes(3);
    await s.svc.onApiErrorStop('s1', err);
    expect(s.deps.markNeedsYou).toHaveBeenCalledWith('s1');
    expect(s.deps.pushInbox).toHaveBeenCalledTimes(1);
    const input = s.deps.pushInbox.mock.calls[0][0] as { comments: string; dedupeKey: string };
    expect(input.comments).toBe('Stopped resuming “Agent”: Zana already resumed it 3 times in the last 15 minutes. Type in the agent to carry on.');
    expect(input.dedupeKey).toMatch(/^api-error-resume:cap:s1:\d+$/);
    vi.advanceTimersByTime(60000);
    expect(s.deps.reply).toHaveBeenCalledTimes(3);
    vi.advanceTimersByTime(15 * 60000);
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(4);
  });
  it('counts resumes per agent, whichever rule fired, and says "time" for one', async () => {
    const other = rule({ id: 'r2', match: 'Connection lost mid-response', delaySeconds: 30 });
    const s = setup({ config: { maxPerWindow: 1, rules: [rule(), other] } });
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    await s.svc.onApiErrorStop('s1', { error: 'Connection lost mid-response', text: '' });
    const input = s.deps.pushInbox.mock.calls[0][0] as { comments: string };
    expect(input.comments).toBe('Stopped resuming “Agent”: Zana already resumed it 1 time in the last 15 minutes. Type in the agent to carry on.');
  });
  it('re-checks the cap when the timer fires, so a lowered cap applies to a pending resume', async () => {
    const s = setup({ config: { maxPerWindow: 2 } });
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    await s.svc.onApiErrorStop('s1', err); // 1 of 2 sent, so this one arms
    s.state.config!.maxPerWindow = 1;
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
    expect(s.deps.markNeedsYou).toHaveBeenCalledWith('s1');
    expect(s.deps.log).toHaveBeenCalledWith('[api-error-resume] session=s1 skip: cap reached');
  });
  it('re-checks the window too: a longer window keeps older sends in the count', async () => {
    const s = setup({ config: { maxPerWindow: 1, windowMinutes: 5 } });
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    vi.advanceTimersByTime(5 * 60000); // the first send falls out of the 5-minute window
    await s.svc.onApiErrorStop('s1', err);
    s.state.config!.windowMinutes = 60;
    vi.advanceTimersByTime(20000);
    expect(s.deps.reply).toHaveBeenCalledTimes(1);
    expect(s.deps.markNeedsYou).toHaveBeenCalledWith('s1');
  });
  it('survives a throwing pushInbox and logs why', async () => {
    const s = setup({ config: { maxPerWindow: 1 } });
    s.deps.pushInbox.mockImplementation(() => { throw new Error('x'); });
    await s.svc.onApiErrorStop('s1', err);
    vi.advanceTimersByTime(20000);
    await expect(s.svc.onApiErrorStop('s1', err)).resolves.toBeUndefined();
    expect(s.deps.markNeedsYou).toHaveBeenCalled();
    expect(s.deps.log).toHaveBeenCalledWith('[api-error-resume] pushInbox failed: x');
  });
  it('logs a non-Error throw from the slow-rule notice', async () => {
    const slow = rule({ id: 'slow', matchMode: 'regex', match: '(a+)+$' });
    const s = setup({ config: { rules: [slow] }, regex: ['timeout'] });
    s.deps.pushInbox.mockImplementation(() => { throw 'plain'; });
    await s.svc.onApiErrorStop('s1', err);
    expect(s.deps.log).toHaveBeenCalledWith('[api-error-resume] pushInbox failed: plain');
  });
});

describe('check', () => {
  it('reports the rule that would fire and nothing is sent', async () => {
    const s = setup();
    expect(await s.svc.check('provider anthropic NOT FOUND', [rule({ message: 'go', delaySeconds: 7 })]))
      .toEqual({ ruleId: 'r1', message: 'go', delaySeconds: 7, skipped: [] });
    expect(await s.svc.check('nothing', [rule()])).toEqual({ ruleId: null, skipped: [] });
    expect(s.deps.reply).not.toHaveBeenCalled();
  });
});

describe('openRegexSession', () => {
  const scanner = (scan: () => Promise<unknown[]>) => {
    const dispose = vi.fn();
    const make = vi.fn(() => ({ scan, dispose }));
    return { dispose, make, factory: make as never };
  };
  it('null scanner is unavailable, and a later match tries again', async () => {
    const make = vi.fn(() => null);
    const session = openRegexSession(make as never);
    expect(await session.match('a', 'a', 'i')).toBe('unavailable');
    expect(await session.match('a', 'a', 'i')).toBe('unavailable');
    expect(make).toHaveBeenCalledTimes(2);
    session.dispose();
  });
  it.each([
    ['hits', async () => [{ line: 1 }], 'match', 0],
    ['no hits', async () => [], 'no-match', 0],
    ['invalid', async () => { throw new Error('Invalid search expression'); }, 'invalid', 0],
    ['time limit', async () => { throw new Error('Search expression exceeded its time limit'); }, 'timeout', 1],
    ['other error', async () => { throw new Error('boom'); }, 'unavailable', 1],
    ['non-error throw', async () => { throw 'boom'; }, 'unavailable', 1]
  ])('%s', async (_n, scan, expected, disposedByFailure) => {
    const sc = scanner(scan as never);
    const session = openRegexSession(sc.factory);
    expect(await session.match('a', 'a', 'i')).toBe(expected);
    expect(sc.dispose).toHaveBeenCalledTimes(disposedByFailure);
    session.dispose(); // a failed worker is already gone, so it is not disposed twice
    expect(sc.dispose).toHaveBeenCalledTimes(1);
  });
  it('reuses one worker across patterns and starts a fresh one after a failure', async () => {
    const results: Array<() => Promise<unknown[]>> = [
      async () => [],
      async () => { throw new Error('Invalid search expression'); },
      async () => { throw new Error('Search expression exceeded its time limit'); },
      async () => [{ line: 1 }]
    ];
    const sc = scanner(() => results.shift()!());
    const session = openRegexSession(sc.factory);
    expect(await session.match('a', 'x', 'i')).toBe('no-match');
    expect(await session.match('a', '(', 'i')).toBe('invalid');
    expect(sc.make).toHaveBeenCalledTimes(1);
    expect(await session.match('a', '(a+)+$', '')).toBe('timeout');
    expect(await session.match('a', 'a', 'i')).toBe('match');
    expect(sc.make).toHaveBeenCalledTimes(2);
    session.dispose();
    session.dispose();
    expect(sc.dispose).toHaveBeenCalledTimes(2);
  });
  it('the real worker times out a catastrophic pattern, and the session still matches afterwards', async () => {
    vi.useRealTimers();
    const session = openRegexSession();
    const started = Date.now();
    expect(await session.match('a'.repeat(40) + '!', '(a+)+$', '')).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await session.match('Provider anthropic not found', 'provider .* not', 'i')).toBe('match');
    session.dispose();
  });
});
