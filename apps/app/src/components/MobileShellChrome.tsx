import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { X } from 'lucide-react';
import { SHELL_MENU_BRIDGE_VERSION } from '@zana-ai/zcc-mobile-bridge';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { getNativeShell, installNativeShellEvents } from '../lib/native-shell.js';
import zanaIcon from '../assets/zana-favicon.svg';
import { MobileNavDismiss } from './mobile-nav-context.js';
import { MobileDeviceActions } from './MobileDeviceActions.js';
import '../styles/mobile-shell.css';
import '../styles/mobile-page-header.css';

function useMobileShellChromeOwnership() {
  const compact = useCompactLayout();
  const shell = getNativeShell();
  // Keep v1/v2 phones and ordinary mobile browsers on their existing controls.
  const supported = compact && !!shell && shell.bridgeVersion >= SHELL_MENU_BRIDGE_VERSION
    && shell.capabilities.includes('open-native');
  useEffect(() => {
    if (!supported || !shell) return;
    shell.post({ type: 'shell-chrome', visible: true });
    return () => shell.post({ type: 'shell-chrome', visible: false });
  }, [shell, supported]);
}

export function useMobileNavigation() {
  const location = useLocation();
  const isCompact = useCompactLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [isCompact]);
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!isCompact) return;
    // The keyboard can shrink AND pan the visual viewport without changing the
    // layout viewport. Follow both so the composer stays above the keyboard.
    const viewport = window.visualViewport;
    const resize = () => {
      document.documentElement.style.setProperty(
        '--mobile-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`
      );
      document.documentElement.style.setProperty(
        '--mobile-viewport-top',
        `${viewport?.offsetTop ?? 0}px`
      );
      // A soft keyboard leaves well under the full height; secondary hints give way to the composer.
      const height = viewport?.height ?? window.innerHeight;
      if (height < window.innerHeight * 0.75) document.documentElement.dataset.mobileKeyboard = 'true';
      else delete document.documentElement.dataset.mobileKeyboard;
    };
    resize();
    viewport?.addEventListener('resize', resize);
    viewport?.addEventListener('scroll', resize);
    window.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      viewport?.removeEventListener('scroll', resize);
      window.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--mobile-viewport-height');
      document.documentElement.style.removeProperty('--mobile-viewport-top');
      delete document.documentElement.dataset.mobileKeyboard;
    };
  }, [isCompact]);
  return { isCompact, drawerOpen, setDrawerOpen };
}

export function MobileNavDrawer({
  enabled,
  open,
  onClose,
  headerStart,
  shortcuts,
  children
}: {
  enabled: boolean;
  open: boolean;
  onClose(): void;
  headerStart?: ReactNode;
  shortcuts?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!enabled || !open) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = ref.current;
    const focusable = () =>
      [
        ...(panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]'
        ) ?? [])
      ].filter((el) => {
        if (el.closest('[hidden]')) return false;
        // Mobile also hides desktop-only controls through CSS. Exclude their
        // ancestors too so tabbing wraps to an actually visible destination.
        for (let node: HTMLElement | null = el; node && node !== panel; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
        }
        return true;
      });
    (focusable()[0] ?? panel)?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      const first = elements[0];
      const last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      }
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel?.addEventListener('keydown', keydown);
    return () => {
      panel?.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [enabled, open]);
  if (!enabled) return children;
  if (!open) return null;
  return (
    <>
      <button
        type="button"
        className="mobile-nav-backdrop"
        aria-label="Close navigation"
        onClick={onClose}
        tabIndex={-1}
      />
      <div
        ref={ref}
        className="mobile-nav-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
      >
        <header className="mobile-nav-header">
          {headerStart ?? <span className="mobile-nav-brand"><img src={zanaIcon} width={28} height={28} alt="" draggable={false} />Zana</span>}
          <div className="mobile-nav-header-actions">
            <MobileDeviceActions />
            <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={onClose}>
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        </header>
        {shortcuts}
        <MobileNavDismiss.Provider value={onClose}>{children}</MobileNavDismiss.Provider>
      </div>
    </>
  );
}

export function MobileShellReporter({ unread }: { unread: number }) {
  useMobileShellChromeOwnership();
  const location = useLocation();
  useEffect(
    () =>
      installNativeShellEvents(() => {
        // Existing product clients own reconnection. Wake visibility/focus consumers
        // when the native app returns, without reloading an unsent composer.
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      }),
    []
  );
  useEffect(() => {
    getNativeShell()?.post({
      type: 'title',
      title: document.title,
      path: location.pathname + location.search
    });
  }, [location.pathname, location.search]);
  useEffect(() => {
    const shell = getNativeShell();
    if (shell?.capabilities.includes('badge'))
      shell.post({ type: 'badge', count: Math.max(0, unread) });
  }, [unread]);
  return null;
}
