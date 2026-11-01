import { describe, it, expect } from 'vitest';
import {
  cleanSessionTitle,
  firstLeftItem,
  parseSessionSummary,
  trimAtLineBoundary
} from './session-summary-text.js';

describe('parseSessionSummary', () => {
  it('removes both sentinels and reads yes', () => {
    const r = parseSessionSummary('**Goal** — x\n\nUnfinished: yes\nAsks the user: yes');
    expect(r).toEqual({ body: '**Goal** — x', unfinished: true, asksUser: true, sentinels: true });
  });

  it('reads no, in any case, with trailing spaces and extra blank lines', () => {
    const r = parseSessionSummary('**Goal** — x\n- did it\n\n\nUNFINISHED: No  \n\n\nasks THE user:   NO\t\n\n');
    expect(r).toEqual({ body: '**Goal** — x\n- did it', unfinished: false, asksUser: false, sentinels: true });
  });

  it('handles one sentinel only: Unfinished present, Asks the user missing', () => {
    const r = parseSessionSummary('body\nUnfinished: no');
    expect(r).toEqual({ body: 'body', unfinished: false, asksUser: false, sentinels: false });
  });

  it('handles one sentinel only: Asks the user present, Unfinished missing counts as unfinished', () => {
    const r = parseSessionSummary('body\nAsks the user: yes');
    expect(r).toEqual({ body: 'body', unfinished: true, asksUser: true, sentinels: false });
  });

  it('treats a reply with no sentinels as unfinished and not asking', () => {
    const r = parseSessionSummary('just a summary\n');
    expect(r).toEqual({ body: 'just a summary', unfinished: true, asksUser: false, sentinels: false });
  });

  it('only looks at the last six non-empty lines', () => {
    const lines = ['Unfinished: no', ...Array.from({ length: 6 }, (_, i) => `line ${i}`)].join('\n');
    const r = parseSessionSummary(lines);
    expect(r.body).toContain('Unfinished: no');
    expect(r.sentinels).toBe(false);
  });

  it('keeps the last sentinel when it is repeated', () => {
    const r = parseSessionSummary('body\nUnfinished: yes\nUnfinished: no\nAsks the user: no');
    expect(r).toMatchObject({ body: 'body', unfinished: false, sentinels: true });
  });

  it('returns an empty body for an empty reply', () => {
    expect(parseSessionSummary('')).toEqual({ body: '', unfinished: true, asksUser: false, sentinels: false });
  });
});

describe('trimAtLineBoundary', () => {
  it('returns text under and at the limit unchanged', () => {
    expect(trimAtLineBoundary('abc', 10)).toBe('abc');
    expect(trimAtLineBoundary('abcde', 5)).toBe('abcde');
  });

  it('cuts at the last newline within the limit', () => {
    expect(trimAtLineBoundary('one\ntwo\nthree', 9)).toBe('one\ntwo\n…');
  });

  it('cuts at the limit when there is no newline', () => {
    expect(trimAtLineBoundary('abcdefghij', 4)).toBe('abcd\n…');
  });

  it('cuts at the limit when the only newline is the first character', () => {
    expect(trimAtLineBoundary('\nabcdefgh', 4)).toBe('\nabc\n…');
  });

  it('defaults the limit to 2,400 characters', () => {
    expect(trimAtLineBoundary('x'.repeat(2_400))).toHaveLength(2_400);
    expect(trimAtLineBoundary('x'.repeat(2_401))).toBe(`${'x'.repeat(2_400)}\n…`);
  });
});

describe('cleanSessionTitle', () => {
  it('turns a resumed slash-command title into the command and its arguments', () => {
    expect(
      cleanSessionTitle(
        '<command-message>pfd-dq-validate</command-message> <command-name>/pfd-dq-validate</command-name> <command-args>Rules: x</command-args>'
      )
    ).toBe('/pfd-dq-validate Rules: x');
  });

  it('leaves a plain title alone', () => {
    expect(cleanSessionTitle('Fix the login bug')).toBe('Fix the login bug');
  });

  it('collapses runs of whitespace', () => {
    expect(cleanSessionTitle('  Fix \n\t the   bug ')).toBe('Fix the bug');
  });

  it('caps an over-long title at 80 characters with an ellipsis', () => {
    const out = cleanSessionTitle('w'.repeat(200));
    expect(out).toHaveLength(80);
    expect(out.endsWith('…')).toBe(true);
    expect(cleanSessionTitle('w'.repeat(80))).toBe('w'.repeat(80));
  });
});

describe('firstLeftItem', () => {
  it('reads a "-" bullet under a bold heading, without the bold', () => {
    const body = '**Goal** — x\n\n**Left / next**\n- **Review** the diff\n- second';
    expect(firstLeftItem(body)).toBe('Review the diff');
  });

  it('reads a "*" bullet', () => {
    expect(firstLeftItem('**Left / next**\n\n* wire the button\n* other')).toBe('wire the button');
  });

  it('returns null without a Left / next section', () => {
    expect(firstLeftItem('**Goal** — x\n- did it')).toBeNull();
  });

  it('returns null when the heading has no bullet before the next heading or text', () => {
    expect(firstLeftItem('**Left / next**\n**Other**\n- b')).toBeNull();
    expect(firstLeftItem('**Left / next**\n\n')).toBeNull();
    expect(firstLeftItem('**Left / next**\n- ')).toBeNull();
  });

  it('caps an over-long item at 90 characters with an ellipsis', () => {
    const out = firstLeftItem(`**Left / next**\n- ${'z'.repeat(200)}`)!;
    expect(out).toHaveLength(90);
    expect(out.endsWith('…')).toBe(true);
  });
});
