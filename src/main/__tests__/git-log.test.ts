import { describe, it, expect } from 'vitest';
import { parseGitLog } from '../git.js';

// The NUL-record / Unit-separated format `getRecentCommits` asks git for:
//   %H%x1f%h%x1f%an%x1f%at%x1f%s%x00
const US = '\x1f';
const NUL = '\0';

function record(hash: string, short: string, author: string, atSec: number, subject: string) {
  return [hash, short, author, String(atSec), subject].join(US) + NUL;
}

describe('parseGitLog', () => {
  it('parses NUL-record, Unit-separated commits into GitCommit[] with ms timestamps', () => {
    const out =
      record('abc123def', 'abc123d', 'Ada Lovelace', 1_700_000_000, 'feat: add feed') +
      record('999fedcba', '999fedc', 'Alan Turing', 1_700_000_060, 'fix: parser edge case');
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(2);
    expect(commits[0]).toEqual({
      hash: 'abc123def',
      shortHash: 'abc123d',
      author: 'Ada Lovelace',
      ts: 1_700_000_000 * 1000,
      subject: 'feat: add feed'
    });
    expect(commits[1]!.ts).toBe(1_700_000_060 * 1000);
  });

  it('is not corrupted by a subject containing newlines or the pipe/US chars in text', () => {
    // A subject with a newline stays intact because records are NUL-separated,
    // not newline-separated.
    const out = record('h1', 's1', 'Dev', 1_700_000_000, 'multi\nline subject');
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.subject).toBe('multi\nline subject');
  });

  it('skips malformed records (too few fields / non-numeric time) without throwing', () => {
    const out =
      'onlytwo' + US + 'fields' + NUL + // too few fields
      ['h', 's', 'a', 'not-a-number', 'subj'].join(US) + NUL + // bad time
      record('good', 'g', 'Dev', 1_700_000_000, 'ok');
    const commits = parseGitLog(out);
    expect(commits).toHaveLength(1);
    expect(commits[0]!.hash).toBe('good');
  });

  it('returns [] on empty output', () => {
    expect(parseGitLog('')).toEqual([]);
    expect(parseGitLog('   ')).toEqual([]);
  });
});
