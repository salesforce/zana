import { app, BrowserWindow, Menu, session, shell, type WebContents } from 'electron';
import { join } from 'node:path';
import { electronZccDataDir } from '@zana-ai/zcc-server/electron-data-dir';
import { accountInstances, readSharedTarget, writeSharedTarget, type SharedInstance, type SharedTarget } from './shared-target.js';
import { SHARED_ACCOUNT as ACCOUNT, signInWithBrowser } from './shared-sign-in.js';
import { SharedInstanceChrome } from './shared-instance-chrome.js';

const ownedContents = new Map<number, Set<string>>();
/** Exemption is scoped to isolated, preload-free web clients created by main. */
export function allowsSharedNavigation(contents: WebContents, value: string): boolean {
  try { return ownedContents.get(contents.id)?.has(new URL(value).origin) === true; } catch { return false; }
}
function register(win: BrowserWindow, origins: string[]) {
  ownedContents.set(win.webContents.id, new Set(origins));
  const id = win.webContents.id;
  win.once('closed', () => ownedContents.delete(id));
  win.webContents.on('will-attach-webview', event => event.preventDefault());
}

export class SharedClient {
  private window: BrowserWindow | null = null;
  private login: { controller: AbortController; promise: Promise<void> } | null = null;
  private generation = 0;
  private signingOut: Promise<void> | null = null;
  private readonly file = join(electronZccDataDir(), 'shared-target.json');
  private readonly partition = 'persist:zcc-shared-account';
  constructor(private readonly showLocal: () => void, private readonly hideLocal: () => void) {}
  private clientSession() {
    const value = session.fromPartition(this.partition);
    value.setPermissionCheckHandler(() => false);
    value.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    return value;
  }
  target(): SharedTarget { return readSharedTarget(this.file); }
  /** Dock/menu activation keeps the chosen authority, including offline states. */
  showSelected(): boolean {
    try { if (this.target().kind === 'local') return false; }
    catch { this.notice('The saved instance selection is damaged. Choose Return to this computer to reset it.'); return true; }
    if (this.window && !this.window.isDestroyed()) { this.window.show(); this.window.focus(); }
    else void this.restore();
    return true;
  }
  async instances(): Promise<SharedInstance[]> {
    if (this.signingOut) throw new Error('Sign-out is in progress');
    const response = await this.clientSession().fetch(`${ACCOUNT}/api/connect/account`, { redirect: 'error', credentials: 'include', signal: AbortSignal.timeout(12_000) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(response.status === 401 ? 'Sign in to your Zana account, then refresh the instances.' : 'Connect is unavailable. Try again.'); }
    const reader = response.body?.getReader(); if (!reader) throw new Error('Empty account response');
    const chunks: Uint8Array[] = []; let size = 0;
    try { for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.length; if (size > 128 * 1024) { await reader.cancel(); throw new Error('Account response too large'); } chunks.push(value); } }
    finally { reader.releaseLock(); }
    return accountInstances(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  signIn(): Promise<void> {
    if (this.signingOut) return Promise.reject(new Error('Sign-out is in progress'));
    if (this.login) return this.login.promise;
    const controller = new AbortController();
    const promise = (async () => {
      try {
        const result = await signInWithBrowser({ fetch: (url, init) => this.clientSession().fetch(url, init), openExternal: url => shell.openExternal(url) }, controller.signal);
        controller.signal.throwIfAborted();
        await this.clientSession().cookies.set({ url: ACCOUNT, name: 'zcc_session', value: result.cookieValue,
          path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: result.expiresAt / 1000 });
      } finally { this.login = null; }
    })();
    this.login = { controller, promise };
    return promise;
  }
  async select(serverId: unknown): Promise<void> {
    if (typeof serverId !== 'string' || serverId.length > 64) throw new Error('Choose an account-owned instance');
    const generation = ++this.generation;
    const instances = await this.instances();
    if (generation !== this.generation) throw new Error('Instance selection changed');
    const selected = instances.find(row => row.id === serverId);
    if (!selected) throw new Error('This instance is unavailable or no longer belongs to your account');
    writeSharedTarget(this.file, { kind: 'connect', serverId: selected.id, instanceId: selected.instanceId });
    this.open(selected);
  }
  private open(selected: SharedInstance): void {
    // Destroying the old document cancels its subscriptions, requests and in-memory caches.
    // Each HTTPS origin retains its own unsent drafts in its normal browser storage.
    this.window?.destroy();
    const win = new BrowserWindow({ width: 1360, height: 900, title: `${selected.name} · Shared Zana`, webPreferences: { session: this.clientSession(), sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
    this.window = win; register(win, [selected.url, ACCOUNT, 'https://github.com']);
    const menu = Menu.buildFromTemplate([{ label: 'Zana instance', submenu: [
      { label: selected.name, enabled: false },
      { label: 'Reload shared instance', click: () => { void win.loadURL(selected.url).catch(() => {}); } },
      { label: 'Return to this computer', click: () => this.local() },
      { label: 'Quit Zana', click: () => app.quit() },
      { label: 'Sign out of shared access', click: () => { void this.signOut().catch(() => this.notice('Sign-out could not clear the saved account session. Close Zana and try signing out again.')); } }
    ] }]);
    win.setMenu(menu);
    win.webContents.on('context-menu', () => menu.popup({ window: win }));
    win.once('closed', () => { if (this.window === win) this.window = null; });
    const chrome = this.chrome(win, selected, false);
    this.hideLocal();
    void win.loadURL(selected.url).catch(() => {
      if (win.isDestroyed()) return;
      chrome.unavailable();
      // Keep a shared-only error document. Never substitute local product data.
      void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><title>Shared Zana unavailable</title><body style="font:16px system-ui;padding:64px 40px"><h1>Shared Zana is unavailable</h1><p>Keep the primary computer running and check your connection. Use the switcher above to retry or return to this computer.</p></body>'));
    });
  }
  private chrome(win: BrowserWindow, selected: SharedInstance | undefined, unavailable: boolean): SharedInstanceChrome {
    if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([
      { label: selected?.name ?? 'Another Zana', enabled: false },
      { label: 'Return to this computer', click: () => this.local() },
      { type: 'separator' },
      { label: 'Quit Zana', click: () => app.quit() }
    ]));
    return new SharedInstanceChrome(win, selected, unavailable, {
      list: () => this.instances(), signIn: () => this.signIn(), select: id => this.select(id),
      local: () => this.local(), retry: () => this.restore(), quit: () => app.quit()
    });
  }
  local(): void { ++this.generation; writeSharedTarget(this.file, { kind: 'local' }); this.window?.destroy(); this.window = null; if (process.platform === 'darwin') app.dock?.setMenu(Menu.buildFromTemplate([])); this.showLocal(); }
  async signOut(): Promise<void> {
    if (this.signingOut) return this.signingOut;
    this.local(); this.login?.controller.abort();
    const login = this.login?.promise;
    this.signingOut = (async () => {
      // Drain an in-flight cookie write before clearing the account partition.
      await login?.catch(() => {});
      try { await this.clientSession().clearStorageData(); }
      finally { await this.clientSession().closeAllConnections(); }
    })();
    try { await this.signingOut; }
    finally { ++this.generation; this.signingOut = null; }
  }
  async restore(): Promise<void> {
    let target: SharedTarget;
    try { target = this.target(); }
    catch { this.notice('The saved instance selection is damaged. Choose Return to this computer to reset it.'); return; }
    if (target.kind !== 'connect') return;
    const generation = ++this.generation;
    this.notice('Connecting to your saved Zana instance…');
    try {
      const instances = await this.instances();
      if (generation !== this.generation) return;
      const selected = instances.find(row => row.id === target.serverId && row.instanceId === target.instanceId);
      if (!selected) throw new Error('The saved instance is unavailable or requires an update.');
      this.open(selected);
    } catch {
      if (generation === this.generation) this.notice('Your shared instance is unavailable. Use the switcher above to sign in or retry.');
    }
  }
  private notice(message: string): void {
    this.window?.destroy();
    const win = new BrowserWindow({ width: 800, height: 480, title: 'Shared Zana', webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
    this.window = win; this.hideLocal();
    const menu = Menu.buildFromTemplate([
      { label: 'Sign in', click: () => { void this.signIn().then(() => this.restore()).catch(() => {}); } },
      { label: 'Retry shared instance', click: () => { void this.restore(); } },
      { label: 'Return to this computer', click: () => this.local() },
      { label: 'Quit Zana', click: () => app.quit() }
    ]);
    win.webContents.on('context-menu', () => menu.popup({ window: win }));
    win.once('closed', () => { if (this.window === win) this.window = null; });
    this.chrome(win, undefined, true);
    void win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><meta charset="utf-8"><title>Shared Zana</title><body style="font:18px system-ui;padding:64px 48px"><h1>Shared Zana</h1><p>${message}</p><p>Use the switcher above to sign in, retry, or return to this computer.</p></body>`));
  }
  close(): void { ++this.generation; this.window?.destroy(); this.login?.controller.abort(); }
}
