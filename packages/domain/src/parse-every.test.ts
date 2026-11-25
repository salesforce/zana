import { describe, expect, it } from 'vitest';
import { MAX_INTERVAL_MS, MIN_INTERVAL_MS, parseEvery } from './parse-every.js';

const UNIT_MS: Record<string, number> = { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };

/** The regex implementation that `parseEvery` replaced, kept as the oracle. */
function referenceParseEvery(every: string): number | null {
  const trimmed = (every ?? '').trim().toLowerCase();
  if (!trimmed) return null;
  const re = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(trimmed)) !== null) {
    const ms = UNIT_MS[match[2]];
    if (!ms) return null;
    total += parseFloat(match[1]) * ms;
    consumed += match[0].length;
  }
  if (total <= 0 || consumed !== trimmed.length) return null;
  const rounded = Math.round(total);
  if (rounded > MAX_INTERVAL_MS) return MAX_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, rounded);
}

function* strings(alphabet: string[], maxLength: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let length = 1; length <= maxLength; length += 1) {
    const next: string[] = [];
    for (const prefix of layer) for (const token of alphabet) next.push(prefix + token);
    yield* next;
    layer = next;
  }
}

describe('parseEvery', () => {
  it.each([
    ['5m', 300_000],
    ['1h30m', 5_400_000],
    ['300000ms', 300_000],
    ['1.5h', 5_400_000],
    ['  2D ', 172_800_000],
    ['30s', MIN_INTERVAL_MS],
    ['99d', MAX_INTERVAL_MS]
  ])('parses %j', (input, expected) => {
    expect(parseEvery(input)).toBe(expected);
  });

  it.each(['', '   ', 'abc', '5', 'm', '1.m', '1..5m', '5m3', '5 m', '5x', '0m', '0s0m', '-5m', '5m,'])(
    'rejects %j',
    (input) => {
      expect(parseEvery(input)).toBeNull();
    }
  );

  it('agrees with the regex implementation on every short string', () => {
    const mismatches: string[] = [];
    for (const input of strings(['0', '5', '.', 'ms', 's', 'm', 'h', 'd', ' ', 'x'], 5)) {
      if (parseEvery(input) !== referenceParseEvery(input)) mismatches.push(input);
    }
    expect(mismatches).toEqual([]);
  });

  it('rejects long inputs in linear time', () => {
    // "000…0" and "1m1m…1m": the old global regex restarted at every digit.
    const started = performance.now();
    expect(parseEvery('0'.repeat(200_000))).toBeNull();
    expect(parseEvery(`${'0'.repeat(200_000)}x`)).toBeNull();
    expect(parseEvery('1.'.repeat(100_000))).toBeNull();
    expect(parseEvery('1m'.repeat(50_000))).toBe(MAX_INTERVAL_MS);
    expect(performance.now() - started).toBeLessThan(500);
  });
});
