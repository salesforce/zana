import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { DocActor } from '../shared/contract.js';
import { scanTags } from '../shared/html-scan.js';
import { PAGE_ORIGIN, scriptJson } from '../shared/page.js';
import {
  createKitReader,
  createPageRoutes,
  createRuntimeSource,
  docPageReader,
  FILE_CSP,
  NO_KIT,
  packFiles,
  PAGE_CSP,
  pluginHttpEndpoint,
  productServerUrl,
  rawFileType,
  renderPage,
  standalonePageHtml,
  standalonePageUrl
} from './pages.js';
import { DesignDocError, DesignDocStore } from './store.js';
import { createTestDatabase } from './test-db.js';

const user: DocActor = { kind: 'user', label: 'You', threadId: null };
const PNG = 'iVBORw0KGgo=';

const scratch = mkdtempSync(join(tmpdir(), 'dd-pages-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function kitDir(): string {
  const dir = mkdtempSync(join(scratch, 'kit-'));
  writeFileSync(join(dir, 'site.css'), 'body { color: teal }');
  writeFileSync(join(dir, 'logo.png'), Buffer.from(PNG, 'base64'));
  writeFileSync(join(scratch, 'secret.css'), 'secret');
  symlinkSync(join(scratch, 'secret.css'), join(dir, 'escape.css'));
  mkdirSync(join(dir, 'folder'));
  return dir;
}

function siteStore(files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>) {
  const store = new DesignDocStore(createTestDatabase());
  const doc = store.create({ title: 'Benchmark', files, entryPath: files[0]?.path }, user);
  return { store, doc };
}

const SITE = [
  {
    path: 'index.html',
    content:
      '<!doctype html><html><head><link rel="stylesheet" href="zcc-kit/site.css"><link rel="stylesheet" href="style.css"></head><body><img src="logo.png"><script src="app.js"></script><a href="runs/r1.md">r1</a></body></html>'
  },
  { path: 'style.css', content: 'h1 { margin: 0 }' },
  { path: 'app.js', content: 'fetch("data.json")' },
  { path: 'data.json', content: '{"runs":["</script>"]}' },
  { path: 'runs/r1.md', content: '# Run 1' },
  { path: 'logo.png', content: PNG, encoding: 'base64' as const },
  { path: 'big.png', content: PNG, encoding: 'base64' as const }
];

describe('createKitReader', () => {
  const kit = createKitReader(kitDir());

  it('reads text and binary kit files, cached', () => {
    expect(kit('site.css')).toEqual({ path: 'zcc-kit/site.css', kind: 'code', content: 'body { color: teal }', encoding: 'utf8', revision: 0 });
    expect(kit('logo.png')).toMatchObject({ kind: 'image', encoding: 'base64', content: PNG });
    expect(kit('site.css')).toBe(kit('site.css'));
  });

  it('refuses traversal, symlink escapes, folders and missing files', () => {
    expect(kit('../secret.css')).toBeNull();
    expect(kit('escape.css')).toBeNull();
    expect(kit('folder')).toBeNull();
    expect(kit('gone.css')).toBeNull();
  });

  it('has nothing to read when the kit folder is missing', () => {
    expect(createKitReader(join(scratch, 'no-kit'))('site.css')).toBeNull();
  });
});

describe('docPageReader', () => {
  it('prefers the doc file and falls back to the kit under zcc-kit/', () => {
    const { store, doc } = siteStore([...SITE, { path: 'zcc-kit/logo.png', content: PNG, encoding: 'base64' }]);
    const read = docPageReader(store, doc.id, createKitReader(kitDir()));
    expect(read('style.css')).toMatchObject({ path: 'style.css', revision: 1 });
    expect(read('zcc-kit/site.css')).toMatchObject({ revision: 0, content: 'body { color: teal }' });
    expect(read('zcc-kit/logo.png')).toMatchObject({ revision: 1 });
    expect(read('gone.css')).toBeNull();
    expect(read('../bad')).toBeNull();
  });

  it('lets unexpected store failures through', () => {
    const store = { readFile: () => { throw new Error('disk'); } } as unknown as DesignDocStore;
    expect(() => docPageReader(store, 'dd_x', NO_KIT)('a.css')).toThrow('disk');
  });
});

describe('renderPage', () => {
  it('bundles the entry page with its revision and dependencies', () => {
    const { store, doc } = siteStore(SITE);
    const page = renderPage(store, createKitReader(kitDir()), { doc: doc.slug });
    expect(page).toMatchObject({ docId: doc.id, path: 'index.html', revision: 1, missing: [], warnings: [], styled: true });
    expect(page.html).toContain('<style data-dd-href="zcc-kit/site.css">body { color: teal }</style>');
    expect(page.html).toContain(`<img src="data:image/png;base64,${PNG}">`);
    expect(page.deps.map((dep) => dep.path)).toEqual(['app.js', 'logo.png', 'style.css', 'zcc-kit/site.css']);
    expect(page.html).toContain(`<base href="${PAGE_ORIGIN}/">`);
  });

  it('renders an unsaved draft, also of a page that does not exist yet', () => {
    const { store, doc } = siteStore(SITE);
    expect(renderPage(store, NO_KIT, { doc: doc.id, path: 'index.html', draft: '<p>draft</p>' })).toMatchObject({ revision: 1, styled: false });
    const fresh = renderPage(store, NO_KIT, { doc: doc.id, path: 'new/page.html', draft: '<img src="../logo.png">' });
    expect(fresh.revision).toBeNull();
    expect(fresh.html).toBe(`<base href="${PAGE_ORIGIN}/new/"><img src="data:image/png;base64,${PNG}">`);
  });

  it('refuses non-pages, missing pages, bad paths and oversized drafts', () => {
    const { store, doc } = siteStore(SITE);
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (error) {
        return (error as DesignDocError).code;
      }
      return null;
    };
    expect(code(() => renderPage(store, NO_KIT, { doc: doc.id, path: 'style.css' }))).toBe('invalid');
    expect(code(() => renderPage(store, NO_KIT, { doc: doc.id, path: 'gone.html' }))).toBe('not_found');
    expect(code(() => renderPage(store, NO_KIT, { doc: doc.id, path: '../x.html' }))).toBe('invalid');
    expect(code(() => renderPage(store, NO_KIT, { doc: 'nope' }))).toBe('not_found');
    expect(code(() => renderPage(store, NO_KIT, { doc: doc.id, draft: 'x'.repeat(3 * 1024 * 1024) }))).toBe('limit');
  });

  it('does not render a kit file as a doc page', () => {
    const dir = kitDir();
    writeFileSync(join(dir, 'page.html'), '<p>kit</p>');
    const { store, doc } = siteStore(SITE);
    expect(() => renderPage(store, createKitReader(dir), { doc: doc.id, path: 'zcc-kit/page.html' })).toThrow(/not found/);
  });
});

describe('standalone pages', () => {
  it('packs the files the bundle did not inline, text first, within the budget', () => {
    const { store, doc } = siteStore(SITE);
    const page = renderPage(store, NO_KIT, { doc: doc.id });
    const files = store.readAllFiles(doc.id);
    expect(Object.keys(packFiles(files, page))).toEqual(['data.json', 'runs/r1.md', 'big.png']);
    expect(Object.keys(packFiles(files, page, 40))).toEqual(['data.json']);
  });

  it('embeds config, pack and runtime ahead of the page, unable to end their scripts', () => {
    const { store, doc } = siteStore(SITE);
    const html = standalonePageHtml(store, NO_KIT, { doc: doc.id }, { endpoint: '/api/v1/plugins/design-docs/http', runtime: 'if (a </script> b) {}' });
    const tags = [...scanTags(html)];
    expect(tags.slice(0, 6).map((tag) => tag.name)).toEqual(['html', 'head', 'script', 'script', 'script', 'base']);
    const block = (id: string) => {
      const tag = tags.find((entry) => entry.attributes.some((a) => a.name === 'id' && a.value === id))!;
      return JSON.parse(html.slice(tag.content!.start, tag.content!.end));
    };
    expect(block('dd-page')).toEqual({
      mode: 'standalone',
      docId: doc.id,
      path: 'index.html',
      endpoint: '/api/v1/plugins/design-docs/http',
      files: ['app.js', 'big.png', 'data.json', 'index.html', 'logo.png', 'style.css', 'runs/r1.md'],
      missing: ['zcc-kit/site.css'],
      warnings: []
    });
    expect(block('dd-files')['data.json']).toEqual({ kind: 'code', encoding: 'utf8', content: '{"runs":["</script>"]}' });
    expect(html).toContain('<script>if (a \\x3C/script> b) {}</script>');
    expect(scriptJson('</script><!--')).toBe('"\\u003c/script>\\u003c!--"');
  });

  it('builds URLs for the product server', () => {
    expect(pluginHttpEndpoint('design docs')).toBe('/api/v1/plugins/design%20docs/http');
    expect(standalonePageUrl('http://127.0.0.1:8780', '/api/v1/plugins/design-docs/http', 'dd_1', 'runs/a b.html')).toBe(
      'http://127.0.0.1:8780/api/v1/plugins/design-docs/http/page?doc=dd_1&path=runs%2Fa+b.html'
    );
  });
});

describe('page routes', () => {
  const setup = () => {
    const { store, doc } = siteStore(SITE);
    const routes = createPageRoutes({ store, kit: NO_KIT, endpoint: '/x', runtime: () => '/*runtime*/' });
    const get = (route: 'page' | 'file', query: Record<string, string>) => routes[route]({ method: 'GET', path: `/${route}`, query, body: undefined });
    return { doc, get };
  };

  it('serves a page sandboxed and uncached', () => {
    const { doc, get } = setup();
    const response = get('page', { doc: doc.id });
    expect(response.status).toBe(200);
    expect(response.body).toContain('/*runtime*/');
    expect(response.headers).toMatchObject({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': PAGE_CSP,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'cross-origin-resource-policy': 'same-origin'
    });
    expect(PAGE_CSP.startsWith('sandbox allow-scripts')).toBe(true);
    expect(PAGE_CSP).not.toContain('allow-same-origin');
  });

  it('serves raw files as inert text or as images, and pages through the page route', () => {
    const { doc, get } = setup();
    expect(get('file', { doc: doc.id, path: 'app.js' })).toMatchObject({
      status: 200,
      body: 'fetch("data.json")',
      headers: { 'content-type': 'text/plain; charset=utf-8', 'content-security-policy': FILE_CSP }
    });
    const image = get('file', { doc: doc.id, path: 'logo.png' });
    expect(image.headers!['content-type']).toBe('image/png');
    expect(Buffer.from(image.body as Uint8Array).toString('base64')).toBe(PNG);
    expect(get('file', { doc: doc.id, path: 'index.html' }).headers!['content-security-policy']).toBe(PAGE_CSP);
  });

  it('answers errors in plain text with the right status', () => {
    const { doc, get } = setup();
    expect(get('page', {})).toMatchObject({ status: 400, body: 'doc is required\n' });
    expect(get('page', { doc: 'nope' }).status).toBe(404);
    expect(get('file', { doc: doc.id, path: 'gone.txt' })).toMatchObject({ status: 404, body: expect.stringContaining('gone.txt not found') });
    expect(get('file', { doc: doc.id, path: '../x' }).status).toBe(400);
    expect(get('page', { doc: doc.id, path: 'style.css' }).headers!['content-security-policy']).toBe(FILE_CSP);
  });

  it('hides unexpected failures', () => {
    const store = { summary: () => { throw new Error('/secret/db failed'); } } as unknown as DesignDocStore;
    const routes = createPageRoutes({ store, kit: NO_KIT, endpoint: '/x', runtime: () => '' });
    expect(routes.page({ method: 'GET', path: '/page', query: { doc: 'a' }, body: undefined })).toMatchObject({
      status: 500,
      body: 'The page could not be rendered.\n'
    });
  });

  it('types raw files so none of them can run', () => {
    expect(rawFileType('a.png')).toBe('image/png');
    expect(rawFileType('a.ico')).toBe('image/x-icon');
    expect(rawFileType('a.woff2')).toBe('font/woff2');
    expect(rawFileType('a.svg')).toBe('image/svg+xml');
    expect(rawFileType('a.js')).toBe('text/plain; charset=utf-8');
    expect(rawFileType('a.html')).toBe('text/plain; charset=utf-8');
  });
});

describe('server wiring helpers', () => {
  it('finds the product server from the environment', () => {
    expect(productServerUrl({ ZCC_SERVER_URL: 'http://127.0.0.1:9000/ ' })).toBe('http://127.0.0.1:9000');
    expect(productServerUrl({ ZCC_SERVER_PORT: '8781' })).toBe('http://127.0.0.1:8781');
    expect(productServerUrl({ ZCC_SERVER_PORT: 'x' })).toBe('http://127.0.0.1:8780');
  });

  it('reads the runtime once and degrades to none', () => {
    const path = join(scratch, 'runtime.js');
    writeFileSync(path, 'run()');
    const source = createRuntimeSource(path);
    expect(source()).toBe('run()');
    rmSync(path);
    expect(source()).toBe('run()');
    const warn = vi.fn();
    const missing = createRuntimeSource(join(scratch, 'gone.js'), warn);
    expect(missing()).toBe('');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('page runtime unavailable'));
  });
});
