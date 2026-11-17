import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);

function consumerRequire(packageJson: string) {
  return createRequire(realpathSync(resolve(packageJson)));
}

// Follow live consumer links: .pnpm can also contain obsolete, vulnerable copies.
const routerRequire = consumerRequire('apps/mobile/node_modules/expo-router/package.json');
const queryRequire = createRequire(routerRequire.resolve('query-string'));
const decoderPath = queryRequire.resolve('decode-uri-component');
const decode = queryRequire('decode-uri-component');
const markdownRequire = consumerRequire('plugins/tasks/node_modules/tiptap-markdown/package.json');

// Run attack-sized inputs out of process so a regression cannot hang the suite.
function boundedParse(modulePath: string, source: string) {
  return JSON.parse(execFileSync(process.execPath, ['-e', source, modulePath], {
    timeout: 6000,
    maxBuffer: 64 * 1024,
    encoding: 'utf8',
  }));
}

describe('dependency security compatibility', () => {
  it('keeps Monaco HTML sanitization and explicit forbidden tags effective', () => {
    const monaco = realpathSync(resolve('apps/app/node_modules/monaco-editor/package.json'));
    const purify = createRequire(monaco)('dompurify');
    const { JSDOM } = require('jsdom');
    const dom = new JSDOM('');
    try {
      const sanitizer = purify(dom.window);
      expect(sanitizer.sanitize('<img src=x onerror=alert(1)><script>alert(1)</script>')).toBe('<img src="x">');
      expect(sanitizer.sanitize('<custom-tag>safe</custom-tag>', { ADD_TAGS: () => true, FORBID_TAGS: ['custom-tag'] })).toBe('safe');
    } finally { dom.window.close(); }
  });

  it.each([
    ['', ''], ['hello+world%20%C3%A9', 'hello world é'],
    ['100%+done', '100% done'], ['%G1%4', '%G1%4'],
    ['%FE%FF', '\uFFFD\uFFFD'], ['%FF%FE%41', '\uFFFD\uFFFDA'],
    ['%FE%FF%41', '\uFFFD\uFFFDA'], ['%C2%41', '\uFFFDA'],
    ['%C2', '\uFFFD'], ['%c2', '%c2'],
    ['%80%C0%C1%F5%FF', '%80%C0%C1%F5%FF'],
    ['%E0%A4%A', '%E0%A4%A'], ['%E0%80%80', '%E0%80%80'],
    ['%ED%A0%80', '%ED%A0%80'], ['%F4%90%80%80', '%F4%90%80%80'],
    ['%F0%9F%92%A9%zz', '💩%zz'], ['%e2%82%ac%zz', '€%zz'],
    ['%C3%A9%C0%41', 'é%C0A'], ['%E2%82', '%E2%82'],
    ['%F0%9F%41', '%F0%9FA'],
    // A decoded percent escape must not be decoded again by a later run.
    ['%25C3%25A9x%C3%A9x%zz', '%C3%A9xéx%zz'],
  ])('preserves URI decoding for %j', (input, expected) => {
    expect(decode(input)).toBe(expected);
  });

  it('retains the CommonJS query-string API used by phone links', () => {
    expect(() => decode(12)).toThrow(TypeError);
    expect(routerRequire('query-string').parse('title=hello+world&text=%C3%A9&bad=%C0')).toEqual({
      title: 'hello world', text: 'é', bad: '%C0',
    });
  });

  it('bounds recursive and many-distinct-run URI attacks', () => {
    expect(boundedParse(decoderPath, `
      const decode = require(process.argv[1]);
      const repeated = '%C0'.repeat(10_000);
      const runs = Array.from({ length: 32_000 }, (_, i) =>
        '%' + (i >> 8).toString(16).padStart(2, '0') + '%' + (i & 255).toString(16).padStart(2, '0') + '☃');
      const decoded = decode(runs.join('') + '%zz');
      const mixed = decode('%FE%FF%F4%90%80%80%C2%41%E2%82%zz');
      let rejectsNonString = false;
      try { decode(12); } catch (error) { rejectsNonString = error instanceof TypeError; }
      console.log(JSON.stringify({ repeated: decode(repeated) === repeated,
        separators: decoded.split('☃').length - 1, tail: decoded.endsWith('%zz'), mixed, rejectsNonString }));
    `)).toEqual({ repeated: true, separators: 32_000, tail: true,
      mixed: '\uFFFD\uFFFD%F4%90%80%80\uFFFDA%E2%82%zz', rejectsNonString: true });
  });

  it('keeps task Markdown links and HTML opt-in behavior', () => {
    const MarkdownIt = markdownRequire('markdown-it');
    const md = new MarkdownIt();
    expect(md.render('[task][ref]\n\n[ref]: https://example.com "Task"')).toContain('<a href="https://example.com" title="Task">task</a>');
    expect(md.render('[bad](javascript:alert(1))')).not.toContain('<a ');
    expect(md.render('<b>task</b>')).toContain('&lt;b&gt;task&lt;/b&gt;');
    expect(new MarkdownIt({ html: true }).render('<b>task</b>')).toContain('<b>task</b>');
  });

  it('bounds unterminated multiline Markdown reference titles', () => {
    const result = boundedParse(markdownRequire.resolve('markdown-it'), `
      const MarkdownIt = require(process.argv[1]);
      const html = new MarkdownIt().render('[ref]: /url "' + 'x\\n'.repeat(200_000));
      console.log(JSON.stringify({ rendered: html.length > 0, linked: html.includes('<a ') }));
    `);
    expect(result).toEqual({ rendered: true, linked: false });
  });

  it('preserves harness TOML tables, quoted keys, errors and serialization', () => {
    const { parse, stringify } = require('smol-toml');
    const config = { model: 'example', mcp_servers: { 'my.server': { command: 'node', args: ['server.js'], enabled: true } } };
    expect(parse(stringify(config))).toEqual(config);
    expect(parse('[mcp_servers."my.server"]\ncommand = "node"\nargs = ["server.js"]')).toEqual({ mcp_servers: { 'my.server': { command: 'node', args: ['server.js'] } } });
    expect(() => parse('model = "unfinished')).toThrow(/string|quote/i);
    expect(() => parse('model = 1\nmodel = 2')).toThrow();
  });

  it('bounds large flat TOML configurations', () => {
    expect(boundedParse(require.resolve('smol-toml'), `
      const { parse } = require(process.argv[1]);
      const document = Array.from({ length: 256_000 }, (_, i) => 'k' + i + ' = 1').join('\\n');
      const result = parse(document);
      console.log(JSON.stringify({ keys: Object.keys(result).length, last: result.k255999 }));
    `)).toEqual({ keys: 256_000, last: 1 });
  });

  it('keeps Expo xcode UUID generation working with the patched uuid release', () => {
    const expoRequire = consumerRequire('apps/mobile/node_modules/expo/package.json');
    const configRequire = createRequire(expoRequire.resolve('@expo/config-plugins'));
    const project = configRequire('xcode').project('/tmp/test.pbxproj');
    project.hash = { project: { objects: {} } };
    expect(project.generateUuid()).toMatch(/^[A-F0-9]{24}$/);
  });
});
