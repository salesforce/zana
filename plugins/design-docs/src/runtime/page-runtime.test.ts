import { Window } from 'happy-dom';
import { runInNewContext } from 'node:vm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FromPage, PageConfig, PageFile, ToPage } from '../shared/frame-protocol.js';
import { PAGE_ORIGIN } from '../shared/page.js';
import {
  decodeBase64,
  ensureCookies,
  ensureStorage,
  MemoryStorage,
  opensNewTab,
  readPack,
  readPageConfig,
  startPageRuntime,
  type PageRuntime,
  type PageWindow
} from './page-runtime.js';

const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const json = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');
const text = (content: string): PageFile => ({ kind: 'code', encoding: 'utf8', content });
const STANDALONE_URL = 'http://127.0.0.1:8780/api/v1/plugins/design-docs/http/page?doc=dd_1&path=index.html';

const windows: Window[] = [];
afterEach(async () => {
  for (const win of windows.splice(0)) await win.happyDOM.close();
  delete (globalThis as { CSS?: unknown }).CSS;
  delete (globalThis as { Highlight?: unknown }).Highlight;
  vi.restoreAllMocks();
});

function newWindow(url = 'about:srcdoc'): PageWindow {
  const happy = new Window({
    url,
    settings: {
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
      navigation: { disableMainFrameNavigation: true }
    }
  });
  windows.push(happy);
  return happy as unknown as PageWindow;
}

/** Put a parsed fixture page in place of the window's document element. */
function load(win: PageWindow, html: string): void {
  const parsed = new win.DOMParser().parseFromString(html, 'text/html');
  const root = win.document.importNode(parsed.documentElement, true);
  win.document.documentElement.remove();
  win.document.appendChild(root);
}

interface SetupOptions {
  config?: Partial<PageConfig>;
  pack?: Record<string, PageFile>;
  head?: string;
  /** Folder of the page, for its `<base>`. */
  dir?: string;
  framed?: boolean;
  before?(win: PageWindow): void;
}

interface Harness {
  win: PageWindow;
  doc: Document;
  runtime: PageRuntime;
  /** Messages the page sent the app. */
  sent: FromPage[];
  hello: ReturnType<typeof vi.fn>;
  /** Code of each script the runtime added, by URL index. */
  scripts: string[];
  go: ReturnType<typeof vi.fn>;
  deliver(message: ToPage): void;
  /** Run the scripts the runtime added since the last run, as the browser would. */
  run(from?: number): void;
  ofType<T extends FromPage['type']>(type: T): Array<Extract<FromPage, { type: T }>>;
}

function setup(body: string, options: SetupOptions = {}): Harness {
  const mode = options.config?.mode ?? 'frame';
  const win = newWindow(mode === 'frame' ? 'about:srcdoc' : STANDALONE_URL);
  const config: PageConfig = { mode, docId: 'dd_1', path: 'index.html', ...options.config };
  load(
    win,
    `<!doctype html><html><head><script type="application/json" id="dd-page">${json(config)}</script>` +
      (options.pack ? `<script type="application/json" id="dd-files">${json(options.pack)}</script>` : '') +
      `<base href="${PAGE_ORIGIN}/${options.dir ?? ''}">${options.head ?? ''}</head><body>${body}</body></html>`
  );
  const sent: FromPage[] = [];
  const hello = vi.fn();
  let port: { postMessage(message: FromPage): void; onmessage: ((event: { data: unknown }) => void) | null } | null = null;
  if (options.framed !== false && mode === 'frame') {
    Object.defineProperty(win, 'parent', { configurable: true, value: { postMessage: hello } });
    (win as unknown as { MessageChannel: unknown }).MessageChannel = class {
      port1 = (port = { postMessage: (message: FromPage) => sent.push(message), onmessage: null });
      port2 = { fake: 'port2' };
    };
  }
  options.before?.(win);
  const scripts: string[] = [];
  const go = vi.fn();
  const runtime = startPageRuntime(win, { scriptUrl: (code) => `test:${scripts.push(code) - 1}`, go });
  let ran = 0;
  return {
    win,
    doc: win.document,
    runtime,
    sent,
    hello,
    scripts,
    go,
    deliver: (message) => port?.onmessage?.({ data: message }),
    run(from = ran) {
      for (let index = from; index < scripts.length; index += 1) {
        ran = index + 1;
        runInNewContext(scripts[index]!, { window: win, document: win.document });
      }
    },
    ofType: (type) => sent.filter((message) => message.type === type) as never
  };
}

function added(doc: Document): HTMLScriptElement[] {
  return [...doc.querySelectorAll<HTMLScriptElement>('script[src^="test:"]')];
}

function click(target: Element, init: MouseEventInit & { type?: string } = {}): MouseEvent {
  const view = target.ownerDocument.defaultView as unknown as PageWindow;
  const event = new view.MouseEvent(init.type ?? 'click', { bubbles: true, cancelable: true, button: 0, ...init });
  target.dispatchEvent(event);
  return event;
}

type Bag = Record<string, unknown>;
const bag = (win: PageWindow) => win as unknown as Bag;

describe('page config and pack', () => {
  it('reads and removes the config and pack blocks', () => {
    const { doc, runtime } = setup('<p>hi</p>', {
      config: { mode: 'standalone', endpoint: '/x', files: ['a', 3 as never], quotes: ['q'], hash: 'h', scroll: { x: 1, y: 2 }, storage: { a: 'b', c: 1 as never } },
      pack: { 'a.json': text('{}'), bad: { content: 1 } as never }
    });
    expect(runtime.config).toEqual({
      mode: 'standalone',
      docId: 'dd_1',
      path: 'index.html',
      endpoint: '/x',
      files: ['a'],
      quotes: ['q'],
      hash: 'h',
      scroll: { x: 1, y: 2 },
      storage: { a: 'b' }
    });
    expect(doc.getElementById('dd-page')).toBeNull();
    expect(doc.getElementById('dd-files')).toBeNull();
  });

  it('falls back to an empty frame config and pack', () => {
    const win = newWindow();
    load(win, '<head><script type="application/json" id="dd-page">{nope</script><script type="application/json" id="dd-files">[1]</script></head>');
    expect(readPageConfig(win.document)).toEqual({ mode: 'frame', docId: '', path: '' });
    expect(readPack(win.document).size).toBe(0);
    expect(readPack(win.document).size).toBe(0);
  });

  it('decodes base64 and knows which targets open a tab', () => {
    expect([...decodeBase64('AAEC')]).toEqual([0, 1, 2]);
    expect(opensNewTab('_blank')).toBe(true);
    expect(opensNewTab('named')).toBe(true);
    expect(opensNewTab(' _SELF ')).toBe(false);
    expect(opensNewTab(null)).toBe(false);
  });
});

describe('scripts', () => {
  const PAGE =
    '<script type="text/x-dd-script" data-dd-async data-dd-src="late.js">a</script>' +
    '<script type="text/x-dd-script" data-dd-type="module">m</script>' +
    '<script type="text/x-dd-script" data-dd-defer data-dd-src="d.js">d</script>' +
    '<script type="text/x-dd-script" data-dd-src="lib.js" data-config="x" data-dd-other="y">c1</script>' +
    '<script type="text/x-dd-script" data-dd-missing data-dd-src="gone.js"></script>' +
    '<script type="text/x-dd-script">c2</script>';

  it('runs classic, then deferred and module, then the ready hook, then async scripts', () => {
    const { doc, scripts } = setup(PAGE, { config: { mode: 'standalone' } });
    expect(scripts.map((code) => code.split('\n')[0])).toEqual(['c1', 'c2', 'm', 'd', 'window.__ddPage.ready();', 'a']);
    expect(scripts[0]).toContain('//# sourceURL=dd:lib.js');
    expect(scripts[1]).toContain(`//# sourceURL=dd:${encodeURIComponent('index.html (inline script 2)')}`);
    const elements = added(doc);
    expect(elements.map((script) => [script.type, script.async])).toEqual([
      ['', false],
      ['', false],
      ['module', false],
      ['', false],
      ['', false],
      ['', true]
    ]);
    expect(elements[0]!.getAttribute('data-config')).toBe('x');
    expect(elements[0]!.hasAttribute('data-dd-other')).toBe(false);
  });

  it('replays DOMContentLoaded for listeners scripts add, also late ones', async () => {
    const { win, run } = setup(
      '<script type="text/x-dd-script">window.document.addEventListener("DOMContentLoaded", () => window.fired = (window.fired || 0) + 1)</script>',
      { config: { mode: 'standalone' } }
    );
    run();
    expect(bag(win).fired).toBe(1);
    win.addEventListener('DOMContentLoaded', function (this: unknown) {
      bag(win).late = this;
    });
    win.document.addEventListener('DOMContentLoaded', { handleEvent: () => (bag(win).object = true) });
    await wait();
    expect(bag(win).late).toBe(win);
    expect(bag(win).object).toBe(true);
    win.__ddPage.ready();
    expect(bag(win).fired).toBe(1);
  });

  it('keeps listeners of other events native and survives a throwing listener', () => {
    const { win, run } = setup(
      '<script type="text/x-dd-script">window.addEventListener("DOMContentLoaded", () => { throw new Error("x") }); window.addEventListener("ping", () => window.pinged = true)</script>',
      { config: { mode: 'standalone' } }
    );
    const error = vi.spyOn(win.console, 'error').mockImplementation(() => {});
    run();
    expect(error).toHaveBeenCalled();
    win.dispatchEvent(new win.Event('ping'));
    expect(bag(win).pinged).toBe(true);
  });

  it('defines its hooks once and reports script errors against their file', () => {
    const { win, doc, ofType } = setup('<script type="text/x-dd-script" data-dd-src="app.js">x</script>');
    expect(Object.getOwnPropertyDescriptor(win, '__ddPage')).toMatchObject({ configurable: false, writable: false, enumerable: false });
    const url = added(doc)[0]!.getAttribute('src')!;
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'boom', filename: url, lineno: 4 }));
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'boom', filename: url, lineno: 4 }));
    win.dispatchEvent(new win.ErrorEvent('error', { message: '', filename: 'dd:runs%2Fa.js' }));
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'elsewhere' }));
    win.dispatchEvent(new win.Event('error'));
    expect(ofType('problem').map((message) => message.problem)).toEqual([
      { kind: 'error', message: 'boom', source: 'app.js', line: 4 },
      { kind: 'error', message: 'Script error', source: 'runs/a.js' },
      { kind: 'error', message: 'elsewhere', source: 'index.html' }
    ]);
  });

  it('reports unhandled rejections and policy violations, except the ones it answers', () => {
    const { win, doc, ofType } = setup('');
    const reject = (reason: unknown) => {
      const event = new win.Event('unhandledrejection');
      Object.assign(event, { reason });
      win.dispatchEvent(event);
    };
    reject(new Error('nope'));
    const violation = (init: Record<string, unknown>) => {
      const event = new win.Event('securitypolicyviolation');
      Object.assign(event, { blockedURI: '', effectiveDirective: '', violatedDirective: '', sourceFile: '', lineNumber: 0, ...init });
      doc.dispatchEvent(event);
    };
    violation({ effectiveDirective: 'script-src-attr', blockedURI: 'inline' });
    violation({ blockedURI: `${PAGE_ORIGIN}/a.png`, effectiveDirective: 'img-src' });
    violation({ blockedURI: 'eval', effectiveDirective: 'script-src', lineNumber: 2, sourceFile: 'dd:app.js' });
    violation({ violatedDirective: 'style-src' });
    reject('plain');
    expect(ofType('problem').map((message) => message.problem)).toEqual([
      { kind: 'error', message: 'Unhandled promise rejection: nope', source: 'index.html' },
      { kind: 'blocked', message: "The preview's sandbox blocked eval (script-src)", source: 'app.js', line: 2 },
      { kind: 'blocked', message: "The preview's sandbox blocked inline code (style-src)", source: 'index.html' },
      { kind: 'error', message: 'Unhandled promise rejection: plain', source: 'index.html' }
    ]);
  });

  it('warns about problems on standalone pages, where nobody else hears them', () => {
    const warn = vi.fn();
    const { win, runtime } = setup('', {
      config: { mode: 'standalone', missing: ['a.css', 'b.js'] },
      before: (page) => vi.spyOn(page.console, 'warn').mockImplementation(warn)
    });
    win.dispatchEvent(new win.ErrorEvent('error', { message: 'console has it' }));
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[design doc] index.html: The page uses a.css, which is not a file in this doc',
      '[design doc] index.html: The page uses b.js, which is not a file in this doc'
    ]);
    expect(runtime.problems).toHaveLength(3);
  });

  it('stops collecting problems at the cap', () => {
    const { win, runtime } = setup('');
    for (let index = 0; index < 60; index += 1) win.dispatchEvent(new win.ErrorEvent('error', { message: `e${index}` }));
    expect(runtime.problems).toHaveLength(50);
  });
});

describe('frame', () => {
  it('hands the app a port, then reports ready and restores the view', () => {
    const { win, doc, hello, sent, run } = setup('<p>hi</p><script type="text/x-dd-script">x</script>', { config: { hash: 'top', scroll: { x: 0, y: 40 } } });
    expect(hello).toHaveBeenCalledWith({ dd: 'dd-page-hello' }, '*', [{ fake: 'port2' }]);
    expect(win.location.href).toBe('about:srcdoc#top');
    expect(doc.querySelector('style[data-dd-runtime]')!.textContent).toContain('::highlight(dd-comment)');
    const scrollTo = vi.spyOn(win, 'scrollTo').mockImplementation(() => {});
    run(1);
    expect(sent).toEqual([{ type: 'anchors', found: [], missing: [] }, { type: 'ready' }]);
    expect(scrollTo).toHaveBeenCalledWith(0, 40);
    win.dispatchEvent(new win.Event('load'));
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('opens at its fragment when there is no scroll to restore', () => {
    const { win, doc, run } = setup('<h2 id="Ünïcode">x</h2>', { config: { hash: 'Ünïcode' } });
    const into = vi.fn();
    (doc.getElementById('Ünïcode') as unknown as { scrollIntoView: () => void }).scrollIntoView = into;
    expect(win.location.hash).toBe(`#${encodeURI('Ünïcode')}`);
    run();
    expect(into).toHaveBeenCalled();
  });

  it('still runs without a parent to talk to', async () => {
    const { runtime, sent } = setup('<p>x</p>', { framed: false });
    expect(await runtime.load('a.json')).toBeNull();
    expect(sent).toEqual([]);
  });

  it('reports hash changes so a re-render reopens there', () => {
    const { win, ofType } = setup('');
    win.location.hash = 'run=a%2Fb';
    win.dispatchEvent(new win.Event('hashchange'));
    win.location.hash = '';
    win.dispatchEvent(new win.Event('popstate'));
    expect(ofType('hash')).toEqual([
      { type: 'hash', hash: 'run=a/b' },
      { type: 'hash', hash: null }
    ]);
  });

  it('reports scroll, throttled', async () => {
    const { win, ofType } = setup('');
    win.dispatchEvent(new win.Event('scroll'));
    win.dispatchEvent(new win.Event('scroll'));
    await wait(200);
    expect(ofType('scroll')).toEqual([{ type: 'scroll', x: 0, y: 0 }]);
  });
});

describe('doc files', () => {
  it('serves fetches from the pack on standalone pages', async () => {
    const warn = vi.fn();
    const { win, runtime } = setup('', {
      config: { mode: 'standalone', files: ['data.json', 'big.bin', 'logo.png'] },
      dir: 'runs/',
      pack: { 'data.json': text('{"a":1}'), 'logo.png': { kind: 'image', encoding: 'base64', content: 'AAEC' } },
      before: (page) => vi.spyOn(page.console, 'warn').mockImplementation(warn)
    });
    const data = await win.fetch('../data.json');
    expect([data.status, data.headers.get('content-type'), data.url, await data.json()]).toEqual([
      200,
      'application/json;charset=utf-8',
      `${PAGE_ORIGIN}/data.json`,
      { a: 1 }
    ]);
    const image = await win.fetch(new URL(`${PAGE_ORIGIN}/logo.png`));
    expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([0, 1, 2]);
    const head = await win.fetch('../data.json', { method: 'head' });
    expect([head.status, await head.text()]).toEqual([200, '']);
    expect((await win.fetch('/big.bin')).status).toBe(404);
    expect((await win.fetch('/gone.txt')).status).toBe(404);
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      '[design doc] index.html: The page fetched big.bin, which this standalone page left out to stay small; open the doc in Zana to load it',
      '[design doc] index.html: The page fetched gone.txt, which is not a file in this doc'
    ]);
    expect(runtime.problems).toHaveLength(2);
  });

  it('refuses writes and passes other URLs to the browser', async () => {
    const native = vi.fn(async () => new Response('net'));
    const { win, ofType } = setup('', { before: (page) => (page.fetch = native as never) });
    const post = await win.fetch(new win.Request(`${PAGE_ORIGIN}/api`, { method: 'POST' }));
    expect(post.status).toBe(405);
    expect(ofType('problem')[0]!.problem).toMatchObject({ kind: 'blocked', message: 'A POST request to api has nowhere to go: published pages are static' });
    expect(await (await win.fetch('https://example.com/x')).text()).toBe('net');
    expect(native).toHaveBeenCalledWith('https://example.com/x', undefined);
    expect(await (await win.fetch('http://[')).text()).toBe('net');
    expect((await win.fetch(`${PAGE_ORIGIN}/~x`)).status).toBe(404);
  });

  it('asks the app for files in the frame', async () => {
    const { win, sent, deliver } = setup('', { dir: 'a/' });
    const pending = win.fetch('b.json');
    expect(sent.at(-1)).toEqual({ type: 'fetch', id: 0, path: 'a/b.json' });
    deliver({ type: 'file', id: 0, file: text('[1]') });
    expect(await (await pending).json()).toEqual([1]);
    const missing = win.fetch('c.json');
    deliver({ type: 'file', id: 1, file: { bogus: true } as never });
    expect((await missing).status).toBe(404);
    deliver({ type: 'file', id: 99, file: null });
  });

  it('gives up on a file the app never sends', async () => {
    const timers: Array<() => void> = [];
    const { runtime } = setup('', {
      before: (page) => {
        const real = page.setTimeout.bind(page);
        page.setTimeout = ((fn: () => void, ms?: number) => (ms === 30_000 ? timers.push(fn) : real(fn, ms))) as never;
      }
    });
    const pending = runtime.load('slow.json');
    timers[0]!();
    expect(await pending).toBeNull();
  });

  it('answers XHRs for doc files from the pack', async () => {
    const { win } = setup('', {
      config: { mode: 'standalone' },
      pack: { 'data.json': text('{"a":1}'), 'logo.png': { kind: 'image', encoding: 'base64', content: 'AAEC' } },
      before: (page) => vi.spyOn(page.console, 'warn').mockImplementation(() => {})
    });
    const request = async (method: string, path: string, responseType: XMLHttpRequestResponseType = '') => {
      const xhr = new win.XMLHttpRequest();
      const done = new Promise<void>((resolve) => xhr.addEventListener('loadend', () => resolve()));
      xhr.open(method, path);
      xhr.responseType = responseType;
      xhr.send();
      await done;
      return xhr;
    };
    const events: string[] = [];
    const xhr = new win.XMLHttpRequest();
    xhr.onreadystatechange = () => events.push(`state ${xhr.readyState}`);
    xhr.onload = (event) => events.push(`load ${(event as ProgressEvent).loaded}`);
    const done = new Promise<void>((resolve) => xhr.addEventListener('loadend', () => resolve()));
    xhr.open('GET', 'data.json');
    xhr.setRequestHeader('x', 'y');
    xhr.overrideMimeType('text/plain');
    xhr.responseType = 'json';
    xhr.send();
    await done;
    expect(events).toEqual(['state 1', 'state 4', 'load 7']);
    expect([xhr.status, xhr.statusText, xhr.response, xhr.responseURL, xhr.getResponseHeader('Content-Type'), xhr.getResponseHeader('x'), xhr.getAllResponseHeaders()]).toEqual([
      200,
      'OK',
      { a: 1 },
      `${PAGE_ORIGIN}/data.json`,
      'application/json;charset=utf-8',
      null,
      'content-type: application/json;charset=utf-8\r\n'
    ]);

    const sync = new win.XMLHttpRequest();
    sync.open('GET', 'data.json', false);
    sync.send();
    expect(sync.responseText).toBe('{"a":1}');

    expect([...new Uint8Array((await request('GET', 'logo.png', 'arraybuffer')).response as ArrayBuffer)]).toEqual([0, 1, 2]);
    expect(((await request('GET', 'logo.png', 'blob')).response as Blob).size).toBe(3);
    expect(((await request('GET', 'data.json', 'blob')).response as Blob).size).toBe(7);
    expect(((await request('GET', 'data.json', 'arraybuffer')).response as ArrayBuffer).byteLength).toBe(7);
    expect((await request('GET', 'logo.png', 'json')).response).toBeNull();
    expect((await request('GET', 'data.json', 'document')).response).toBeNull();
    const head = await request('HEAD', 'data.json');
    expect([head.status, head.responseText]).toEqual([200, '']);
    const missing = await request('GET', 'gone.json');
    expect([missing.status, missing.statusText, missing.responseText, missing.getAllResponseHeaders()]).toEqual([404, 'Not Found', 'Not found', '']);
    expect((await request('GET', `${PAGE_ORIGIN}/~x`)).status).toBe(404);

    const write = new win.XMLHttpRequest();
    write.open('PUT', 'data.json');
    write.send('x');
    expect([write.status, write.statusText]).toEqual([405, 'Method Not Allowed']);
  });

  it('aborts, refuses synchronous frame requests and leaves other URLs native', async () => {
    const { win, ofType, deliver } = setup('');
    const xhr = new win.XMLHttpRequest();
    const events: string[] = [];
    for (const type of ['abort', 'loadend', 'load']) xhr.addEventListener(type, () => events.push(type));
    xhr.open('GET', 'a.json');
    xhr.send();
    xhr.abort();
    xhr.abort();
    deliver({ type: 'file', id: 0, file: text('{}') });
    await wait();
    expect(events).toEqual(['abort', 'loadend']);
    expect(xhr.readyState).toBe(0);

    const sync = new win.XMLHttpRequest();
    expect(() => sync.open('GET', 'a.json', false)).toThrow(/Synchronous requests/);
    expect(ofType('problem').at(-1)!.problem.kind).toBe('blocked');

    // Reopened for the network, the instance shows the browser's own state again.
    xhr.open('GET', 'https://example.com/');
    expect(xhr.readyState).toBe(1);
    xhr.setRequestHeader('x', 'y');
    expect(xhr.getAllResponseHeaders()).toBe('');
    expect(xhr.getResponseHeader('x')).toBeNull();
    xhr.abort();
  });
});

describe('links', () => {
  it('turns doc links into navigation, after the page had its say', async () => {
    const { doc, ofType } = setup(
      '<a id="a" href="runs/r1.html#top">r1</a><a id="b" href="other.html" target="_blank">b</a><a id="c" href="x.html"><span id="inner">c</span></a><a id="d" href="d.html">d</a>'
    );
    doc.getElementById('c')!.addEventListener('click', (event) => event.preventDefault());
    doc.getElementById('d')!.addEventListener('click', (event) => event.stopPropagation());
    const first = click(doc.getElementById('a')!);
    click(doc.getElementById('b')!);
    click(doc.getElementById('inner')!);
    click(doc.getElementById('d')!);
    click(doc.getElementById('a')!, { metaKey: true });
    click(doc.getElementById('a')!, { button: 2 });
    click(doc.getElementById('a')!, { type: 'auxclick', button: 1 });
    expect(first.defaultPrevented).toBe(true);
    await wait();
    expect(ofType('navigate')).toEqual([
      { type: 'navigate', path: 'runs/r1.html', hash: 'top', newTab: false, redirect: false },
      { type: 'navigate', path: 'other.html', hash: null, newTab: true, redirect: false },
      { type: 'navigate', path: 'd.html', hash: null, newTab: false, redirect: false },
      { type: 'navigate', path: 'runs/r1.html', hash: 'top', newTab: true, redirect: false },
      { type: 'navigate', path: 'runs/r1.html', hash: 'top', newTab: true, redirect: false }
    ]);
  });

  it('lets a page prevent a link after stopping it', async () => {
    const { doc, ofType } = setup('<a id="a" href="x.html">a</a>');
    const link = doc.getElementById('a')!;
    link.addEventListener('click', (event) => event.stopPropagation());
    link.addEventListener('click', (event) => event.preventDefault());
    click(link);
    await wait();
    expect(ofType('navigate')).toEqual([]);
  });

  it('moves within the page for fragment links, whatever the base says', async () => {
    const { win, doc, ofType } = setup(
      '<a id="a" href="#run=a%2Fb">a</a><a id="b" href="">b</a><h2 id="sec">s</h2><a id="c" href="#sec">c</a><a id="top" href="#top">t</a>',
      { dir: 'deep/', config: { path: 'deep/page.html' } }
    );
    click(doc.getElementById('a')!);
    await wait();
    expect(decodeURIComponent(win.location.hash)).toBe('#run=a/b');
    const into = vi.fn();
    (doc.getElementById('sec') as unknown as { scrollIntoView: () => void }).scrollIntoView = into;
    win.location.hash = 'sec';
    click(doc.getElementById('c')!);
    await wait();
    expect(into).toHaveBeenCalled();
    const scrollTo = vi.spyOn(win, 'scrollTo').mockImplementation(() => {});
    win.location.hash = 'top';
    click(doc.getElementById('top')!);
    await wait();
    expect(scrollTo).toHaveBeenCalledWith(0, 0);
    click(doc.getElementById('b')!);
    await wait();
    expect(ofType('navigate')).toEqual([{ type: 'navigate', path: 'deep/page.html', hash: null, newTab: false, redirect: false }]);
  });

  it('asks the app to open external links and runs javascript: links', async () => {
    const { doc, ofType, scripts } = setup(
      '<a id="ext" href="https://example.com/a">e</a><a id="mail" href="mailto:a@b.c">m</a><a id="js" href="javascript:window.go%20=%201">j</a>' +
        '<a id="ftp" href="ftp://x/">f</a><a id="nohref">n</a><a id="bad" href="http://[">bad</a><a id="up" href="../../x">up</a><a id="root" href="/a/../../">r</a>'
    );
    for (const id of ['ext', 'mail', 'js', 'ftp', 'nohref', 'bad', 'up', 'root']) click(doc.getElementById(id)!);
    await wait();
    expect(ofType('open')).toEqual([
      { type: 'open', url: 'https://example.com/a' },
      { type: 'open', url: 'mailto:a@b.c' }
    ]);
    expect(scripts.at(-1)).toContain('window.go = 1');
    expect(ofType('navigate')).toEqual([
      { type: 'navigate', path: 'x', hash: null, newTab: false, redirect: false },
      { type: 'navigate', path: 'index.html', hash: null, newTab: false, redirect: false }
    ]);
  });

  it('follows links between standalone pages through the plugin endpoint', async () => {
    const warn = vi.fn();
    const { doc, go } = setup(
      '<a id="a" href="runs/r1.html#x">a</a><a id="b" href="runs">b</a><a id="c" href="data.json">c</a><a id="d" href="gone.html">d</a><a id="e" href="#top" target="_blank">e</a>',
      {
        config: { mode: 'standalone', endpoint: '/api/v1/plugins/design-docs/http', files: ['index.html', 'runs/r1.html', 'runs/index.html', 'data.json'] },
        before: (win) => vi.spyOn(win.console, 'warn').mockImplementation(warn)
      }
    );
    for (const id of ['a', 'b', 'c', 'd', 'e']) click(doc.getElementById(id)!);
    await wait();
    const base = 'http://127.0.0.1:8780/api/v1/plugins/design-docs/http';
    expect(go.mock.calls).toEqual([
      [`${base}/page?doc=dd_1&path=runs%2Fr1.html#x`, 'assign'],
      [`${base}/page?doc=dd_1&path=runs%2Findex.html`, 'assign'],
      [`${base}/file?doc=dd_1&path=data.json`, 'assign'],
      [`${base}/page?doc=dd_1&path=index.html#top`, 'tab']
    ]);
    expect(warn).toHaveBeenCalledWith('[design doc] index.html: A link points to gone.html, which is not a file in this doc');
  });

  it('leaves external and javascript: links to the browser on standalone pages', async () => {
    const { doc, go } = setup('<a id="a" href="https://example.com">a</a><a id="b" href="javascript:void 0">b</a>', { config: { mode: 'standalone' } });
    const events: Event[] = [];
    for (const id of ['a', 'b']) {
      doc.getElementById(id)!.addEventListener('click', (event) => events.push(event));
      click(doc.getElementById(id)!);
    }
    await wait();
    expect(events.map((event) => event.defaultPrevented)).toEqual([false, false]);
    expect(go).not.toHaveBeenCalled();
  });

  it('routes window.open through the same rules', () => {
    const native = vi.fn(() => null);
    const { win, ofType } = setup('', { before: (page) => (page.open = native) });
    expect(win.open('runs/a.html')).toBeNull();
    expect(win.open('b.html', '_self')).toBeNull();
    expect(win.open('https://example.com/')).toBeNull();
    expect(win.open(`${PAGE_ORIGIN}/a/../../?x`)).toBeNull();
    win.open('ftp://x/', 'w', 'popup');
    win.open();
    expect(ofType('navigate')).toEqual([
      { type: 'navigate', path: 'runs/a.html', hash: null, newTab: true, redirect: false },
      { type: 'navigate', path: 'b.html', hash: null, newTab: false, redirect: false },
      { type: 'navigate', path: 'index.html', hash: null, newTab: true, redirect: false }
    ]);
    expect(ofType('open')).toEqual([{ type: 'open', url: 'https://example.com/' }]);
    expect(native.mock.calls).toEqual([['ftp://x/', 'w', 'popup'], [undefined, undefined, undefined]]);
  });

  it('opens standalone tabs through the browser', () => {
    const { win, go } = setup('', { config: { mode: 'standalone', endpoint: '/e' } });
    win.open('a.html');
    expect(go).toHaveBeenCalledWith('http://127.0.0.1:8780/e/page?doc=dd_1&path=a.html', 'tab');
  });

  it('catches scripts that set location', () => {
    const withNavigation = (page: PageWindow) => Object.defineProperty(page, 'navigation', { configurable: true, value: new page.EventTarget() });
    const fire = (win: PageWindow, url: string, init: Record<string, unknown> = {}) => {
      const { cancelable = true, ...rest } = init;
      const event = new win.Event('navigate', { cancelable: cancelable as boolean });
      Object.assign(event, { destination: { url }, navigationType: 'push', hashChange: false, ...rest });
      (bag(win).navigation as EventTarget).dispatchEvent(event);
      return event.defaultPrevented;
    };
    const { win, ofType } = setup('', { before: withNavigation });
    expect(
      [
        fire(win, `${PAGE_ORIGIN}/runs/a.html#x`),
        fire(win, `${PAGE_ORIGIN}/latest.html`, { navigationType: 'replace' }),
        fire(win, `${PAGE_ORIGIN}/save`, { formData: {} }),
        fire(win, `${PAGE_ORIGIN}/~x`),
        fire(win, 'https://example.com/'),
        fire(win, 'ftp://x/'),
        fire(win, `${PAGE_ORIGIN}/a.html`, { hashChange: true }),
        fire(win, `${PAGE_ORIGIN}/a.html`, { navigationType: 'reload' }),
        fire(win, `${PAGE_ORIGIN}/a.html`, { cancelable: false }),
        fire(win, 'http://[')
      ]
    ).toEqual([true, true, true, true, true, false, false, false, false, false]);
    expect(ofType('navigate')).toEqual([
      { type: 'navigate', path: 'runs/a.html', hash: 'x', newTab: false, redirect: false },
      { type: 'navigate', path: 'latest.html', hash: null, newTab: false, redirect: true }
    ]);
    expect(ofType('open')).toEqual([{ type: 'open', url: 'https://example.com/' }]);
    expect(ofType('problem').map((message) => message.problem.message)).toEqual([
      'A form tried to submit; published pages are static, so handle submit in a script',
      `The page tried to open ${PAGE_ORIGIN}/~x, which names no file in this doc`
    ]);

    const warn = vi.fn();
    const standalone = setup('', {
      config: { mode: 'standalone', endpoint: '/e', files: ['a.html'] },
      before: (page) => {
        withNavigation(page);
        vi.spyOn(page.console, 'warn').mockImplementation(warn);
      }
    });
    expect([fire(standalone.win, `${PAGE_ORIGIN}/a.html`), fire(standalone.win, `${PAGE_ORIGIN}/b.html`), fire(standalone.win, 'https://example.com/')]).toEqual([
      true,
      true,
      false
    ]);
    expect(standalone.go).toHaveBeenCalledWith('http://127.0.0.1:8780/e/page?doc=dd_1&path=a.html', 'assign');
    expect(warn).toHaveBeenCalledWith('[design doc] index.html: The page tried to open b.html, which is not a file in this doc');
  });

  it('reports forms that try to submit', async () => {
    const { win, doc, ofType } = setup('<form id="f" action="/save"><button>go</button></form><form id="g"></form>');
    doc.getElementById('g')!.addEventListener('submit', (event) => event.preventDefault());
    for (const id of ['f', 'g']) doc.getElementById(id)!.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await wait();
    expect(ofType('problem').map((message) => message.problem.message)).toEqual(['A form tried to submit; published pages are static, so handle submit in a script']);
  });

  it('follows a refresh redirect to another doc page', async () => {
    const { ofType } = setup('', { head: `<meta name="dd-refresh" content="0;${PAGE_ORIGIN}/runs/">` });
    await wait(5);
    expect(ofType('navigate')).toEqual([{ type: 'navigate', path: 'runs/index.html', hash: null, newTab: false, redirect: true }]);
  });

  it('replaces a standalone page on redirect, also to itself', async () => {
    const { go } = setup('', { config: { mode: 'standalone', endpoint: '/e' }, head: `<meta name="dd-refresh" content="0;${PAGE_ORIGIN}/index.html#a">` });
    await wait(5);
    expect(go).toHaveBeenCalledWith('http://127.0.0.1:8780/e/page?doc=dd_1&path=index.html#a', 'replace');
  });
});

describe('inline handlers in the frame', () => {
  it('binds on* attributes as scripts, rebinding when they change', async () => {
    const { win, doc, scripts, run } = setup('<button id="b" onclick="window.clicks = (window.clicks || 0) + 1; return false">b</button>');
    expect(scripts[0]).toContain('window.__ddPage.bind(0, function (event) {\nwindow.clicks');
    run();
    const button = doc.getElementById('b')!;
    expect(click(button).defaultPrevented).toBe(true);
    expect(bag(win).clicks).toBe(1);

    button.setAttribute('onclick', 'window.other = this.id');
    await wait();
    run();
    click(button);
    expect(bag(win).clicks).toBe(1);
    expect(bag(win).other).toBe('b');

    button.removeAttribute('onclick');
    await wait();
    bag(win).other = null;
    click(button);
    expect(bag(win).other).toBeNull();
  });

  it('binds body window events on the window and handlers on added elements', async () => {
    const { win, doc, scripts, run } = setup('<p>x</p>', {
      before: (page) => page.document.body.setAttribute('onresize', 'window.resized = this === window')
    });
    run();
    win.dispatchEvent(new win.Event('resize'));
    expect(bag(win).resized).toBe(true);
    const span = doc.createElement('span');
    span.setAttribute('onmouseover', 'window.over = 1');
    doc.body.appendChild(span);
    await wait();
    expect(scripts.at(-1)).toContain('window.over = 1');
    run();
    span.dispatchEvent(new win.Event('mouseover'));
    expect(bag(win).over).toBe(1);
  });

  it('ignores a binding whose attribute changed before it ran', async () => {
    const { win, doc, run } = setup('<i id="i" onclick="window.stale = 1">i</i>');
    doc.getElementById('i')!.setAttribute('onclick', 'window.fresh = 1');
    await wait();
    run();
    click(doc.getElementById('i')!);
    expect(bag(win).stale).toBeUndefined();
    expect(bag(win).fresh).toBe(1);
    win.__ddPage.bind(99, () => {});
  });

  it('leaves on* attributes alone on standalone pages', () => {
    const { scripts } = setup('<button onclick="x()">b</button>', { config: { mode: 'standalone' } });
    expect(scripts).toEqual(['window.__ddPage.ready();\n//# sourceURL=dd:design%20doc%20runtime']);
  });
});

describe('late images', () => {
  it('loads doc images added after render as blobs', async () => {
    const { win, doc, sent, deliver, ofType } = setup('<img id="first" src="a.png">');
    const create = vi.spyOn(win.URL, 'createObjectURL').mockReturnValue('blob:img');
    expect(sent.at(-1)).toEqual({ type: 'fetch', id: 0, path: 'a.png' });
    const image = doc.createElement('img');
    image.src = 'a.png';
    doc.body.appendChild(image);
    const gone = doc.createElement('img');
    doc.body.appendChild(gone);
    gone.setAttribute('src', 'gone.png');
    await wait();
    deliver({ type: 'file', id: 0, file: { kind: 'image', encoding: 'base64', content: 'AAEC' } });
    deliver({ type: 'file', id: 1, file: null });
    await wait();
    expect(doc.getElementById('first')!.getAttribute('src')).toBe('blob:img');
    expect(image.getAttribute('src')).toBe('blob:img');
    expect(create).toHaveBeenCalledTimes(1);
    expect(ofType('problem').map((message) => message.problem)).toEqual([
      { kind: 'missing', message: 'An image shows gone.png, which is not a file in this doc', source: 'index.html' }
    ]);
    image.setAttribute('src', 'https://example.com/x.png');
    await wait();
    expect(image.getAttribute('src')).toBe('https://example.com/x.png');
  });
});

describe('comments', () => {
  function stubHighlights() {
    const painted = new Map<string, Range[]>();
    (globalThis as { CSS?: unknown }).CSS = {
      highlights: { set: (name: string, highlight: { ranges: Range[] }) => painted.set(name, highlight.ranges), delete: (name: string) => painted.delete(name) }
    };
    (globalThis as { Highlight?: unknown }).Highlight = class {
      ranges: Range[];
      constructor(...ranges: Range[]) {
        this.ranges = ranges;
      }
    };
    return painted;
  }

  it('paints open quotes and tells the app which it found', async () => {
    const painted = stubHighlights();
    const { doc, run, ofType, deliver } = setup('<p>Total snake_case runs</p><script type="text/x-dd-script">void "Total";</script>', {
      config: { quotes: ['snake_case runs', 'absent'] }
    });
    run();
    expect(painted.get('dd-comment')!.map((range) => range.toString())).toEqual(['snake_case runs']);
    expect(ofType('anchors')).toEqual([{ type: 'anchors', found: ['snake_case runs'], missing: ['absent'] }]);

    deliver({ type: 'highlight', quotes: ['Total', 'later text', 7 as never] });
    expect(ofType('anchors').at(-1)).toEqual({ type: 'anchors', found: ['Total'], missing: ['later text'] });
    doc.body.appendChild(doc.createElement('p')).textContent = 'later text';
    await wait(300);
    expect(ofType('anchors').at(-1)).toEqual({ type: 'anchors', found: ['Total', 'later text'], missing: [] });
    const count = ofType('anchors').length;
    doc.body.setAttribute('class', 'x');
    await wait(300);
    expect(ofType('anchors')).toHaveLength(count);

    deliver({ type: 'highlight', quotes: [] });
    expect(painted.has('dd-comment')).toBe(false);
  });

  it('focuses a quote and clears the focus mark', () => {
    const painted = stubHighlights();
    const { doc, ofType, deliver } = setup('<p id="p">Focus me please</p>');
    const into = vi.fn();
    (doc.getElementById('p') as unknown as { scrollIntoView: () => void }).scrollIntoView = into;
    deliver({ type: 'focus', quote: 'me please' });
    deliver({ type: 'focus', quote: 'not here' });
    expect(into).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(painted.get('dd-comment-focus')!.map((range) => range.toString())).toEqual(['me please']);
    expect(ofType('focused')).toEqual([
      { type: 'focused', quote: 'me please', found: true },
      { type: 'focused', quote: 'not here', found: false }
    ]);
    deliver({ type: 'bogus' } as never);
    deliver(null as never);
  });

  it('reports selections, and clears them on request', async () => {
    const { win, doc, ofType, deliver } = setup('<p id="p">Pick this text</p>');
    const range = doc.createRange();
    range.selectNodeContents(doc.getElementById('p')!.firstChild!);
    win.getSelection()!.addRange(range);
    doc.dispatchEvent(new win.Event('selectionchange'));
    await wait(200);
    expect(ofType('selection')).toEqual([{ type: 'selection', text: 'Pick this text', rect: { top: 0, left: 0, bottom: 0, right: 0 } }]);
    win.dispatchEvent(new win.Event('scroll'));
    await wait(200);
    expect(ofType('selection')).toHaveLength(2);
    deliver({ type: 'clear-selection' });
    doc.dispatchEvent(new win.Event('selectionchange'));
    await wait(200);
    expect(ofType('selection').at(-1)).toEqual({ type: 'selection', text: '', rect: null });
    doc.dispatchEvent(new win.Event('selectionchange'));
    await wait(200);
    expect(ofType('selection')).toHaveLength(3);
  });
});

describe('storage and cookies', () => {
  const denied = () => {
    throw new DOMException('denied', 'SecurityError');
  };

  it('stands in for storage the origin does not have, and keeps the app posted', async () => {
    const { win, ofType } = setup('', {
      config: { storage: { theme: 'dark' } },
      before: (page) => {
        Object.defineProperty(page, 'localStorage', { configurable: true, get: denied });
        Object.defineProperty(page, 'sessionStorage', { configurable: true, get: denied });
        Object.defineProperty(page.document, 'cookie', { configurable: true, get: denied, set: denied });
      }
    });
    expect(win.localStorage.getItem('theme')).toBe('dark');
    win.localStorage.setItem('n', '1');
    win.sessionStorage.setItem('s', '1');
    await wait(450);
    expect(ofType('storage')).toEqual([{ type: 'storage', entries: { theme: 'dark', n: '1' } }]);
    win.localStorage.setItem('big', 'x'.repeat(300 * 1024));
    await wait(450);
    expect(ofType('storage')).toHaveLength(1);

    win.document.cookie = 'a=1; path=/';
    win.document.cookie = 'b=2';
    expect(win.document.cookie).toBe('a=1; b=2');
    win.document.cookie = 'a=; max-age=0';
    win.document.cookie = 'b=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    win.document.cookie = 'flag';
    expect(win.document.cookie).toBe('flag');
  });

  it('keeps storage and cookies that work', () => {
    const win = newWindow();
    expect(ensureStorage(win, 'localStorage')).toBeNull();
    expect(ensureCookies(win.document)).toBe(false);
    const sealed = Object.freeze({
      get localStorage(): Storage {
        throw new Error('x');
      }
    });
    expect(ensureStorage(sealed, 'localStorage')).toBeNull();
  });

  it('implements Storage in memory', () => {
    const changed = vi.fn();
    const storage = new MemoryStorage({ a: '1' }, changed);
    storage.setItem('b', 2 as never);
    expect([storage.length, storage.key(1), storage.key(5), storage.getItem('b'), storage.getItem('z')]).toEqual([2, 'b', null, '2', null]);
    storage.removeItem('z');
    storage.removeItem('a');
    storage.clear();
    storage.clear();
    expect(changed).toHaveBeenCalledTimes(3);
    expect(storage.entries()).toEqual({});
    expect(new MemoryStorage().length).toBe(0);
  });
});
