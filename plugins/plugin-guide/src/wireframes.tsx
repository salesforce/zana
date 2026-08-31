import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode
} from 'react';
import { SURFACE_GROUPS, SURFACES_BY_ID } from './surfaces.js';
import {
  annotationChipClass,
  annotationChipCounterScale,
  CHIP_PLACEMENT_CLASS,
  ExperimentalBadge,
  type AnnotationChipPlacement
} from './annotation.js';

export interface SurfaceMapState {
  activeId: string | null;
  setActiveId: (id: string | null) => void;
  expandedId: string | null;
  spotlightId?: string | null;
  numberOf: (id: string) => number | null;
  pluginPageHref?: (displayName: string) => string | null;
  onSelect?: (id: string) => void;
  currentGroupId?: string;
  onGoToSurface?: (id: string) => void;
}

export const SurfaceMapContext = createContext<SurfaceMapState | null>(null);

export function useSurfaceMap(): SurfaceMapState {
  const state = useContext(SurfaceMapContext);
  if (!state) {
    throw new Error('useSurfaceMap must be used inside a SurfaceMapContext');
  }
  return state;
}

function useEngagement(id: string) {
  const { activeId, expandedId, spotlightId } = useSurfaceMap();
  return {
    active: activeId === id || expandedId === id || spotlightId === id,
    outlined: activeId !== null ? activeId === id : expandedId === id || spotlightId === id,
    dimmed: Boolean(spotlightId) && spotlightId !== id
  };
}

function classNames(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

function Plug({ className }: { className?: string }): ReactNode {
  return (
    <svg className={className ?? 'plugin-guide-glyph'} viewBox="0 0 16 16" aria-hidden>
      <path
        fill="currentColor"
        d="M5.2 1.5v3H3.8V1.5h1.4zm7 0v3h-1.4V1.5H12.2zM4.5 5.2h7c.7 0 1.3.6 1.3 1.3v3.2c0 2.4-1.6 4.4-3.8 5v1.8H7v-1.8c-2.2-.6-3.8-2.6-3.8-5V6.5c0-.7.6-1.3 1.3-1.3z"
      />
    </svg>
  );
}

type IconName =
  | 'pen'
  | 'inbox'
  | 'bot'
  | 'clock'
  | 'blocks'
  | 'sidebar'
  | 'more'
  | 'plus'
  | 'search'
  | 'term'
  | 'back'
  | 'fwd'
  | 'settings'
  | 'bug'
  | 'filter'
  | 'activity'
  | 'folderTree'
  | 'paperclip'
  | 'mic'
  | 'send'
  | 'folder'
  | 'appWindow'
  | 'agents'
  | 'cal'
  | 'plugins'
  | 'home';

/** Stroke icons matching the host Lucide set (SquarePen, Bot, Blocks, …). */
function Icon({ name, className }: { name: IconName; className?: string }): ReactNode {
  return (
    <svg
      className={className ?? 'plugin-guide-glyph'}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {iconGlyph(name)}
    </svg>
  );
}

const ICON_PATHS: Record<Exclude<IconName, 'agents' | 'cal' | 'plugins' | 'home'>, ReactNode> = {
  pen: (
    <>
      <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z" />
    </>
  ),
  inbox: (
    <>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </>
  ),
  bot: (
    <>
      <path d="M12 8V4H8" />
      <rect width="16" height="12" x="4" y="8" rx="2" />
      <path d="M2 14h2" />
      <path d="M20 14h2" />
      <circle cx="9" cy="13" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="13" r="0.6" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  blocks: (
    <>
      <rect width="7" height="7" x="14" y="3" rx="1" />
      <path d="M10 21V8a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1H3" />
    </>
  ),
  sidebar: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
      <path d="m16 15-3-3 3-3" />
    </>
  ),
  more: (
    <>
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M5 12h14M12 5v14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3-3" />
    </>
  ),
  term: (
    <>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="m8 9 3 3-3 3" />
      <path d="M13 15h4" />
    </>
  ),
  back: <path d="M19 12H5M12 19l-7-7 7-7" />,
  fwd: <path d="M5 12h14M12 5l7 7-7 7" />,
  settings: (
    <>
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </>
  ),
  bug: (
    <>
      <path d="M8 2l1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3 3 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </>
  ),
  filter: (
    <>
      <path d="M3 6h18" />
      <path d="M7 12h10" />
      <path d="M10 18h4" />
    </>
  ),
  activity: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />,
  folderTree: (
    <>
      <path d="M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" />
      <path d="M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.88-.55H9.5a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1Z" />
      <path d="M3 5.5a2.5 2.5 0 0 1 5 0v10a2.5 2.5 0 0 1-5 0Z" />
    </>
  ),
  paperclip: <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />,
  mic: (
    <>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" x2="12" y1="19" y2="22" />
    </>
  ),
  send: <path d="M12 19V5M5 12l7-7 7 7" />,
  folder: (
    <>
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </>
  ),
  appWindow: (
    <>
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="M2 8h20" />
    </>
  )
};

const ICON_ALIASES: Record<'agents' | 'cal' | 'plugins' | 'home', keyof typeof ICON_PATHS> = {
  agents: 'bot',
  cal: 'clock',
  plugins: 'blocks',
  home: 'folderTree'
};

function iconGlyph(name: IconName): ReactNode {
  if (name === 'agents' || name === 'cal' || name === 'plugins' || name === 'home') {
    return ICON_PATHS[ICON_ALIASES[name]];
  }
  return ICON_PATHS[name];
}

function Mark({
  id,
  label,
  className,
  chip = 'corner',
  showChip = true,
  onActivate,
  title,
  children
}: {
  id: string;
  label: string;
  className?: string;
  chip?: AnnotationChipPlacement;
  showChip?: boolean;
  onActivate?: () => void;
  title?: string;
  children?: ReactNode;
}): ReactNode {
  const { setActiveId, numberOf, onSelect } = useSurfaceMap();
  const { active, outlined, dimmed } = useEngagement(id);
  return (
    <a
      data-guide-region={id}
      href={`#surface-${id}`}
      title={title}
      aria-label={`${label} — jump to details`}
      className={classNames(
        'plugin-guide-mark',
        outlined && 'is-outlined',
        dimmed && 'is-dimmed',
        className
      )}
      onClick={(event) => {
        onActivate?.();
        if (!onSelect) return;
        event.preventDefault();
        event.stopPropagation();
        onSelect(id);
      }}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
    >
      {showChip ? (
        <span aria-hidden data-guide-badge={id} className={annotationChipClass(active, CHIP_PLACEMENT_CLASS[chip])}>
          {numberOf(id)}
        </span>
      ) : null}
      {children}
    </a>
  );
}

const CHIP_SIZE = 20;
const CHIP_GAP = 8;

function MeasuredBadge({
  id,
  label,
  anchor,
  at,
  onActivate
}: {
  id: string;
  label: string;
  anchor: string;
  at: 'start' | 'end' | 'above';
  onActivate?: () => void;
}): ReactNode {
  const { setActiveId, numberOf, onSelect } = useSurfaceMap();
  const { active } = useEngagement(id);
  const ref = useRef<HTMLAnchorElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    const container = element?.offsetParent;
    if (!element || !(container instanceof HTMLElement)) return;
    const scope = container.closest<HTMLElement>('[data-map-section]') ?? container;
    const target = scope.querySelector<HTMLElement>(anchor);
    if (!target) return;
    const measure = () => {
      const strategy = container.closest<HTMLElement>('[data-guide-responsive-strategy]');
      const scale = Number(strategy?.dataset.guideScale ?? '1') || 1;
      const counter = annotationChipCounterScale(scale);
      const chipBox = CHIP_SIZE * counter;
      const gap = CHIP_GAP * counter;
      const cr = container.getBoundingClientRect();
      const tr = target.getBoundingClientRect();
      const fr = (container.querySelector<HTMLElement>('[data-guide-frame]') ?? container).getBoundingClientRect();
      const local = {
        left: (tr.left - cr.left) / scale,
        top: (tr.top - cr.top) / scale,
        width: tr.width / scale,
        height: tr.height / scale
      };
      const frame = {
        left: (fr.left - cr.left) / scale,
        right: (fr.right - cr.left) / scale
      };
      const next =
        at === 'start'
          ? { left: frame.left - chipBox - gap, top: local.top + local.height / 2 - chipBox / 2 }
          : at === 'end'
            ? { left: frame.right + gap, top: local.top + local.height / 2 - chipBox / 2 }
            : {
                left: local.left + local.width / 2 - chipBox / 2,
                top: local.top - chipBox - 4
              };
      setPosition((current) =>
        current && Math.abs(current.left - next.left) < 0.5 && Math.abs(current.top - next.top) < 0.5
          ? current
          : next
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(target);
    return () => observer.disconnect();
  }, [anchor, at]);

  return (
    <a
      ref={ref}
      data-guide-badge={id}
      href={`#surface-${id}`}
      aria-label={`${label} — jump to details`}
      className={annotationChipClass(active, 'plugin-guide-measured-chip')}
      style={
        (position
          ? { left: position.left, top: position.top }
          : { visibility: 'hidden' }) as CSSProperties
      }
      onClick={(event) => {
        onActivate?.();
        if (!onSelect) return;
        event.preventDefault();
        onSelect(id);
      }}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
      onFocus={() => setActiveId(id)}
      onBlur={() => setActiveId(null)}
    >
      {numberOf(id)}
    </a>
  );
}

function WindowFrame({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="plugin-guide-window" data-guide-frame>
      {children}
    </div>
  );
}

function TrafficLights(): ReactNode {
  return (
    <span className="plugin-guide-traffic-row" aria-hidden>
      <span className="plugin-guide-traffic" />
      <span className="plugin-guide-traffic" />
      <span className="plugin-guide-traffic" />
    </span>
  );
}

export function AppShellWireframe(): ReactNode {
  const [workspace, setWorkspace] = useState<'agents' | 'library'>('agents');
  const menu = useEngagement('experimental_projectMenuAction');
  return (
    <div className="plugin-guide-stage">
      <MeasuredBadge id="navPanel" label="Sidebar panel" anchor='[data-guide-region="navPanel"]' at="start" />
      <MeasuredBadge
        id="sidebarFooterAction"
        label="Sidebar footer"
        anchor='[data-guide-region="sidebarFooterAction"]'
        at="start"
      />
      <MeasuredBadge id="projectTab" label="Project tab" anchor='[data-guide-region="projectTab"]' at="end" />
      <WindowFrame>
        <div className="plugin-guide-shell plugin-guide-shell--bb">
          <span className="plugin-guide-sidebar-trigger" aria-hidden>
            <Icon name="sidebar" />
          </span>
          <aside className="plugin-guide-fx-nav plugin-guide-fx-nav--wide">
            <div className="plugin-guide-fx-titlebar plugin-guide-fx-titlebar--reserve">
              <Icon name="back" />
              <Icon name="fwd" />
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="plus" /> New Chat
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="inbox" /> Inbox
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="agents" /> Agents
              <span className="plugin-guide-status-dot" aria-hidden />
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="cal" /> Scheduler
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="plugins" /> Plugins
            </div>
            <Mark id="navPanel" label="Sidebar panel" showChip={false} className="plugin-guide-fx-nav-row is-plugin">
              <Icon name="folder" /> Tasks
            </Mark>
            <div className="plugin-guide-thread-stack">
              <div className="plugin-guide-ws-head">
                <span className="plugin-guide-fx-section plugin-guide-ws-head-title">Workspaces</span>
                <span className="plugin-guide-ws-head-actions">
                  <Mark
                    id="experimental_projectMenuAction"
                    label="Project / workspace menu"
                    chip="side"
                    className="plugin-guide-icon-hit"
                    title="Organize workspaces"
                  >
                    <Icon name="filter" />
                    {menu.outlined ? (
                      <span className="plugin-guide-ws-menu" aria-hidden>
                        <span className="plugin-guide-ws-menu-label">Sort by</span>
                        <span>Manual order</span>
                        <span className="plugin-guide-ws-menu-label">Plugins</span>
                        <span className="is-plugin">
                          <Plug /> Your action
                        </span>
                      </span>
                    ) : null}
                  </Mark>
                  <span className="plugin-guide-icon-hit" title="Workspace menu">
                    <Icon name="more" />
                  </span>
                  <span className="plugin-guide-icon-hit" title="Add project">
                    <Icon name="plus" />
                  </span>
                </span>
              </div>
              <span className="plugin-guide-fx-folder">zana-command-center</span>
              <span className="plugin-guide-fx-nav-row is-plugin">
                Acme
                <span className="plugin-guide-fx-overflow">
                  <Icon name="more" />
                </span>
              </span>
              <span className="plugin-guide-fx-nav-row">checkout-api</span>
              <span className="plugin-guide-fx-nav-row">docs-site</span>
            </div>
            <Mark
              id="sidebarFooterAction"
              label="Sidebar footer"
              showChip={false}
              className="plugin-guide-fx-footer plugin-guide-fx-footer--bb"
            >
              <span className="plugin-guide-fx-footer-plug">
                <Plug />
              </span>
              <Icon name="settings" />
              <Icon name="bug" />
            </Mark>
          </aside>
          <aside className="plugin-guide-fx-list">
            <header className="plugin-guide-fx-list-head plugin-guide-ws-rail-head">
              <Icon name="back" /> Acme
            </header>
            <button
              type="button"
              className={classNames('plugin-guide-fx-list-row', workspace === 'agents' && 'is-selected')}
              onClick={() => setWorkspace('agents')}
            >
              <Icon name="agents" /> Agents
            </button>
            <div className="plugin-guide-fx-list-row">
              <Icon name="inbox" /> Feed
            </div>
            <div className="plugin-guide-fx-list-row">
              <Icon name="term" /> Terminals
            </div>
            <div className="plugin-guide-fx-list-row">
              <Icon name="home" /> Explorer
            </div>
            <div className="plugin-guide-fx-list-row">
              <Icon name="cal" /> Scheduler
            </div>
            <Mark
              id="projectTab"
              label="Project tab"
              showChip={false}
              className={classNames('plugin-guide-fx-list-row', workspace === 'library' && 'is-selected')}
              onActivate={() => setWorkspace('library')}
            >
              <Plug /> Library
            </Mark>
          </aside>
          <section className="plugin-guide-workspace">
            <header className="plugin-guide-ws-topbar">
              <span>{workspace === 'library' ? 'Library' : 'Agents'}</span>
            </header>
            {workspace === 'library' ? (
              <div className="plugin-guide-fx-canvas">
                <div className="plugin-guide-fx-card">
                  <strong>Library</strong>
                  <p>A project-scoped plugin tab on this workspace rail. Fill the slot; keep reading width on an inner wrapper.</p>
                </div>
                <div className="plugin-guide-fx-skel" />
                <div className="plugin-guide-fx-skel is-short" />
              </div>
            ) : (
              <div className="plugin-guide-agents-board">
                <div className="plugin-guide-agent-col">
                  <span className="plugin-guide-agent-col-head">Running</span>
                  <div className="plugin-guide-agent-card is-live">
                    <span className="plugin-guide-tl-meta">
                      <Icon name="agents" /> Pairing relay
                    </span>
                    <p>Ship the pairing flow on this host.</p>
                  </div>
                </div>
                <div className="plugin-guide-agent-col">
                  <span className="plugin-guide-agent-col-head">Idle</span>
                  <div className="plugin-guide-agent-card">
                    <span className="plugin-guide-tl-meta">
                      <Icon name="agents" /> Checkout flakes
                    </span>
                    <p>Fix the flaky checkout tests</p>
                  </div>
                </div>
              </div>
            )}
          </section>
        </div>
      </WindowFrame>
    </div>
  );
}

function GuideComposerCard({
  variant,
  children
}: {
  variant: 'home' | 'thread';
  children: ReactNode;
}): ReactNode {
  return (
    <div className={classNames('plugin-guide-composer-card', variant === 'home' && 'is-home')}>
      <div className="plugin-guide-composer-prompt">{children}</div>
      <div className="plugin-guide-composer-tools">
        <div className="plugin-guide-composer-tools-start">
          {variant === 'thread' ? <span className="plugin-guide-picker">Agent</span> : null}
          <span className="plugin-guide-picker">
            <Icon name="agents" />
            Claude Code
          </span>
        </div>
        <div className="plugin-guide-composer-tools-end">
          <span className="plugin-guide-composer-icon" title="Attach files">
            <Icon name="paperclip" />
          </span>
          <span className="plugin-guide-composer-icon" title="Voice input">
            <Icon name="mic" />
          </span>
          <span className="plugin-guide-send" title="Send">
            <Icon name="send" />
          </span>
        </div>
      </div>
    </div>
  );
}

function GuideComposerMeta({
  project,
  permission
}: {
  project: string;
  permission?: string;
}): ReactNode {
  return (
    <div className="plugin-guide-composer-meta">
      <span className="plugin-guide-composer-chip">
        <Icon name="folder" />
        {project}
      </span>
      {permission ? <span className="plugin-guide-picker">{permission}</span> : null}
    </div>
  );
}

export function HomeWireframe(): ReactNode {
  return (
    <div className="plugin-guide-stage">
      <MeasuredBadge
        id="experimental_newThreadPanelAction"
        label="New-thread action"
        anchor='[data-guide-region="experimental_newThreadPanelAction"]'
        at="end"
      />
      <WindowFrame>
        <div className="plugin-guide-home">
          <aside className="plugin-guide-fx-nav">
            <div className="plugin-guide-fx-titlebar plugin-guide-fx-titlebar--reserve">
              <Icon name="back" />
              <Icon name="fwd" />
            </div>
            <div className="plugin-guide-fx-nav-row is-plugin">
              <Icon name="pen" /> New Chat
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="inbox" /> Inbox
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="agents" /> Agents
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="cal" /> Scheduler
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="plugins" /> Plugins
            </div>
            <div className="plugin-guide-thread-stack">
              <div className="plugin-guide-ws-head">
                <span className="plugin-guide-fx-section plugin-guide-ws-head-title">Workspaces</span>
                <span className="plugin-guide-ws-head-actions">
                  <span className="plugin-guide-icon-hit">
                    <Icon name="filter" />
                  </span>
                  <span className="plugin-guide-icon-hit">
                    <Icon name="more" />
                  </span>
                  <span className="plugin-guide-icon-hit">
                    <Icon name="plus" />
                  </span>
                </span>
              </div>
              <span className="plugin-guide-fx-folder">zana-command-center</span>
              <span className="plugin-guide-fx-nav-row">Acme</span>
            </div>
          </aside>
          <div className="plugin-guide-home-main aurora-host">
            <div className="aurora-grid" aria-hidden />
            <div className="plugin-guide-home-column">
              <GuideComposerCard variant="home">
                <span className="plugin-guide-composer-placeholder">Describe the task…</span>
              </GuideComposerCard>
              <GuideComposerMeta project="Acme" />
              <Mark
                id="experimental_newThreadPanelAction"
                label="New-thread action"
                showChip={false}
                className="plugin-guide-home-cta"
              >
                <Plug /> Your action
              </Mark>
              <Mark id="homepageSection" label="Home section" className="plugin-guide-home-section">
                <span className="plugin-guide-home-section-kicker">
                  <Plug /> Your section
                </span>
                <div className="plugin-guide-home-tiles">
                  {['Release 1.4', 'Bug triage', 'Design QA'].map((card) => (
                    <span key={card} className="plugin-guide-home-tile">
                      <strong>{card}</strong>
                      <i className="plugin-guide-skel" />
                      <i className="plugin-guide-skel is-short" />
                    </span>
                  ))}
                </div>
              </Mark>
            </div>
          </div>
        </div>
      </WindowFrame>
    </div>
  );
}

export function ComposerWireframe(): ReactNode {
  const plus = useEngagement('composer');
  return (
    <div className="plugin-guide-stage">
      <MeasuredBadge id="composer" label="Composer chrome" anchor='[data-guide-region="composer"]' at="start" />
      <WindowFrame>
        <div className="plugin-guide-thread-lite">
          <aside className="plugin-guide-fx-nav">
            <div className="plugin-guide-fx-titlebar plugin-guide-fx-titlebar--reserve">
              <Icon name="back" />
              <Icon name="fwd" />
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="pen" /> New Chat
            </div>
            <div className="plugin-guide-fx-nav-row">
              <Icon name="inbox" /> Inbox
            </div>
            <div className="plugin-guide-fx-nav-row is-plugin">
              <Icon name="agents" /> Agents
            </div>
            <div className="plugin-guide-thread-stack">
              <div className="plugin-guide-ws-head">
                <span className="plugin-guide-fx-section plugin-guide-ws-head-title">Workspaces</span>
              </div>
              <span className="plugin-guide-fx-nav-row">Acme</span>
            </div>
          </aside>
          <section className="plugin-guide-thread-main">
            <header className="plugin-guide-thread-head">
              <span>Ship the pairing flow</span>
              <span className="plugin-guide-head-action">
                <Icon name="more" />
              </span>
            </header>
            <div className="plugin-guide-timeline plugin-guide-timeline--short">
              <div className="plugin-guide-bubble is-user">Draft the pairing notes</div>
              <p className="plugin-guide-assistant-line">
                Drafted. Two rough edges left in pairing — reply with what to fold in.
              </p>
            </div>
            <Mark id="composer" label="Composer chrome" showChip={false} className="plugin-guide-composer-mark">
              <div className="plugin-guide-banner">
                <Plug /> Your banner
              </div>
              <GuideComposerCard variant="thread">
                <span className="plugin-guide-draft">
                  Summarize <span className="plugin-guide-mention-pill">@release-notes</span> and fix the{' '}
                  <span className="plugin-guide-rich">TODO</span> in checkout.
                </span>
              </GuideComposerCard>
              <div
                className="plugin-guide-composer-actions"
                data-guide-transient-for={plus.outlined ? 'composer' : undefined}
                aria-hidden
              >
                <span className="plugin-guide-plus-chip is-plugin">
                  <Plug /> Your action
                </span>
              </div>
              <GuideComposerMeta project="Acme" permission="Full Access" />
            </Mark>
          </section>
        </div>
      </WindowFrame>
    </div>
  );
}

export function ThreadWireframe(): ReactNode {
  const { expandedId } = useSurfaceMap();
  const [hovered, setHovered] = useState(false);
  const actionsVisible = hovered || expandedId === 'messageAction';
  return (
    <div className="plugin-guide-stage">
      <MeasuredBadge
        id="experimental_threadList"
        label="Agents list"
        anchor='[data-guide-region="experimental_threadList"]'
        at="start"
      />
      <WindowFrame>
        <div className="plugin-guide-thread">
          <aside className="plugin-guide-fx-list">
            <header className="plugin-guide-fx-list-head">Agents</header>
            <Mark
              id="experimental_threadList"
              label="Agents list"
              showChip={false}
              className="plugin-guide-fx-list-body"
            >
              <div className="plugin-guide-fx-list-row is-selected">Fix flaky checkout tests</div>
              <div className="plugin-guide-fx-list-row">Refactor settings page</div>
              <div className="plugin-guide-fx-list-row">Ship dark mode</div>
            </Mark>
          </aside>
          <section className="plugin-guide-thread-main">
            <header className="plugin-guide-thread-head">
              <span>Fix flaky checkout tests</span>
              <Mark
                id="experimental_threadHeaderAction"
                label="Thread header"
                chip="side"
                className="plugin-guide-head-action"
              >
                <Plug />
              </Mark>
            </header>
            <div className="plugin-guide-timeline">
              <div className="plugin-guide-bubble is-user">Fix the flaky checkout tests</div>
              <div className="plugin-guide-tl-plugin">
                <span className="plugin-guide-tl-meta">
                  <Plug /> Re-ran checkout suite <em>Completed</em>
                </span>
                <Mark
                  id="experimental_timelineRenderer"
                  label="Timeline renderer"
                  chip="side"
                  className="plugin-guide-tl-body"
                >
                  <span className="plugin-guide-bar" />
                  <span className="plugin-guide-bar is-accent" />
                </Mark>
              </div>
              <div
                className="plugin-guide-assistant"
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
              >
                <p>The retries cluster in two suites. Failure rate by suite:</p>
                <Mark id="messageDirective" label="Message directive" chip="side" className="plugin-guide-directive">
                  <span className="plugin-guide-bars" aria-hidden>
                    <i />
                    <i className="is-tall" />
                    <i />
                    <i className="is-mid" />
                    <i />
                  </span>
                  <span>
                    <Plug /> ::your-directive
                  </span>
                </Mark>
                <p>
                  Fixed by isolating the <strong>Stripe mock</strong> per test.
                </p>
                <Mark
                  id="messageAction"
                  label="Message action"
                  chip="side"
                  className={classNames('plugin-guide-msg-actions', actionsVisible && 'is-visible')}
                >
                  Copy <Plug /> Your action
                </Mark>
                <Mark id="fileOpener" label="File opener" chip="side" className="plugin-guide-file">
                  checkout.spec.ts · Open with plugin
                </Mark>
              </div>
            </div>
            <Mark id="pendingInteraction" label="Pending interaction" className="plugin-guide-pending">
              <span>
                <Plug /> Pick a release channel
              </span>
              <span className="plugin-guide-pending-row">
                <span className="plugin-guide-field" />
                <span className="plugin-guide-btn">Cancel</span>
                <span className="plugin-guide-btn is-primary">Submit</span>
              </span>
            </Mark>
          </section>
          <aside className="plugin-guide-side">
            <header className="plugin-guide-side-tabs">
              <Mark id="threadPanelAction" label="Thread panel" chip="outside-above" className="plugin-guide-side-tab is-active">
                <Plug /> Tasks
              </Mark>
              <span className="plugin-guide-side-tab">Files</span>
            </header>
            <div className="plugin-guide-side-body">
              <strong>Open tasks</strong>
              <div className="plugin-guide-skel" />
              <div className="plugin-guide-skel is-short" />
            </div>
          </aside>
        </div>
      </WindowFrame>
    </div>
  );
}

const RELEASE_DEMO_MS = 2400;

export function PaletteWireframe(): ReactNode {
  const [paletteOpen, setPaletteOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const restore = useRef<number | undefined>(undefined);
  const run = () => {
    setPaletteOpen(false);
    setPanelOpen(true);
    window.clearTimeout(restore.current);
    restore.current = window.setTimeout(() => setPaletteOpen(true), RELEASE_DEMO_MS);
  };
  useEffect(() => () => window.clearTimeout(restore.current), []);

  return (
    <div
      className="plugin-guide-stage"
      data-guide-fixture="command-palette-flow"
      data-guide-state={paletteOpen ? 'palette-open' : 'release-checklist-open'}
    >
      <WindowFrame>
        <div className="plugin-guide-palette-stage">
          <div className="plugin-guide-thread plugin-guide-thread--palette">
            <aside className="plugin-guide-fx-nav">
              <div className="plugin-guide-fx-titlebar">
                <TrafficLights />
              </div>
              <div className="plugin-guide-fx-nav-row">
                <Icon name="plus" /> New Chat
              </div>
              <div className="plugin-guide-fx-nav-row">
                <Icon name="inbox" /> Inbox
              </div>
              <div className="plugin-guide-fx-nav-row is-plugin">
                <Icon name="agents" /> Agents
              </div>
              <div className="plugin-guide-thread-stack">
                <div className="plugin-guide-ws-head">
                  <span className="plugin-guide-fx-section plugin-guide-ws-head-title">Workspaces</span>
                </div>
                <div className="plugin-guide-fx-nav-row">Acme</div>
              </div>
            </aside>
            <section className="plugin-guide-thread-main">
              <header className="plugin-guide-thread-head">
                <span>Ship release candidate</span>
                <button
                  type="button"
                  className="plugin-guide-palette-open"
                  aria-label="Open command palette"
                  onClick={() => setPaletteOpen(true)}
                >
                  ⌘P
                </button>
              </header>
              <div className="plugin-guide-timeline">
                <div className="plugin-guide-bubble is-user">Run the release checklist</div>
                <p className="plugin-guide-assistant-line">Checklist is in the side panel when the plugin action runs.</p>
              </div>
            </section>
            <aside className={classNames('plugin-guide-side', panelOpen && 'is-open')}>
              <header className="plugin-guide-side-tabs">
                <span className={classNames('plugin-guide-side-tab', panelOpen && 'is-active')}>
                  <Plug /> Checklist
                </span>
              </header>
              <div className="plugin-guide-side-body">
                {panelOpen ? (
                  <>
                    <strong>Release checklist</strong>
                    <div className="plugin-guide-skel" />
                    <div className="plugin-guide-skel is-short" />
                  </>
                ) : null}
              </div>
            </aside>
          </div>
          {paletteOpen ? (
            <div className="plugin-guide-palette" role="listbox" aria-label="Command palette">
              <div className="plugin-guide-palette-search">Search commands…</div>
              <div className="plugin-guide-palette-group">Extensions</div>
              <Mark
                id="commandPaletteAction"
                label="Palette action"
                chip="side"
                className="plugin-guide-palette-row"
                onActivate={run}
              >
                <Plug /> Run release checklist
                <kbd>Plugins</kbd>
              </Mark>
              <div className="plugin-guide-palette-row is-idle">Reload plugins</div>
            </div>
          ) : null}
        </div>
      </WindowFrame>
    </div>
  );
}

export function SettingsWireframe(): ReactNode {
  return (
    <div className="plugin-guide-stage">
      <WindowFrame>
        <div className="plugin-guide-hub">
          <header className="plugin-guide-hub-head">
            <span className="plugin-guide-hub-icon">
              <Plug />
            </span>
            <div>
              <h3>Hello</h3>
              <p>A friendly example plugin.</p>
            </div>
          </header>
          <div className="plugin-guide-hub-config">
            <h4>Configuration</h4>
            <div className="plugin-guide-hub-form">
              <label>
                API key <span className="plugin-guide-secret-tag">secret</span>
                <span className="plugin-guide-field is-wide" />
              </label>
              <label className="plugin-guide-toggle-row">
                Case-sensitive search
                <span className="plugin-guide-toggle" aria-hidden />
              </label>
              <span className="plugin-guide-btn">Save settings</span>
            </div>
            <Mark id="settingsSection" label="Settings section" className="plugin-guide-hub-section">
              <strong>Your settings UI</strong>
              <p>Plugin-owned React on this hub page, not in Global Settings.</p>
            </Mark>
          </div>
        </div>
      </WindowFrame>
    </div>
  );
}

export function PlatformWireframe(): ReactNode {
  const headless = SURFACE_GROUPS.find((row) => row.id === 'headless');
  return (
    <div className="plugin-guide-platform" data-guide-responsive-strategy="reflow">
      {(headless?.sections ?? []).map((section) => {
        const surfaces = section.surfaceIds
          .map((id) => SURFACES_BY_ID.get(id))
          .filter((surface): surface is NonNullable<typeof surface> => Boolean(surface));
        return (
          <section key={section.title} aria-label={section.title}>
            <h3 className="plugin-guide-platform-kicker">{section.title}</h3>
            <ul className="plugin-guide-platform-grid">
              {surfaces.map((surface) => (
                <li key={surface.id}>
                  <PlatformCard
                    id={surface.id}
                    title={surface.title}
                    tagline={surface.tagline ?? surface.summary}
                    experimental={surface.experimental}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function PlatformCard({
  id,
  title,
  tagline,
  experimental
}: {
  id: string;
  title: string;
  tagline: string;
  experimental?: boolean;
}): ReactNode {
  const { activeId, setActiveId, expandedId, onSelect } = useSurfaceMap();
  const selected = activeId === id || expandedId === id;
  return (
    <a
      href={`#surface-${id}`}
      aria-label={`${title} — jump to details`}
      className={classNames('plugin-guide-platform-card', selected && 'is-active')}
      onClick={(event) => {
        if (!onSelect) return;
        event.preventDefault();
        onSelect(id);
      }}
      onMouseEnter={() => setActiveId(id)}
      onMouseLeave={() => setActiveId(null)}
    >
      <Plug />
      <span>
        <span className="plugin-guide-platform-title">
          {title}
          {experimental ? <ExperimentalBadge /> : null}
        </span>
        <span className="plugin-guide-platform-tagline">{tagline}</span>
      </span>
    </a>
  );
}
