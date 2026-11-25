import { describe, expect, it } from 'vitest';
import { LINEAR_TIME_BUDGET_MS, allStrings } from '@zana-ai/zcc-domain/linear-time-testing';
import { redactPemBlocks, redactTranscript } from './redact-transcript.js';

// The regex this scanner replaced; kept as the oracle.
const REFERENCE = /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g;
const BEGIN = '-----BEGIN PRIVATE KEY-----';
const END = '-----END PRIVATE KEY-----';

describe('redactPemBlocks', () => {
  it('redacts a block, keeps surrounding text, and handles several blocks', () => {
    expect(redactPemBlocks(`a ${BEGIN}\nxx\n${END} b`, 'R')).toBe('a R b');
    expect(redactPemBlocks(`${BEGIN}x${END} mid ${BEGIN}y${END}`, 'R')).toBe('R mid R');
    expect(redactPemBlocks(`${BEGIN} never closed`, 'R')).toBe(`${BEGIN} never closed`);
    expect(redactPemBlocks('', 'R')).toBe('');
  });

  it('is wired into redactTranscript', () => {
    expect(redactTranscript(`key:\n-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----\ndone`)).toBe('key:\n[redacted]\ndone');
  });

  it('matches the regex it replaced on every short string', () => {
    const mismatches: string[] = [];
    const alphabet = ['-----BEGIN ', '-----END ', 'PRIVATE KEY-----', 'RSA ', 'x', ' ', '\n'];
    for (const input of allStrings(alphabet, 5)) {
      if (redactPemBlocks(input, 'R') !== input.replace(REFERENCE, 'R')) mismatches.push(input);
    }
    expect(mismatches.slice(0, 5)).toEqual([]);
  });

  it('is linear on 1MB of repeated unterminated BEGIN markers', () => {
    const input = BEGIN.repeat(Math.floor((1024 * 1024) / BEGIN.length));
    const started = performance.now();
    const out = redactTranscript(input);
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
    expect(out).toBe(input);
  });

  it('redacts 1MB of repeated BEGIN markers closed by a single END in one block', () => {
    const input = `head ${BEGIN.repeat(Math.floor((1024 * 1024) / BEGIN.length))}${END} tail`;
    const started = performance.now();
    const out = redactPemBlocks(input, 'R');
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
    expect(out).toBe('head R tail');
  });

  it('is linear when one END closes thousands of BEGINs', () => {
    const input = `${BEGIN}`.repeat(9000) + END + BEGIN.repeat(9000);
    const started = performance.now();
    expect(redactPemBlocks(input, 'R')).toBe(input.replace(REFERENCE, 'R'));
    expect(performance.now() - started).toBeLessThan(LINEAR_TIME_BUDGET_MS);
  });
});
