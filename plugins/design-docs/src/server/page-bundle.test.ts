import { describe, expect, it } from 'vitest';
import { scanTags } from '../shared/html-scan.js';
import { PAGE_ORIGIN } from '../shared/page.js';
import { fileKindOf, isBinaryKind } from '../shared/paths.js';
import { assetDataUrl, bundlePage, escapeScriptText, type BundleInput, type PageSource } from './page-bundle.js';

const PNG = 'iVBORw0KGgo=';
const FONT = 'd09GMgABAAA=';

function doc(files: Record<string, string>): Map<string, PageSource> {
  return new Map(
    Object.entries(files).map(([path, content], index) => {
      const kind = fileKindOf(path);
      return [path, { path, kind, content, encoding: isBinaryKind(kind) ? 'base64' : 'utf8', revision: index + 1 }];
    })
  );
}

function bundle(html: string, files: Record<string, string> = {}, extra: Partial<BundleInput> = {}) {
  const store = doc(files);
  const reads: string[] = [];
  const result = bundlePage({
    entryPath: 'index.html',
    html,
    read: (path) => {
      reads.push(path);
      return store.get(path) ?? null;
    },
    ...extra
  });
  return { ...result, reads };
}

const svgUrl = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

describe('bundlePage: stylesheets', () => {
  it('inlines a linked stylesheet with its url() assets resolved from the CSS file', () => {
    const result = bundle('<html><head><link rel="stylesheet" href="css/site.css" media="screen"></head><body></body></html>', {
      'css/site.css': `@font-face { font-family: Inter; src: url("../fonts/Inter.woff2") format("woff2"); }\nbody { background: url(bg.png) }`,
      'fonts/Inter.woff2': FONT,
      'css/bg.png': PNG
    });
    expect(result.html).toContain('<style data-dd-href="css/site.css" media="screen">');
    expect(result.html).toContain(`url("data:font/woff2;base64,${FONT}")`);
    expect(result.html).toContain(`url("data:image/png;base64,${PNG}")`);
    expect(result.html).not.toContain('<link');
    expect(result.styled).toBe(true);
    expect(result.deps.map((dep) => dep.path)).toEqual(['css/bg.png', 'css/site.css', 'fonts/Inter.woff2']);
  });

  it('inlines @import chains with their conditions and hoists external imports', () => {
    const result = bundle('<style>@import "base.css" screen; @import url(https://fonts.example/x.css); p { color: red }</style>', {
      'base.css': '@charset "utf-8"; @import url("theme/layer.css") layer(theme) supports(display: grid); h1 { margin: 0 }',
      'theme/layer.css': '.card { background: url("../bg.svg") }',
      'bg.svg': '<svg/>'
    });
    const css = result.html.slice(result.html.indexOf('<style>') + 7, result.html.indexOf('</style>'));
    expect(css.startsWith('@import url(https://fonts.example/x.css);')).toBe(true);
    expect(css).toContain('@media screen {');
    expect(css).toContain('@layer theme {\n@supports (display: grid) {');
    expect(css).toContain(`url("${svgUrl('<svg/>')}")`);
    expect(css).not.toContain('@charset');
    expect(css).toContain('p { color: red }');
    expect(result.warnings).toEqual(['External stylesheet https://fonts.example/x.css does not load in previews; add the file to the doc.']);
  });

  it('wraps anonymous layers and plain media lists', () => {
    const result = bundle('<style>@import "a.css" layer; @import "b.css" print and (min-width: 1px);</style>', {
      'a.css': '.a{}',
      'b.css': '.b{}'
    });
    expect(result.html).toContain('@layer {\n.a{}\n}');
    expect(result.html).toContain('@media print and (min-width: 1px) {\n.b{}\n}');
  });

  it('stops import cycles and reports them', () => {
    const result = bundle('<link rel=stylesheet href="a.css">', { 'a.css': '@import "b.css"; .a{}', 'b.css': '@import "a.css"; .b{}' });
    expect(result.html).toContain('.b{}');
    expect(result.warnings).toEqual(['b.css imports a.css in a cycle or too deeply; the import was skipped.']);
  });

  it('leaves comments, strings, fragments and data URLs alone', () => {
    const css = '/* url(a.png) */ .x::after { content: "url(b.png)" } .y { mask: url(#m) } .z { background: url(data:image/png;base64,AA) }';
    const result = bundle(`<style>${css}</style>`, { 'a.png': PNG, 'b.png': PNG });
    expect(result.html).toContain(css);
    expect(result.deps).toEqual([]);
  });

  it('points a missing or non-asset CSS reference at the page origin', () => {
    const result = bundle('<link rel="stylesheet" href="css/a.css">', { 'css/a.css': '.a { cursor: url(hand.cur) } .b { background: url("gone.png#x") }', 'css/hand.cur': 'x' });
    expect(result.html).toContain(`url("${PAGE_ORIGIN}/css/hand.cur")`);
    expect(result.html).toContain(`url("${PAGE_ORIGIN}/css/gone.png#x")`);
    expect(result.missing).toEqual(['css/gone.png']);
  });

  it('drops a missing stylesheet, keeps external and alternate ones', () => {
    const result = bundle(
      '<link rel="stylesheet" href="gone.css"><link rel="stylesheet" href="https://cdn.example/x.css"><link rel="alternate stylesheet" href="alt.css"><link rel="stylesheet">',
      { 'alt.css': '.alt{}' }
    );
    expect(result.html).toBe(
      `<base href="${PAGE_ORIGIN}/"><link rel="stylesheet" href="https://cdn.example/x.css"><link rel="alternate stylesheet" href="alt.css"><link rel="stylesheet">`
    );
    expect(result.missing).toEqual(['gone.css']);
    expect(result.warnings).toHaveLength(1);
  });

  it('escapes a stylesheet that would close its <style> block', () => {
    const result = bundle('<link rel="stylesheet" href="a.css">', { 'a.css': '.a::after { content: "</style><script>x</script>" }' });
    expect(result.html).toContain('content: "<\\/style><script>x</script>"');
    expect([...scanTags(result.html)].map((tag) => tag.name)).toEqual(['base', 'style']);
  });
});

describe('bundlePage: scripts', () => {
  it('turns inline and file scripts into inert blocks in document order', () => {
    const result = bundle(
      '<script>window.a = 1</script><script src="js/app.js" defer data-config="x"></script><script type="module" src="m.js" async></script><script type="module">import "./x.js"</script>',
      { 'js/app.js': 'if (html.includes("</script>")) {} <!-- legacy', 'm.js': 'export {}' }
    );
    expect(result.html).toBe(
      `<base href="${PAGE_ORIGIN}/">` +
        '<script type="text/x-dd-script">window.a = 1</script>' +
        '<script type="text/x-dd-script" data-dd-defer data-dd-src="js/app.js" data-config="x">if (html.includes("\\x3C/script>")) {} \\x3C!-- legacy</script>' +
        '<script type="text/x-dd-script" data-dd-type="module" data-dd-async data-dd-src="m.js">export {}</script>' +
        '<script type="text/x-dd-script" data-dd-type="module">import "./x.js"</script>'
    );
    expect(result.warnings).toEqual(['index.html imports other modules; previews run each script on its own, so bundle modules into one file.']);
    expect(result.styled).toBe(false);
  });

  it('keeps data blocks and external scripts, drops nomodule fallbacks', () => {
    const html = '<script type="application/json" id="d">{"a":1}</script><script src="https://cdn.example/x.js"></script><script nomodule src="legacy.js"></script><script src></script>';
    const result = bundle(html, { 'legacy.js': 'x' });
    expect(result.html).toBe(
      `<base href="${PAGE_ORIGIN}/"><script type="application/json" id="d">{"a":1}</script><script src="https://cdn.example/x.js"></script><script src></script>`
    );
    expect(result.warnings).toEqual(['External script https://cdn.example/x.js is blocked in previews; add the file to the doc.']);
    expect(result.reads).toEqual([]);
  });

  it('marks a missing script so the runtime can skip it in place', () => {
    const result = bundle('<script src="gone.js"></script>');
    expect(result.html).toContain('<script type="text/x-dd-script" data-dd-src="gone.js" data-dd-missing></script>');
    expect(result.missing).toEqual(['gone.js']);
  });

  it('escapes script text only where the HTML parser would see markup', () => {
    expect(escapeScriptText('a </SCRIPT> <!-- b')).toBe('a \\x3C/SCRIPT> \\x3C!-- b');
    expect(escapeScriptText('1 < 2')).toBe('1 < 2');
  });
});

describe('bundlePage: images and other references', () => {
  it('inlines img, srcset, poster, SVG image and style url() references', () => {
    const result = bundle(
      '<img src="img/a.png" srcset="img/a.png 1x, img/b.png 2x"><video poster="img/a.png"></video><svg><image href="logo.svg"/></svg><div style="background: url(\'img/a.png\')"></div>',
      { 'img/a.png': PNG, 'img/b.png': PNG, 'logo.svg': '<svg></svg>' }
    );
    const png = `data:image/png;base64,${PNG}`;
    expect(result.html).toContain(`<img src="${png}" srcset="${png} 1x, ${png} 2x">`);
    expect(result.html).toContain(`<video poster="${png}">`);
    expect(result.html).toContain(`<image href="${svgUrl('<svg></svg>')}" />`);
    expect(result.html).toContain(`style="background: url(&quot;${png}&quot;)"`);
    expect(result.reads).toEqual(['img/a.png', 'img/b.png', 'logo.svg']);
  });

  it('parses srcset candidates with commas inside URLs and trailing commas', () => {
    const result = bundle('<img srcset="a.png, data:image/png;base64,AA 2x,b.png 100w">', { 'a.png': PNG });
    expect(result.html).toContain(`srcset="data:image/png;base64,${PNG}, data:image/png;base64,AA 2x, ${PAGE_ORIGIN}/b.png 100w"`);
    expect(result.missing).toEqual(['b.png']);
  });

  it('defers images past the budget to on-demand loading', () => {
    const result = bundle('<img src="a.png"><img src="b.png"><img src="a.png">', { 'a.png': PNG, 'b.png': PNG }, { assetBudget: 40 });
    expect(result.html).toBe(`<base href="${PAGE_ORIGIN}/"><img src="data:image/png;base64,${PNG}"><img src="${PAGE_ORIGIN}/b.png"><img src="data:image/png;base64,${PNG}">`);
    expect(result.warnings).toEqual(['Some images and fonts load on demand: the page inlines at most 0 MB of them.']);
  });

  it('inlines icons and drops doc-local preloads', () => {
    const result = bundle(
      '<link rel="icon" href="favicon.ico" sizes="any"><link rel="preload" href="data.json" as="fetch"><link rel="preconnect" href="https://cdn.example"><link rel="icon" href="gone.ico">',
      { 'favicon.ico': 'AAAB' }
    );
    expect(result.html).toBe(
      `<base href="${PAGE_ORIGIN}/"><link rel="icon" href="data:image/x-icon;base64,AAAB" sizes="any"><link rel="preconnect" href="https://cdn.example"><link rel="icon" href="gone.ico">`
    );
  });

  it('replaces the author base, resolving from the page folder', () => {
    const result = bundle('<head><base href="/elsewhere/"><img src="../logo.png"></head>', { 'logo.png': PNG }, { entryPath: 'runs/r1/index.html', html: '<head><base href="/elsewhere/"><img src="../logo.png"></head>' });
    expect(result.html).toBe(`<head><base href="${PAGE_ORIGIN}/runs/r1/"><img src="${PAGE_ORIGIN}/runs/logo.png"></head>`);
    expect(result.missing).toEqual(['runs/logo.png']);
  });

  it('hands a meta refresh to a doc page to the runtime', () => {
    const result = bundle('<meta http-equiv="refresh" content="0; url=docs/#intro"><meta http-equiv="Refresh" content="5;URL=\'https://example.com\'">');
    expect(result.html).toContain(`<meta name="dd-refresh" content="0;${PAGE_ORIGIN}/docs#intro">`);
    expect(result.html).toContain(`<meta http-equiv="Refresh" content="5;URL='https://example.com'">`);
  });

  it('warns about media, frames and leaves links and untouched tags byte-for-byte', () => {
    const html = '<video src="clip.mp4"></video><audio><source src="a.mp3?x"></audio><iframe src="other.html"></iframe><a href="other.html" class=x>Other</a><p data-x=1>t</p>';
    const result = bundle(html);
    expect(result.warnings).toEqual(['Audio and video do not play in previews.', 'Pages embedded with <iframe> do not render in previews; link to them instead.']);
    expect(result.html).toContain('<a href="other.html" class=x>Other</a><p data-x=1>t</p>');
  });

  it('survives a reader that throws and a self-reference to the entry', () => {
    const result = bundlePage({
      entryPath: 'index.html',
      html: '<img src="index.html"><img src="boom.png">',
      read: (path) => {
        if (path === 'boom.png') throw new Error('disk');
        return null;
      }
    });
    expect(result.missing).toEqual(['boom.png']);
  });

  it('caps warnings', () => {
    const html = Array.from({ length: 60 }, (_, index) => `<script src="https://cdn.example/${index}.js"></script>`).join('');
    expect(bundle(html).warnings).toHaveLength(40);
  });
});

describe('assetDataUrl', () => {
  it('covers images, SVG and fonts but not text or unknown images', () => {
    expect(assetDataUrl({ path: 'a.webp', kind: 'image', content: 'AA', encoding: 'base64' })).toBe('data:image/webp;base64,AA');
    expect(assetDataUrl({ path: 'a.otf', kind: 'font', content: 'AA', encoding: 'base64' })).toBe('data:font/otf;base64,AA');
    expect(assetDataUrl({ path: 'a.svg', kind: 'svg', content: 'é', encoding: 'utf8' })).toBe(`data:image/svg+xml;base64,${Buffer.from('é').toString('base64')}`);
    expect(assetDataUrl({ path: 'a.bmp', kind: 'image', content: 'AA', encoding: 'base64' })).toBeNull();
    expect(assetDataUrl({ path: 'a.png', kind: 'image', content: 'AA', encoding: 'utf8' })).toBeNull();
    expect(assetDataUrl({ path: 'a.css', kind: 'code', content: 'AA', encoding: 'utf8' })).toBeNull();
  });
});
