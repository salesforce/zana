import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DocContent, MarkdownContent } from './MarkdownContent.js';

describe('MarkdownContent thread extras', () => {
  it('turns single newlines into breaks for user messages only', () => {
    const withBreaks = renderToStaticMarkup(<MarkdownContent text={'hello\nworld'} breaks />);
    const withoutBreaks = renderToStaticMarkup(<MarkdownContent text={'hello\nworld'} />);
    expect(withBreaks).toContain('<br');
    expect(withoutBreaks).not.toContain('<br');
  });

  it('renders assistant thread mentions as pills instead of external links', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent text="Ping @thread:thr_child" threadMentions />
    );
    expect(html).toContain('thread-mention-pill');
    expect(html).toContain('@thread:thr_child');
    expect(html).not.toContain('target="_blank"');
  });

  it('keeps local file markdown links in-app', () => {
    const html = renderToStaticMarkup(
      <MarkdownContent text="See [readme](file:///workspace/README.md)" threadId="t1" />
    );
    expect(html).toContain('file:///workspace/README.md');
    expect(html).not.toContain('target="_blank"');
  });

  it('renders mdx through the markdown pipeline', () => {
    const html = renderToStaticMarkup(
      <DocContent path="notes/intro.mdx" content="# Hello\n\n**there**" />
    );
    expect(html).toContain('inbox-md');
    expect(html).toContain('<h1');
    expect(html).toContain('<strong>');
    expect(html).not.toContain('**there**');
  });
});
