import { describe, expect, it } from 'vitest';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { PluginOverviewMarkdown } from './PluginOverviewMarkdown.js';

describe('PluginOverviewMarkdown', () => {
  it('uppercases section headings and keeps https links', () => {
    const html = renderToStaticMarkup(
      h(PluginOverviewMarkdown, {
        markdown: '## What you get\n\n- [Docs](https://example.test/docs)\n- [Skip](http://insecure.test)\n'
      })
    );
    expect(html).toContain('data-plugin-overview=""');
    expect(html).toContain('ext-plugin-overview-heading');
    expect(html).toContain('What you get');
    expect(html).toContain('https://example.test/docs');
    expect(html).not.toContain('http://insecure.test');
  });
});
