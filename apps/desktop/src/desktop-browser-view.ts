import { Menu, WebContentsView, session, type Session, type WebContents } from 'electron';
import {
  DESKTOP_BROWSER_MAX_EVAL_SCRIPT_LENGTH,
  DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH,
  DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  DESKTOP_BROWSER_MAX_TYPED_TEXT_LENGTH,
  DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampDesktopBrowserViewBounds,
  type DesktopBrowserAttachRequest,
  type DesktopBrowserNavigateRequest,
  type DesktopBrowserOpenTabRequest,
  type DesktopBrowserScopedOpenTabRequest,
  type DesktopBrowserSetBoundsRequest,
  type DesktopBrowserSetVisibleRequest,
  type DesktopBrowserSnapshot,
  type DesktopBrowserState,
  type DesktopBrowserViewBounds,
  type DesktopBrowserViewportBounds
} from '@zana-ai/zcc-desktop-contract';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import {
  evaluatePopupRate,
  isAllowedBrowserPermission,
  isAllowedBrowserUrl,
  resolveWindowOpenAction
} from './desktop-browser-policy.js';

const POPUP_RATE_WINDOW_MS = 10_000;
const POPUP_RATE_MAX_IN_WINDOW = 3;
const RESIZE_SNAPSHOT_HIDE_CAP_MS = 80;
const RESIZE_SNAPSHOT_JPEG_QUALITY = 70;
const RENDERER_RECOVERY_DELAY_MS = 250;
const RENDERER_RECOVERY_MAX_ATTEMPTS = 2;
const ERR_ABORTED = -3;

export const ZCC_BROWSER_PARTITION = 'persist:zcc-browser';

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

interface BrowserViewEntry {
  view: WebContentsView;
  hostWindow: DesktopBrowserHostWindow;
  lastErrorText: string | null;
  desiredBounds: DesktopBrowserViewBounds;
  popupTimestamps: number[];
  rendererRecoveryAttempts: number;
  rendererRecoveryState: 'healthy' | 'pending' | 'blocked';
  rendererRecoveryTimer: ReturnType<typeof setTimeout> | null;
  visible: boolean;
  automationTargetId: string | null;
}

export type DesktopBrowserHostWebContentsPayload =
  | DesktopBrowserState
  | DesktopBrowserOpenTabRequest
  | DesktopBrowserScopedOpenTabRequest
  | DesktopBrowserSnapshot;

export interface DesktopBrowserHostContentBounds {
  height: number;
  width: number;
}

export interface DesktopBrowserHostContentView {
  addChildView(view: WebContentsView): void;
  removeChildView(view: WebContentsView): void;
}

export interface DesktopBrowserHostWebContents {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: DesktopBrowserHostWebContentsPayload): void;
}

export interface DesktopBrowserHostWindow {
  contentView: DesktopBrowserHostContentView;
  getContentBounds(): DesktopBrowserHostContentBounds;
  isDestroyed(): boolean;
  webContents: DesktopBrowserHostWebContents;
}

interface HostScopedRequestArgs<TRequest> {
  hostWindow: DesktopBrowserHostWindow;
  request: TRequest;
}

interface HostScopedTabArgs {
  hostWindow: DesktopBrowserHostWindow;
  tabId: string;
}

export interface DesktopBrowserAutomationSnapshot {
  targetId: string;
  tabId: string;
  url: string;
  title: string | null;
  dataUrl: string | null;
}

export interface DesktopBrowserViewManager {
  attach(args: HostScopedRequestArgs<DesktopBrowserAttachRequest>): void;
  detach(args: HostScopedTabArgs): void;
  navigate(args: HostScopedRequestArgs<DesktopBrowserNavigateRequest>): void;
  goBack(args: HostScopedTabArgs): void;
  goForward(args: HostScopedTabArgs): void;
  reload(args: HostScopedTabArgs): void;
  stop(args: HostScopedTabArgs): void;
  setBounds(args: HostScopedRequestArgs<DesktopBrowserSetBoundsRequest>): void;
  setVisible(args: HostScopedRequestArgs<DesktopBrowserSetVisibleRequest>): void;
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
  registerAutomationTarget(args: { tabId: string; targetId: string; hostWebContentsId: number }): boolean;
  unregisterAutomationTarget(targetId: string): boolean;
  listAutomationTargets(): Array<{ targetId: string; tabId: string; url: string; title: string | null }>;
  snapshotAutomationTarget(targetId: string): Promise<DesktopBrowserAutomationSnapshot>;
  clickAutomationTarget(targetId: string, args: { selector?: string; x?: number; y?: number }): Promise<void>;
  typeAutomationTarget(targetId: string, args: { selector?: string; text: string }): Promise<void>;
  evaluateAutomationTarget(targetId: string, script: string): Promise<unknown>;
  closeAutomationTarget(targetId: string): void;
}

function browserViewKey(hostWindow: DesktopBrowserHostWindow, tabId: string): string {
  return `${hostWindow.webContents.id}:${tabId}`;
}

function send(
  hostWindow: DesktopBrowserHostWindow,
  channel: string,
  payload: DesktopBrowserHostWebContentsPayload
): void {
  if (hostWindow.isDestroyed() || hostWindow.webContents.isDestroyed()) return;
  hostWindow.webContents.send(channel, payload);
}

function hostWindowViewportBounds(hostWindow: DesktopBrowserHostWindow): DesktopBrowserViewportBounds {
  const contentBounds = hostWindow.getContentBounds();
  return { width: contentBounds.width, height: contentBounds.height };
}

function applyEntryDesiredBounds(entry: BrowserViewEntry, hostWindow: DesktopBrowserHostWindow): void {
  entry.view.setBounds(
    clampDesktopBrowserViewBounds({
      bounds: entry.desiredBounds,
      viewport: hostWindowViewportBounds(hostWindow)
    })
  );
}

function buildBrowserState(tabId: string, entry: BrowserViewEntry): DesktopBrowserState {
  const webContents = entry.view.webContents;
  const url = webContents.getURL();
  const rawTitle = webContents.getTitle();
  const title = rawTitle.length > 0 && rawTitle !== url ? rawTitle : null;
  return {
    tabId,
    url: truncate(url, DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: title === null ? null : truncate(title, DESKTOP_BROWSER_MAX_TITLE_LENGTH),
    isLoading: webContents.isLoadingMainFrame(),
    canGoBack: webContents.navigationHistory.canGoBack(),
    canGoForward: webContents.navigationHistory.canGoForward(),
    errorText: entry.lastErrorText === null
      ? null
      : truncate(entry.lastErrorText, DESKTOP_BROWSER_MAX_TITLE_LENGTH)
  };
}

async function ensureDebugger(webContents: WebContents): Promise<void> {
  if (!webContents.debugger.isAttached()) {
    webContents.debugger.attach('1.3');
  }
}

export function createDesktopBrowserViewManager(options?: {
  partition?: string;
}): DesktopBrowserViewManager {
  const partition = options?.partition ?? ZCC_BROWSER_PARTITION;
  const entries = new Map<string, BrowserViewEntry>();
  const automationTargets = new Map<string, string>();
  const resizingHostIds = new Set<number>();
  let hardenedSession: Session | null = null;

  function isHostResizing(hostWindow: DesktopBrowserHostWindow): boolean {
    return resizingHostIds.has(hostWindow.webContents.id);
  }

  function applyEntryVisibility(entry: BrowserViewEntry, hostWindow: DesktopBrowserHostWindow): void {
    if (entry.view.webContents.isDestroyed()) return;
    entry.view.setVisible(
      entry.visible && entry.rendererRecoveryState === 'healthy' && !isHostResizing(hostWindow)
    );
  }

  function clearEntryRendererRecoveryTimer(entry: BrowserViewEntry): void {
    if (entry.rendererRecoveryTimer !== null) {
      clearTimeout(entry.rendererRecoveryTimer);
      entry.rendererRecoveryTimer = null;
    }
  }

  function resetEntryRendererRecovery(entry: BrowserViewEntry): void {
    clearEntryRendererRecoveryTimer(entry);
    entry.rendererRecoveryAttempts = 0;
    entry.rendererRecoveryState = 'healthy';
  }

  function scheduleEntryRendererRecovery(
    entry: BrowserViewEntry,
    hostWindow: DesktopBrowserHostWindow,
    tabId: string
  ): void {
    if (entry.rendererRecoveryState !== 'pending' || !entry.visible || entry.rendererRecoveryTimer !== null) {
      return;
    }
    if (entry.rendererRecoveryAttempts >= RENDERER_RECOVERY_MAX_ATTEMPTS) {
      entry.rendererRecoveryState = 'blocked';
      entry.lastErrorText = 'The page renderer stopped repeatedly';
      pushState(hostWindow, tabId);
      return;
    }
    entry.rendererRecoveryTimer = setTimeout(() => {
      entry.rendererRecoveryTimer = null;
      const webContents = entry.view.webContents;
      if (webContents.isDestroyed() || entry.rendererRecoveryState !== 'pending' || !entry.visible) {
        return;
      }
      entry.rendererRecoveryAttempts += 1;
      entry.rendererRecoveryState = 'healthy';
      entry.lastErrorText = null;
      webContents.reload();
      applyEntryVisibility(entry, hostWindow);
    }, RENDERER_RECOVERY_DELAY_MS);
  }

  function startResizeSnapshot(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry
  ): void {
    const hideCap = setTimeout(() => {
      applyEntryVisibility(entry, hostWindow);
    }, RESIZE_SNAPSHOT_HIDE_CAP_MS);
    entry.view.webContents
      .capturePage()
      .then((image) => {
        if (!isHostResizing(hostWindow) || image.isEmpty()) return;
        const dataUrl = `data:image/jpeg;base64,${image
          .toJPEG(RESIZE_SNAPSHOT_JPEG_QUALITY)
          .toString('base64')}`;
        if (dataUrl.length > DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH) return;
        send(hostWindow, IPC.browser.snapshot, { tabId, dataUrl });
      })
      .catch(() => {
        /* no placeholder */
      })
      .finally(() => {
        clearTimeout(hideCap);
        applyEntryVisibility(entry, hostWindow);
      });
  }

  function ensureHardenedSession(): Session {
    if (hardenedSession !== null) return hardenedSession;
    const browserSession = session.fromPartition(partition);
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) => isAllowedBrowserPermission(permission));
    browserSession.on('will-download', (event) => {
      event.preventDefault();
    });
    hardenedSession = browserSession;
    return browserSession;
  }

  function pushState(hostWindow: DesktopBrowserHostWindow, tabId: string): void {
    const entry = entries.get(browserViewKey(hostWindow, tabId));
    if (!entry || entry.view.webContents.isDestroyed()) return;
    send(hostWindow, IPC.browser.state, buildBrowserState(tabId, entry));
  }

  function wireWebContents(
    hostWindow: DesktopBrowserHostWindow,
    tabId: string,
    entry: BrowserViewEntry
  ): void {
    const webContents = entry.view.webContents;

    webContents.on('will-frame-navigate', (event) => {
      if (!event.isMainFrame) return;
      if (!isAllowedBrowserUrl(event.url)) event.preventDefault();
    });
    webContents.on('will-navigate', (event, url) => {
      if (!isAllowedBrowserUrl(url)) event.preventDefault();
    });
    webContents.on('will-redirect', (event, url, _isInPlace, isMainFrame) => {
      if (!isMainFrame) return;
      if (!isAllowedBrowserUrl(url)) event.preventDefault();
    });

    webContents.setWindowOpenHandler((details) => {
      const { openTabUrl } = resolveWindowOpenAction(details.url);
      if (openTabUrl !== null) {
        const decision = evaluatePopupRate({
          timestamps: entry.popupTimestamps,
          now: Date.now(),
          windowMs: POPUP_RATE_WINDOW_MS,
          maxInWindow: POPUP_RATE_MAX_IN_WINDOW
        });
        entry.popupTimestamps = decision.timestamps;
        if (decision.allowed) {
          send(hostWindow, IPC.browser.openTab, { url: openTabUrl });
          send(hostWindow, IPC.browser.scopedOpenTab, { tabId, url: openTabUrl });
        }
      }
      return { action: 'deny' };
    });

    webContents.on('context-menu', (_event, params) => {
      if (webContents.isDestroyed()) return;
      const { editFlags } = params;
      const menu = Menu.buildFromTemplate([
        { role: 'cut', enabled: editFlags.canCut },
        { role: 'copy', enabled: editFlags.canCopy && params.selectionText.length > 0 },
        { role: 'paste', enabled: editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', enabled: editFlags.canSelectAll }
      ]);
      menu.popup();
    });

    webContents.on('render-process-gone', (_event, details) => {
      if (webContents.isDestroyed() || webContents.getURL().length === 0) return;
      clearEntryRendererRecoveryTimer(entry);
      entry.rendererRecoveryState = 'blocked';
      if (details.reason === 'launch-failed' || details.reason === 'integrity-failure') {
        entry.lastErrorText = 'The page renderer could not start';
        applyEntryVisibility(entry, hostWindow);
        pushState(hostWindow, tabId);
        return;
      }
      entry.rendererRecoveryState = 'pending';
      entry.lastErrorText = null;
      applyEntryVisibility(entry, hostWindow);
      scheduleEntryRendererRecovery(entry, hostWindow, tabId);
    });

    const refresh = () => pushState(hostWindow, tabId);
    webContents.on('did-finish-load', () => {
      resetEntryRendererRecovery(entry);
      applyEntryVisibility(entry, hostWindow);
      refresh();
    });
    webContents.on('did-start-loading', refresh);
    webContents.on('did-stop-loading', refresh);
    webContents.on('did-navigate', () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on('did-navigate-in-page', refresh);
    webContents.on('did-start-navigation', () => {
      entry.lastErrorText = null;
      refresh();
    });
    webContents.on('page-title-updated', refresh);
    webContents.on('did-fail-load', (_event, errorCode, errorDescription, _validatedURL, isMainFrame) => {
      if (!isMainFrame || errorCode === ERR_ABORTED) return;
      entry.lastErrorText = errorDescription.length > 0 ? errorDescription : 'Failed to load page';
      refresh();
    });
  }

  function createEntry(args: {
    desiredBounds: DesktopBrowserViewBounds;
    hostWindow: DesktopBrowserHostWindow;
    tabId: string;
  }): BrowserViewEntry {
    ensureHardenedSession();
    const view = new WebContentsView({
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false
      }
    });
    const entry: BrowserViewEntry = {
      view,
      hostWindow: args.hostWindow,
      lastErrorText: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      rendererRecoveryAttempts: 0,
      rendererRecoveryState: 'healthy',
      rendererRecoveryTimer: null,
      visible: false,
      automationTargetId: null
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(args.hostWindow, args.tabId), entry);
    return entry;
  }

  function loadIfNeeded(entry: BrowserViewEntry, url: string): void {
    if (url.length === 0) return;
    if (entry.view.webContents.getURL() === url) return;
    if (!isAllowedBrowserUrl(url)) return;
    entry.lastErrorText = null;
    entry.view.webContents.loadURL(url).catch(() => {
      /* surfaced through did-fail-load */
    });
  }

  function destroyEntry(hostWindow: DesktopBrowserHostWindow, key: string): void {
    const entry = entries.get(key);
    if (!entry) return;
    entries.delete(key);
    if (entry.automationTargetId) automationTargets.delete(entry.automationTargetId);
    clearEntryRendererRecoveryTimer(entry);
    if (!hostWindow.isDestroyed()) hostWindow.contentView.removeChildView(entry.view);
    if (!entry.view.webContents.isDestroyed()) {
      try {
        if (entry.view.webContents.debugger.isAttached()) entry.view.webContents.debugger.detach();
      } catch {
        /* ignore */
      }
      entry.view.webContents.close();
    }
  }

  function withEntry(args: HostScopedTabArgs, fn: (entry: BrowserViewEntry) => void): void {
    const entry = entries.get(browserViewKey(args.hostWindow, args.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) return;
    fn(entry);
  }

  function findAutomationEntry(targetId: string): { key: string; entry: BrowserViewEntry } | null {
    const key = automationTargets.get(targetId);
    if (!key) return null;
    const entry = entries.get(key);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    return { key, entry };
  }

  return {
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const existing = entries.get(key) ?? null;
      const wasVisible = existing?.visible ?? false;
      const entry = existing ?? createEntry({
        desiredBounds: request.bounds,
        hostWindow,
        tabId: request.tabId
      });
      entry.desiredBounds = request.bounds;
      applyEntryDesiredBounds(entry, hostWindow);
      entry.visible = request.visible;
      applyEntryVisibility(entry, hostWindow);
      if (request.visible && !wasVisible && !entry.view.webContents.isDestroyed()) {
        entry.view.webContents.focus();
      }
      loadIfNeeded(entry, request.url);
      pushState(hostWindow, request.tabId);
    },
    detach({ hostWindow, tabId }) {
      destroyEntry(hostWindow, browserViewKey(hostWindow, tabId));
    },
    navigate({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        resetEntryRendererRecovery(entry);
        applyEntryVisibility(entry, hostWindow);
        loadIfNeeded(entry, request.url);
      });
    },
    goBack({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoBack()) {
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goBack();
        }
      });
    },
    goForward({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        if (entry.view.webContents.navigationHistory.canGoForward()) {
          resetEntryRendererRecovery(entry);
          applyEntryVisibility(entry, hostWindow);
          entry.view.webContents.navigationHistory.goForward();
        }
      });
    },
    reload({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        resetEntryRendererRecovery(entry);
        entry.view.webContents.reload();
        applyEntryVisibility(entry, hostWindow);
      });
    },
    stop({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, (entry) => {
        entry.view.webContents.stop();
      });
    },
    setBounds({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.desiredBounds = request.bounds;
        applyEntryDesiredBounds(entry, hostWindow);
      });
    },
    setVisible({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        const wasVisible = entry.visible;
        entry.visible = request.visible;
        applyEntryVisibility(entry, hostWindow);
        scheduleEntryRendererRecovery(entry, hostWindow, request.tabId);
        if (request.visible && !wasVisible && !entry.view.webContents.isDestroyed()) {
          entry.view.webContents.focus();
        }
      });
    },
    beginWindowResize(hostWindow) {
      if (isHostResizing(hostWindow)) return;
      resizingHostIds.add(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) continue;
        if (entry.visible) startResizeSnapshot(hostWindow, key.slice(prefix.length), entry);
      }
    },
    endWindowResize(hostWindow) {
      if (!isHostResizing(hostWindow)) return;
      resizingHostIds.delete(hostWindow.webContents.id);
      const prefix = `${hostWindow.webContents.id}:`;
      for (const [key, entry] of entries.entries()) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) continue;
        if (entry.visible) applyEntryDesiredBounds(entry, hostWindow);
        applyEntryVisibility(entry, hostWindow);
        send(hostWindow, IPC.browser.snapshot, { tabId: key.slice(prefix.length), dataUrl: null });
      }
    },
    releaseWindow(hostWebContentsId) {
      resizingHostIds.delete(hostWebContentsId);
      const prefix = `${hostWebContentsId}:`;
      for (const [key, entry] of [...entries.entries()]) {
        if (!key.startsWith(prefix)) continue;
        entries.delete(key);
        if (entry.automationTargetId) automationTargets.delete(entry.automationTargetId);
        clearEntryRendererRecoveryTimer(entry);
        if (!entry.view.webContents.isDestroyed()) {
          try {
            if (entry.view.webContents.debugger.isAttached()) entry.view.webContents.debugger.detach();
          } catch {
            /* ignore */
          }
          entry.view.webContents.close();
        }
      }
    },
    destroyAll() {
      resizingHostIds.clear();
      automationTargets.clear();
      for (const [key, entry] of [...entries.entries()]) {
        entries.delete(key);
        clearEntryRendererRecoveryTimer(entry);
        if (!entry.view.webContents.isDestroyed()) {
          try {
            if (entry.view.webContents.debugger.isAttached()) entry.view.webContents.debugger.detach();
          } catch {
            /* ignore */
          }
          entry.view.webContents.close();
        }
      }
    },
    registerAutomationTarget({ tabId, targetId, hostWebContentsId }) {
      const key = `${hostWebContentsId}:${tabId}`;
      const entry = entries.get(key);
      if (!entry) return false;
      if (entry.automationTargetId && entry.automationTargetId !== targetId) {
        automationTargets.delete(entry.automationTargetId);
      }
      entry.automationTargetId = targetId;
      automationTargets.set(targetId, key);
      return true;
    },
    unregisterAutomationTarget(targetId) {
      const found = findAutomationEntry(targetId);
      if (!found) {
        automationTargets.delete(targetId);
        return false;
      }
      found.entry.automationTargetId = null;
      automationTargets.delete(targetId);
      try {
        if (found.entry.view.webContents.debugger.isAttached()) {
          found.entry.view.webContents.debugger.detach();
        }
      } catch {
        /* ignore */
      }
      return true;
    },
    listAutomationTargets() {
      const listed: Array<{ targetId: string; tabId: string; url: string; title: string | null }> = [];
      for (const [targetId, key] of automationTargets.entries()) {
        const entry = entries.get(key);
        if (!entry || entry.view.webContents.isDestroyed()) continue;
        const tabId = key.slice(key.indexOf(':') + 1);
        listed.push({
          targetId,
          tabId,
          url: entry.view.webContents.getURL(),
          title: entry.view.webContents.getTitle() || null
        });
      }
      return listed;
    },
    async snapshotAutomationTarget(targetId) {
      const found = findAutomationEntry(targetId);
      if (!found) throw new Error('unknown automation target');
      const webContents = found.entry.view.webContents;
      const image = await webContents.capturePage();
      let dataUrl: string | null = null;
      if (!image.isEmpty()) {
        const encoded = `data:image/jpeg;base64,${image.toJPEG(70).toString('base64')}`;
        dataUrl = encoded.length <= DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH ? encoded : null;
      }
      return {
        targetId,
        tabId: found.key.slice(found.key.indexOf(':') + 1),
        url: webContents.getURL(),
        title: webContents.getTitle() || null,
        dataUrl
      };
    },
    async clickAutomationTarget(targetId, args) {
      const found = findAutomationEntry(targetId);
      if (!found) throw new Error('unknown automation target');
      const webContents = found.entry.view.webContents;
      await ensureDebugger(webContents);
      let x = args.x;
      let y = args.y;
      if (args.selector) {
        const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
          returnByValue: true
        }) as { result?: { value?: { x: number; y: number } | null } };
        const point = result.result?.value;
        if (!point) throw new Error('selector did not match');
        x = point.x;
        y = point.y;
      }
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new Error('click requires a selector or coordinates');
      }
      await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
      await webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x,
        y,
        button: 'left',
        clickCount: 1
      });
    },
    async typeAutomationTarget(targetId, args) {
      const found = findAutomationEntry(targetId);
      if (!found) throw new Error('unknown automation target');
      if (args.text.length > DESKTOP_BROWSER_MAX_TYPED_TEXT_LENGTH) {
        throw new Error('typed text exceeds cap');
      }
      const webContents = found.entry.view.webContents;
      await ensureDebugger(webContents);
      if (args.selector) {
        await webContents.debugger.sendCommand('Runtime.evaluate', {
          expression: `(() => { const el = document.querySelector(${JSON.stringify(args.selector)}); if (!el) throw new Error('selector did not match'); el.focus(); return true; })()`
        });
      }
      for (const char of args.text) {
        await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyDown',
          text: char
        });
        await webContents.debugger.sendCommand('Input.dispatchKeyEvent', {
          type: 'keyUp',
          text: char
        });
      }
    },
    async evaluateAutomationTarget(targetId, script) {
      const found = findAutomationEntry(targetId);
      if (!found) throw new Error('unknown automation target');
      if (script.length > DESKTOP_BROWSER_MAX_EVAL_SCRIPT_LENGTH) {
        throw new Error('eval script exceeds cap');
      }
      const webContents = found.entry.view.webContents;
      await ensureDebugger(webContents);
      const result = await webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: script,
        returnByValue: true
      }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } };
      if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text ?? 'eval failed');
      }
      return result.result?.value ?? null;
    },
    closeAutomationTarget(targetId) {
      const found = findAutomationEntry(targetId);
      if (!found) return;
      destroyEntry(found.entry.hostWindow, found.key);
    }
  };
}
