import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { getNativeShell, installNativeShellEvents } from '../lib/native-shell.js';
import '../styles/mobile-shell.css';

export function useMobileNavigation() {
  const location = useLocation();
  const isCompact = useCompactLayout();
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => setDrawerOpen(false), [isCompact]);
  useEffect(() => setDrawerOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!isCompact) return;
    // visualViewport shrinks for the software keyboard even when layoutViewport
    // and 100vh do not. Restore the property on desktop/tablet transitions.
    const viewport = window.visualViewport;
    const resize = () =>
      document.documentElement.style.setProperty(
        '--mobile-viewport-height',
        `${viewport?.height ?? window.innerHeight}px`
      );
    resize();
    viewport?.addEventListener('resize', resize);
    return () => {
      viewport?.removeEventListener('resize', resize);
      document.documentElement.style.removeProperty('--mobile-viewport-height');
    };
  }, [isCompact]);
  return { isCompact, drawerOpen, setDrawerOpen };
}

export function MobileNavDrawer({
  enabled,
  open,
  onClose,
  children
}: {
  enabled: boolean;
  open: boolean;
  onClose(): void;
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
      ].filter((el) => !el.closest('[hidden]'));
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
        <button type="button" className="mobile-nav-close" onClick={onClose}>
          Close navigation
        </button>
        {children}
      </div>
    </>
  );
}

export function MobileShellReporter({ unread }: { unread: number }) {
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
