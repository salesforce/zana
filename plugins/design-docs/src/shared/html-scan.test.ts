import { describe, expect, it } from 'vitest';
import { attribute, decodeEntities, escapeAttribute, isScriptType, pageText, prependToHead, scanTags, startTag } from './html-scan.js';

const names = (html: string) => [...scanTags(html)].map((tag) => tag.name);

describe('scanTags', () => {
  it('reads names and attributes in every quoting style', () => {
    const [tag] = [...scanTags(`<IMG Src="a.png" alt='A &amp; B' width=10 hidden data-x = "y">`)];
    expect(tag!.name).toBe('img');
    expect(tag!.attributes).toEqual([
      { name: 'src', value: 'a.png' },
      { name: 'alt', value: 'A & B' },
      { name: 'width', value: '10' },
      { name: 'hidden', value: null },
      { name: 'data-x', value: 'y' }
    ]);
    expect(attribute(tag!, 'hidden')).toBeNull();
    expect(attribute(tag!, 'nope')).toBeUndefined();
  });

  it('skips comments, doctypes, end tags and stray angle brackets', () => {
    expect(names('<!doctype html><!-- <img src=x> --><p>a < b</p><?xml?><br/>')).toEqual(['p', 'br']);
    expect(names('<!-- unterminated <img>')).toEqual([]);
  });

  it('does not look for tags inside raw-text elements', () => {
    const tags = [...scanTags('<script>if (a<b) document.write("<img src=x>")</script><style>a{}</style><p>')];
    expect(tags.map((tag) => tag.name)).toEqual(['script', 'style', 'p']);
    const script = tags[0]!;
    expect(script.content).toBeDefined();
    expect('<script>if (a<b) document.write("<img src=x>")</script>'.slice(script.content!.start, script.content!.end)).toBe(
      'if (a<b) document.write("<img src=x>")'
    );
  });

  it('ends a raw-text element only at its own closing tag', () => {
    const html = '<script>"</scriptx>"</SCRIPT ><i>';
    const [script, italic] = [...scanTags(html)];
    expect(html.slice(script!.content!.start, script!.content!.end)).toBe('"</scriptx>"');
    expect(script!.content!.closeEnd).toBe(html.indexOf('<i>'));
    expect(italic!.name).toBe('i');
  });

  it('runs an unclosed raw-text element to the end, like the browser', () => {
    const html = '<style>a{}';
    const [style] = [...scanTags(html)];
    expect(style!.content).toEqual({ start: 7, end: html.length, closeEnd: html.length });
  });

  it('tells a self-closing tag from a value ending in a slash', () => {
    const [image, link] = [...scanTags('<image href="a.png"/><a href=/docs/>')];
    expect(image!.selfClosing).toBe(true);
    expect(link!.selfClosing).toBe(false);
    expect(attribute(link!, 'href')).toBe('/docs/');
  });

  it('stops at a tag that never closes', () => {
    expect(names('<p>ok</p><img src="a.png')).toEqual(['p']);
    expect(names('<img src=a.png')).toEqual([]);
  });
});

describe('entities and serialization', () => {
  it('decodes named and numeric references and leaves unknown ones', () => {
    expect(decodeEntities('a&amp;b &lt;&gt;&quot;&apos;&#39;&#x41;&#66;&copy;&mdash;&zwnj;&#0;')).toBe(`a&b <>"''AB©—&zwnj;&#0;`);
    expect(decodeEntities('plain')).toBe('plain');
  });

  it('escapes attribute values and keeps bare attributes bare', () => {
    expect(escapeAttribute('a&"<')).toBe('a&amp;&quot;&lt;');
    expect(startTag('script', [{ name: 'type', value: 'a"b' }, { name: 'defer', value: null }])).toBe('<script type="a&quot;b" defer>');
    expect(startTag('image', [{ name: 'href', value: 'x' }], true)).toBe('<image href="x" />');
  });
});

describe('prependToHead', () => {
  it('goes right after <head>', () => {
    expect(prependToHead('<!doctype html><html><head><title>t</title>', '<base>')).toBe('<!doctype html><html><head><base><title>t</title>');
  });

  it('does not mistake <header> for <head>', () => {
    expect(prependToHead('<html><body><header>x</header>', '<base>')).toBe('<html><base><body><header>x</header>');
  });

  it('falls back to after the doctype, then the very start', () => {
    expect(prependToHead('<!DOCTYPE html>\n<p>x', '<base>')).toBe('<!DOCTYPE html><base>\n<p>x');
    expect(prependToHead('<div>x</div>', '<base>')).toBe('<base><div>x</div>');
  });
});

describe('pageText', () => {
  it('reads the text a page shows, the way the panel searches it', () => {
    const html = [
      '<!doctype html><html><head><title>T</title><style>p { color: red }</style></head>',
      '<body><!-- note --><h1>Pass <em>rate</em></h1>',
      '<p>A &amp; B&nbsp;&mdash; C</p>',
      '<textarea>typed &lt;here&gt;</textarea><xmp>raw</xmp>',
      '<noscript>fallback</noscript><template>later <template>nested</template><script>x()</script></template><p>!</p>',
      '<script type="application/json">{"hidden": true}</script>',
      '</body></html>'
    ].join('');
    const { text, scripted } = pageText(html);
    // <title> is raw text the page does not show in its body; the panel searches the body.
    expect(text).toBe('Pass rateA & B\xa0— Ctyped <here>raw!');
    expect(scripted).toBe(false);
  });

  it('notices scripts that may change what the page shows', () => {
    expect(pageText('<p>x</p><script>go()</script>').scripted).toBe(true);
    expect(pageText('<script type="module" src="app.js"></script>').scripted).toBe(true);
    expect(pageText('<script type="text/plain">x</script>').scripted).toBe(false);
    // An unclosed comment hides the rest, as in a browser.
    expect(pageText('<p>a</p><!-- open b').text).toBe('a');
    expect(pageText('<p>a</p><template>never closed').text).toBe('a');
  });

  it('knows which script types run', () => {
    for (const type of [null, undefined, '', ' module ', 'TEXT/JAVASCRIPT', 'application/ecmascript']) expect(isScriptType(type)).toBe(true);
    for (const type of ['application/json', 'importmap', 'text/x-template']) expect(isScriptType(type)).toBe(false);
  });
});
