import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  collectSamples, firstCallTokens, median, parseArgs, parsePositiveInt, run, parseTranscript, summarize, WORKER_PREFIX, type FirstCallSample
} from './measure-squad-first-call.js';

const user = (text: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({
  type: 'user', sessionId: 's1', version: '2.1.316', entrypoint: 'cli', timestamp: '2026-11-01T00:00:00Z',
  message: { role: 'user', content: text }, ...extra
});
const assistant = (usage: Record<string, number>) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', usage } });

describe('firstCallTokens', () => {
  it('sums the three counters and treats missing as zero', () => {
    expect(firstCallTokens({ input_tokens: 3, cache_creation_input_tokens: 10, cache_read_input_tokens: 100 })).toBe(113);
    expect(firstCallTokens({})).toBe(0);
  });
});

describe('median', () => {
  it('handles empty, odd, even, unsorted', () => {
    expect(median([])).toBeUndefined();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('parseTranscript', () => {
  it('extracts the first assistant usage for a standby worker (string content)', () => {
    const t = [user(`${WORKER_PREFIX} worker 1`), assistant({ input_tokens: 2, cache_creation_input_tokens: 30, cache_read_input_tokens: 8 }),
      assistant({ input_tokens: 999 })].join('\n');
    expect(parseTranscript(t)).toEqual({ sessionId: 's1', version: '2.1.316', entrypoint: 'cli', startedAt: '2026-11-01T00:00:00Z', tokens: 40 });
  });
  it('reads array text content and skips malformed and blank lines', () => {
    const t = ['', 'not json', '[]', user([{ type: 'image' }, { type: 'text', text: `${WORKER_PREFIX} x` }]), assistant({ input_tokens: 7 })].join('\n');
    expect(parseTranscript(t)?.tokens).toBe(7);
  });
  it('rejects non-worker sessions, non-text first messages, and sessions with no assistant usage', () => {
    expect(parseTranscript([user('Fix the bug'), assistant({ input_tokens: 1 })].join('\n'))).toBeUndefined();
    expect(parseTranscript([user(42), assistant({ input_tokens: 1 })].join('\n'))).toBeUndefined();
    expect(parseTranscript(user(`${WORKER_PREFIX} y`))).toBeUndefined();
    expect(parseTranscript(JSON.stringify({ type: 'summary' }) + '\n' + user(`${WORKER_PREFIX} z`))).toBeUndefined();
  });
  it('falls back to the file-derived session id', () => {
    const t = [JSON.stringify({ type: 'user', message: { content: `${WORKER_PREFIX} q` } }), assistant({ input_tokens: 1 })].join('\n');
    expect(parseTranscript(t, 'file-id')?.sessionId).toBe('file-id');
  });
});

const sample = (tokens: number, startedAt: string, over: Partial<FirstCallSample> = {}): FirstCallSample =>
  ({ sessionId: String(tokens) + startedAt, version: '2.1.316', entrypoint: 'cli', startedAt, tokens, ...over });
const baseline = [44000, 43000, 45000, 43800, 44500].map((n) => sample(n, '2026-11-01T00:00:00Z'));
const lean = (n: number[]) => n.map((t) => sample(t, '2026-11-07T00:00:00Z'));

describe('summarize', () => {
  const opts = { leanAfter: '2026-11-05T00:00:00Z', version: '2.1.316' };
  it('passes at >= 20% reduction', () => {
    const r = summarize([...baseline, ...lean([30000, 31000, 29000])], opts);
    expect(r).toMatchObject({ verdict: 'pass', baselineCount: 5, leanCount: 3, baselineMedian: 44000, leanMedian: 30000 });
    expect(r.reduction).toBeCloseTo(1 - 30000 / 44000);
  });
  it('fails below 20% and never lowers the bar', () => {
    expect(summarize([...baseline, ...lean([40000, 41000, 39000])], opts).verdict).toBe('fail');
  });
  it('reports insufficient sessions with counts', () => {
    const r = summarize([...baseline.slice(0, 4), ...lean([1, 2, 3])], opts);
    expect(r.verdict).toBe('insufficient-sessions');
    expect(r.reason).toContain('found 4 and 3');
    expect(summarize([...baseline, ...lean([1, 2])], opts).verdict).toBe('insufficient-sessions');
  });
  it('filters by version and entrypoint; ignores samples without a valid timestamp', () => {
    const noise = [sample(1, '2026-11-01T00:00:00Z', { version: '2.0.0' }), sample(1, '2026-11-01T00:00:00Z', { entrypoint: 'sdk-ts' }),
      sample(1, 'garbage'), { sessionId: 'x', version: '2.1.316', entrypoint: 'cli', tokens: 1 }];
    const r = summarize([...noise, ...baseline, ...lean([30000, 31000, 29000])], opts);
    expect(r.baselineCount).toBe(5);
    expect(summarize([...baseline.map((b) => ({ ...b, entrypoint: 'sdk-ts' })), ...lean([1, 2, 3]).map((b) => ({ ...b, entrypoint: 'sdk-ts' }))],
      { ...opts, entrypoint: 'sdk-ts' }).baselineCount).toBe(5);
  });
  it('honours custom minimums, an unpinned version, and a zero baseline', () => {
    expect(summarize([...baseline.slice(0, 1), ...lean([1])], { leanAfter: opts.leanAfter, minBaseline: 1, minLean: 1 }).verdict).toBe('pass');
    expect(summarize([sample(0, '2026-11-01T00:00:00Z'), sample(0, '2026-11-07T00:00:00Z')],
      { leanAfter: opts.leanAfter, minBaseline: 1, minLean: 1 })).toMatchObject({ reduction: 0, verdict: 'fail' });
  });
  it('passes at exactly 20% despite floating-point error', () => {
    const r = summarize([...baseline.map((b) => ({ ...b, tokens: 100 })), ...lean([80, 80, 80])], opts);
    expect(r).toMatchObject({ baselineMedian: 100, leanMedian: 80, verdict: 'pass' });
    expect(summarize([...baseline.map((b) => ({ ...b, tokens: 100 })), ...lean([81, 81, 81])], opts).verdict).toBe('fail');
  });
  it('throws on an invalid cutoff', () => {
    expect(() => summarize([], { leanAfter: 'nope' })).toThrow('invalid --lean-after');
  });
});

describe('parseArgs', () => {
  it('parses flag/value pairs and rejects malformed input', () => {
    expect(parseArgs(['--a', '1', '--b', 'x'])).toEqual({ a: '1', b: 'x' });
    expect(() => parseArgs(['a', '1'])).toThrow('bad argument');
    expect(() => parseArgs(['--a'])).toThrow('bad argument');
  });
});

describe('collectSamples', () => {
  const roots: string[] = [];
  afterEach(async () => { await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true }))); });
  it('walks project dirs read-only, honours the project filter, ignores non-worker and non-jsonl files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'squad-first-call-')); roots.push(root);
    await mkdir(join(root, '-proj-a')); await mkdir(join(root, '-other'));
    await writeFile(join(root, 'stray.txt'), 'x');
    const worker = [user(`${WORKER_PREFIX} w`), assistant({ input_tokens: 5 })].join('\n');
    await writeFile(join(root, '-proj-a', 'one.jsonl'), worker);
    await writeFile(join(root, '-proj-a', 'two.jsonl'), user('hello'));
    await writeFile(join(root, '-proj-a', 'note.md'), worker);
    await writeFile(join(root, '-other', 'three.jsonl'), worker);
    expect(await collectSamples(root)).toHaveLength(2);
    expect(await collectSamples(root, 'proj-a')).toEqual([expect.objectContaining({ tokens: 5 })]);
  });
});

describe('parseTranscript session id fallback', () => {
  it('derives the id from the file basename on posix and windows paths', async () => {
    const root = await mkdtemp(join(tmpdir(), 'squad-first-call-')); await mkdir(join(root, 'p'));
    try {
      await writeFile(join(root, 'p', 'abc-123.jsonl'),
        [JSON.stringify({ type: 'user', message: { content: `${WORKER_PREFIX} q` } }), assistant({ input_tokens: 1 })].join('\n'));
      expect((await collectSamples(root))[0]?.sessionId).toBe('abc-123');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});

describe('collectSamples failures', () => {
  it('rejects when the root is missing', async () => {
    await expect(collectSamples(join(tmpdir(), 'squad-first-call-missing-dir'))).rejects.toThrow();
  });
});

describe('parsePositiveInt', () => {
  it('accepts positive integers', () => {
    expect(parsePositiveInt('min-lean', '3')).toBe(3);
    expect(parsePositiveInt('min-lean', ' 12 ')).toBe(12);
  });
  it.each(['abc', '0', '-1', '1.5', '', '1e3', '99999999999999999999'])('rejects %j', (v) => {
    expect(() => parsePositiveInt('min-baseline', v)).toThrow('invalid --min-baseline');
  });
});

describe('run (CLI)', () => {
  const roots: string[] = [];
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });
  const mkRoot = async (tokens: { base: number[]; lean: number[] }) => {
    const root = await mkdtemp(join(tmpdir(), 'squad-first-call-')); roots.push(root);
    await mkdir(join(root, 'proj'));
    let i = 0;
    const put = (n: number, ts: string) => writeFile(join(root, 'proj', `s${i++}.jsonl`),
      [user(`${WORKER_PREFIX} w`, { timestamp: ts, sessionId: `s${i}` }), assistant({ input_tokens: n })].join('\n'));
    await Promise.all([...tokens.base.map((n) => put(n, '2026-11-01T00:00:00Z')), ...tokens.lean.map((n) => put(n, '2026-11-07T00:00:00Z'))]);
    return root;
  };
  const quiet = () => ({ log: vi.spyOn(console, 'log').mockImplementation(() => {}), err: vi.spyOn(console, 'error').mockImplementation(() => {}) });
  const base = ['--lean-after', '2026-11-05T00:00:00Z', '--version', '2.1.316'];

  it('exits 0 on pass, 1 on fail, 2 on insufficient sessions', async () => {
    const { log } = quiet();
    const pass = await mkRoot({ base: [100, 100, 100, 100, 100], lean: [80, 80, 80] });
    expect(await run([...base, '--root', pass, '--project-contains', 'proj'])).toBe(0);
    expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({ verdict: 'pass', workerSessionsScanned: 8 });
    const fail = await mkRoot({ base: [100, 100, 100, 100, 100], lean: [95, 95, 95] });
    expect(await run([...base, '--entrypoint', 'cli', '--root', fail])).toBe(1);
    expect(await run([...base, '--root', fail, '--min-baseline', '6'])).toBe(2);
    expect(await run([...base, '--root', fail, '--min-baseline', '5', '--min-lean', '3'])).toBe(1);
  });
  it('exits 2 with a usage error for invalid counts before reading any transcripts', async () => {
    const { err } = quiet();
    const missing = join(tmpdir(), 'squad-first-call-never-created');
    for (const flag of ['--min-baseline', '--min-lean']) {
      for (const v of ['abc', '0', '-1', '1.5', '']) {
        err.mockClear();
        expect(await run([...base, '--root', missing, flag, v])).toBe(2);
        expect(err.mock.calls[0]![0]).toContain(`invalid ${flag}`);
      }
    }
  });
  it('exits 2 for missing --lean-after, bad flags, invalid cutoff, and a missing root', async () => {
    const { err } = quiet();
    expect(await run([])).toBe(2);
    expect(err).toHaveBeenLastCalledWith('--lean-after <ISO timestamp> is required');
    expect(await run(['lean-after'])).toBe(2);
    expect(await run(['--lean-after', 'nope', '--root', await mkRoot({ base: [], lean: [] })])).toBe(2);
    expect(await run(['--lean-after', '2026-11-05T00:00:00Z', '--root', join(tmpdir(), 'squad-first-call-missing-dir')])).toBe(2);
  });
  it('stringifies non-Error throwables', async () => {
    const { err } = quiet();
    vi.spyOn(console, 'log').mockImplementation(() => { throw 'boom'; });
    const root = await mkRoot({ base: [100], lean: [80] });
    expect(await run([...base, '--root', root, '--min-baseline', '1', '--min-lean', '1'])).toBe(2);
    expect(err).toHaveBeenLastCalledWith('boom');
  });
});
