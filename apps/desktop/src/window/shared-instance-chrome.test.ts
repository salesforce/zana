import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ views: [] as any[] }));
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events');
  const { Window } = await import('happy-dom');
  return { WebContentsView: class {
    options: unknown;
    webContents = Object.assign(new EventEmitter(), {
      url: '', destroyed: false,
      setWindowOpenHandler: vi.fn(),
      getURL() { return this.url; },
      html: '',
      async loadURL(url: string) { this.url = url; this.html = ''; },
      executeJavaScript: vi.fn(async function (this: any, code: string) {
        const dom = new Window({ url: this.url });
        dom.document.write(this.html || decodeURIComponent(this.url.split(',').slice(1).join(',')));
        dom.eval(code);
        this.html = dom.document.documentElement.outerHTML;
        await dom.happyDOM.close();
      }),
      isDestroyed() { return this.destroyed; },
      focus: vi.fn(),
      close: vi.fn()
    });
    setBackgroundColor = vi.fn(); setBounds = vi.fn();
    constructor(options: unknown) { this.options = options; h.views.push(this); }
  } };
});
import { SharedInstanceChrome } from './shared-instance-chrome.js';
import { sharedChromeHtml, type SharedChromeState } from './shared-instance-chrome-html.js';

const selected = { id: 'instance-id', instanceId: 'authority-id', name: 'Studio Mac', url: 'https://studio.zana-ide.com', online: true };
let win: any, chrome: SharedInstanceChrome;
let actions: { list: ReturnType<typeof vi.fn>; signIn: ReturnType<typeof vi.fn>; select: ReturnType<typeof vi.fn>; local: ReturnType<typeof vi.fn>; retry: ReturnType<typeof vi.fn>; quit: ReturnType<typeof vi.fn> };
const view = () => h.views.at(-1);
const html = () => view().webContents.html || decodeURIComponent(view().webContents.url.split(',').slice(1).join(','));
async function command(url: string) {
  const event = { preventDefault: vi.fn() };
  view().webContents.emit('will-navigate', event, url);
  await new Promise(resolve => setImmediate(resolve));
  expect(event.preventDefault).toHaveBeenCalled();
}
beforeEach(() => {
  h.views.length = 0;
  win = Object.assign(new EventEmitter(), { destroyed: false, isDestroyed() { return this.destroyed; }, getContentSize: () => [1360, 900], webContents: Object.assign(new EventEmitter(), { getURL: () => selected.url }), contentView: { addChildView: vi.fn(), removeChildView: vi.fn() } });
  actions = { list: vi.fn().mockResolvedValue([selected]), signIn: vi.fn().mockResolvedValue(undefined), select: vi.fn().mockResolvedValue(undefined), local: vi.fn(), retry: vi.fn().mockResolvedValue(undefined), quit: vi.fn() };
  chrome = new SharedInstanceChrome(win, selected, false, actions);
});
afterEach(() => chrome.close());

it('owns an isolated, preload-free view with bounded placement and releases it on window close', async () => {
  expect(view().options.webPreferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
  expect(win.contentView.addChildView).toHaveBeenCalledWith(view());
  expect(view().setBounds).toHaveBeenLastCalledWith({ x: 900, y: 0, width: 360, height: 32 });
  expect(view().webContents.setWindowOpenHandler.mock.calls[0][0]()).toEqual({ action: 'deny' });
  for (const name of ['will-redirect', 'will-attach-webview']) {
    const preventDefault = vi.fn(); view().webContents.emit(name, { preventDefault }); expect(preventDefault).toHaveBeenCalled();
  }
  win.getContentSize = () => [300, 200]; win.emit('resize');
  await command('zcc-instance://toggle');
  expect(view().setBounds).toHaveBeenLastCalledWith({ x: 8, y: 0, width: 192, height: 200 });
  expect(html()).toContain('aria-expanded="true"');
  win.emit('closed'); chrome.close();
  expect(win.listenerCount('resize')).toBe(0);
  expect(win.listenerCount('blur')).toBe(0);
  expect(win.contentView.removeChildView).toHaveBeenCalledOnce();
  expect(view().webContents.close).toHaveBeenCalledOnce();
});

it('returns and quits without a remote dependency, including unavailable states', async () => {
  chrome.unavailable();
  await command('zcc-instance://toggle');
  expect(html()).toContain('Unavailable'); expect(html()).toContain('Studio Mac');
  await command('zcc-instance://local'); await command('zcc-instance://quit');
  expect(actions.local).toHaveBeenCalledOnce(); expect(actions.quit).toHaveBeenCalledOnce();
  expect(actions.list).not.toHaveBeenCalled();
  await command('zcc-instance://retry'); expect(actions.retry).toHaveBeenCalledOnce();
});

it('lists account instances and revalidates selections through the main authority', async () => {
  await command('zcc-instance://pick'); expect(actions.list).not.toHaveBeenCalled();
  await command('zcc-instance://toggle'); await command('zcc-instance://pick');
  expect(html()).toContain('Open another computer'); expect(html()).toContain('Refresh computers');
  await command('zcc-instance://select/forged'); expect(actions.select).not.toHaveBeenCalled();
  await command('zcc-instance://select/instance-id'); expect(actions.select).toHaveBeenCalledWith('instance-id');
  await command('zcc-instance://refresh'); expect(actions.list).toHaveBeenCalledTimes(2);
  actions.list.mockResolvedValueOnce([{ ...selected, online: false }]);
  await command('zcc-instance://refresh'); expect(html()).toContain('Offline');
  await command('zcc-instance://select/instance-id'); expect(actions.select).toHaveBeenCalledOnce();
});

it('offers browser sign-in on expiry and handles empty, unavailable and non-Error responses', async () => {
  await command('zcc-instance://toggle');
  actions.list.mockRejectedValueOnce(new Error('Sign in to your Zana account'));
  await command('zcc-instance://pick'); expect(html()).toContain('Sign in to find your computers');
  actions.list.mockResolvedValueOnce([]);
  await command('zcc-instance://signin'); expect(actions.signIn).toHaveBeenCalledOnce(); expect(html()).toContain('No computers found');
  actions.list.mockRejectedValueOnce('offline');
  await command('zcc-instance://refresh'); expect(html()).toContain('Check your connection');
  actions.signIn.mockRejectedValueOnce(new Error('browser unavailable'));
  await command('zcc-instance://signin'); expect(html()).toContain('Check your connection');
});

it('keeps local and quit available during a pending account check and ignores completions after shutdown', async () => {
  await command('zcc-instance://toggle');
  let finish!: (rows: unknown[]) => void;
  actions.list.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await command('zcc-instance://pick'); expect(html()).toContain('role="status"');
  await command('zcc-instance://refresh'); expect(actions.list).toHaveBeenCalledOnce();
  await command('zcc-instance://local'); await command('zcc-instance://quit');
  expect(actions.local).toHaveBeenCalledOnce(); expect(actions.quit).toHaveBeenCalledOnce();
  chrome.close(); const before = view().webContents.url;
  finish([selected]); await new Promise(resolve => setImmediate(resolve));
  chrome.unavailable(); expect(view().webContents.url).toBe(before);
  await command('zcc-instance://local'); expect(actions.local).toHaveBeenCalledOnce();
});

it('closes on Escape commands and blur, rejects forged sources and all other navigation', async () => {
  for (const value of ['https://evil.example', 'zcc-instance://local?x=1', 'zcc-instance://local#x', 'zcc-instance://user@local', 'zcc-instance://local:30', 'zcc-instance://unknown', 'zcc-instance://pick/extra']) await command(value);
  expect(actions.local).not.toHaveBeenCalled(); expect(actions.list).not.toHaveBeenCalled();
  await command('zcc-instance://toggle'); await command('zcc-instance://pick/extra'); expect(actions.list).not.toHaveBeenCalled();
  await command('zcc-instance://close'); expect(html()).toContain('aria-expanded="false"');
  view().webContents.emit('blur'); await command('zcc-instance://toggle'); view().webContents.emit('blur');
  expect(html()).toContain('aria-expanded="false"');
  view().webContents.url = 'https://attacker.example';
  await command('zcc-instance://local'); expect(actions.local).not.toHaveBeenCalled();
  // Invalid URLs are contained rather than escaping the navigation callback.
  chrome.unavailable(); await command('invalid'); expect(html()).toContain('aria-expanded="false"');
});

it('escapes account text and error messages while keeping the chrome CSP strict', () => {
  const state: SharedChromeState = { selected: { ...selected, name: '<script>"&\'</script>' }, unavailable: true, expanded: true, picking: true, busy: false, needsSignIn: true, instances: [selected, { ...selected, online: false }], message: '<img src=x onerror=alert(1)>' };
  const result = sharedChromeHtml(state);
  expect(result).not.toContain('<img'); expect(result).not.toContain('<script>');
  expect(result).toContain('&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  expect(result).toContain("default-src 'none'"); expect(result).toContain('nonce-');
  expect(result).toContain('Sign in to find your computers');
  expect(sharedChromeHtml({ ...state, selected: undefined, busy: true })).toContain('Another computer');
  expect(sharedChromeHtml({ ...state, expanded: false })).not.toContain('class="panel"');
  chrome.close(); view().webContents.destroyed = true; win.destroyed = true; chrome.close();
});


it('keeps an expanding menu through document-replacement blur and focuses its new frame', async () => {
  const wc = view().webContents;
  let finish!: () => void;
  wc.loadURL = vi.fn((url: string) => {
    wc.url = url;
    wc.emit('blur');
    return new Promise<void>(resolve => { finish = resolve; });
  });
  await command('zcc-instance://toggle');
  expect(html()).toContain('aria-expanded="true"');
  expect(wc.focus).not.toHaveBeenCalled();
  finish(); await new Promise(resolve => setImmediate(resolve));
  expect(wc.focus).toHaveBeenCalledOnce();
  wc.emit('blur');
  expect(html()).toContain('aria-expanded="false"');
  finish(); await new Promise(resolve => setImmediate(resolve));
});

it('dismisses on window blur during a replacement and ignores stale or closed frame completions', async () => {
  const wc = view().webContents;
  const pending: Array<() => void> = [];
  wc.loadURL = vi.fn((url: string) => {
    wc.url = url;
    return new Promise<void>(resolve => { pending.push(resolve); });
  });
  await command('zcc-instance://toggle');
  win.emit('blur');
  expect(html()).toContain('aria-expanded="false"');
  pending[0]!(); await new Promise(resolve => setImmediate(resolve));
  expect(wc.focus).not.toHaveBeenCalled();
  chrome.close();
  pending[1]!(); await new Promise(resolve => setImmediate(resolve));
  expect(wc.focus).not.toHaveBeenCalled();
});

it('recovers its blur dismissal after a rejected document load', async () => {
  const wc = view().webContents;
  wc.loadURL = vi.fn(async (url: string) => { wc.url = url; throw new Error('load failed'); });
  await command('zcc-instance://toggle');
  wc.emit('blur');
  expect(html()).toContain('aria-expanded="false"');
});

it('shows connection progress until the selected product document finishes loading', async () => {
  await new Promise(resolve => setImmediate(resolve));
  expect(html()).toContain('Connecting to Studio Mac');
  win.webContents.getURL = () => 'https://zana-ide.com/connect/';
  win.webContents.emit('did-finish-load'); expect(html()).toContain('Connecting to Studio Mac');
  win.webContents.getURL = () => selected.url + '/_connect/callback?code=public';
  win.webContents.emit('did-finish-load'); expect(html()).toContain('Connecting to Studio Mac');
  win.webContents.getURL = () => selected.url + '/';
  win.webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  expect(html()).toContain('Connected to Studio Mac');
  chrome.unavailable(); expect(html()).toContain('Unavailable');
  win.webContents.getURL = () => 'invalid'; win.webContents.emit('did-finish-load');
  expect(html()).toContain('Unavailable');
  chrome.close(); expect(win.webContents.listenerCount('did-finish-load')).toBe(0);
});

it('updates status without replacing the frame or losing a simultaneous menu action', async () => {
  await new Promise(resolve => setImmediate(resolve));
  const wc = view().webContents;
  const displayed = wc.url;
  wc.loadURL = vi.fn(async () => {});
  win.webContents.emit('did-finish-load');
  expect(wc.url).toBe(displayed);
  await command('zcc-instance://local'); expect(actions.local).toHaveBeenCalledOnce();
  expect(html()).toContain('Connected to Studio Mac');
  win.webContents.emit('did-finish-load');
  expect(wc.loadURL).not.toHaveBeenCalled();
  expect(wc.executeJavaScript).toHaveBeenCalledOnce();
  wc.url = 'https://attacker.example';
  await command('zcc-instance://local');
  expect(actions.local).toHaveBeenCalledOnce();
});

it('applies a queued connection update after its frame settles and contains closed-frame failures', async () => {
  // Constructor render is still pending when this event arrives.
  win.webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
  expect(html()).toContain('Connected to Studio Mac');
  expect(view().webContents.executeJavaScript).toHaveBeenCalledOnce();
  chrome.unavailable(); await new Promise(resolve => setImmediate(resolve));
  view().webContents.executeJavaScript.mockRejectedValueOnce(new Error('frame closed'));
  win.webContents.emit('did-finish-load');
  await new Promise(resolve => setImmediate(resolve));
});
