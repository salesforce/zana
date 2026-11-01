import { WebContentsView, type BrowserWindow } from 'electron';
import { sharedChromeHtml, type SharedChromeState } from './shared-instance-chrome-html.js';
import type { SharedInstance } from './shared-target.js';

interface ChromeActions {
  list(): Promise<SharedInstance[]>;
  signIn(): Promise<void>;
  select(id: string): Promise<void>;
  local(): void;
  retry(): Promise<void>;
  quit(): void;
}

/** A separate view keeps desktop controls outside the untrusted shared document. */
export class SharedInstanceChrome {
  private readonly view = new WebContentsView({ webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false } });
  private readonly state: SharedChromeState;
  private documentUrl = '';
  private pendingConnectionUpdate = false;
  private closed = false;
  private renderGeneration = 0;
  private rendering = false;
  constructor(private readonly window: BrowserWindow, selected: SharedInstance | undefined, unavailable: boolean, private readonly actions: ChromeActions) {
    this.state = { selected, unavailable, connecting: !unavailable, expanded: false, picking: false, busy: false, needsSignIn: false, instances: [], message: '' };
    this.view.setBackgroundColor('#00000000');
    this.view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    this.view.webContents.on('will-navigate', (event, url) => {
      event.preventDefault();
      // A remote webContents cannot issue commands to this view. Never follow a
      // navigation away from the exact document main just generated either.
      if (this.closed || this.view.webContents.getURL() !== this.documentUrl) return;
      void this.command(url).catch(() => {
        this.state.message = 'Could not complete that action. Try again.';
        this.render();
      });
    });
    this.view.webContents.on('will-redirect', event => event.preventDefault());
    this.view.webContents.on('will-attach-webview', event => event.preventDefault());
    this.view.webContents.on('blur', this.onViewBlur);
    window.contentView.addChildView(this.view);
    window.on('resize', this.layout);
    window.on('blur', this.collapse);
    window.once('closed', this.close);
    window.webContents.on('did-finish-load', this.onDocumentLoaded);
    this.render();
  }
  unavailable(): void { this.state.unavailable = true; this.state.connecting = false; this.render(); }
  private onDocumentLoaded = () => {
    if (this.closed || !this.state.selected) return;
    try {
      const url = new URL(this.window.webContents.getURL());
      if (url.origin !== this.state.selected.url || url.pathname.startsWith('/_connect')) return;
      if (!this.state.connecting && !this.state.unavailable) return;
      this.state.connecting = false; this.state.unavailable = false;
      // Status text must not reload or blur the interactive switcher frame.
      if (this.rendering) this.pendingConnectionUpdate = true;
      else this.updateConnectionText();
    } catch { /* Error documents do not establish a remote connection. */ }
  };
  private updateConnectionText(): void {
    const documentUrl = this.documentUrl;
    const markup = sharedChromeHtml(this.state);
    void this.view.webContents.executeJavaScript(`(() => {
      if (document.URL !== ${JSON.stringify(documentUrl)}) return;
      const next = new DOMParser().parseFromString(${JSON.stringify(markup)}, 'text/html');
      const trigger = document.querySelector('.trigger'), updated = next.querySelector('.trigger');
      if (trigger && updated) for (const attribute of ['title', 'aria-label']) trigger.setAttribute(attribute, updated.getAttribute(attribute));
      for (const selector of ['.trigger span', '.current .status']) {
        const current = document.querySelector(selector), value = next.querySelector(selector);
        if (current && value) current.textContent = value.textContent;
      }
    })()`).catch(() => { /* A replacement or closed frame already has its current state. */ });
  }
  private layout = () => {
    if (this.closed || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const viewWidth = Math.min(this.state.expanded ? 380 : 360, Math.max(1, width - 108));
    this.view.setBounds({ x: Math.max(0, width - 100 - viewWidth), y: 0, width: viewWidth, height: this.state.expanded ? Math.min(620, height) : 32 });
  };
  // Reloading the main-owned document can blur its old frame on Linux. Only
  // dismiss a settled view; leaving the owning window still dismisses at once.
  private onViewBlur = () => { if (!this.rendering) this.collapse(); };
  private collapse = () => {
    if (!this.state.expanded || this.closed) return;
    this.state.expanded = false;
    this.render();
  };
  private render(): void {
    if (this.closed) return;
    this.layout();
    this.pendingConnectionUpdate = false;
    this.documentUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(sharedChromeHtml(this.state));
    const generation = ++this.renderGeneration;
    this.rendering = true;
    void this.view.webContents.loadURL(this.documentUrl).then(() => {
      if (this.closed || generation !== this.renderGeneration) return;
      this.rendering = false;
      if (this.pendingConnectionUpdate) { this.pendingConnectionUpdate = false; this.updateConnectionText(); }
      if (this.state.expanded) this.view.webContents.focus();
    }).catch(() => {
      if (generation === this.renderGeneration) this.rendering = false;
    });
  }
  private async command(value: string): Promise<void> {
    const url = new URL(value);
    if (url.protocol !== 'zcc-instance:' || url.search || url.hash || url.username || url.password || url.port) return;
    if (url.hostname === 'local' && !url.pathname) { this.actions.local(); return; }
    if (url.hostname === 'quit' && !url.pathname) { this.actions.quit(); return; }
    if (url.hostname === 'toggle' && !url.pathname) { this.state.expanded = !this.state.expanded; this.render(); return; }
    if (url.hostname === 'close' && !url.pathname) { this.collapse(); return; }
    if (this.state.busy || !this.state.expanded) return;
    const command = url.hostname;
    if (!['pick', 'refresh', 'signin', 'select', 'retry'].includes(command)) return;
    if (command !== 'select' && url.pathname) return;
    const id = url.pathname.slice(1);
    if (command === 'select' && !this.state.instances.some(row => row.id === id && row.online)) return;
    this.state.busy = true; this.state.message = '';
    if (command !== 'select' && command !== 'retry') this.state.picking = true;
    this.render();
    try {
      if (command === 'select') await this.actions.select(id);
      else if (command === 'retry') await this.actions.retry();
      else {
        if (command === 'signin') await this.actions.signIn();
        this.state.instances = await this.actions.list();
        this.state.needsSignIn = false;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message.includes('Sign in to your Zana account')) { this.state.needsSignIn = true; this.state.instances = []; }
      else this.state.message = 'Could not load this Zana. Check your connection and try again.';
    } finally {
      this.state.busy = false;
      this.render();
    }
  }
  close = () => {
    if (this.closed) return;
    this.closed = true;
    this.window.removeListener('resize', this.layout);
    this.window.removeListener('blur', this.collapse);
    this.window.removeListener('closed', this.close);
    this.window.webContents.removeListener('did-finish-load', this.onDocumentLoaded);
    this.view.webContents.removeListener('blur', this.onViewBlur);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  };
}
