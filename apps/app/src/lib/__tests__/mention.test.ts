import { describe, it, expect } from 'vitest';
import { detectMention, applyMention } from '../mention.js';

// Helper: put the caret with a `|` marker so cases read naturally.
function at(s: string) {
  const caret = s.indexOf('|');
  return { value: s.replace('|', ''), caret };
}

describe('detectMention', () => {
  it('detects a bare @ at the caret (empty query)', () => {
    const { value, caret } = at('do @|');
    expect(detectMention(value, caret)).toEqual({ query: '', start: 3 });
  });

  it('detects a partial token', () => {
    const { value, caret } = at('open @src/fo|');
    expect(detectMention(value, caret)).toEqual({ query: 'src/fo', start: 5 });
  });

  it('detects an @ at the very start of the value', () => {
    const { value, caret } = at('@main|');
    expect(detectMention(value, caret)).toEqual({ query: 'main', start: 0 });
  });

  it('does NOT trigger mid-word (email-like a@b)', () => {
    const { value, caret } = at('me@host|');
    expect(detectMention(value, caret)).toBeNull();
  });

  it('keeps spaces verbatim in a multiword mention query', () => {
    const { value, caret } = at('Ask @Hello world |');
    expect(detectMention(value, caret)).toEqual({ query: 'Hello world ', start: 4 });
  });

  it('still ends a mention query on a tab or newline', () => {
    const tab = at('Ask @prompt\t|');
    expect(detectMention(tab.value, tab.caret)).toBeNull();
    const nl = at('Ask @prompt\n|');
    expect(detectMention(nl.value, nl.caret)).toBeNull();
  });

  it('returns null when there is no @ left of the caret', () => {
    const { value, caret } = at('plain text|');
    expect(detectMention(value, caret)).toBeNull();
  });

  it('scopes to the token the caret is inside, not an earlier one', () => {
    const { value, caret } = at('@first done @seco|');
    expect(detectMention(value, caret)).toEqual({ query: 'seco', start: 12 });
  });

  it('treats a newline before @ as a valid word boundary', () => {
    const { value, caret } = at('line one\n@fo|');
    expect(detectMention(value, caret)).toEqual({ query: 'fo', start: 9 });
  });
});

describe('applyMention', () => {
  it('splices the chosen path with a trailing space and moves the caret past it', () => {
    const { value, caret } = at('open @fo|');
    const match = detectMention(value, caret)!;
    const out = applyMention(value, match, caret, 'src/foo.ts');
    expect(out.value).toBe('open @src/foo.ts ');
    expect(out.caret).toBe(out.value.length);
  });

  it('keeps trailing text and collapses the gap to a single space', () => {
    const { value, caret } = at('open @fo| and build');
    const match = detectMention(value, caret)!;
    const out = applyMention(value, match, caret, 'src/foo.ts');
    expect(out.value).toBe('open @src/foo.ts and build');
    // caret sits right after "@src/foo.ts "
    expect(out.value.slice(0, out.caret)).toBe('open @src/foo.ts ');
  });

  it('replaces the whole partial query, not just appends', () => {
    const { value, caret } = at('@wrongguess|');
    const match = detectMention(value, caret)!;
    const out = applyMention(value, match, caret, 'right.ts');
    expect(out.value).toBe('@right.ts ');
  });
});
