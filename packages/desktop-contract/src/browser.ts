/**
 * In-app thread-panel browser IPC. Shapes are wire-frozen: adding a required
 * field or extra key breaks renderer/shell version skew. Change only with an
 * explicit preload capability bump.
 */

export const DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;
export const DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;
export const DESKTOP_BROWSER_MAX_SELECTOR_LENGTH = 1024;
export const DESKTOP_BROWSER_MAX_TYPED_TEXT_LENGTH = 8192;
export const DESKTOP_BROWSER_MAX_EVAL_SCRIPT_LENGTH = 16_384;
export const DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH = 1024;

export interface DesktopBrowserViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesktopBrowserViewportBounds {
  width: number;
  height: number;
}

export interface ClampDesktopBrowserViewBoundsArgs {
  bounds: DesktopBrowserViewBounds;
  viewport: DesktopBrowserViewportBounds;
}

function clampIntegerToRange(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function clampDesktopBrowserViewBounds(
  args: ClampDesktopBrowserViewBoundsArgs
): DesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange(Math.round(args.bounds.x), 0, viewportRight);
  const y = clampIntegerToRange(Math.round(args.bounds.y), 0, viewportBottom);
  const right = clampIntegerToRange(
    Math.round(args.bounds.x + args.bounds.width),
    x,
    viewportRight
  );
  const bottom = clampIntegerToRange(
    Math.round(args.bounds.y + args.bounds.height),
    y,
    viewportBottom
  );
  return { x, y, width: right - x, height: bottom - y };
}

export type ParseResult<T> = { success: true; data: T } | { success: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extraKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

function parseInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function parseNonNegativeInteger(value: unknown): number | null {
  const parsed = parseInteger(value);
  return parsed !== null && parsed >= 0 ? parsed : null;
}

function parseBoundedString(value: unknown, max: number, min = 0): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < min || value.length > max) return null;
  return value;
}

function parseBounds(value: unknown): DesktopBrowserViewBounds | null {
  if (!isRecord(value) || extraKeys(value, ['x', 'y', 'width', 'height'])) return null;
  const x = parseInteger(value.x);
  const y = parseInteger(value.y);
  const width = parseNonNegativeInteger(value.width);
  const height = parseNonNegativeInteger(value.height);
  if (x === null || y === null || width === null || height === null) return null;
  return { x, y, width, height };
}

export interface DesktopBrowserAttachRequest {
  tabId: string;
  url: string;
  bounds: DesktopBrowserViewBounds;
  visible: boolean;
  threadId?: string;
}

export interface DesktopBrowserControlState {
  tabId: string;
  threadId: string;
  control: {
    leaseId: string;
    controllerLabel: string;
    expiresAt: number;
  } | null;
}

export interface DesktopBrowserTarget {
  hostId: string;
  instanceId: string;
  generation: string;
}

export interface DesktopBrowserRevealRequest {
  tabId: string;
  threadId: string;
  desktopTarget?: DesktopBrowserTarget | null;
}

export interface DesktopBrowserImportCookiesRequest {
  sourceId: string;
  sourceProfileDirectory: string;
  intoAutomation?: boolean;
}

export interface DesktopBrowserNavigateRequest {
  tabId: string;
  url: string;
}

export interface DesktopBrowserSetBoundsRequest {
  tabId: string;
  bounds: DesktopBrowserViewBounds;
}

export interface DesktopBrowserSetVisibleRequest {
  tabId: string;
  visible: boolean;
}

export interface DesktopBrowserTabRef {
  tabId: string;
}

export interface DesktopBrowserState {
  tabId: string;
  url: string;
  title: string | null;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  errorText: string | null;
}

export interface DesktopBrowserOpenTabRequest {
  url: string;
}

export interface DesktopBrowserScopedOpenTabRequest {
  tabId: string;
  url: string;
}

export interface DesktopBrowserSnapshot {
  tabId: string;
  dataUrl: string | null;
}

export interface DesktopBrowserFindInPageRequest {
  tabId: string;
  text: string;
  forward: boolean;
  newSession: boolean;
}

export type DesktopBrowserStopFindAction = 'clearSelection' | 'keepSelection' | 'activateSelection';

export interface DesktopBrowserStopFindInPageRequest {
  tabId: string;
  action: DesktopBrowserStopFindAction;
}

export interface DesktopBrowserFindResult {
  tabId: string;
  requestId: number;
  activeMatchOrdinal: number;
  matches: number;
  finalUpdate: boolean;
}

export interface DesktopBrowserAutomationOpenRequest {
  threadId: string;
  tabId: string;
  targetId: string;
  url: string;
}

export interface DesktopBrowserAutomationTargetRef {
  targetId: string;
}

export function parseDesktopBrowserAttachRequest(value: unknown): ParseResult<DesktopBrowserAttachRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'url', 'bounds', 'visible', 'threadId'])) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH);
  const bounds = parseBounds(value.bounds);
  const threadId =
    value.threadId === undefined
      ? undefined
      : parseBoundedString(value.threadId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (
    tabId === null ||
    url === null ||
    bounds === null ||
    typeof value.visible !== 'boolean' ||
    threadId === null
  ) {
    return { success: false };
  }
  return {
    success: true,
    data: { tabId, url, bounds, visible: value.visible, ...(threadId ? { threadId } : {}) }
  };
}

export function parseDesktopBrowserNavigateRequest(value: unknown): ParseResult<DesktopBrowserNavigateRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'url'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH, 1);
  if (tabId === null || url === null) return { success: false };
  return { success: true, data: { tabId, url } };
}

export function parseDesktopBrowserSetBoundsRequest(value: unknown): ParseResult<DesktopBrowserSetBoundsRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'bounds'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const bounds = parseBounds(value.bounds);
  if (tabId === null || bounds === null) return { success: false };
  return { success: true, data: { tabId, bounds } };
}

export function parseDesktopBrowserSetVisibleRequest(value: unknown): ParseResult<DesktopBrowserSetVisibleRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'visible'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (tabId === null || typeof value.visible !== 'boolean') return { success: false };
  return { success: true, data: { tabId, visible: value.visible } };
}

export function parseDesktopBrowserTabRef(value: unknown): ParseResult<DesktopBrowserTabRef> {
  if (!isRecord(value) || extraKeys(value, ['tabId'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (tabId === null) return { success: false };
  return { success: true, data: { tabId } };
}

const STOP_FIND_ACTIONS: readonly DesktopBrowserStopFindAction[] = [
  'clearSelection',
  'keepSelection',
  'activateSelection'
];

export function parseDesktopBrowserFindInPageRequest(
  value: unknown
): ParseResult<DesktopBrowserFindInPageRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'text', 'forward', 'newSession'])) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const text = parseBoundedString(value.text, DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH, 1);
  if (tabId === null || text === null || typeof value.forward !== 'boolean' || typeof value.newSession !== 'boolean') {
    return { success: false };
  }
  return { success: true, data: { tabId, text, forward: value.forward, newSession: value.newSession } };
}

export function parseDesktopBrowserStopFindInPageRequest(
  value: unknown
): ParseResult<DesktopBrowserStopFindInPageRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'action'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (
    tabId === null
    || typeof value.action !== 'string'
    || !STOP_FIND_ACTIONS.includes(value.action as DesktopBrowserStopFindAction)
  ) {
    return { success: false };
  }
  return { success: true, data: { tabId, action: value.action as DesktopBrowserStopFindAction } };
}

export function parseDesktopBrowserFindResult(value: unknown): ParseResult<DesktopBrowserFindResult> {
  if (
    !isRecord(value)
    || extraKeys(value, ['tabId', 'requestId', 'activeMatchOrdinal', 'matches', 'finalUpdate'])
  ) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const requestId = parseInteger(value.requestId);
  const activeMatchOrdinal = parseNonNegativeInteger(value.activeMatchOrdinal);
  const matches = parseNonNegativeInteger(value.matches);
  if (
    tabId === null
    || requestId === null
    || activeMatchOrdinal === null
    || matches === null
    || typeof value.finalUpdate !== 'boolean'
  ) {
    return { success: false };
  }
  return {
    success: true,
    data: { tabId, requestId, activeMatchOrdinal, matches, finalUpdate: value.finalUpdate }
  };
}

export function parseDesktopBrowserState(value: unknown): ParseResult<DesktopBrowserState> {
  if (
    !isRecord(value)
    || extraKeys(value, ['tabId', 'url', 'title', 'isLoading', 'canGoBack', 'canGoForward', 'errorText'])
  ) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH);
  const title = value.title === null
    ? null
    : parseBoundedString(value.title, DESKTOP_BROWSER_MAX_TITLE_LENGTH);
  const errorText = value.errorText === null
    ? null
    : parseBoundedString(value.errorText, DESKTOP_BROWSER_MAX_TITLE_LENGTH);
  if (
    tabId === null
    || url === null
    || title === undefined
    || errorText === undefined
    || typeof value.isLoading !== 'boolean'
    || typeof value.canGoBack !== 'boolean'
    || typeof value.canGoForward !== 'boolean'
  ) {
    return { success: false };
  }
  return {
    success: true,
    data: {
      tabId,
      url,
      title,
      isLoading: value.isLoading,
      canGoBack: value.canGoBack,
      canGoForward: value.canGoForward,
      errorText
    }
  };
}

export function parseDesktopBrowserOpenTabRequest(value: unknown): ParseResult<DesktopBrowserOpenTabRequest> {
  if (!isRecord(value) || extraKeys(value, ['url'])) return { success: false };
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH, 1);
  if (url === null) return { success: false };
  return { success: true, data: { url } };
}

export function parseDesktopBrowserScopedOpenTabRequest(
  value: unknown
): ParseResult<DesktopBrowserScopedOpenTabRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'url'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH, 1);
  if (tabId === null || url === null) return { success: false };
  return { success: true, data: { tabId, url } };
}

export function parseDesktopBrowserSnapshot(value: unknown): ParseResult<DesktopBrowserSnapshot> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'dataUrl'])) return { success: false };
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const dataUrl = value.dataUrl === null
    ? null
    : parseBoundedString(value.dataUrl, DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH);
  if (tabId === null || dataUrl === undefined) return { success: false };
  return { success: true, data: { tabId, dataUrl } };
}

export function parseDesktopBrowserAutomationOpenRequest(
  value: unknown
): ParseResult<DesktopBrowserAutomationOpenRequest> {
  if (!isRecord(value) || extraKeys(value, ['threadId', 'tabId', 'targetId', 'url'])) {
    return { success: false };
  }
  const threadId = parseBoundedString(value.threadId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const targetId = parseBoundedString(value.targetId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const url = parseBoundedString(value.url, DESKTOP_BROWSER_MAX_URL_LENGTH);
  if (threadId === null || tabId === null || targetId === null || url === null) {
    return { success: false };
  }
  return { success: true, data: { threadId, tabId, targetId, url } };
}

function parseDesktopBrowserTarget(value: unknown): DesktopBrowserTarget | null {
  if (!isRecord(value) || extraKeys(value, ['hostId', 'instanceId', 'generation'])) return null;
  const hostId = parseBoundedString(value.hostId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const instanceId = parseBoundedString(value.instanceId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const generation = parseBoundedString(value.generation, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (hostId === null || instanceId === null || generation === null) return null;
  return { hostId, instanceId, generation };
}

export function parseDesktopBrowserRevealRequest(
  value: unknown
): ParseResult<DesktopBrowserRevealRequest> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'threadId', 'desktopTarget'])) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const threadId = parseBoundedString(value.threadId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (tabId === null || threadId === null) return { success: false };
  if (value.desktopTarget === undefined || value.desktopTarget === null) {
    return { success: true, data: { tabId, threadId, desktopTarget: value.desktopTarget ?? null } };
  }
  const desktopTarget = parseDesktopBrowserTarget(value.desktopTarget);
  if (desktopTarget === null) return { success: false };
  return { success: true, data: { tabId, threadId, desktopTarget } };
}

export function parseDesktopBrowserControlState(
  value: unknown
): ParseResult<DesktopBrowserControlState> {
  if (!isRecord(value) || extraKeys(value, ['tabId', 'threadId', 'control'])) {
    return { success: false };
  }
  const tabId = parseBoundedString(value.tabId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const threadId = parseBoundedString(value.threadId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  if (tabId === null || threadId === null) return { success: false };
  if (value.control === null) {
    return { success: true, data: { tabId, threadId, control: null } };
  }
  if (!isRecord(value.control) || extraKeys(value.control, ['leaseId', 'controllerLabel', 'expiresAt'])) {
    return { success: false };
  }
  const leaseId = parseBoundedString(value.control.leaseId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const controllerLabel = parseBoundedString(
    value.control.controllerLabel,
    DESKTOP_BROWSER_MAX_TITLE_LENGTH,
    1
  );
  const expiresAt = parseInteger(value.control.expiresAt);
  if (leaseId === null || controllerLabel === null || expiresAt === null || expiresAt <= 0) {
    return { success: false };
  }
  return { success: true, data: { tabId, threadId, control: { leaseId, controllerLabel, expiresAt } } };
}

export function parseDesktopBrowserImportCookiesRequest(
  value: unknown
): ParseResult<DesktopBrowserImportCookiesRequest> {
  if (
    !isRecord(value)
    || extraKeys(value, ['sourceId', 'sourceProfileDirectory', 'intoAutomation'])
  ) {
    return { success: false };
  }
  const sourceId = parseBoundedString(value.sourceId, DESKTOP_BROWSER_MAX_TITLE_LENGTH, 1);
  const sourceProfileDirectory = parseBoundedString(
    value.sourceProfileDirectory,
    DESKTOP_BROWSER_MAX_URL_LENGTH,
    1
  );
  if (sourceId === null || sourceProfileDirectory === null) return { success: false };
  if (value.intoAutomation !== undefined && typeof value.intoAutomation !== 'boolean') {
    return { success: false };
  }
  return {
    success: true,
    data: {
      sourceId,
      sourceProfileDirectory,
      ...(value.intoAutomation === true ? { intoAutomation: true } : {})
    }
  };
}

export type DesktopBrowserUnsubscribe = () => void;

export interface DesktopBrowserApi {
  attach(request: DesktopBrowserAttachRequest): void;
  detach(tabId: string): void;
  navigate(request: DesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  setBounds(request: DesktopBrowserSetBoundsRequest): void;
  setVisible(request: DesktopBrowserSetVisibleRequest): void;
  setVisibleWithoutFocus?(request: DesktopBrowserSetVisibleRequest): void;
  focus?(tabId: string): void;
  findInPage?(request: DesktopBrowserFindInPageRequest): void;
  stopFindInPage?(request: DesktopBrowserStopFindInPageRequest): void;
  onFindResult?(listener: (result: DesktopBrowserFindResult) => void): DesktopBrowserUnsubscribe;
  onAppCommand?(listener: (command: string) => void): DesktopBrowserUnsubscribe;
  getControl?(tabId: string): Promise<DesktopBrowserControlState | null>;
  onState(listener: (state: DesktopBrowserState) => void): DesktopBrowserUnsubscribe;
  onOpenTab(listener: (request: DesktopBrowserOpenTabRequest) => void): DesktopBrowserUnsubscribe;
  onScopedOpenTab?(
    listener: (request: DesktopBrowserScopedOpenTabRequest) => void
  ): DesktopBrowserUnsubscribe;
  onSnapshot?(listener: (snapshot: DesktopBrowserSnapshot) => void): DesktopBrowserUnsubscribe;
  onAutomationOpen?(
    listener: (request: DesktopBrowserAutomationOpenRequest) => void
  ): DesktopBrowserUnsubscribe;
  registerAutomationTarget?(request: { targetId: string; tabId: string; threadId: string }): Promise<{ ok: boolean }>;
  unregisterAutomationTarget?(targetId: string): Promise<{ ok: boolean }>;
  stopAutomation?(targetId: string): Promise<{ ok: boolean }>;
  onReveal?(listener: (request: DesktopBrowserRevealRequest) => void): DesktopBrowserUnsubscribe;
  onControl?(listener: (state: DesktopBrowserControlState) => void): DesktopBrowserUnsubscribe;
  listImportSources?(): Promise<{ sources: import('./browser-import.js').DesktopBrowserImportSource[] }>;
  importCookies?(
    request: DesktopBrowserImportCookiesRequest
  ): Promise<import('./browser-import.js').DesktopBrowserImportOutcome>;
  openFullDiskAccessSettings?(): Promise<{ ok: boolean }>;
  releaseControl?(tabId: string): Promise<{ ok: boolean }>;
}
