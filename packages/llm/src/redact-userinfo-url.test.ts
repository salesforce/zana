import { describe, expect, it } from 'vitest';
import { redactUserinfoUrls } from './redact-userinfo-url.js';
import { redactTranscript } from './redact-transcript.js';

// The regex this scanner replaced; kept as the oracle.
const REFERENCE = /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@[^\s/]+/gi;

function* allStrings(alphabet: readonly string[], maxTokens: number): Generator<string> {
  let layer = [''];
  yield '';
  for (let n = 1; n <= maxTokens; n += 1) {
    const next: string[] = [];
    for (const prefix of layer) for (const token of alphabet) next.push(prefix + token);
    yield* next;
    layer = next;
  }
}

describe('redactUserinfoUrls', () => {
  it('redacts credential URLs and leaves the rest', () => {
    expect(redactUserinfoUrls('clone https://u:p@host.example/x now', 'R')).toBe('clone R/x now');
    expect(redactUserinfoUrls('no creds https://host/x', 'R')).toBe('no creds https://host/x');
    expect(redactUserinfoUrls('git+ssh://me:pw@h and ftp://a:b@c', 'R')).toBe('R and R');
    expect(redactUserinfoUrls('', 'R')).toBe('');
  });

  it('is wired into redactTranscript', () => {
    expect(redactTranscript('see https://bob:hunter2@example.com/repo')).toBe('see [redacted]/repo');
  });

  it('matches the regex it replaced on every short string', () => {
    const mismatches: string[] = [];
    for (const input of allStrings(['a', '1', '.', ':', '/', '@', ' '], 7)) {
      const expected = input.replace(REFERENCE, 'R');
      if (redactUserinfoUrls(input, 'R') !== expected) mismatches.push(input);
    }
    expect(mismatches).toEqual([]);
  });

  it('is linear on a long run of scheme characters with no separator', () => {
    // The old regex retried the scheme at every word boundary: quadratic here.
    const input = 'a.'.repeat(100_000);
    const start = performance.now();
    expect(redactUserinfoUrls(input, 'R')).toBe(input);
    expect(performance.now() - start).toBeLessThan(2_000);
  });
});
