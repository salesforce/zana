import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ dir: '', windows: [] as any[], fetch: vi.fn(), clear: vi.fn(), close: vi.fn(), login: vi.fn(), cookie: vi.fn(), external: vi.fn(), permissions: [] as Function[], menus: [] as any[], failLoad: false, chrome: [] as any[], dock: vi.fn(), quit: vi.fn() }));
vi.mock('./shared-instance-chrome.js', () => ({ SharedInstanceChrome: class { unavailable = vi.fn(); constructor(...args: unknown[]) { state.chrome.push({ args, instance: this }); } } }));
vi.mock('./shared-sign-in.js', () => ({ SHARED_ACCOUNT: 'https://zana-ide.com', signInWithBrowser: state.login }));
vi.mock('@zana-ai/zcc-server/electron-data-dir', () => ({ electronZccDataDir: () => state.dir }));
vi.mock('electron', () => {
  class Emitter {
    listeners = new Map<string, Function[]>();
    on(name: string, fn: Function) { this.listeners.set(name, [...(this.listeners.get(name) ?? []), fn]); }
    once(name: string, fn: Function) { this.on(name, fn); }
    emit(name: string, ...args: unknown[]) { for (const fn of this.listeners.get(name) ?? []) fn(...args); }
  }
  return {
    app: { dock: { setMenu: state.dock }, quit: state.quit },
    BrowserWindow: class extends Emitter {
      options: any; destroyed = false; url = ''; visible = true; menu: any;
      webContents = Object.assign(new Emitter(), { id: state.windows.length + 1 });
      constructor(options: any) { super(); this.options = options; state.windows.push(this); }
      destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('closed'); } }
      isDestroyed() { return this.destroyed; }
      show() { this.visible = true; }
      focus() {}
      setMenu(menu: any) { this.menu = menu; }
      async loadURL(url: string) { this.url = url; if (state.failLoad && url.startsWith('https://')) throw new Error('offline'); }
    },
    Menu: { buildFromTemplate: (template: unknown) => { const menu = { template, popup: vi.fn() }; state.menus.push(menu); return menu; } },
    shell: { openExternal: state.external },
    session: { fromPartition: () => ({ fetch: state.fetch, cookies: { set: state.cookie }, clearStorageData: state.clear, closeAllConnections: state.close, setPermissionCheckHandler(fn: Function) { state.permissions.push(fn); }, setPermissionRequestHandler(fn: Function) { state.permissions.push(fn); } }) }
  };
});
import { SharedClient, allowsSharedNavigation } from './shared-client.js';
import { writeSharedTarget } from './shared-target.js';
let client: SharedClient;
let show: ReturnType<typeof vi.fn>, hide: ReturnType<typeof vi.fn>;
const serverId = randomUUID(), instanceId = randomUUID();
const account = { servers: [{ id: serverId, instanceId, name: 'Shared', browserUrl: 'https://owned.zana-ide.com', live: true }] };
beforeEach(() => {
  state.dir = mkdtempSync(join(tmpdir(), 'shared-client-')); state.windows = []; state.menus = []; state.chrome = []; state.permissions = []; state.failLoad = false; state.dock.mockClear(); state.quit.mockClear();
  state.fetch.mockReset().mockImplementation(async () => Response.json(account)); state.clear.mockReset(); state.close.mockReset();
  state.login.mockReset().mockResolvedValue({ cookieValue: 'account-session', expiresAt: Date.now() + 60_000 }); state.cookie.mockReset(); state.external.mockReset();
  show = vi.fn(); hide = vi.fn(); client = new SharedClient(show, hide);
});
afterEach(() => { client.close(); rmSync(state.dir, { recursive: true, force: true }); });
it('selects owned identities, destroys prior documents, and restricts navigation to registered isolated windows', async () => {
  await expect(client.select({ url: 'https://evil' })).rejects.toThrow('account-owned');
  await expect(client.select(randomUUID())).rejects.toThrow('unavailable');
  await client.select(serverId);
  const win = state.windows.at(-1);
  expect(win.options.webPreferences).toMatchObject({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false });
  expect(win.options.webPreferences.preload).toBeUndefined();
  expect(hide).toHaveBeenCalledOnce();
  expect(allowsSharedNavigation(win.webContents, win.url)).toBe(true);
  expect(allowsSharedNavigation(win.webContents, 'https://evil.example')).toBe(false);
  expect(allowsSharedNavigation(win.webContents, ':invalid')).toBe(false);
  expect(allowsSharedNavigation({ id: 999 } as any, win.url)).toBe(false);
  const deny = vi.fn(); win.webContents.emit('will-attach-webview', { preventDefault: deny }); expect(deny).toHaveBeenCalled();
  expect(client.showSelected()).toBe(true);
  await client.select(serverId); expect(win.destroyed).toBe(true); expect(allowsSharedNavigation(win.webContents, win.url)).toBe(false);
  client.local(); expect(client.target()).toEqual({ kind: 'local' }); expect(show).toHaveBeenCalledOnce(); expect(client.showSelected()).toBe(false);
});
it('fences late selection and keeps offline or damaged saved targets away from local product state', async () => {
  let resolve!: (value: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>(done => { resolve = done; }));
  const pending = client.select(serverId); client.local(); resolve(Response.json(account));
  await expect(pending).rejects.toThrow('selection changed'); expect(state.windows).toHaveLength(0);
  writeSharedTarget(join(state.dir, 'shared-target.json'), { kind: 'connect', serverId, instanceId });
  show.mockClear(); state.fetch.mockResolvedValueOnce(new Response('', { status: 401 }));
  await client.restore(); expect(state.windows.at(-1).url).toContain('data:text/html'); expect(show).not.toHaveBeenCalled();
  state.failLoad = true; await client.restore(); await Promise.resolve();
  expect(state.windows.at(-1).url).toContain('data:text/html');
  writeFileSync(join(state.dir, 'shared-target.json'), '{'); await client.restore(); expect(client.showSelected()).toBe(true); expect(show).not.toHaveBeenCalled();
});
it('bounds account responses and signs out without exposing credentials to content', async () => {
  for (const response of [new Response('', { status: 401 }), new Response('', { status: 503 }), new Response(null), new Response('x'.repeat(128 * 1024 + 1))]) {
    state.fetch.mockResolvedValueOnce(response); await expect(client.instances()).rejects.toThrow();
  }
  const first = client.signIn(); expect(client.signIn()).toBe(first); await first;
  expect(state.windows).toHaveLength(0); expect(state.login).toHaveBeenCalledOnce();
  expect(state.cookie).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://zana-ide.com', name: 'zcc_session', value: 'account-session', secure: true, httpOnly: true, sameSite: 'lax' }));
  await client.select(serverId); await client.signOut();
  expect(state.clear).toHaveBeenCalledOnce(); expect(state.close).toHaveBeenCalledOnce();
  expect(state.windows.every(win => win.destroyed)).toBe(true); expect(client.target()).toEqual({ kind: 'local' });
});
it('restores the exact saved instance and refuses revoked or rebound selections', async () => {
  await client.restore(); expect(state.windows).toHaveLength(0);
  writeSharedTarget(join(state.dir, 'shared-target.json'), { kind: 'connect', serverId, instanceId });
  await client.restore(); expect(state.windows.at(-1).url).toBe('https://owned.zana-ide.com');
  state.fetch.mockResolvedValueOnce(Response.json({ servers: [{ ...account.servers[0], instanceId: randomUUID() }] }));
  await client.restore(); expect(state.windows.at(-1).url).toContain('data:text/html'); expect(show).not.toHaveBeenCalled();
});
it('keeps recovery menu actions in the shared context and denies local OS permissions', async () => {
  await client.select(serverId);
  const win = state.windows.at(-1), menu = win.menu;
  win.webContents.emit('context-menu'); expect(menu.popup).toHaveBeenCalledWith({ window: win });
  expect(state.permissions[0]!()).toBe(false);
  const permission = vi.fn(); state.permissions[1]!(null, 'media', permission); expect(permission).toHaveBeenCalledWith(false);
  menu.template[0].submenu.find((row: any) => row.label === 'Reload shared instance').click();
  expect(win.url).toBe('https://owned.zana-ide.com');
  menu.template[0].submenu.find((row: any) => row.label === 'Return to this computer').click();
  expect(show).toHaveBeenCalled();
  await client.select(serverId);
  state.windows.at(-1).menu.template[0].submenu.find((row: any) => row.label === 'Sign out of shared access').click();
  await vi.waitFor(() => expect(state.clear).toHaveBeenCalledOnce());
  await client.signOut();
  writeSharedTarget(join(state.dir, 'shared-target.json'), { kind: 'connect', serverId, instanceId });
  state.fetch.mockResolvedValueOnce(new Response('', { status: 401 })); await client.restore();
  const notice = state.windows.at(-1), actions = state.menus.findLast(menu => menu.template.some((row: any) => row.label === 'Sign in'));
  notice.webContents.emit('context-menu'); expect(actions.popup).toHaveBeenCalled();
  actions.template.find((row: any) => row.label === 'Sign in').click();
  expect(state.login).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(state.windows.at(-1).url).toBe('https://owned.zana-ide.com'));
  actions.template.find((row: any) => row.label === 'Retry shared instance').click();
  await vi.waitFor(() => expect(state.windows.at(-1).url).toBe('https://owned.zana-ide.com'));
  actions.template.find((row: any) => row.label === 'Return to this computer').click();
  expect(client.target()).toEqual({ kind: 'local' });
});
it('exposes matching desktop chrome and Dock actions without granting a product preload', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin');
  try {
    await client.select(serverId);
    const chrome = state.chrome.at(-1);
    expect(chrome.args[1]).toMatchObject({ name: 'Shared' });
    const actions = chrome.args[3];
    expect(await actions.list()).toHaveLength(1);
    await actions.signIn(); await actions.select(serverId);
    actions.quit(); expect(state.quit).toHaveBeenCalledOnce();
    const dock = state.dock.mock.calls.at(-1)![0];
    dock.template.find((row: any) => row.label === 'Quit Zana').click();
    expect(state.quit).toHaveBeenCalledTimes(2);
    dock.template.find((row: any) => row.label === 'Return to this computer').click();
    expect(state.dock.mock.calls.at(-1)![0].template).toEqual([]);
    await client.select(serverId); await state.chrome.at(-1).args[3].retry();
    state.chrome.at(-1).args[3].local(); expect(client.target()).toEqual({ kind: 'local' });
  } finally { vi.restoreAllMocks(); }
});
it('serializes sign-out, refuses selection during it and closes connections even if storage clearing fails', async () => {
  await client.select(serverId);
  let finish!: () => void;
  state.clear.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = client.signOut(), second = client.signOut();
  await expect(client.select(serverId)).rejects.toThrow('Sign-out');
  await expect(client.signIn()).rejects.toThrow('Sign-out'); expect(state.windows.every(win => win.destroyed)).toBe(true);
  finish(); await Promise.all([first, second]); expect(state.clear).toHaveBeenCalledOnce();
  state.clear.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(client.signOut()).rejects.toThrow('storage unavailable'); expect(state.close).toHaveBeenCalledTimes(2);
  expect(client.target()).toEqual({ kind: 'local' });
});
it('does not resurrect an instance after the user returns locally during restore', async () => {
  writeSharedTarget(join(state.dir, 'shared-target.json'), { kind: 'connect', serverId, instanceId });
  let finish!: (response: Response) => void;
  state.fetch.mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }));
  const restore = client.restore(); client.local(); finish(Response.json(account)); await restore;
  expect(state.windows.every(win => win.destroyed)).toBe(true); expect(client.target()).toEqual({ kind: 'local' });
  writeSharedTarget(join(state.dir, 'shared-target.json'), { kind: 'connect', serverId, instanceId });
  expect(client.showSelected()).toBe(true);
  await vi.waitFor(() => expect(state.windows.at(-1).url).toBe('https://owned.zana-ide.com'));
});

it('propagates browser failures, allows retry, and delegates external opening through main', async () => {
  state.login.mockRejectedValueOnce(new Error('No browser'));
  await expect(client.signIn()).rejects.toThrow('No browser');
  state.login.mockImplementationOnce(async (deps: any) => {
    await deps.openExternal('https://zana-ide.com/connect/?desktop=public');
    await deps.fetch('https://zana-ide.com/api/connect/desktop/start/', { method: 'POST' });
    return { cookieValue: 'session', expiresAt: Date.now() + 60_000 };
  });
  await client.signIn();
  expect(state.external).toHaveBeenCalledOnce(); expect(state.cookie).toHaveBeenCalledOnce();
  expect(state.windows).toHaveLength(0);
});
it('aborts pending login on sign-out and cannot install a late session', async () => {
  let finish!: (value: unknown) => void;
  state.login.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const pending = client.signIn(); const rejected = expect(pending).rejects.toThrow();
  const out = client.signOut();
  expect(state.login.mock.calls[0][1].aborted).toBe(true);
  finish({ cookieValue: 'late', expiresAt: Date.now() + 60_000 });
  await rejected; await out;
  expect(state.cookie).not.toHaveBeenCalled(); expect(state.clear).toHaveBeenCalledOnce();
});
it('drains a cookie installation before clearing storage on sign-out', async () => {
  let finish!: () => void;
  state.cookie.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const pending = client.signIn();
  await vi.waitFor(() => expect(state.cookie).toHaveBeenCalledOnce());
  const out = client.signOut(); expect(state.clear).not.toHaveBeenCalled();
  finish(); await pending; await out;
  expect(state.clear).toHaveBeenCalledOnce();
});
