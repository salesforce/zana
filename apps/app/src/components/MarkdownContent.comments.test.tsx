import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MarkdownContent } from './MarkdownContent.js';

describe('MarkdownContent HTML comments', () => {
  it('hides a tool marker in a heading but keeps the heading text', () => {
    const html = renderToStaticMarkup(<MarkdownContent text={'### home: Build the home page <!-- executable-step -->'} />);
    expect(html).toContain('home: Build the home page');
    expect(html).not.toContain('executable-step');
  });

  it('keeps a comment shown inside a code block', () => {
    const html = renderToStaticMarkup(<MarkdownContent text={'```html\n<!-- keep me -->\n```'} />);
    expect(html).toContain('keep me');
  });
});
