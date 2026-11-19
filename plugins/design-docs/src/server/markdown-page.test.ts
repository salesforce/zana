import { describe, expect, it } from 'vitest';
import { checkMarkdownLimits, FALLBACK_CSS, markdownPageHtml, MAX_MARKDOWN_BYTES, renderMarkdownBody, slugify, type MarkdownRenderContext } from './markdown-page.js';
import type { PageSource } from './page-bundle.js';

const PNG = 'iVBORw0KGgo=';

function context(files: Record<string, PageSource> = {}, extra: Partial<MarkdownRenderContext> = {}): MarkdownRenderContext {
  return { docId: 'dd_1', path: 'docs/a.md', endpoint: '/ep', read: (path) => files[path] ?? null, ...extra };
}

const png: PageSource = { path: 'docs/p.png', kind: 'image', content: PNG, encoding: 'base64', revision: 1 };
const svg: PageSource = { path: 'docs/s.svg', kind: 'svg', content: '<svg/>', encoding: 'utf8', revision: 1 };
const text: PageSource = { path: 'docs/t.txt', kind: 'text', content: 'x', encoding: 'utf8', revision: 1 };

describe('renderMarkdownBody', () => {
  it('renders GFM', () => {
    const html = renderMarkdownBody('# Hi There\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n\n~~gone~~\n\n```\ncode\n```\n', context());
    expect(html).toContain('<h1 id="hi-there">');
    expect(html).toContain('<table>');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('<del>');
    expect(html).toContain('<pre><code>');
  });

  it('numbers duplicate heading ids', () => {
    const html = renderMarkdownBody('# A\n\n# A\n\n# !!!\n', context());
    expect(html).toContain('id="a"');
    expect(html).toContain('id="a-1"');
    expect(html).toContain('id="section"');
  });

  it('drops raw html and script', () => {
    const html = renderMarkdownBody('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n[x](javascript:alert(1))\n\n[y](data:text/html;base64,AA)', context());
    expect(html).not.toMatch(/<script|onerror|javascript:|data:text/i);
  });

  it('rewrites doc links to the plugin routes', () => {
    const html = renderMarkdownBody(
      '[o](other.md#Sec%20Tion) [h](../index.html) [f](f.txt) [a](#top) [w](https://x.test/p) [m](mailto:a@b.c) [d](doc://dd_2/x.md) [u](/abs.md) [e](../../../x.md) [s](//evil.test/x) [t](ftp://x)',
      context()
    );
    expect(html).toContain('href="/ep/page?doc=dd_1&#x26;path=docs%2Fother.md#Sec%20Tion"');
    expect(html).toContain('href="/ep/page?doc=dd_1&#x26;path=index.html"');
    expect(html).toContain('href="/ep/file?doc=dd_1&#x26;path=docs%2Ff.txt"');
    expect(html).toContain('href="#top"');
    expect(html).toContain('href="https://x.test/p"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).not.toContain('doc://');
    expect(html).not.toContain('ftp:');
    expect(html).not.toContain('//evil.test');
  });

  it('inlines relative images and keeps https and data images', () => {
    const html = renderMarkdownBody(
      `![p](p.png) ![s](s.svg) ![t](t.txt) ![m](missing.png) ![h](http://x.test/a.png) ![s2](https://x.test/a.png) ![d](data:image/png;base64,${PNG}) ![bad](data:image/svg+xml;base64,AA) ![u](//x.test/a.png)`,
      context({ 'docs/p.png': png, 'docs/s.svg': svg, 'docs/t.txt': text })
    );
    expect(html).toContain(`src="data:image/png;base64,${PNG}"`);
    expect(html).toContain('src="data:image/svg+xml;base64,');
    expect(html).toContain('src="https://x.test/a.png"');
    expect(html).not.toContain('http://x.test');
    expect(html).not.toContain('alt="u"');
    expect(html).toContain('m');
    expect(html).not.toContain('<img src="docs');
  });

  it('stops inlining past the asset budget', () => {
    const html = renderMarkdownBody('![a](p.png) ![b](p.png)', context({ 'docs/p.png': png }, { assetBudget: 40 }));
    expect(html.match(/<img/g)).toHaveLength(1);
  });

  it('keeps an image with no alt as empty text', () => {
    expect(renderMarkdownBody('![](missing.png)', context())).toBe('<p></p>');
  });
});

describe('limits', () => {
  it('rejects oversized input', () => {
    expect(() => checkMarkdownLimits('a'.repeat(MAX_MARKDOWN_BYTES + 1))).toThrow(/512 KB/);
  });

  it('rejects deep nesting', () => {
    expect(() => checkMarkdownLimits(`${'>'.repeat(150)} x`)).toThrow(/nested/);
    expect(() => checkMarkdownLimits(`${'> '.repeat(101)}x`)).toThrow(/nested/);
    expect(() => checkMarkdownLimits(`${' '.repeat(250)}- x`)).toThrow(/nested/);
    expect(() => checkMarkdownLimits(`${'['.repeat(120)}x`)).toThrow(/nested/);
    expect(() => checkMarkdownLimits('> a\n> > b\n- c')).not.toThrow();
  });

  it('throws before rendering', () => {
    expect(() => renderMarkdownBody('a'.repeat(MAX_MARKDOWN_BYTES + 1), context())).toThrow();
  });
});

describe('slugify', () => {
  it('lowers, strips punctuation and hyphenates', () => {
    expect(slugify('Hello, World! 2')).toBe('hello-world-2');
    expect(slugify('Ünï')).toBe('ünï');
    expect(slugify('***')).toBe('section');
  });
});

describe('markdownPageHtml', () => {
  it('is a script-free, base-free document', () => {
    const html = markdownPageHtml('# T\n\n<script>x</script>', context(), 'body{color:red}');
    expect(html).toMatch(/^<!doctype html>/);
    expect(html).not.toMatch(/<script|<base/i);
    expect(html).toContain('<title>docs/a.md</title>');
    expect(html).toContain('body{color:red}');
    expect(html).toContain('<main class="narrow">');
  });

  it('falls back to built-in css without the kit and cannot close the style tag', () => {
    expect(markdownPageHtml('x', context(), null)).toContain(FALLBACK_CSS);
    expect(markdownPageHtml('x', context(), 'a{}</style><script>1</script>')).not.toMatch(/<\/style><script/);
  });

  it('escapes the title', () => {
    expect(markdownPageHtml('x', context({}, { path: 'a"<b>&.md' }), null)).toContain('<title>a&quot;&lt;b&gt;&amp;.md</title>');
  });
});
