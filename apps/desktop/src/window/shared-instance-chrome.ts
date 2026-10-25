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
  private closed = false;
  private renderGeneration = 0;
  private rendering = false;
  constructor(private readonly window: BrowserWindow, selected: SharedInstance | undefined, unavailable: boolean, private readonly actions: ChromeActions) {
    this.state = { selected, unavailable, expanded: false, picking: false, busy: false, needsSignIn: false, instances: [], message: '' };
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
    this.render();
  }
  unavailable(): void { this.state.unavailable = true; this.render(); }
  private layout = () => {
    if (this.closed || this.window.isDestroyed()) return;
    const [width, height] = this.window.getContentSize();
    const viewWidth = Math.min(this.state.expanded ? 340 : 164, Math.max(1, width - 108));
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
    this.documentUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent(sharedChromeHtml(this.state));
    const generation = ++this.renderGeneration;
    this.rendering = true;
    void this.view.webContents.loadURL(this.documentUrl).then(() => {
      if (this.closed || generation !== this.renderGeneration) return;
      this.rendering = false;
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
    this.view.webContents.removeListener('blur', this.onViewBlur);
    if (!this.window.isDestroyed()) this.window.contentView.removeChildView(this.view);
    if (!this.view.webContents.isDestroyed()) this.view.webContents.close();
  };
}
