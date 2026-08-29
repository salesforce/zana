export { IPC } from './ipc.js';
export type { CcApi, HostBootstrapEvent, ZccDesktopApi } from './cc-api.js';
export {
  DESKTOP_BROWSER_MAX_EVAL_SCRIPT_LENGTH,
  DESKTOP_BROWSER_MAX_SELECTOR_LENGTH,
  DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH,
  DESKTOP_BROWSER_MAX_TITLE_LENGTH,
  DESKTOP_BROWSER_MAX_TYPED_TEXT_LENGTH,
  DESKTOP_BROWSER_MAX_URL_LENGTH,
  clampDesktopBrowserViewBounds,
  parseDesktopBrowserAttachRequest,
  parseDesktopBrowserAutomationOpenRequest,
  parseDesktopBrowserNavigateRequest,
  parseDesktopBrowserOpenTabRequest,
  parseDesktopBrowserScopedOpenTabRequest,
  parseDesktopBrowserSetBoundsRequest,
  parseDesktopBrowserSetVisibleRequest,
  parseDesktopBrowserSnapshot,
  parseDesktopBrowserState,
  parseDesktopBrowserTabRef
} from './browser.js';
export type {
  DesktopBrowserApi,
  DesktopBrowserAttachRequest,
  DesktopBrowserAutomationOpenRequest,
  DesktopBrowserNavigateRequest,
  DesktopBrowserOpenTabRequest,
  DesktopBrowserScopedOpenTabRequest,
  DesktopBrowserSetBoundsRequest,
  DesktopBrowserSetVisibleRequest,
  DesktopBrowserSnapshot,
  DesktopBrowserState,
  DesktopBrowserTabRef,
  DesktopBrowserUnsubscribe,
  DesktopBrowserViewBounds,
  DesktopBrowserViewportBounds
} from './browser.js';
