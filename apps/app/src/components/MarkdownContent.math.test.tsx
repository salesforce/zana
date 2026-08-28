import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent.js';

describe('MarkdownContent math', () => {
  it('renders KaTeX for display math', () => {
    const html = renderToStaticMarkup(<MarkdownContent text={'$$a^2 + b^2 = c^2$$'} />);
    expect(html).toMatch(/katex|math/i);
  });

  it('renders GFM tables and math without React key warnings', () => {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    };
    try {
      renderToStaticMarkup(
        <MarkdownContent
          text={[
            '| a | b |',
            '| --- | --- |',
            '| 1 | 2 |',
            '',
            'Inline $x^2$ and',
            '',
            '$$a^2 + b^2 = c^2$$'
          ].join('\n')}
        />
      );
    } finally {
      console.error = original;
    }
    expect(errors.filter((line) => line.includes('unique') && line.includes('key'))).toEqual([]);
  });
});
