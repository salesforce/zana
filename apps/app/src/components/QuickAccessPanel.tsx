import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowUpRight, Bell, Star, X } from 'lucide-react';
import { useUi } from '../store.js';
import './quick-access-panel.css';

type PanelKind = 'notifications' | 'favorites';

/** Shared, non-modal quick access surface. The workspace remains interactive. */
export function QuickAccessPanel({ kind, summary, children, footer, onViewAll }: {
  kind: PanelKind;
  summary: string;
  children: ReactNode;
  footer: string;
  onViewAll: () => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const setNotificationsOpen = useUi((s) => s.setNotificationsDrawerOpen);
  const setFavoritesOpen = useUi((s) => s.setFavoritesDrawerOpen);
  const setOpen = kind === 'notifications' ? setNotificationsOpen : setFavoritesOpen;
  const trigger = kind === 'notifications' ? '.titlebar-bell' : '.titlebar-fav';
  const close = () => {
    setOpen(false);
    document.querySelector<HTMLButtonElement>(trigger)?.focus();
  };

  useEffect(() => {
    const element = panel.current!;
    element.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
    const dismiss = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || element.contains(target)) return;
      // Let the two launch buttons toggle/switch the panel in one click.
      if (target.closest('.titlebar-bell, .titlebar-fav')) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [kind, setOpen]);

  return (
    <aside
      ref={panel}
      id={`${kind}-panel`}
      className={`quick-access-panel ${kind}-drawer`}
      aria-label={kind === 'notifications' ? 'Notifications' : 'Favorites'}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <header className="quick-access-header">
        <div
          role="tablist"
          aria-label="Quick access"
          className="quick-access-tabs"
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 'notifications' : event.key === 'End' ? 'favorites'
              : kind === 'notifications' ? 'favorites' : 'notifications';
            if (next === 'notifications') setNotificationsOpen(true);
            else setFavoritesOpen(true);
          }}
        >
          <button type="button" role="tab" id="quick-access-notifications" aria-selected={kind === 'notifications'}
            aria-controls={kind === 'notifications' ? 'quick-access-content' : undefined}
            tabIndex={kind === 'notifications' ? 0 : -1} onClick={() => setNotificationsOpen(true)}>
            <Bell size={14} aria-hidden="true" /> Notifications
          </button>
          <button type="button" role="tab" id="quick-access-favorites" aria-selected={kind === 'favorites'}
            aria-controls={kind === 'favorites' ? 'quick-access-content' : undefined}
            tabIndex={kind === 'favorites' ? 0 : -1} onClick={() => setFavoritesOpen(true)}>
            <Star size={14} aria-hidden="true" /> Favorites
          </button>
        </div>
        <button type="button" className="quick-access-icon-button" onClick={close}
          aria-label={`Close ${kind}`} title="Close (Esc)"><X size={16} aria-hidden="true" /></button>
      </header>
      <div className="quick-access-summary">{summary}</div>
      <div className="quick-access-content" id="quick-access-content" role="tabpanel"
        aria-labelledby={`quick-access-${kind}`}>
        {children}
      </div>
      <footer className="quick-access-footer">
        <button type="button" className={kind === 'notifications' ? 'notifications-drawer-view-all' : undefined} onClick={onViewAll}>
          {footer}<ArrowUpRight size={14} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}
