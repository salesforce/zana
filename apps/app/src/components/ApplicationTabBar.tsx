import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronDown, Plus, RotateCcw, X } from 'lucide-react';
import {
  ApplicationTabContextMenu,
  type ApplicationTabMenuItem
} from './ApplicationTabContextMenu.js';
import type { ApplicationTab } from '../lib/application-tabs.js';
import './ApplicationTabs.css';

export interface ApplicationTabView {
  id: string;
  kind: ApplicationTab['kind'];
  title: string;
  context: string;
  label: string;
  tooltip?: string;
  icon: ReactNode;
  status?: ReactNode;
  unread?: boolean;
  active: boolean;
  busy: boolean;
  closeHint: string;
  actions: ApplicationTabMenuItem[];
  footerActions?: ApplicationTabMenuItem[];
}

/** Presentation and common tab commands are independent of the content type. */
export function ApplicationTabBar({
  tabs,
  onSelect,
  onClose,
  onMove,
  onNewThread,
  onReopen,
  locationKey
}: {
  tabs: ApplicationTabView[];
  onSelect(id: string): void;
  onClose(ids: string[]): void;
  onMove(id: string, targetId: string): void;
  onNewThread?: () => void;
  onReopen?: () => void;
  locationKey: string;
}) {
  const [query, setQuery] = useState('');
  const [contextMenu, setContextMenu] = useState<{
    id: string;
    x: number;
    y: number;
    anchor: HTMLElement;
  } | null>(null);
  const dismissContextMenu = useCallback(() => setContextMenu(null), []);
  const [position, setPosition] = useState({ left: 8, top: 44 });
  const strip = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDetailsElement>(null);
  const dragging = useRef<string | null>(null);
  const activeId = tabs.find((tab) => tab.active)?.id;
  const order = tabs.map((tab) => tab.id).join('\n');
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [activeId, order]);
  useLayoutEffect(() => {
    if (menu.current) menu.current.open = false;
    setContextMenu(null);
    setQuery('');
  }, [locationKey]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (menu.current && !menu.current.contains(event.target as Node))
        menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector('summary')?.focus();
      }
    };
    const resize = () => {
      if (menu.current) menu.current.open = false;
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('resize', resize);
    };
  }, []);
  const select = (id: string) => {
    onSelect(id);
    if (menu.current) menu.current.open = false;
  };
  const openActions = (
    id: string,
    anchor: HTMLElement,
    x: number,
    y: number
  ) => {
    if (menu.current) menu.current.open = false;
    setContextMenu({ id, anchor, x, y });
  };
  const target = tabs.find((tab) => tab.id === contextMenu?.id);
  const index = tabs.findIndex((tab) => tab.id === target?.id);
  const closable = (items: ApplicationTabView[]) =>
    items.some((tab) => !tab.busy);
  const matches = tabs.filter((tab) =>
    `${tab.title} ${tab.context} ${tab.kind}`
      .toLowerCase()
      .includes(query.toLowerCase())
  );
  return (
    <div className="titlebar-threads" data-testid="application-tabs">
      <div
        className="titlebar-threads-strip"
        role="tablist"
        aria-label="Open tabs"
        ref={strip}
        onKeyDown={(event) => {
          if (
            !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) ||
            !(event.target instanceof HTMLElement) ||
            event.target.getAttribute('role') !== 'tab'
          )
            return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="tab"]'
            )
          ];
          const current = buttons.indexOf(event.target as HTMLButtonElement);
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? buttons.length - 1
                : (current +
                    (event.key === 'ArrowRight' ? 1 : -1) +
                    buttons.length) %
                  buttons.length;
          event.preventDefault();
          buttons[next]?.focus();
          buttons[next]?.click();
        }}
      >
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            data-tab-id={tab.id}
            data-tab-kind={tab.kind}
            className={`titlebar-thread ${tab.active ? 'is-active' : ''} ${tab.unread ? 'is-unread' : ''}`}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openActions(
                tab.id,
                event.currentTarget.querySelector<HTMLButtonElement>(
                  '[role="tab"]'
                )!,
                event.clientX,
                event.clientY
              );
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab.active}
              aria-label={tab.label}
              tabIndex={tab.active || (!activeId && index === 0) ? 0 : -1}
              title={tab.tooltip ?? tab.label}
              aria-haspopup="menu"
              aria-expanded={contextMenu?.id === tab.id}
              draggable
              onDragStart={(event) => {
                dragging.current = tab.id;
                event.dataTransfer.setData('text/plain', tab.id);
                event.dataTransfer.effectAllowed = 'move';
              }}
              onDragOver={(event) => {
                if (dragging.current) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragging.current) onMove(dragging.current, tab.id);
                dragging.current = null;
              }}
              onDragEnd={() => {
                dragging.current = null;
              }}
              onKeyDown={(event) => {
                if (
                  event.key !== 'ContextMenu' &&
                  !(event.shiftKey && event.key === 'F10')
                )
                  return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                openActions(
                  tab.id,
                  event.currentTarget,
                  rect.left,
                  rect.bottom
                );
              }}
              onClick={() => select(tab.id)}
            >
              {tab.icon}
              <span className="titlebar-thread-copy">
                <span className="titlebar-thread-name">{tab.title}</span>
                <span className="titlebar-thread-context">
                  <span className="titlebar-thread-project">{tab.context}</span>
                  {tab.unread && (
                    <span
                      className="titlebar-thread-unread-label"
                      aria-hidden="true"
                    >
                      <span className="titlebar-thread-context-separator">
                        /
                      </span>
                      New
                    </span>
                  )}
                </span>
              </span>
              {tab.status}
            </button>
            <button
              type="button"
              className="titlebar-thread-close"
              aria-label={`Close tab: ${tab.title}`}
              title={tab.closeHint}
              disabled={tab.busy}
              onClick={() => onClose([tab.id])}
            >
              <X size={12} />
            </button>
          </div>
        ))}
        {tabs.length === 0 && (
          <span className="titlebar-threads-empty">No open tabs</span>
        )}
      </div>
      {onNewThread && (
        <button
          type="button"
          className="titlebar-threads-action"
          aria-label="New thread"
          title="New thread"
          onClick={onNewThread}
        >
          <Plus size={16} />
        </button>
      )}
      <details
        className="titlebar-threads-menu"
        ref={menu}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            dismissContextMenu();
            const rect = event.currentTarget.getBoundingClientRect();
            setPosition({
              left: Math.max(
                8,
                Math.min(rect.right - 330, window.innerWidth - 338)
              ),
              top: rect.bottom + 4
            });
            event.currentTarget.querySelector('input')?.focus();
          } else setQuery('');
        }}
      >
        <summary
          className="titlebar-threads-action"
          aria-label="All open tabs"
          title="All open tabs"
        >
          <ChevronDown size={15} />
        </summary>
        <div className="titlebar-threads-popover" style={position}>
          <input
            aria-label="Find an open tab"
            placeholder="Find an open tab…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="titlebar-threads-results">
            {matches.map((tab) => (
              <button
                type="button"
                key={tab.id}
                onClick={() => select(tab.id)}
                aria-current={tab.active ? 'page' : undefined}
              >
                {tab.icon}
                <span>
                  {tab.title}
                  <small>{tab.context}</small>
                </span>
              </button>
            ))}
            {matches.length === 0 && (
              <p className="titlebar-tabs-empty-results">
                {query ? 'No matching tabs' : 'No open tabs'}
              </p>
            )}
          </div>
          {onReopen && (
            <button
              type="button"
              className="titlebar-threads-reopen"
              onClick={onReopen}
            >
              <RotateCcw size={13} />
              Reopen closed tab
            </button>
          )}
        </div>
      </details>
      {contextMenu && target && (
        <ApplicationTabContextMenu
          {...contextMenu}
          onClose={dismissContextMenu}
          note={target.closeHint}
          items={[
            ...target.actions,
            {
              label: 'Move tab left',
              separatorBefore: target.actions.length > 0,
              disabled: index <= 0,
              run: () => onMove(target.id, tabs[index - 1]!.id)
            },
            {
              label: 'Move tab right',
              disabled: index === tabs.length - 1,
              run: () => onMove(target.id, tabs[index + 1]!.id)
            },
            {
              label: 'Close tab',
              separatorBefore: true,
              disabled: target.busy,
              run: () => onClose([target.id])
            },
            {
              label: 'Close other tabs',
              disabled: !closable(tabs.filter((tab) => tab !== target)),
              run: () =>
                onClose(
                  tabs.filter((tab) => tab !== target).map((tab) => tab.id)
                )
            },
            {
              label: 'Close tabs to the right',
              disabled: !closable(tabs.slice(index + 1)),
              run: () => onClose(tabs.slice(index + 1).map((tab) => tab.id))
            },
            {
              label: 'Close all tabs',
              disabled: !closable(tabs),
              run: () => onClose(tabs.map((tab) => tab.id))
            },
            {
              label: 'Reopen closed tab',
              separatorBefore: true,
              disabled: !onReopen,
              run: () => onReopen?.()
            },
            ...(target.footerActions ?? [])
          ]}
        />
      )}
    </div>
  );
}
