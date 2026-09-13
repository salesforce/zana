import { randomUUID } from 'node:crypto';
import { Menu, WebContentsView, session, type Session, type WebContents } from 'electron';
import { captureDesktopBrowserPage } from './desktop-browser-capture.js';
import {
  DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH,
  DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampDesktopBrowserViewBounds,
  type DesktopBrowserAttachRequest,
  type DesktopBrowserNavigateRequest,
  type DesktopBrowserOpenTabRequest,
  type DesktopBrowserScopedOpenTabRequest,
  type DesktopBrowserFindInPageRequest,
  type DesktopBrowserFindResult,
  type DesktopBrowserSetBoundsRequest,
  type DesktopBrowserSetVisibleRequest,
  type DesktopBrowserSnapshot,
  type DesktopBrowserState,
  type DesktopBrowserStopFindInPageRequest,
  type DesktopBrowserViewBounds,
  type DesktopBrowserViewportBounds
} from '@zana-ai/zcc-desktop-contract';
import type { AppCommandId, AppShortcutInput } from '@zana-ai/zcc-domain/thread-runtime';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import {
  evaluatePopupRate,
  isAllowedBrowserPermission,
  isAllowedBrowserUrl,
  resolveWindowOpenAction
} from './desktop-browser-policy.js';
import { isPendingAutomationTab, hashedAutomationPartition } from './desktop-browser-thread-scope.js';

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

export type DesktopBrowserTabProfile =
  | { kind: 'personal' }
  | { kind: 'automation'; id: string };

export interface DesktopBrowserNativeTab extends DesktopBrowserState {
  threadId: string;
  generation: string;
  profile: DesktopBrowserTabProfile;
  presentation: 'hidden' | 'reveal';
}

interface BrowserViewEntry {
  view: WebContentsView;
  hostWindow: DesktopBrowserHostWindow;
  threadId: string;
  generation: string;
  profile: DesktopBrowserTabProfile;
  lastErrorText: string | null;
  desiredBounds: DesktopBrowserViewBounds;
  popupTimestamps: number[];
  rendererRecoveryAttempts: number;
  rendererRecoveryState: 'healthy' | 'pending' | 'blocked';
  rendererRecoveryTimer: ReturnType<typeof setTimeout> | null;
  visible: boolean;
  automationTargetId: string | null;
  activeFindRequestId: number | null;
  suppressNextFocusNotification: boolean;
}

export type DesktopBrowserHostWebContentsPayload =
  | DesktopBrowserState
  | DesktopBrowserOpenTabRequest
  | DesktopBrowserScopedOpenTabRequest
  | DesktopBrowserSnapshot
  | DesktopBrowserFindResult
  | { tabId: string }
  | AppCommandId;

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
  createTab(args: {
    hostWindow: DesktopBrowserHostWindow;
    tabId: string;
    threadId: string;
    url: string;
    profile: DesktopBrowserTabProfile;
    viewport: DesktopBrowserViewportBounds;
  }): DesktopBrowserNativeTab;
  listTabs(args: { hostWebContentsId: number; threadId: string | null }): DesktopBrowserNativeTab[];
  closeTab(args: { hostWebContentsId: number; threadId: string; tabId: string; generation: string }): void;
  captureTab(args: {
    hostWebContentsId: number;
    threadId: string;
    tabId: string;
    generation: string;
    maxWidth: number;
    maxHeight: number;
    quality: number;
  }): Promise<{ data: Buffer; width: number; height: number }>;
  getAutomationTabs(args: {
    hostWebContentsId: number;
    threadId: string;
  }): Array<{ tabId: string; webContents: WebContents }>;
  subscribeAutomationTabs(listener: () => void): () => void;
  profileSession(profile: DesktopBrowserTabProfile): Session;
  attach(args: HostScopedRequestArgs<DesktopBrowserAttachRequest>): void;
  detach(args: HostScopedTabArgs): void;
  navigate(args: HostScopedRequestArgs<DesktopBrowserNavigateRequest>): void;
  goBack(args: HostScopedTabArgs): void;
  goForward(args: HostScopedTabArgs): void;
  reload(args: HostScopedTabArgs): void;
  stop(args: HostScopedTabArgs): void;
  setBounds(args: HostScopedRequestArgs<DesktopBrowserSetBoundsRequest>): void;
  setVisible(args: HostScopedRequestArgs<DesktopBrowserSetVisibleRequest>): void;
  setVisibleWithoutFocus(args: HostScopedRequestArgs<DesktopBrowserSetVisibleRequest>): void;
  focus(args: HostScopedTabArgs): void;
  findInPage(args: HostScopedRequestArgs<DesktopBrowserFindInPageRequest>): void;
  stopFindInPage(args: HostScopedRequestArgs<DesktopBrowserStopFindInPageRequest>): void;
  beginWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  endWindowResize(hostWindow: DesktopBrowserHostWindow): void;
  releaseWindow(hostWebContentsId: number): void;
  destroyAll(): void;
  registerAutomationTarget(args: { tabId: string; targetId: string; hostWebContentsId: number }): boolean;
  unregisterAutomationTarget(targetId: string): boolean;
  listAutomationTargets(): Array<{ targetId: string; tabId: string; url: string; title: string | null }>;
  snapshotAutomationTarget(targetId: string): Promise<DesktopBrowserAutomationSnapshot>;
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

export interface DesktopBrowserAppCommandHooks {
  dispatchAppCommand: (args: { command: AppCommandId; hostWebContentsId: number }) => void;
  focusHostWebContents: (hostWebContentsId: number) => void;
  resolveAppCommand: (input: AppShortcutInput) => AppCommandId | null;
}

export function createDesktopBrowserViewManager(options?: {
  partition?: string;
  appCommands?: DesktopBrowserAppCommandHooks;
}): DesktopBrowserViewManager {
  const partition = options?.partition ?? ZCC_BROWSER_PARTITION;
  const appCommands = options?.appCommands;
  const entries = new Map<string, BrowserViewEntry>();
  const automationTargets = new Map<string, string>();
  const resizingHostIds = new Set<number>();
  const hardenedSessions = new Map<string, Session>();
  const automationTabListeners = new Set<() => void>();

  function notifyAutomationTabs(): void {
    for (const listener of automationTabListeners) listener();
  }

  function partitionForProfile(profile: DesktopBrowserTabProfile): string {
    return profile.kind === 'personal'
      ? partition
      : hashedAutomationPartition(profile.id);
  }

  function nativeTab(tabId: string, entry: BrowserViewEntry): DesktopBrowserNativeTab {
    return {
      ...buildBrowserState(tabId, entry),
      threadId: entry.threadId,
      generation: entry.generation,
      profile: { ...entry.profile },
      presentation: entry.visible ? 'reveal' : 'hidden'
    };
  }

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

  function ensureHardenedSession(sessionPartition: string): Session {
    const existing = hardenedSessions.get(sessionPartition);
    if (existing) return existing;
    const browserSession = session.fromPartition(sessionPartition);
    browserSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(isAllowedBrowserPermission(permission));
    });
    browserSession.setPermissionCheckHandler((_wc, permission) => isAllowedBrowserPermission(permission));
    browserSession.on('will-download', (event) => {
      event.preventDefault();
    });
    hardenedSessions.set(sessionPartition, browserSession);
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
    webContents.on('found-in-page', (_event, result) => {
      if (result.requestId !== entry.activeFindRequestId) return;
      send(hostWindow, IPC.browser.findResult, {
        tabId,
        requestId: result.requestId,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate
      });
    });
    webContents.on('focus', () => {
      if (entry.suppressNextFocusNotification) {
        entry.suppressNextFocusNotification = false;
        return;
      }
      send(hostWindow, IPC.browser.focused, { tabId });
    });
    if (appCommands) {
      webContents.on('before-input-event', (event, input) => {
        if (input.type !== 'keyDown' || input.isAutoRepeat || input.isComposing) return;
        const command = appCommands.resolveAppCommand({
          altKey: input.alt,
          code: input.code,
          ctrlKey: input.control,
          key: input.key,
          metaKey: input.meta,
          shiftKey: input.shift
        });
        if (command === null) return;
        event.preventDefault();
        if (command === 'browser.focusLocation' || command === 'browser.find') {
          appCommands.focusHostWebContents(hostWindow.webContents.id);
        }
        appCommands.dispatchAppCommand({
          command,
          hostWebContentsId: hostWindow.webContents.id
        });
      });
    }
  }

  function createEntry(args: {
    desiredBounds: DesktopBrowserViewBounds;
    hostWindow: DesktopBrowserHostWindow;
    tabId: string;
    threadId?: string;
    profile?: DesktopBrowserTabProfile;
    sessionPartition?: string;
  }): BrowserViewEntry {
    const profile = args.profile ?? (
      isPendingAutomationTab(args.tabId)
        ? { kind: 'automation' as const, id: args.tabId }
        : { kind: 'personal' as const }
    );
    const sessionPartition = args.sessionPartition ?? partitionForProfile(profile);
    ensureHardenedSession(sessionPartition);
    const view = new WebContentsView({
      webPreferences: {
        partition: sessionPartition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        backgroundThrottling: profile.kind === 'personal'
      }
    });
    const entry: BrowserViewEntry = {
      view,
      hostWindow: args.hostWindow,
      threadId: args.threadId ?? '',
      generation: randomUUID(),
      profile,
      lastErrorText: null,
      desiredBounds: args.desiredBounds,
      popupTimestamps: [],
      rendererRecoveryAttempts: 0,
      rendererRecoveryState: 'healthy',
      rendererRecoveryTimer: null,
      visible: false,
      automationTargetId: null,
      activeFindRequestId: null,
      suppressNextFocusNotification: false
    };
    wireWebContents(args.hostWindow, args.tabId, entry);
    args.hostWindow.contentView.addChildView(view);
    entries.set(browserViewKey(args.hostWindow, args.tabId), entry);
    notifyAutomationTabs();
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
    notifyAutomationTabs();
  }

  function withEntry(args: HostScopedTabArgs, fn: (entry: BrowserViewEntry) => void): void {
    const entry = entries.get(browserViewKey(args.hostWindow, args.tabId));
    if (!entry || entry.view.webContents.isDestroyed()) return;
    fn(entry);
  }

  function hasOtherVisibleEntry(hostWindow: DesktopBrowserHostWindow, tabId: string): boolean {
    const prefix = `${hostWindow.webContents.id}:`;
    const currentKey = browserViewKey(hostWindow, tabId);
    for (const [key, entry] of entries) {
      if (key !== currentKey && key.startsWith(prefix) && entry.visible) return true;
    }
    return false;
  }

  function focusEntryWithoutNotifying(entry: BrowserViewEntry): void {
    entry.suppressNextFocusNotification = true;
    entry.view.webContents.focus();
    setTimeout(() => {
      entry.suppressNextFocusNotification = false;
    }, 0);
  }

  function setEntryVisibility(
    args: HostScopedRequestArgs<DesktopBrowserSetVisibleRequest>,
    focusOnShow: boolean
  ): void {
    withEntry({ hostWindow: args.hostWindow, tabId: args.request.tabId }, (entry) => {
      const wasVisible = entry.visible;
      entry.visible = args.request.visible;
      applyEntryVisibility(entry, args.hostWindow);
      scheduleEntryRendererRecovery(entry, args.hostWindow, args.request.tabId);
      if (
        focusOnShow
        && args.request.visible
        && !wasVisible
        && !hasOtherVisibleEntry(args.hostWindow, args.request.tabId)
        && !entry.view.webContents.isDestroyed()
      ) {
        focusEntryWithoutNotifying(entry);
      }
    });
  }

  function findAutomationEntry(targetId: string): { key: string; entry: BrowserViewEntry } | null {
    const key = automationTargets.get(targetId);
    if (!key) return null;
    const entry = entries.get(key);
    if (!entry || entry.view.webContents.isDestroyed()) return null;
    return { key, entry };
  }

  return {
    createTab(request) {
      if (!isAllowedBrowserUrl(request.url)) throw new Error('Unsupported browser URL');
      if (request.hostWindow.isDestroyed() || request.hostWindow.webContents.isDestroyed()) {
        throw new Error('Desktop window is unavailable');
      }
      const key = browserViewKey(request.hostWindow, request.tabId);
      if (entries.has(key)) throw new Error('Native browser tab already exists');
      const entry = createEntry({
        desiredBounds: { x: 0, y: 0, ...request.viewport },
        hostWindow: request.hostWindow,
        tabId: request.tabId,
        threadId: request.threadId,
        profile: request.profile
      });
      applyEntryDesiredBounds(entry, request.hostWindow);
      applyEntryVisibility(entry, request.hostWindow);
      loadIfNeeded(entry, request.url);
      return nativeTab(request.tabId, entry);
    },
    listTabs({ hostWebContentsId, threadId }) {
      const prefix = `${hostWebContentsId}:`;
      const tabs: DesktopBrowserNativeTab[] = [];
      for (const [key, entry] of entries) {
        if (!key.startsWith(prefix) || entry.view.webContents.isDestroyed()) continue;
        if (threadId !== null && entry.threadId !== threadId) continue;
        tabs.push(nativeTab(key.slice(prefix.length), entry));
      }
      return tabs;
    },
    closeTab({ hostWebContentsId, tabId, generation }) {
      const key = `${hostWebContentsId}:${tabId}`;
      const entry = entries.get(key);
      if (!entry || entry.generation !== generation) return;
      destroyEntry(entry.hostWindow, key);
    },
    async captureTab(request) {
      const key = `${request.hostWebContentsId}:${request.tabId}`;
      const entry = entries.get(key);
      if (!entry || entry.generation !== request.generation || entry.view.webContents.isDestroyed()) {
        throw new Error('Native browser tab is unavailable');
      }
      if (
        ![request.maxWidth, request.maxHeight].every((size) => Number.isInteger(size) && size > 0 && size <= 4096)
        || !Number.isInteger(request.quality)
        || request.quality < 1
        || request.quality > 100
      ) {
        throw new Error('Invalid browser capture dimensions or quality');
      }
      const image = await captureDesktopBrowserPage(entry.view.webContents);
      if (image.isEmpty()) throw new Error('Native browser capture is empty');
      const size = image.getSize();
      const scale = Math.min(1, request.maxWidth / size.width, request.maxHeight / size.height);
      const resized = scale < 1
        ? image.resize({
          width: Math.max(1, Math.round(size.width * scale)),
          height: Math.max(1, Math.round(size.height * scale))
        })
        : image;
      const data = resized.toJPEG(request.quality);
      if (data.byteLength > 8 * 1024 * 1024) {
        throw new Error('Native browser capture exceeds the size limit');
      }
      return { data, ...resized.getSize() };
    },
    getAutomationTabs({ hostWebContentsId, threadId }) {
      const prefix = `${hostWebContentsId}:`;
      const tabs: Array<{ tabId: string; webContents: WebContents }> = [];
      for (const [key, entry] of entries) {
        if (
          key.startsWith(prefix)
          && entry.threadId === threadId
          && !entry.view.webContents.isDestroyed()
        ) {
          tabs.push({ tabId: key.slice(prefix.length), webContents: entry.view.webContents });
        }
      }
      return tabs;
    },
    subscribeAutomationTabs(listener) {
      automationTabListeners.add(listener);
      return () => {
        automationTabListeners.delete(listener);
      };
    },
    profileSession(profile) {
      return ensureHardenedSession(partitionForProfile(profile));
    },
    attach({ hostWindow, request }) {
      const key = browserViewKey(hostWindow, request.tabId);
      const existing = entries.get(key) ?? null;
      const wasVisible = existing?.visible ?? false;
      const entry = existing ?? createEntry({
        desiredBounds: request.bounds,
        hostWindow,
        tabId: request.tabId,
        threadId: request.threadId
      });
      if (request.threadId) entry.threadId = request.threadId;
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
      setEntryVisibility({ hostWindow, request }, true);
    },
    setVisibleWithoutFocus({ hostWindow, request }) {
      setEntryVisibility({ hostWindow, request }, false);
    },
    focus({ hostWindow, tabId }) {
      withEntry({ hostWindow, tabId }, focusEntryWithoutNotifying);
    },
    findInPage({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.activeFindRequestId = entry.view.webContents.findInPage(request.text, {
          forward: request.forward,
          findNext: request.newSession
        });
      });
    },
    stopFindInPage({ hostWindow, request }) {
      withEntry({ hostWindow, tabId: request.tabId }, (entry) => {
        entry.activeFindRequestId = null;
        entry.view.webContents.stopFindInPage(request.action);
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
    closeAutomationTarget(targetId) {
      const found = findAutomationEntry(targetId);
      if (!found) return;
      destroyEntry(found.entry.hostWindow, found.key);
    }
  };
}
