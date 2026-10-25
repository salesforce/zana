import { type DragEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDownToLine, ChevronDown, ChevronUp, FolderTree, GitCompare, Globe, Info, ListTodo, Maximize2, Minimize2, MoreHorizontal, PanelRight, Plus, Terminal, X } from 'lucide-react';
import {
  activeClosableTab,
  activePinnedView,
  secondaryPanelShowsInspectorFooter,
  SECONDARY_PANEL_MIN_WIDTH_PX,
  type ThreadSecondaryPanelState
} from './threadSecondaryPanelState.js';
import { startColumnResize } from './threadSecondaryPanelLogic.js';
import { useCompactLayout } from '../../../hooks/useCompactLayout.js';
import { MobilePanelNavigation } from './MobilePanelNavigation.js';
import {
  FilePreviewScrollPositionContext,
  filePreviewScrollPositionFor,
  pruneFilePreviewScrollPositions,
  type FilePreviewScrollPositions
} from './filePreviewScrollPositionContext.js';
import './mobile-panel.css';
import './thread-panel-controls.css';
import { ThreadToolMenu, type ThreadToolMenuItem } from './ThreadToolMenu.js';

export type ThreadPanelToolKind = 'terminal' | 'browser' | 'explorer';

export function ThreadSecondaryPanel({
  state,
  showDiffPin,
  showPlanPin,
  showInfoPin = true,
  children,
  footer,
  onSelectInfo,
  onSelectDiff,
  onSelectPlan,
  onNewTab,
  onAddTool,
  canAddBrowser = true,
  onCloseTab,
  onActivateTab,
  onToggleMaximized,
  onHide,
  onResize,
  dock
}: {
  state: ThreadSecondaryPanelState;
  showDiffPin?: boolean;
  showPlanPin?: boolean;
  showInfoPin?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  onSelectInfo: () => void;
  onSelectDiff: () => void;
  onSelectPlan?: () => void;
  onNewTab: () => void;
  onAddTool?: (kind: ThreadPanelToolKind) => void;
  canAddBrowser?: boolean;
  onCloseTab: (tabId: string) => void;
  onActivateTab: (tabId: string) => void;
  onToggleMaximized: () => void;
  onHide: () => void;
  onResize: (widthPx: number, containerWidthPx: number) => void;
  dock?: {
    side: 'right' | 'bottom';
    dragging?: boolean;
    collapsed?: boolean;
    onToggleCollapsed?: () => void;
    onMove: (tabId: string) => void;
    onDragStart: (event: DragEvent, tabId: string) => void;
    onDragEnd: () => void;
    onDrop: (event: DragEvent) => void;
    onDragOver: (event: DragEvent) => void;
    heightPx?: number;
    onHeight?: (height: number) => void;
  };
}) {
  const compact = useCompactLayout();
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewToggleRef = useRef<HTMLButtonElement>(null);
  const toggleViews = () => { setViewsOpen((open) => !open); viewToggleRef.current?.focus(); };
  const panelRef = useRef<HTMLElement>(null);
  const activeTabRef = useRef<HTMLSpanElement>(null);
  const pin = activePinnedView(state);
  const activeTab = activeClosableTab(state);
  const pinnedTabs = [
    ...(showInfoPin ? [{ id: 'info', title: 'Info', label: 'Show info', testId: 'thread-info-pin', icon: <Info size={15} />, select: onSelectInfo }] : []),
    ...(showDiffPin ? [{ id: 'diff', title: 'Changes', label: 'Show workspace diff', testId: 'thread-diff-pin', icon: <GitCompare size={15} />, select: onSelectDiff }] : []),
    ...(showPlanPin ? [{ id: 'plan', title: 'Plan', label: 'Show plan', testId: 'thread-plan-pin', icon: <ListTodo size={15} />, select: () => onSelectPlan?.() }] : [])
  ];
  const [menu, setMenu] = useState<{ kind: 'add' | 'actions'; anchor: HTMLElement; tabId?: string } | null>(null);
  const closeMenu = useCallback((restoreFocus: boolean) => {
    if (restoreFocus && menu?.anchor.isConnected) menu.anchor.focus();
    setMenu(null);
  }, [menu]);
  useEffect(() => { setMenu(null); }, [state.activeId, dock?.collapsed, compact]);
  const menuTabId = menu?.tabId ?? state.activeId;
  const menuPinnedTab = pinnedTabs.find(tab => tab.id === menuTabId);
  const menuClosableTab = state.tabs.find(tab => tab.id === menuTabId);
  const menuTab = menuPinnedTab ?? menuClosableTab;
  const hideLabel = dock?.side === 'bottom' ? (dock.collapsed ? 'Expand bottom panel' : 'Hide bottom panel') : 'Hide right panel';
  const hidePanel = dock?.side === 'bottom' ? dock.onToggleCollapsed! : onHide;
  const menuItems: ThreadToolMenuItem[] = menu?.kind === 'add' ? [
    ...(onAddTool ? [
      { id: 'terminal', label: 'Terminal', icon: <Terminal />, run: () => onAddTool('terminal') },
      ...(canAddBrowser ? [{ id: 'browser', label: 'Browser', icon: <Globe />, run: () => onAddTool('browser') }] : []),
      { id: 'explorer', label: 'Files', icon: <FolderTree />, run: () => onAddTool('explorer') }
    ] : []),
    { id: 'more', label: 'More tools…', icon: <Plus />, run: onNewTab }
  ] : [
    ...(dock && menuTab ? [{ id: 'move', label: `Move ${menuTab.title} to ${dock.side === 'bottom' ? 'right' : 'bottom'} panel`,
      icon: dock.side === 'bottom' ? <PanelRight /> : <ArrowDownToLine />, run: () => dock.onMove(menuTab.id) }] : []),
    { id: 'maximize', label: state.isMaximized ? 'Restore conversation' : 'Maximize panel', icon: <Maximize2 />, run: onToggleMaximized },
    { id: 'hide', label: hideLabel, description: 'Keeps your tools and sessions available', icon: dock?.side === 'bottom' ? <ChevronDown /> : <PanelRight />, run: hidePanel },
    ...(menuClosableTab ? [{ id: 'close', label: `Close ${menuClosableTab.title}`, description: menuClosableTab.kind === 'terminal' ? 'Stops this terminal session' : undefined,
      icon: <X />, run: () => onCloseTab(menuClosableTab.id) }] : [])
  ];
  // Only the active surface is mounted, so a file's scroll container disappears whenever the
  // reader visits another tab. Offsets live here, keyed by open tab id, to survive that.
  const [scrollPositions] = useState<FilePreviewScrollPositions>(() => new Map());
  const scrollPosition = activeTab?.kind === 'file-preview' || activeTab?.kind === 'storage-preview'
    ? filePreviewScrollPositionFor(scrollPositions, activeTab.id)
    : null;

  useEffect(() => {
    pruneFilePreviewScrollPositions(scrollPositions, state.tabs.map((tab) => tab.id));
  }, [scrollPositions, state.tabs]);

  useEffect(() => {
    if (compact) viewToggleRef.current?.focus({ preventScroll: true });
    else setViewsOpen(false);
  }, [compact]);

  useEffect(() => {
    activeTabRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [state.activeId]);

  const tabActions = (tabId: string) => dock ? {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLSpanElement>) => dock.onDragStart(event, tabId),
    onDragEnd: dock.onDragEnd,
    onContextMenu: (event: MouseEvent<HTMLSpanElement>) => {
      event.preventDefault(); setMenu({ kind: 'actions', anchor: event.currentTarget.querySelector('button')!, tabId });
    },
    onKeyDown: (event: import('react').KeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault(); setMenu({ kind: 'actions', anchor: event.currentTarget.querySelector('button')!, tabId });
      }
    }
  } : {};

  const onResizeMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    startColumnResize(
      event,
      () => panelRef.current?.parentElement,
      onResize,
      (name) => document.body.classList.add(name),
      (name) => document.body.classList.remove(name),
      // `blur` hands its listener a FocusEvent, which the drag ignores.
      (type, fn) => window.addEventListener(type, fn as unknown as EventListener),
      (type, fn) => window.removeEventListener(type, fn as unknown as EventListener)
    );
  };


  return (
    <aside
      ref={panelRef}
      className={`thread-secondary-panel${state.isMaximized ? ' is-maximized' : ''}${dock?.side === 'bottom' ? ' thread-tool-bottom' : ''}${dock?.collapsed ? ' is-collapsed' : ''}`}
      data-testid={dock?.side === 'bottom' ? 'thread-bottom-panel' : 'thread-secondary-panel'}
      data-tool-dock-side={dock?.side}
      onDragOver={dock?.onDragOver}
      onDrop={dock?.onDrop}
      data-mobile-panel={compact || undefined}
      aria-label={dock?.side === 'bottom' ? 'Bottom tools' : 'Agent panel'}
      onKeyDown={(event) => {
        if (!compact || event.defaultPrevented || event.key !== 'Escape') return;
        event.stopPropagation();
        if (viewsOpen) toggleViews();
        else if ((event.target as Element).closest('.mobile-panel-header')) onHide();
      }}
      style={{ ['--thread-secondary-width' as string]: `${Math.max(SECONDARY_PANEL_MIN_WIDTH_PX, state.widthPx)}px`, ...(dock?.side === 'bottom' ? { ['--thread-tool-bottom-height' as string]: `${dock.heightPx ?? 240}px` } : {}) }}
    >
      {compact ? <MobilePanelNavigation state={state} open={viewsOpen} toggleRef={viewToggleRef} onToggle={toggleViews}
        showInfoPin={showInfoPin} showDiffPin={showDiffPin} showPlanPin={showPlanPin}
        onSelectInfo={onSelectInfo} onSelectDiff={onSelectDiff} onSelectPlan={onSelectPlan}
        onActivateTab={onActivateTab} onCloseTab={onCloseTab} onNewTab={onNewTab} onHide={onHide} /> : <>
      {dock?.side === 'bottom' ? <div
        className="thread-tool-bottom-resizer"
        role="separator" tabIndex={0} aria-orientation="horizontal" aria-label="Resize bottom panel"
        aria-valuemin={120} aria-valuemax={480} aria-valuenow={dock.heightPx ?? 240}
        onKeyDown={event => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
          event.preventDefault(); dock.onHeight?.((dock.heightPx ?? 240) + (event.key === 'ArrowUp' ? 16 : -16));
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
          const start = event.clientY, height = dock.heightPx ?? 240;
          const target = event.currentTarget;
          target.onpointermove = next => dock.onHeight?.(height + start - next.clientY);
          const stop = () => { target.onpointermove = null; target.onpointerup = null; target.onpointercancel = null; target.onlostpointercapture = null; };
          target.onpointerup = target.onpointercancel = target.onlostpointercapture = stop;
        }}
      /> : <div
        className="thread-secondary-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize right panel"
        onMouseDown={onResizeMouseDown}
      />}
      <div className="thread-secondary-chrome" data-testid="thread-secondary-chrome">
        {!dock ? <div className="thread-secondary-pins">{pinnedTabs.map(tab => <button
          key={tab.id} type="button" className="thread-secondary-pin" aria-label={tab.label}
          aria-pressed={pin === tab.id} data-testid={tab.testId} onClick={tab.select}>
          {tab.icon}
        </button>)}</div> : null}
        <div className="thread-secondary-tabs" role={dock ? 'toolbar' : undefined} aria-label={dock ? 'Panel tabs' : undefined}
          onKeyDown={dock ? event => {
            if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
              || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)
              || !(event.target instanceof HTMLElement) || !event.target.matches('.thread-secondary-tab-label')) return;
            const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.thread-secondary-tab-label'));
            const index = tabs.indexOf(event.target as HTMLButtonElement);
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
            event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
          } : undefined}>
          {dock ? pinnedTabs.map(tab => <span key={tab.id}
            ref={pin === tab.id ? activeTabRef : undefined}
            className={`thread-secondary-tab is-pinned${pin === tab.id ? ' is-active' : ''}`}
            {...tabActions(tab.id)}>
            <button type="button" className="thread-secondary-tab-label" aria-label={tab.label}
              title={`${tab.title} · Pinned tab`} data-testid={tab.testId} aria-pressed={pin === tab.id} onClick={tab.select}>
              {tab.icon}<span>{tab.title}</span>
            </button>
          </span>) : null}
          {state.tabs.map((tab) => (
            <span
              key={tab.id}
              ref={activeTab?.id === tab.id ? activeTabRef : undefined}
              className={`thread-secondary-tab${activeTab?.id === tab.id ? ' is-active' : ''}`}
              {...tabActions(tab.id)}
            >
              <button type="button" className="thread-secondary-tab-label" title={tab.title} aria-pressed={activeTab?.id === tab.id} onClick={() => onActivateTab(tab.id)}>
                {tab.title}
              </button>
              <button
                type="button"
                className="thread-secondary-tab-close"
                aria-label={`Close ${tab.title}`}
                title={tab.kind === 'terminal' ? `Close ${tab.title} (stops terminal session)` : `Close ${tab.title}`}
                onClick={() => onCloseTab(tab.id)}
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
        {dock ? <button type="button" className="thread-secondary-pin thread-secondary-new-tool"
          aria-label={`Add tool to ${dock.side} panel`} title="Add tool" data-testid="thread-secondary-new-tab"
          aria-haspopup="menu" aria-expanded={menu?.kind === 'add'}
          onClick={event => menu?.kind === 'add' ? closeMenu(true) : setMenu({ kind: 'add', anchor: event.currentTarget })}>
          <Plus size={15} />
        </button> : null}
        <div className="thread-secondary-controls">
          {dock ? <button type="button" className="thread-secondary-pin"
            aria-label={`${dock.side === 'bottom' ? 'Bottom' : 'Right'} panel actions`} title="Panel actions"
            aria-haspopup="menu" aria-expanded={menu?.kind === 'actions'}
            onClick={event => menu?.kind === 'actions' ? closeMenu(true) : setMenu({ kind: 'actions', anchor: event.currentTarget })}>
            <MoreHorizontal size={15} />
          </button> : null}
          {!dock ? <button
            type="button"
            className="thread-secondary-pin"
            aria-label="New tab"
            data-testid="thread-secondary-new-tab"
            onClick={onNewTab}
          >
            <Plus size={15} />
          </button> : null}
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label={state.isMaximized ? 'Restore conversation' : 'Maximize panel'}
            title={state.isMaximized ? 'Restore conversation' : 'Maximize panel'}
            data-testid="thread-secondary-maximize"
            onClick={onToggleMaximized}
          >
            {state.isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
          <button
            type="button"
            className="thread-secondary-pin"
            aria-label={compact ? 'Close panel' : hideLabel}
            title={hideLabel}
            data-testid="thread-secondary-hide"
            onClick={hidePanel}
          >
            {dock?.side === 'bottom' ? (dock.collapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />) : compact ? <X size={18} /> : <PanelRight size={15} />}
          </button>
        </div>
      </div>
      </>}
      {menu && dock && !compact ? <ThreadToolMenu anchor={menu.anchor}
        label={menu.kind === 'add' ? `Add to ${dock.side} panel` : menuTab?.title ?? 'Panel actions'}
        items={menuItems} onClose={closeMenu} /> : null}
      <div className="thread-secondary-body" hidden={(compact && viewsOpen) || dock?.collapsed}>
        <FilePreviewScrollPositionContext.Provider value={scrollPosition}>{dock?.collapsed ? null : children}</FilePreviewScrollPositionContext.Provider>
      </div>
      {footer && secondaryPanelShowsInspectorFooter(state) ? (
        <div className="thread-secondary-footer" data-testid="thread-secondary-footer" hidden={compact && viewsOpen}>
          {footer}
        </div>
      ) : null}
      {dock?.dragging ? <div className="thread-tool-drag-target">{dock.side === 'bottom' ? 'Dock below conversation' : 'Dock in right panel'}</div> : null}
    </aside>
  );
}
