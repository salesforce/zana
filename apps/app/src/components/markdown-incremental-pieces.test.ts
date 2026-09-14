import { describe, expect, it } from 'vitest';
import {
  findMarkdownPieceCandidates,
  markdownHasGlobalConstructs
} from './markdown-block-scan.js';
import { resolveIncrementalMarkdownPieces } from './markdown-incremental-pieces.js';

describe('findMarkdownPieceCandidates', () => {
  it('marks block starts after blank lines', () => {
    const body = 'Para one.\n\nPara two.\n\nPara three\n';
    expect(findMarkdownPieceCandidates(body)).toEqual([
      body.indexOf('Para two.'),
      body.indexOf('Para three')
    ]);
  });

  it('does not split inside a fence or between list items', () => {
    const fenced = 'Intro.\n\n```js\nline one\n\nline two\n```\n\nAfter.\n';
    expect(findMarkdownPieceCandidates(fenced)).toEqual([
      fenced.indexOf('```js'),
      fenced.indexOf('After.')
    ]);
    const list = 'Intro.\n\n- one\n\n- two\n\nAfter list.\n';
    expect(findMarkdownPieceCandidates(list)).toEqual([
      list.indexOf('- one'),
      list.indexOf('After list.')
    ]);
  });
});

describe('resolveIncrementalMarkdownPieces', () => {
  it('parses the whole document once on a cold mount', () => {
    const body = 'Para one.\n\nPara two.\n\nPara three\n';
    expect(resolveIncrementalMarkdownPieces(body, [])).toEqual([body]);
  });

  it('reuses the settled prefix and only appends new pieces', () => {
    const first = 'Para one.\n\n';
    const second = 'Para one.\n\nPara two.\n\n';
    const third = 'Para one.\n\nPara two.\n\nPara three\n';
    const afterFirst = resolveIncrementalMarkdownPieces(first, []);
    expect(afterFirst).toEqual([first]);
    const afterSecond = resolveIncrementalMarkdownPieces(second, afterFirst);
    expect(afterSecond[0]).toBe(afterFirst[0]);
    expect(afterSecond).toEqual([first, 'Para two.\n\n']);
    const afterThird = resolveIncrementalMarkdownPieces(third, afterSecond);
    expect(afterThird[0]).toBe(afterSecond[0]);
    expect(afterThird[1]).toBe(afterSecond[1]);
    expect(afterThird.join('')).toBe(third);
  });

  it('falls back to a single document for footnotes and definitions', () => {
    const footnotes = 'See [^a].\n\nMore.\n\n[^a]: note\n';
    expect(markdownHasGlobalConstructs(footnotes)).toBe(true);
    expect(resolveIncrementalMarkdownPieces(footnotes, ['See [^a].\n\n'])).toEqual([
      footnotes
    ]);
  });
});
