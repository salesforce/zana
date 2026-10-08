// @vitest-environment happy-dom
// The frame asks for page-runtime.js, which happy-dom does not load.
// @vitest-environment-options { "settings": { "handleDisabledFileLoadingAsSuccess": true } }
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { MutableRefObject } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UI_USER } from '../server/rpc.js';
import type { DesignDocFileMeta } from '../shared/contract.js';
import { PAGE_HELLO, type PageConfig, type ToPage } from '../shared/frame-protocol.js';
import { MAX_FILES_PER_DOC } from '../shared/limits.js';
import { MAX_RPC_PAYLOAD_BYTES } from '../shared/page.js';
import type { PreviewHandle } from './FilePreview.js';
import { createJobQueue, DRAFT_DELAY_MS, PageFrame, pageSrcDoc, REPORT_DELAY_MS, resetPageFrameState } from './PageFrame.js';
import { createHarness, type Harness, type HarnessOptions } from './test-harness.js';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const PAGE = '<!doctype html><html><head><title>Runs</title></head><body><h1>Runs</h1><img src="logo.png"><script>go()</script></body></html>';

/** Stands in for the page's end of the MessageChannel. */
class FakePort {
  sent: ToPage[] = [];
  closed = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  postMessage(message: ToPage) {
    this.sent.push(message);
  }
  close() {
    this.closed = true;
  }
  /** A message from the page, raw so tests can send malformed ones too. */
  emit(data: unknown) {
    act(() => this.onmessage?.({ data }));
  }
  ofType<T extends ToPage['type']>(type: T): Array<Extract<ToPage, { type: T }>> {
    return this.sent.filter((message): message is Extract<ToPage, { type: T }> => message.type === type);
  }
}

function makeDoc(harness: Harness, extra: Array<{ path: string; content: string; encoding?: 'base64' }> = []) {
  return harness.store.create(
    {
      title: 'Bench',
      projectId: 'p1',
      files: [
        { path: 'index.html', content: PAGE },
        { path: 'b.html', content: '<p>B</p>' },
        { path: 'runs/index.html', content: '<p>Runs</p>' },
        { path: 'data/runs.json', content: '[1,2]' },
        { path: 'logo.png', content: PNG, encoding: 'base64' },
        ...extra
      ]
    },
    UI_USER
  );
}

interface MountOptions {
  path?: string;
  draft?: string;
  quotes?: string[];
  files?: DesignDocFileMeta[];
}

function mount(harness: Harness, docId: string, options: MountOptions = {}) {
  const onOpenPath = vi.fn();
  const onQuote = vi.fn();
  const onAskAbout = vi.fn();
  const handleRef: MutableRefObject<PreviewHandle | null> = { current: null };
  const element = (next: MountOptions) => {
    const path = next.path ?? 'index.html';
    const content = next.draft ?? harness.store.readFile(docId, path).content;
    return (
      <PageFrame
        docId={docId}
        file={{ path, kind: 'html', content, encoding: 'utf8' }}
        files={next.files ?? harness.store.get(docId).files}
        draft={next.draft !== undefined}
        quotes={next.quotes ?? []}
        onOpenPath={onOpenPath}
        onQuote={onQuote}
        onAskAbout={onAskAbout}
        handleRef={handleRef}
      />
    );
  };
  let current = options;
  const view = harness.render(element(options));
  return {
    onOpenPath,
    onQuote,
    onAskAbout,
    handleRef,
    rerender(next: MountOptions = {}) {
      current = { ...current, ...next };
      view.rerender(element(current));
    },
    unmount: () => view.unmount()
  };
}

async function findFrame(): Promise<HTMLIFrameElement> {
  return (await screen.findByTitle(/\.html$/)) as HTMLIFrameElement;
}

function configOf(frame: HTMLIFrameElement): PageConfig {
  const match = frame.getAttribute('srcdoc')!.match(/<script type="application\/json" id="dd-page">([^<]*)<\/script>/);
  return JSON.parse(match![1]!) as PageConfig;
}

function hello(frame: HTMLIFrameElement, port = new FakePort(), source: unknown = frame.contentWindow): FakePort {
  act(() => {
    globalThis.dispatchEvent(new MessageEvent('message', { data: { dd: PAGE_HELLO }, source: source as Window, ports: [port as unknown as MessagePort] }));
  });
  return port;
}

const renderCalls = (harness: Harness) => harness.rpcCalls.filter((call) => call.method === 'renderPage');

function setup(options: HarnessOptions = {}, extra?: Parameters<typeof makeDoc>[1]) {
  const harness = createHarness(options);
  const doc = makeDoc(harness, extra);
  return { harness, doc };
}

afterEach(() => {
  vi.useRealTimers();
  resetPageFrameState();
  vi.unstubAllGlobals();
});

describe('pageSrcDoc', () => {
  const config: PageConfig = { mode: 'frame', docId: 'd', path: 'a.html', quotes: ['</script>'] };

  it('boots the runtime first and themes pages without CSS', () => {
    const out = pageSrcDoc({ html: '<html><head><title>x</title></head></html>', styled: false }, config, 'http://h/page-runtime.js?a=1&b="2"', { '--accent': '#123' });
    expect(out.startsWith('<html><head><style data-zcc-theme>')).toBe(true);
    expect(out).toContain('--accent: #123;');
    expect(out).toContain('<script src="http://h/page-runtime.js?a=1&amp;b=&quot;2&quot;"></script><title>');
    // The config cannot end its own script block.
    expect(out).toContain('"quotes":["\\u003c/script>"]');
  });

  it('leaves styled pages to their own CSS', () => {
    const out = pageSrcDoc({ html: '<p>x</p>', styled: true }, config, 'http://h/r.js', { '--accent': '#123' });
    expect(out).not.toContain('data-zcc-theme');
    expect(out.endsWith('<script src="http://h/r.js"></script><p>x</p>')).toBe(true);
  });
});

describe('createJobQueue', () => {
  it('runs at most the limit at once and refuses work over the cap', async () => {
    const queue = createJobQueue(2, 3);
    const releases: Array<() => void> = [];
    let running = 0;
    let peak = 0;
    const job = () =>
      new Promise<void>((resolve) => {
        running += 1;
        peak = Math.max(peak, running);
        releases.push(() => {
          running -= 1;
          resolve();
        });
      });
    expect([queue.add(job), queue.add(job), queue.add(job), queue.add(job)]).toEqual([true, true, true, false]);
    await waitFor(() => expect(releases).toHaveLength(2));
    releases.shift()!();
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(peak).toBe(2);
    releases.splice(0).forEach((release) => release());
    await waitFor(() => expect(running).toBe(0));
  });

  it('keeps going after a failed job and drops waiting work on clear', async () => {
    const queue = createJobQueue(1, 10);
    const ran: string[] = [];
    let release!: () => void;
    queue.add(() => Promise.reject(new Error('boom')));
    queue.add(() => new Promise<void>((resolve) => (release = () => (ran.push('second'), resolve()))));
    queue.add(async () => {
      ran.push('dropped');
    });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    queue.clear();
    release();
    queue.add(async () => {
      ran.push('third');
    });
    await waitFor(() => expect(ran).toEqual(['second', 'third']));
  });
});

describe('PageFrame', () => {
  it('renders the saved page the way the site will show it', async () => {
    const { harness, doc } = setup();
    mount(harness, doc.id, { quotes: ['Runs'] });
    const frame = await findFrame();
    expect(frame.title).toBe('index.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
    const srcDoc = frame.getAttribute('srcdoc')!;
    expect(srcDoc).toContain('data-zcc-theme');
    expect(srcDoc).toContain('data:image/png;base64,');
    expect(srcDoc).toMatch(/<script src="[^"]*\/page-runtime\.js"><\/script>/);
    expect(configOf(frame)).toEqual({ mode: 'frame', docId: doc.id, path: 'index.html', hash: null, scroll: null, quotes: ['Runs'] });
    expect(screen.queryByRole('button', { name: /page problem/ })).toBeNull();
    expect(screen.queryByText('Unsaved changes')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Phone (390px)' }));
    expect(frame.style.width).toBe('390px');
    expect(frame.className).toContain('dd-html-frame-device');
    fireEvent.click(screen.getByRole('button', { name: 'Full width' }));
    expect(frame.style.width).toBe('');
  });

  it('shows why a page cannot render', async () => {
    const { harness, doc } = setup();
    harness.fail('renderPage', 'index.html is not an HTML page');
    mount(harness, doc.id);
    expect(await screen.findByText('index.html is not an HTML page')).toBeTruthy();
    expect(screen.queryByTitle('index.html')).toBeNull();
  });

  it('answers the page over the port it hands over, and only that port', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id, { quotes: ['Runs'] });
    const frame = await findFrame();

    const stranger = hello(frame, new FakePort(), globalThis);
    expect(stranger.onmessage).toBeNull();
    act(() => {
      globalThis.dispatchEvent(new MessageEvent('message', { data: { dd: PAGE_HELLO }, source: frame.contentWindow }));
    });

    const port = hello(frame);
    expect(port.onmessage).toBeTypeOf('function');
    port.emit({ type: 'ready' });
    expect(port.ofType('highlight')).toEqual([{ type: 'highlight', quotes: ['Runs'] }]);

    port.emit({ type: 'fetch', id: 1, path: 'data/runs.json' });
    port.emit({ type: 'fetch', id: 2, path: 'absent.json' });
    port.emit({ type: 'fetch', id: -1, path: 'data/runs.json' });
    port.emit('junk');
    await waitFor(() => expect(port.ofType('file')).toHaveLength(2));
    expect(port.ofType('file')).toContainEqual({ type: 'file', id: 1, file: { kind: 'code', encoding: 'utf8', content: '[1,2]' } });
    expect(port.ofType('file')).toContainEqual({ type: 'file', id: 2, file: null });

    // A reload hands over a new port; the old one is closed and ignored.
    const next = hello(frame);
    expect(port.closed).toBe(true);
    port.emit({ type: 'fetch', id: 3, path: 'data/runs.json' });
    next.emit({ type: 'fetch', id: 4, path: 'data/runs.json' });
    await waitFor(() => expect(next.ofType('file')).toHaveLength(1));
    expect(port.ofType('file')).toHaveLength(2);

    view.unmount();
    expect(next.closed).toBe(true);
  });

  it('answers a fetch with nothing when the read fails or the page moved on', async () => {
    const { harness, doc } = setup();
    mount(harness, doc.id);
    const port = hello(await findFrame());
    harness.fail('readPageFile', 'boom');
    port.emit({ type: 'fetch', id: 1, path: 'data/runs.json' });
    await waitFor(() => expect(port.ofType('file')).toEqual([{ type: 'file', id: 1, file: null }]));
  });

  it('opens doc files the page links to', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id);
    const port = hello(await findFrame());

    port.emit({ type: 'navigate', path: 'b.html', hash: null, newTab: false, redirect: false });
    port.emit({ type: 'navigate', path: 'runs', hash: null, newTab: true, redirect: false });
    port.emit({ type: 'navigate', path: 'data/runs.json', hash: null, newTab: false, redirect: false });
    port.emit({ type: 'navigate', path: 'index.html', hash: null, newTab: true, redirect: false });
    expect(view.onOpenPath.mock.calls).toEqual([['b.html'], ['runs/index.html'], ['data/runs.json']]);

    port.emit({ type: 'navigate', path: 'gone.html', hash: null, newTab: false, redirect: false });
    expect(harness.toasts).toContainEqual({ message: 'gone.html is not a file in this design doc', kind: 'error' });
  });

  it('opens a linked page at the fragment the link names', async () => {
    const { harness, doc } = setup();
    const first = mount(harness, doc.id);
    const port = hello(await findFrame());
    port.emit({ type: 'navigate', path: 'b.html', hash: 'run=a/b', newTab: false, redirect: false });
    expect(first.onOpenPath).toHaveBeenCalledWith('b.html');
    first.unmount();

    mount(harness, doc.id, { path: 'b.html' });
    expect(configOf(await findFrame()).hash).toBe('run=a/b');
  });

  it('asks before following a redirect', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id);
    const port = hello(await findFrame());

    port.emit({ type: 'navigate', path: 'index.html', hash: null, newTab: false, redirect: true });
    expect(screen.queryByText(/This page redirects to/)).toBeNull();

    port.emit({ type: 'navigate', path: 'b.html', hash: 'top', newTab: false, redirect: true });
    expect(view.onOpenPath).not.toHaveBeenCalled();
    const banner = screen.getByText(/This page redirects to/).closest('.dd-banner') as HTMLElement;
    expect(within(banner).getByText('b.html')).toBeTruthy();
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/This page redirects to/)).toBeNull();

    port.emit({ type: 'navigate', path: 'b.html', hash: 'top', newTab: false, redirect: true });
    fireEvent.click(screen.getByRole('button', { name: 'Go there' }));
    expect(view.onOpenPath).toHaveBeenCalledWith('b.html');
    expect(screen.queryByText(/This page redirects to/)).toBeNull();
  });

  it('opens web links from a click, and nothing else', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { harness, doc } = setup();
    mount(harness, doc.id);
    const port = hello(await findFrame());

    port.emit({ type: 'open', url: 'https://example.com/x' });
    expect(open).toHaveBeenCalledWith('https://example.com/x', '_blank', 'noopener,noreferrer');

    port.emit({ type: 'open', url: 'mailto:team@example.com' });
    expect(harness.toasts).toContainEqual({ message: 'Zana opens web links only, not mailto: links', kind: 'error' });
    port.emit({ type: 'open', url: 'not a url' });

    vi.stubGlobal('navigator', { ...globalThis.navigator, userActivation: { isActive: false } });
    port.emit({ type: 'open', url: 'https://example.com/popup' });
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: '1 page problem' }));
    expect(screen.getByText('The page tried to open https://example.com/popup without a click')).toBeTruthy();
  });

  it('lists what went wrong in the page, without repeats, fresh for each load', async () => {
    const { harness, doc } = setup({}, [
      { path: 'broken.html', content: '<link rel="stylesheet" href="gone.css"><script src="https://cdn.example.com/x.js"></script><p>x</p>' }
    ]);
    mount(harness, doc.id, { path: 'broken.html' });
    const frame = await findFrame();
    const port = hello(frame);
    const problem = { kind: 'error', message: 'x is not defined', source: 'broken.html (inline script 1)', line: 3 };
    port.emit({ type: 'problem', problem });
    port.emit({ type: 'problem', problem });
    port.emit({ type: 'problem', problem: { kind: 'blocked', message: 'A form tried to submit' } });

    fireEvent.click(screen.getByRole('button', { name: '4 page problems' }));
    const list = screen.getByRole('list', { name: 'Page problems' });
    const items = within(list).getAllByRole('listitem').map((item) => item.textContent);
    expect(items).toEqual([
      'MissingThe page uses gone.css, which is not a file in this doc',
      'BlockedExternal script https://cdn.example.com/x.js is blocked in previews; add the file to the doc.',
      'Errorx is not definedbroken.html (inline script 1):3',
      'BlockedA form tried to submit'
    ]);

    hello(frame);
    expect(screen.getByRole('button', { name: '2 page problems' })).toBeTruthy();
  });

  it('turns a selection in the page into a comment or a question', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id);
    const port = hello(await findFrame());
    const rect = { top: 100, left: 40, bottom: 120, right: 140 };

    port.emit({ type: 'selection', text: 'Runs', rect });
    fireEvent.click(screen.getByRole('button', { name: 'Comment' }));
    expect(view.onQuote).toHaveBeenCalledWith('Runs');
    expect(port.ofType('clear-selection')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();

    port.emit({ type: 'selection', text: 'Runs', rect });
    fireEvent.click(screen.getByRole('button', { name: 'Ask agent' }));
    expect(view.onAskAbout).toHaveBeenCalledWith('Runs');

    port.emit({ type: 'selection', text: 'Runs', rect });
    port.emit({ type: 'selection', text: '', rect: null });
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();

    port.emit({ type: 'selection', text: 'Runs', rect });
    fireEvent.mouseDown(screen.getByRole('toolbar', { name: 'Preview width' }));
    expect(screen.queryByRole('button', { name: 'Comment' })).toBeNull();
  });

  it('focuses commented passages once the page is ready, and paints new quotes', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id, { quotes: ['Runs'] });
    const port = hello(await findFrame());

    expect(view.handleRef.current!.focusQuote('Runs')).toBe(true);
    expect(port.ofType('focus')).toEqual([]);
    port.emit({ type: 'ready' });
    expect(port.ofType('focus')).toEqual([{ type: 'focus', quote: 'Runs' }]);
    view.handleRef.current!.focusQuote('B');
    expect(port.ofType('focus')).toHaveLength(2);

    port.emit({ type: 'focused', quote: 'B', found: false });
    expect(harness.toasts).toContainEqual({ message: 'That passage is no longer on this page', kind: 'info' });
    port.emit({ type: 'focused', quote: 'Runs', found: true });
    port.emit({ type: 'anchors', found: ['Runs'], missing: [] });

    view.rerender({ quotes: ['Runs', 'go'] });
    expect(port.ofType('highlight').at(-1)).toEqual({ type: 'highlight', quotes: ['Runs', 'go'] });

    view.unmount();
    expect(view.handleRef.current).toBeNull();
  });

  it('tells agents what the page showed once it settles, and only what changed', async () => {
    const { harness, doc } = setup();
    harness.store.addComment(doc.id, { body: 'Where?', path: 'index.html', quote: 'Pass rate' }, UI_USER);
    mount(harness, doc.id, { quotes: ['Pass rate'] });
    const port = hello(await findFrame());
    vi.useFakeTimers();
    const reportCalls = () => harness.rpcCalls.filter((call) => call.method === 'reportRender');
    const settle = () => act(async () => vi.advanceTimersByTime(REPORT_DELAY_MS));
    const error = { kind: 'error', message: 'go is not defined', source: 'index.html (inline script 1)', line: 1 };

    // Nothing is said before the page is ready.
    port.emit({ type: 'problem', problem: error });
    await settle();
    expect(reportCalls()).toEqual([]);

    port.emit({ type: 'ready' });
    port.emit({ type: 'anchors', found: [], missing: ['Pass rate'] });
    await act(async () => vi.advanceTimersByTime(REPORT_DELAY_MS - 1));
    expect(reportCalls()).toEqual([]);
    await act(async () => vi.advanceTimersByTime(1));
    expect(reportCalls()).toHaveLength(1);
    const [report] = harness.reports.current(doc.id, harness.store.get(doc.id).files);
    expect(report).toMatchObject({ path: 'index.html', revision: 1, problems: [error], unanchored: ['Pass rate'] });
    expect(report!.deps.map((dep) => dep.path)).toContain('logo.png');

    // The same picture again is not news.
    port.emit({ type: 'anchors', found: [], missing: ['Pass rate'] });
    await settle();
    expect(reportCalls()).toHaveLength(1);

    // A failed report is sent again with the next change.
    harness.fail('reportRender', 'offline');
    port.emit({ type: 'problem', problem: { kind: 'blocked', message: 'The page tried to open a popup.' } });
    await settle();
    expect(reportCalls()).toHaveLength(2);
    harness.restore('reportRender');
    port.emit({ type: 'anchors', found: ['Pass rate'], missing: [] });
    await settle();
    expect(reportCalls()).toHaveLength(3);
    expect(harness.reports.current(doc.id, harness.store.get(doc.id).files)[0]).toMatchObject({ unanchored: [], problems: [error, { kind: 'blocked' }] });
  });

  it('keeps drafts to itself', async () => {
    const { harness, doc } = setup();
    mount(harness, doc.id, { draft: '<p>draft</p>' });
    const port = hello(await findFrame());
    vi.useFakeTimers();
    port.emit({ type: 'ready' });
    port.emit({ type: 'problem', problem: { kind: 'error', message: 'boom' } });
    await act(async () => vi.advanceTimersByTime(REPORT_DELAY_MS * 2));
    expect(harness.rpcCalls.filter((call) => call.method === 'reportRender')).toEqual([]);
  });

  it('re-renders when the doc changes under the page, keeping the reader where they were', async () => {
    const { harness, doc } = setup({}, [{ path: 'site.css', content: 'h1 { color: red }' }]);
    harness.store.writeFile(doc.id, { path: 'index.html', content: PAGE.replace('<title>', '<link rel="stylesheet" href="site.css"><title>') }, UI_USER);
    const view = mount(harness, doc.id);
    const frame = await findFrame();
    expect(frame.getAttribute('srcdoc')).toContain('h1 { color: red }');
    const port = hello(frame);
    port.emit({ type: 'scroll', x: 0, y: 420 });
    port.emit({ type: 'hash', hash: 'latest' });
    port.emit({ type: 'storage', entries: { theme: 'dark' } });
    const before = renderCalls(harness).length;

    // Unrelated changes leave the page alone.
    view.rerender({ files: [...harness.store.get(doc.id).files] });
    expect(renderCalls(harness)).toHaveLength(before);

    harness.store.writeFile(doc.id, { path: 'site.css', content: 'h1 { color: blue }' }, UI_USER);
    view.rerender({ files: harness.store.get(doc.id).files });
    await waitFor(() => expect(screen.getByTitle('index.html').getAttribute('srcdoc')).toContain('h1 { color: blue }'));
    expect(configOf(await findFrame())).toMatchObject({ hash: 'latest', scroll: { x: 0, y: 420 }, storage: { theme: 'dark' } });

    // The doc's other pages share its storage, like pages of one site.
    view.unmount();
    mount(harness, doc.id, { path: 'b.html' });
    expect(configOf(await findFrame()).storage).toEqual({ theme: 'dark' });
  });

  it('reloads the page when a file it fetched changes, and tells agents it read it', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id);
    const frame = await findFrame();
    const port = hello(frame);
    port.emit({ type: 'ready' });
    port.emit({ type: 'fetch', id: 1, path: 'data/runs.json' });
    port.emit({ type: 'fetch', id: 2, path: 'data/runs.json' });
    port.emit({ type: 'fetch', id: 3, path: 'later.json' });
    await waitFor(() => expect(port.ofType('file')).toHaveLength(3));
    port.emit({ type: 'scroll', x: 0, y: 300 });

    await waitFor(() => expect(harness.rpcCalls.filter((call) => call.method === 'reportRender')).toHaveLength(1), { timeout: REPORT_DELAY_MS * 3 });
    const [report] = harness.reports.current(doc.id, harness.store.get(doc.id).files);
    expect(report!.deps).toEqual(expect.arrayContaining([{ path: 'data/runs.json', revision: 1 }, { path: 'later.json', revision: 0 }]));
    expect(report!.deps.filter((dep) => dep.path === 'data/runs.json')).toHaveLength(1);

    // The page HTML is the same, so only a fresh frame shows the new data.
    const before = renderCalls(harness).length;
    harness.store.writeFile(doc.id, { path: 'data/runs.json', content: '[3]' }, UI_USER);
    view.rerender({ files: harness.store.get(doc.id).files });
    await waitFor(() => expect(renderCalls(harness)).toHaveLength(before + 1));
    await waitFor(() => expect(screen.getByTitle('index.html')).not.toBe(frame));
    expect(configOf(await findFrame())).toMatchObject({ scroll: { x: 0, y: 300 } });

    // The new page has fetched nothing yet, so a further change leaves it alone.
    hello(await findFrame());
    harness.store.writeFile(doc.id, { path: 'data/runs.json', content: '[4]' }, UI_USER);
    view.rerender({ files: harness.store.get(doc.id).files });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(renderCalls(harness)).toHaveLength(before + 1);

    // A file it fetched that the doc lacked reloads it once it appears.
    const latest = hello(await findFrame());
    latest.emit({ type: 'fetch', id: 1, path: 'later.json' });
    await waitFor(() => expect(latest.ofType('file')).toHaveLength(1));
    harness.store.writeFile(doc.id, { path: 'later.json', content: '{}' }, UI_USER);
    view.rerender({ files: harness.store.get(doc.id).files });
    await waitFor(() => expect(renderCalls(harness)).toHaveLength(before + 2));
  });

  it('remembers only as many fetched files as a doc can hold', async () => {
    const { harness, doc } = setup();
    mount(harness, doc.id);
    const port = hello(await findFrame());
    port.emit({ type: 'ready' });
    for (let id = 0; id <= MAX_FILES_PER_DOC; id += 1) port.emit({ type: 'fetch', id, path: `missing/${id}.json` });
    await waitFor(() => expect(port.ofType('file')).toHaveLength(MAX_FILES_PER_DOC + 1), { timeout: 10_000 });
    await waitFor(() => expect(harness.rpcCalls.filter((call) => call.method === 'reportRender')).toHaveLength(1), { timeout: REPORT_DELAY_MS * 3 });
    const { deps } = harness.rpcCalls.find((call) => call.method === 'reportRender')!.input as { deps: Array<{ path: string }> };
    expect(deps).toHaveLength(MAX_FILES_PER_DOC);
    expect(deps.some((dep) => dep.path === `missing/${MAX_FILES_PER_DOC}.json`)).toBe(false);
  }, 20_000);

  it('re-renders a missing file once it appears, and only once per change', async () => {
    const { harness, doc } = setup({}, [{ path: 'gap.html', content: '<link rel="stylesheet" href="later.css"><p>x</p>' }]);
    // The files list can lag the server: a stale list keeps the page stale without looping.
    const lagging = [...harness.store.get(doc.id).files, { path: 'later.css', revision: 1 } as DesignDocFileMeta];
    const view = mount(harness, doc.id, { path: 'gap.html', files: lagging });
    await findFrame();
    await waitFor(() => expect(renderCalls(harness)).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(renderCalls(harness)).toHaveLength(2);

    harness.store.writeFile(doc.id, { path: 'later.css', content: 'p { margin: 0 }' }, UI_USER);
    view.rerender({ files: harness.store.get(doc.id).files });
    await waitFor(() => expect(screen.getByTitle('gap.html').getAttribute('srcdoc')).toContain('p { margin: 0 }'));
  });

  it('previews drafts as they are typed', async () => {
    const { harness, doc } = setup();
    const view = mount(harness, doc.id, { draft: '<p>first draft</p>' });
    const frame = await findFrame();
    expect(frame.getAttribute('srcdoc')).toContain('first draft');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open in browser' })).toBeNull();
    expect(renderCalls(harness).at(-1)!.input).toMatchObject({ doc: doc.id, path: 'index.html', draft: '<p>first draft</p>' });

    view.rerender({ draft: '<p>second</p>' });
    view.rerender({ draft: '<p>second draft</p>' });
    expect(frame.getAttribute('srcdoc')).toContain('first draft');
    await waitFor(() => expect(screen.getByTitle('index.html').getAttribute('srcdoc')).toContain('second draft'), { timeout: DRAFT_DELAY_MS * 4 });
    expect(renderCalls(harness).filter((call) => (call.input as { draft?: string }).draft === '<p>second</p>')).toEqual([]);

    view.rerender({ draft: 'x'.repeat(MAX_RPC_PAYLOAD_BYTES) });
    expect(await screen.findByText('This draft is too large to preview. Save it to see the page.', {}, { timeout: DRAFT_DELAY_MS * 4 })).toBeTruthy();
    expect(screen.getByTitle('index.html').getAttribute('srcdoc')).toContain('second draft');
  });

  it('opens the standalone page in the browser', async () => {
    const open = vi.fn();
    vi.stubGlobal('open', open);
    const { harness, doc } = setup({ pageUrl: (docId, path) => `http://127.0.0.1:8780/page?doc=${docId}&path=${path}` });
    mount(harness, doc.id);
    await findFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
    await waitFor(() => expect(open).toHaveBeenCalledWith(`http://127.0.0.1:8780/page?doc=${doc.id}&path=index.html`, '_blank', 'noopener,noreferrer'));
  });

  it('says so when standalone pages are not served', async () => {
    const { harness, doc } = setup();
    mount(harness, doc.id);
    await findFrame();
    fireEvent.click(screen.getByRole('button', { name: 'Open in browser' }));
    await waitFor(() => expect(harness.toasts).toContainEqual({ message: 'standalone pages are not served here', kind: 'error' }));
  });
});
