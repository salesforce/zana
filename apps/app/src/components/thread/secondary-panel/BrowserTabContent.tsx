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
import { clampDesktopBrowserViewBounds, type DesktopBrowserApi, type DesktopBrowserState, type DesktopBrowserViewBounds } from '@zana-ai/zcc-desktop-contract';
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
  const { entries: recent, recordVisit, clear: clearRecent } = useBrowserHistory(threadId);
  const [state, setState] = useState<DesktopBrowserState | null>(null);
  const [currentUrl, setCurrentUrl] = useState(initialUrl);
  const [addressDraft, setAddressDraft] = useState(initialUrl);
  const [isEditing, setIsEditing] = useState(false);
  const [resizeSnapshotUrl, setResizeSnapshotUrl] = useState<string | null>(null);
  const [attached, setAttached] = useState(false);
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
    return () => {
      unsubscribe();
      unsubscribeSnapshot?.();
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

  if (desktopBrowser === null) {
    return (
      <div className="thread-browser-tab" data-testid="thread-browser-tab">
        <BrowserUnavailable />
      </div>
    );
  }

  return (
    <div className="thread-browser-tab" data-testid="thread-browser-tab">
      {automationTargetId ? (
        <div className="thread-browser-automation" data-testid="thread-browser-automation">
          <span>Agent is controlling this page</span>
          <button
            type="button"
            onClick={() => onStopAutomation?.(automationTargetId)}
          >
            <Square size={12} /> Stop
          </button>
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
