import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
  type RefObject
} from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  Globe,
  Lock,
  RotateCw,
  Search,
  Square,
  X
} from 'lucide-react';
import {
  clampDesktopBrowserViewBounds,
  DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH,
  type DesktopBrowserApi,
  type DesktopBrowserControlState,
  type DesktopBrowserFindInPageRequest,
  type DesktopBrowserState,
  type DesktopBrowserViewBounds
} from '@zana-ai/zcc-desktop-contract';
import { BrowserFindBar, type BrowserFindMatches } from './BrowserFindBar.js';
import { formatAppShortcut, shortcutForCommand } from '../../../lib/keyboard-shortcut-settings.js';
import { getDesktopBrowserApi } from '../../../lib/desktop-browser.js';
import { getBrowserUrlHost, getBrowserUrlSecurity, resolveBrowserAddressInput } from '../../../lib/browser-url.js';
import { useBrowserHistory } from '../../../lib/browser-history.js';
import { isLoopbackHostname } from '../../../lib/loopback-hostname.js';
import { BrowserNewTabScreen } from './BrowserNewTabScreen.js';
import {
  registerBrowserView,
  type BrowserViewVisibilityCoordinator
} from './browserViewVisibilityCoordinator.js';
import { useIsBrowserDimmingModalOpen } from './useIsBrowserDimmingModalOpen.js';

const EMPTY_BOUNDS: DesktopBrowserViewBounds = { x: 0, y: 0, width: 0, height: 0 };

export interface BrowserTabContentProps {
  tabId: string;
  initialUrl: string;
  canShowNativeBrowserView: boolean;
  visibilityCoordinator: BrowserViewVisibilityCoordinator | null;
  threadId: string;
  automationTargetId?: string | null;
  onUpdate: (args: { tabId: string; url: string; title: string | null }) => void;
  onStopAutomation?: (targetId: string) => void;
}

function roundedBoundsFromRect(rect: DOMRect): DesktopBrowserViewBounds {
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };
}

function browserViewBoundsFromElement(element: HTMLElement): DesktopBrowserViewBounds {
  return clampDesktopBrowserViewBounds({
    bounds: roundedBoundsFromRect(element.getBoundingClientRect()),
    viewport: { width: window.innerWidth, height: window.innerHeight }
  });
}

function boundsEqual(a: DesktopBrowserViewBounds, b: DesktopBrowserViewBounds): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function isLocalBrowserUrl(url: string): boolean {
  try {
    return isLoopbackHostname(new URL(url).hostname);
  } catch {
    return false;
  }
}

function NavButton({
  label,
  disabled,
  onClick,
  children
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

function BrowserChrome({
  addressDraft,
  isEditing,
  state,
  currentUrl,
  addressInputRef,
  onAddressChange,
  onAddressFocus,
  onAddressBlur,
  onSubmit,
  onBack,
  onForward,
  onReloadOrStop,
  onOpenExternal
}: {
  addressDraft: string;
  isEditing: boolean;
  state: DesktopBrowserState | null;
  currentUrl: string;
  addressInputRef: RefObject<HTMLInputElement | null>;
  onAddressChange: (value: string) => void;
  onAddressFocus: () => void;
  onAddressBlur: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onBack: () => void;
  onForward: () => void;
  onReloadOrStop: () => void;
  onOpenExternal: () => void;
}) {
  const isLoading = state?.isLoading ?? false;
  const security = getBrowserUrlSecurity(currentUrl);
  const addressValue = isEditing ? addressDraft : currentUrl;
  return (
    <div className="thread-browser-chrome" data-testid="browser-tab-nav-bar" role="region" aria-label="Browser navigation">
      <NavButton label="Go back" disabled={!(state?.canGoBack ?? false)} onClick={onBack}>
        <ArrowLeft size={14} />
      </NavButton>
      <NavButton label="Go forward" disabled={!(state?.canGoForward ?? false)} onClick={onForward}>
        <ArrowRight size={14} />
      </NavButton>
      <NavButton label={isLoading ? 'Stop loading' : 'Reload'} onClick={onReloadOrStop}>
        {isLoading ? <X size={14} /> : <RotateCw size={14} />}
      </NavButton>
      <form onSubmit={onSubmit} className="thread-browser-address">
        {security === 'secure' ? (
          <Lock size={12} aria-label="Secure connection" />
        ) : security === 'insecure' ? (
          <AlertTriangle size={12} aria-label="Connection not secure" />
        ) : (
          <Search size={12} aria-hidden />
        )}
        <input
          ref={addressInputRef}
          type="text"
          value={addressValue}
          onChange={(event) => onAddressChange(event.target.value)}
          onFocus={onAddressFocus}
          onBlur={onAddressBlur}
          placeholder="Enter a URL"
          aria-label="Address and search bar"
          data-testid="thread-browser-address"
          autoComplete="off"
          spellCheck={false}
        />
      </form>
      <NavButton label="Open in external browser" disabled={currentUrl.length === 0} onClick={onOpenExternal}>
        <ExternalLink size={14} />
      </NavButton>
    </div>
  );
}

function BrowserUnavailable() {
  return (
    <div className="thread-browser-empty" data-testid="thread-browser-unavailable">
      <Globe size={22} aria-hidden />
      <p>Browser tabs need the desktop app</p>
    </div>
  );
}

function BrowserPageLoadError({
  errorText,
  onOpenExternal,
  onRetry,
  url
}: {
  errorText: string;
  onOpenExternal: () => void;
  onRetry: () => void;
  url: string;
}) {
  const host = getBrowserUrlHost(url);
  const title = isLocalBrowserUrl(url) ? 'Server not reachable' : 'Page unavailable';
  const message = isLocalBrowserUrl(url)
    ? `The browser could not reach ${host || 'this local server'}. Start the server, then reload.`
    : 'The browser could not load this page. Try reloading or opening it externally.';
  return (
    <div className="thread-browser-empty" data-testid="thread-browser-error">
      <p>{title}</p>
      <p>{message}</p>
      <div className="thread-browser-error-actions">
        <button type="button" onClick={onRetry}>Reload</button>
        <button type="button" onClick={onOpenExternal}>Open externally</button>
      </div>
      <p className="thread-browser-error-detail">{errorText}</p>
    </div>
  );
}

export function BrowserTabContent({
  tabId,
  initialUrl,
  canShowNativeBrowserView,
  visibilityCoordinator,
  threadId,
  automationTargetId = null,
  onUpdate,
  onStopAutomation
}: BrowserTabContentProps) {
  const desktopBrowser = useMemo<DesktopBrowserApi | null>(() => getDesktopBrowserApi(), []);
  const contentRef = useRef<HTMLDivElement>(null);
  const addressInputRef = useRef<HTMLInputElement>(null);
  const findInputRef = useRef<HTMLInputElement>(null);
  const { entries: recent, recordVisit, clear: clearRecent } = useBrowserHistory(threadId);
  const [state, setState] = useState<DesktopBrowserState | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);
  const [resizeSnapshotUrl, setResizeSnapshotUrl] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);
  const [control, setControl] = useState<DesktopBrowserControlState['control']>(null);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findMatches, setFindMatches] = useState<BrowserFindMatches | null>(null);
  const findShortcutLabel = formatAppShortcut(
    { key: 'f', mod: true, meta: false, control: false, alt: false, shift: false },
    typeof navigator === 'undefined' ? '' : navigator.platform
  );
  const onUpdateRef = useRef(onUpdate);
  const recordVisitRef = useRef(recordVisit);
  onUpdateRef.current = onUpdate;
  recordVisitRef.current = recordVisit;
  const initialUrlRef = useRef(initialUrl);
  const lastSentBoundsRef = useRef<DesktopBrowserViewBounds | null>(null);
  const isBrowserDimmingModalOpen = useIsBrowserDimmingModalOpen();

  const readBounds = useCallback(() => {
    const element = contentRef.current;
    if (element === null) return null;
    return browserViewBoundsFromElement(element);
  }, []);

  const sendBounds = useCallback((bounds: DesktopBrowserViewBounds) => {
    if (desktopBrowser === null) return;
    lastSentBoundsRef.current = bounds;
    desktopBrowser.setBounds({ tabId, bounds });
  }, [desktopBrowser, tabId]);

  const syncPlacement = useCallback((force: boolean) => {
    const bounds = readBounds();
    if (bounds === null) return;
    const last = lastSentBoundsRef.current;
    if (!force && last !== null && boundsEqual(last, bounds)) return;
    sendBounds(bounds);
  }, [readBounds, sendBounds]);

  const syncBounds = useCallback(() => {
    syncPlacement(true);
  }, [syncPlacement]);

  useEffect(() => {
    if (desktopBrowser === null) return;
    registerBrowserView({ tabId, threadId });
    const bounds = readBounds() ?? EMPTY_BOUNDS;
    lastSentBoundsRef.current = bounds;
    desktopBrowser.attach({
      tabId,
      url: initialUrlRef.current,
      bounds,
      visible: false
    });
    setAttached(true);
    if (automationTargetId) {
      void desktopBrowser.registerAutomationTarget?.({
        targetId: automationTargetId,
        tabId,
        threadId
      });
    }
    const unsubscribe = desktopBrowser.onState((nextState) => {
      if (nextState.tabId !== tabId) return;
      setState(nextState);
      setCurrentUrl(nextState.url);
      onUpdateRef.current({
        tabId,
        url: nextState.url,
        title: nextState.title
      });
      if (!nextState.isLoading && nextState.url.length > 0) {
        recordVisitRef.current({ url: nextState.url, title: nextState.title });
      }
    });
    const unsubscribeSnapshot = desktopBrowser.onSnapshot?.((snapshot) => {
      if (snapshot.tabId !== tabId) return;
      setResizeSnapshotUrl(snapshot.dataUrl);
    });
    const unsubscribeControl = desktopBrowser.onControl?.((next) => {
      if (next.tabId !== tabId) return;
      setControl(next.control);
    });
    const unsubscribeFind = desktopBrowser.onFindResult?.((result) => {
      if (result.tabId !== tabId) return;
      setFindMatches({
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches
      });
    });
    void desktopBrowser.getControl?.(tabId).then((next) => {
      if (next && next.tabId === tabId) setControl(next.control);
    });
    return () => {
      unsubscribe();
      unsubscribeSnapshot?.();
      unsubscribeControl?.();
      unsubscribeFind?.();
      visibilityCoordinator?.release(tabId);
    };
  }, [automationTargetId, desktopBrowser, readBounds, tabId, threadId, visibilityCoordinator]);

  useEffect(() => {
    const element = contentRef.current;
    if (element === null || desktopBrowser === null) return;
    const onResize = () => {
      syncPlacement(false);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(element);
    window.addEventListener('resize', onResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [desktopBrowser, syncPlacement]);

  const hasPage = currentUrl.length > 0;
  const pageLoadErrorText = state?.errorText ?? null;
  const hasPageLoadError = pageLoadErrorText !== null && hasPage;
  const isViewVisible = canShowNativeBrowserView
    && hasPage
    && !hasPageLoadError
    && attached
    && !isBrowserDimmingModalOpen;

  useLayoutEffect(() => {
    if (visibilityCoordinator === null) return;
    if (isViewVisible) {
      visibilityCoordinator.show(tabId, syncBounds);
      return () => {
        visibilityCoordinator.hide(tabId);
      };
    }
    visibilityCoordinator.hide(tabId);
  }, [visibilityCoordinator, tabId, isViewVisible, syncBounds]);

  const navigateToInput = useCallback((rawInput: string) => {
    const url = resolveBrowserAddressInput(rawInput);
    if (url === null) return;
    setCurrentUrl(url);
    setIsEditing(false);
    desktopBrowser?.navigate({ tabId, url });
  }, [desktopBrowser, tabId]);

  const handleReloadOrStop = useCallback(() => {
    if (state?.isLoading ?? false) {
      desktopBrowser?.stop(tabId);
      return;
    }
    desktopBrowser?.reload(tabId);
  }, [desktopBrowser, state?.isLoading, tabId]);

  const handleFocusLocation = useCallback(() => {
    if (desktopBrowser === null) return false;
    setAddressDraft(currentUrl);
    setIsEditing(true);
    addressInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      addressInputRef.current?.focus({ preventScroll: true });
      addressInputRef.current?.select();
    });
    return true;
  }, [currentUrl, desktopBrowser]);

  const canFindInPage =
    canShowNativeBrowserView
    && desktopBrowser !== null
    && desktopBrowser.findInPage !== undefined
    && hasPage;

  const runFind = useCallback((args: Omit<DesktopBrowserFindInPageRequest, 'tabId'>) => {
    desktopBrowser?.findInPage?.({ tabId, ...args });
  }, [desktopBrowser, tabId]);

  const clearFind = useCallback(() => {
    desktopBrowser?.stopFindInPage?.({ tabId, action: 'clearSelection' });
    setFindMatches(null);
  }, [desktopBrowser, tabId]);

  const focusFindInput = useCallback(() => {
    findInputRef.current?.focus({ preventScroll: true });
    window.requestAnimationFrame(() => {
      findInputRef.current?.focus({ preventScroll: true });
      findInputRef.current?.select();
    });
  }, []);

  const handleFindQueryChange = useCallback((rawQuery: string) => {
    const query = rawQuery.slice(0, DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH);
    setFindQuery(query);
    if (query.length === 0) {
      clearFind();
      return;
    }
    runFind({ text: query, forward: true, newSession: true });
  }, [clearFind, runFind]);

  const handleFindNext = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: true, newSession: false });
  }, [findQuery, runFind]);

  const handleFindPrevious = useCallback(() => {
    if (findQuery.length === 0) return;
    runFind({ text: findQuery, forward: false, newSession: false });
  }, [findQuery, runFind]);

  const handleCloseFind = useCallback(() => {
    setIsFindOpen(false);
    clearFind();
  }, [clearFind]);

  const handleOpenFind = useCallback(() => {
    if (!canFindInPage) return false;
    setIsFindOpen(true);
    if (findQuery.length > 0) {
      runFind({ text: findQuery, forward: true, newSession: true });
    }
    focusFindInput();
    return true;
  }, [canFindInPage, findQuery, focusFindInput, runFind]);

  useEffect(() => {
    if (isFindOpen && !canFindInPage) {
      setIsFindOpen(false);
      clearFind();
    }
  }, [canFindInPage, clearFind, isFindOpen]);

  useEffect(() => {
    if (desktopBrowser === null) return;
    const unsubscribe = desktopBrowser.onAppCommand?.((command) => {
      if (command === 'browser.find') handleOpenFind();
      if (command === 'browser.focusLocation') handleFocusLocation();
      if (command === 'browser.reload' && hasPage) desktopBrowser.reload(tabId);
    });
    return () => {
      unsubscribe?.();
    };
  }, [desktopBrowser, handleFocusLocation, handleOpenFind, hasPage, tabId]);

  useEffect(() => {
    if (!isViewVisible) return;
    const onKey = (event: KeyboardEvent) => {
      if (shortcutForCommand('browser.find', event)) {
        event.preventDefault();
        handleOpenFind();
        return;
      }
      if (shortcutForCommand('browser.focusLocation', event)) {
        event.preventDefault();
        handleFocusLocation();
        return;
      }
      if (shortcutForCommand('browser.reload', event) && hasPage) {
        event.preventDefault();
        desktopBrowser?.reload(tabId);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [desktopBrowser, handleFocusLocation, handleOpenFind, hasPage, isViewVisible, tabId]);

  const handleTakeOver = useCallback(() => {
    void desktopBrowser?.releaseControl?.(tabId);
    desktopBrowser?.focus?.(tabId);
  }, [desktopBrowser, tabId]);

  const handleStopControl = useCallback(() => {
    void desktopBrowser?.releaseControl?.(tabId);
    if (automationTargetId) onStopAutomation?.(automationTargetId);
  }, [automationTargetId, desktopBrowser, onStopAutomation, tabId]);

  const controllingLabel = control?.controllerLabel ?? (automationTargetId ? 'Agent' : null);

  if (desktopBrowser === null) {
    return (
      <div className="thread-browser-tab" data-testid="thread-browser-tab">
        <BrowserUnavailable />
      </div>
    );
  }

  return (
    <div className="thread-browser-tab" data-testid="thread-browser-tab" data-app-browser="">
      {controllingLabel ? (
        <div
          className="thread-browser-automation"
          data-testid="thread-browser-automation"
          role="status"
        >
          <span>{controllingLabel} is controlling this tab</span>
          <div className="thread-browser-automation-actions">
            <button type="button" onClick={handleStopControl}>
              <Square size={12} /> Stop
            </button>
            <button type="button" data-testid="thread-browser-take-over" onClick={handleTakeOver}>
              Take over
            </button>
          </div>
        </div>
      ) : null}
      <BrowserChrome
        addressDraft={addressDraft}
        isEditing={isEditing}
        state={state}
        currentUrl={currentUrl}
        addressInputRef={addressInputRef}
        onAddressChange={setAddressDraft}
        onAddressFocus={() => {
          setAddressDraft(currentUrl);
          setIsEditing(true);
        }}
        onAddressBlur={() => setIsEditing(false)}
        onSubmit={(event) => {
          event.preventDefault();
          navigateToInput(addressDraft);
        }}
        onBack={() => desktopBrowser.goBack(tabId)}
        onForward={() => desktopBrowser.goForward(tabId)}
        onReloadOrStop={handleReloadOrStop}
        onOpenExternal={() => {
          if (currentUrl.length > 0) window.open(currentUrl, '_blank', 'noopener,noreferrer');
        }}
      />
      {isFindOpen ? (
        <BrowserFindBar
          inputRef={findInputRef}
          query={findQuery}
          matches={findMatches}
          onQueryChange={handleFindQueryChange}
          onFindNext={handleFindNext}
          onFindPrevious={handleFindPrevious}
          onClose={handleCloseFind}
          shortcutLabel={findShortcutLabel}
        />
      ) : null}
      <div ref={contentRef} className="thread-browser-view">
        {hasPageLoadError ? (
          <BrowserPageLoadError
            errorText={pageLoadErrorText}
            onOpenExternal={() => window.open(currentUrl, '_blank', 'noopener,noreferrer')}
            onRetry={handleReloadOrStop}
            url={currentUrl}
          />
        ) : hasPage && !isBrowserDimmingModalOpen ? null : (
          <BrowserNewTabScreen
            onNavigateInput={navigateToInput}
            recent={recent}
            onClearRecent={clearRecent}
          />
        )}
        {hasPage && resizeSnapshotUrl !== null ? (
          <img className="thread-browser-snapshot" src={resizeSnapshotUrl} alt="" draggable={false} />
        ) : null}
      </div>
    </div>
  );
}
