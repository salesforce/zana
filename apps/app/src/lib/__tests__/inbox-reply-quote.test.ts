import { describe, expect, it } from 'vitest';
import { formatReplyQuote } from '../inbox-reply-quote.js';

describe('formatReplyQuote', () => {
  it('quotes a single line and ends on a bullet', () => {
    expect(formatReplyQuote('', 'Should the skipped case block merge?')).toBe(
      '> Should the skipped case block merge?\n- ',
    );
  });

  it('returns the draft unchanged for empty or whitespace selections', () => {
    expect(formatReplyQuote('keep', '')).toBe('keep');
    expect(formatReplyQuote('keep  ', '  \n\t ')).toBe('keep  ');
  });

  it('prefixes a blank line inside the selection with a bare >', () => {
    expect(formatReplyQuote('', 'a\n\nb')).toBe('> a\n>\n> b\n- ');
  });

  it('normalises CRLF', () => {
    expect(formatReplyQuote('', 'a\r\nb\r\n')).toBe('> a\n> b\n- ');
  });

  it('caps long selections at the last whitespace with an ellipsis', () => {
    const out = formatReplyQuote('', `${'word '.repeat(600)}`);
    const quoted = out.slice(2, out.length - 3);
    expect(quoted.endsWith('word…')).toBe(true);
    expect(quoted.length).toBeLessThanOrEqual(2001);
  });

  it('hard-cuts a long selection with no whitespace', () => {
    const out = formatReplyQuote('', 'x'.repeat(3000));
    expect(out).toBe(`> ${'x'.repeat(2000)}…\n- `);
  });

  it('appends to an existing draft after one blank line', () => {
    expect(formatReplyQuote('first answer  \n ', 'q')).toBe('first answer\n\n> q\n- ');
  });
});
