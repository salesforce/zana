import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { HomeView } from '../home/HomeView.js';
import { InboxView } from '../inbox/InboxView.js';
import { AgentsView } from '../agents/AgentsView.js';
import { AgentSessionPage } from '../agents/AgentSessionPage.js';
import { NewThreadView } from '../threads/NewThreadView.js';
import { ThreadDetail } from '../threads/ThreadDetailView.js';
import { SchedulerView } from '../scheduler/SchedulerView.js';
import { ScheduleDetailPage } from '../scheduler/ScheduleDetailPage.js';
import { useRouteState } from '../../hooks/useRouteState.js';
import { useIsCompactViewport } from '../../hooks/useIsCompactViewport.js';
import { useData, useUi } from '../../store.js';
import { getScopedProjectId } from '../../lib/windowScope.js';
import {
  beginSplitDrag,
  decidePaneDrop,
  SPLIT_PANE_DATA_ATTR
} from '../../lib/split-drag/index.js';
import {
  computePaneRects,
  countPanes,
  findPane,
  listPanes,
  movePane,
  removePane,
  replacePaneContent,
  resizeSplit,
  setFocus,
  swapPanes,
  type LayoutNode,
  type PaneContent,
  type PaneNode,
  type SplitLayout,
  splitLayoutScopeKey,
  type SplitPath,
  type SplitSide
} from '../../lib/split-layout/index.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';
import {
  focusedPaneRoute,
  paneContentForPathname,
  paneContentRoute,
  reconcileLayoutForContent
} from '../../lib/split-layout/splitThreadNavigation.js';
import {
  PaneContextProvider,
  usePaneContextValue,
  type PaneSecondaryPanelRegistry
} from './PaneContext.js';
import { PluginPanelPaneView } from './PluginPanelPaneView.js';
import { SplitDivider } from './SplitDivider.js';
import { SplitPaneBar } from './SplitPaneBar.js';
import { paneUsesHostBar } from './split-pane-bar-title.js';
import { ProjectModePane } from '../project/ProjectModePane.js';

const EMPTY_PATH: SplitPath = [];
const PANE_DRAG_ENGAGE_DISTANCE_PX = 8;

type NavigateInPane = (paneId: string, threadId: string, projectId: string | null) => void;
type BeginPaneDrag = (paneId: string, event: ReactPointerEvent, label: string) => void;

export function SplitThreadArea({ routeContent }: { routeContent: PaneContent }) {
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();
  const route = useRouteState();
  const storeFocusedProjectId = useUi((s) => s.focusedProjectId);
  const focusedProjectId = route.focusedProjectId ?? storeFocusedProjectId;
  const scopeKey = splitLayoutScopeKey({
    scopedProjectId: getScopedProjectId(),
    nav: route.nav,
    focusedProjectId
  });
  const storedScopeKey = useSplitWorkspace((s) => s.scopeKey);
  const layoutFromStore = useSplitWorkspace((s) => s.layout);
  const setLayout = useSplitWorkspace((s) => s.setLayout);
  const updateLayout = useSplitWorkspace((s) => s.updateLayout);
  const dimsInactiveSplits = useSplitWorkspace((s) => s.dimInactiveSplits);
  const maximizedPaneId = useSplitWorkspace((s) => s.maximizedPaneId);
  const setMaximizedPaneIdAtom = useSplitWorkspace((s) => s.setMaximizedPaneId);
  const routeKey = paneContentRoute(routeContent);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => cancelDrag.current?.(), [scopeKey, isCompact]);

  // Activate before reconcile so a project route never writes into the global tree.
  if (storedScopeKey !== scopeKey) {
    useSplitWorkspace.getState().activateScope(scopeKey);
  }
  const layout =
    storedScopeKey === scopeKey ? layoutFromStore : useSplitWorkspace.getState().layout;

  useEffect(() => {
    useSplitWorkspace.getState().activateScope(scopeKey);
  }, [scopeKey]);

  useEffect(() => {
    updateLayout((previous) =>
      reconcileLayoutForContent(previous, paneContentForPathname(routeKey) ?? routeContent)
    );
    // Reconstruct from the path key. Depending on the `routeContent` object
    // re-runs this on every parent render and hits React #185.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeKey, scopeKey, updateLayout]);

  // Reconcile on this render so `/sessions/:id` replaces a stored Agents board
  // immediately. The effect below persists the same layout; do not write the
  // store here.
  const effectiveLayout: SplitLayout = reconcileLayoutForContent(layout, routeContent);
  const panes = listPanes(effectiveLayout.root);
  const isSplitActive = !isCompact && panes.length > 1;
  const focusedPaneId = effectiveLayout.focusedPaneId;
  const paneCount = countPanes(effectiveLayout.root);
  // Portal hosts outlive tree slots. Reparenting a slot must not remount editors,
  // reset unsent composers, or discard plugin-local state.
  const hostCache = useRef(new Map<string, HTMLDivElement>());
  const hosts = new Map<string, HTMLDivElement>();
  const paneKeys = new Map<string, string>();
  for (const pane of panes) {
    const key = `${scopeKey}:${paneContentKey(pane)}`;
    const host = hostCache.current.get(key) ?? document.createElement('div');
    host.className = 'split-pane-host';
    hosts.set(pane.paneId, host);
    paneKeys.set(pane.paneId, key);
  }
  hostCache.current = new Map(panes.map((pane) => [paneKeys.get(pane.paneId)!, hosts.get(pane.paneId)!]));
  const maximizedPane =
    maximizedPaneId !== null ? findPane(effectiveLayout.root, maximizedPaneId) : null;
  const maximizedPaneMissing = maximizedPaneId !== null && maximizedPane === null;
  const effectiveMaximizedPaneId =
    paneCount > 1 && maximizedPaneId !== null && maximizedPane !== null
      ? maximizedPaneId
      : null;

  const setMaximizedPaneId = useCallback(
    (next: SetStateAction<string | null>) => {
      const value = typeof next === 'function' ? next(useSplitWorkspace.getState().maximizedPaneId) : next;
      setMaximizedPaneIdAtom(value);
    },
    [setMaximizedPaneIdAtom]
  );

  useEffect(() => {
    if (maximizedPaneId === null) return;
    if (paneCount < 2 || maximizedPaneMissing) {
      setMaximizedPaneId(null);
      return;
    }
    if (focusedPaneId !== maximizedPaneId) {
      setMaximizedPaneId(focusedPaneId);
    }
  }, [focusedPaneId, maximizedPaneId, maximizedPaneMissing, paneCount, setMaximizedPaneId]);

  const navigateInPane = useCallback<NavigateInPane>(
    (paneId, threadId, projectId) => {
      const content: PaneContent = { kind: 'thread', projectId, threadId };
      const next = replacePaneContent(useSplitWorkspace.getState().layout ?? effectiveLayout, paneId, content);
      setLayout(next);
      navigate(paneContentRoute(content));
    },
    [effectiveLayout, navigate, setLayout]
  );

  const focusPane = useCallback(
    (paneId: string) => {
      const current = useSplitWorkspace.getState().layout ?? effectiveLayout;
      if (current.focusedPaneId === paneId) return;
      const pane = findPane(current.root, paneId);
      const next = setFocus(current, paneId);
      setLayout(next);
      if (useSplitWorkspace.getState().maximizedPaneId !== null) setMaximizedPaneId(paneId);
      if (pane !== null && pane.content.kind !== 'empty') {
        navigate(paneContentRoute(pane.content), { replace: true });
      }
    },
    [effectiveLayout, navigate, setLayout, setMaximizedPaneId]
  );

  const closePane = useCallback(
    (paneId: string) => {
      const current = useSplitWorkspace.getState().layout ?? effectiveLayout;
      const next = removePane(current, paneId);
      if (next === current) return;
      setLayout(next);
      if (useSplitWorkspace.getState().maximizedPaneId === paneId) setMaximizedPaneId(null);
      if (next.focusedPaneId !== current.focusedPaneId) {
        const route = focusedPaneRoute(next);
        if (route !== null) navigate(route, { replace: true });
      }
    },
    [effectiveLayout, navigate, setLayout, setMaximizedPaneId]
  );

  const toggleMaximizePane = useCallback(
    (paneId: string) => {
      const current = useSplitWorkspace.getState().layout ?? effectiveLayout;
      const pane = findPane(current.root, paneId);
      if (countPanes(current.root) < 2 || pane === null) return;
      if (current.focusedPaneId !== paneId) {
        const next = setFocus(current, paneId);
        setLayout(next);
        const route = focusedPaneRoute(next);
        if (route !== null) navigate(route, { replace: true });
      }
      setMaximizedPaneId((previous) => (previous === paneId ? null : paneId));
    },
    [effectiveLayout, navigate, setLayout, setMaximizedPaneId]
  );

  const movePaneToSide = useCallback(
    (paneId: string, side: SplitSide) => {
      const current = useSplitWorkspace.getState().layout ?? effectiveLayout;
      if (countPanes(current.root) < 2) return;
      const rects = computePaneRects(current.root);
      const candidates = listPanes(current.root).filter((pane) => pane.paneId !== paneId);
      const edgePosition = (candidateId: string) => {
        const rect = rects.get(candidateId);
        if (rect === undefined) return 0;
        switch (side) {
          case 'left':
            return rect.x;
          case 'right':
            return -(rect.x + rect.w);
          case 'top':
            return rect.y;
          case 'bottom':
            return -(rect.y + rect.h);
        }
      };
      const target = candidates.sort(
        (first, second) => edgePosition(first.paneId) - edgePosition(second.paneId)
      )[0];
      if (target === undefined) return;
      const next = movePane(current, paneId, target.paneId, side);
      if (next === current) return;
      setLayout(next);
      const route = focusedPaneRoute(next);
      if (route !== null) navigate(route, { replace: true });
    },
    [effectiveLayout, navigate, setLayout]
  );

  const resize = useCallback(
    (splitPath: SplitPath, childIndex: number, fraction: number) => {
      updateLayout((previous) =>
        previous === null ? previous : resizeSplit(previous, splitPath, childIndex, fraction)
      );
    },
    [updateLayout]
  );

  const beginPaneDrag = useCallback<BeginPaneDrag>(
    (paneId, event, label) => {
      if (event.button !== 0) return;
      const startScope = useSplitWorkspace.getState().scopeKey;
      const startLayout = useSplitWorkspace.getState().layout ?? effectiveLayout;
      if (countPanes(startLayout.root) < 2) return;
      const restoreMaximizeAfterDrag = useSplitWorkspace.getState().maximizedPaneId === paneId;
      const sourceEl =
        event.currentTarget instanceof Element
          ? event.currentTarget.closest<HTMLElement>(`[${SPLIT_PANE_DATA_ATTR}]`)
          : null;
      const startX = event.clientX;
      const startY = event.clientY;
      cancelDrag.current = beginSplitDrag({
        pointerId: event.pointerId,
        ghostLabel: label,
        sourceEl,
        shouldEngage: (x, y) => Math.hypot(x - startX, y - startY) > PANE_DRAG_ENGAGE_DISTANCE_PX,
        onEngage: restoreMaximizeAfterDrag ? () => setMaximizedPaneId(null) : undefined,
        onEnd: restoreMaximizeAfterDrag
          ? () => {
              const current = useSplitWorkspace.getState().layout;
              if (useSplitWorkspace.getState().scopeKey === startScope && current !== null && findPane(current.root, current.focusedPaneId) !== null) {
                setMaximizedPaneId(current.focusedPaneId);
              }
            }
          : undefined,
        decide: (targetPaneId, zone) => useSplitWorkspace.getState().scopeKey === startScope
          ? decidePaneDrop({ zone, isSelf: targetPaneId === paneId }) : null,
        onDrop: (target) => {
          const current = useSplitWorkspace.getState().layout ?? startLayout;
          const next =
            target.zone === 'center'
              ? swapPanes(current, paneId, target.paneId)
              : movePane(current, paneId, target.paneId, target.zone);
          if (next === current) return;
          setLayout(next);
          const route = focusedPaneRoute(next);
          if (route !== null) navigate(route, { replace: true });
        }
      });
    },
    [effectiveLayout, navigate, setLayout, setMaximizedPaneId]
  );

  useSplitPaneShortcuts({
    enabled: isSplitActive,
    layout: effectiveLayout,
    panes,
    maximizedPaneId: effectiveMaximizedPaneId,
    focusPane,
    closePane,
    toggleMaximizePane
  });

  const treeProps: SplitTreeProps = {
    node: effectiveLayout.root,
    path: EMPTY_PATH,
    dimsInactiveSplits,
    focusedPaneId: effectiveMaximizedPaneId ?? focusedPaneId,
    maximizedPaneId: isSplitActive ? effectiveMaximizedPaneId : null,
    onFocusPane: focusPane,
    onClosePane: closePane,
    onToggleMaximizePane: toggleMaximizePane,
    onMovePaneToSide: movePaneToSide,
    onResize: resize,
    onNavigateInPane: navigateInPane,
    onBeginPaneDrag: beginPaneDrag,
    paneHosts: hosts
  };
  return (
    <div className="split-workspace" data-testid="split-workspace" data-split={isSplitActive ? 'true' : 'false'}>
      {isSplitActive ? <SplitTree key={scopeKey} {...treeProps} /> : panes.map((pane) => (
        <PaneSlot key={pane.paneId} host={hosts.get(pane.paneId)!} hidden={pane.paneId !== focusedPaneId} />
      ))}
      {panes.map((pane) => createPortal(
        <SplitPane {...treeProps} node={pane} isSplitPane={isSplitActive} />,
        hosts.get(pane.paneId)!,
        paneKeys.get(pane.paneId)
      ))}
    </div>
  );
}

function useSplitPaneShortcuts({
  enabled,
  layout,
  panes,
  maximizedPaneId,
  focusPane,
  closePane,
  toggleMaximizePane
}: {
  enabled: boolean;
  layout: SplitLayout;
  panes: readonly PaneNode[];
  maximizedPaneId: string | null;
  focusPane: (paneId: string) => void;
  closePane: (paneId: string) => void;
  toggleMaximizePane: (paneId: string) => void;
}) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const digit = /^Digit([1-8])$/.exec(event.code);
      if (digit && !event.shiftKey && !event.altKey) {
        const pane = panes[Number(digit[1]) - 1];
        if (!pane) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        focusPane(pane.paneId);
        return;
      }
      if (event.altKey && (event.key === '[' || event.key === ']')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const dir = event.key === ']' ? 1 : -1;
        const index = panes.findIndex((pane) => pane.paneId === layout.focusedPaneId);
        const next = panes[(index + dir + panes.length) % panes.length];
        if (next) focusPane(next.paneId);
        return;
      }
      if (event.shiftKey && (event.key === 'M' || event.key === 'm')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        toggleMaximizePane(maximizedPaneId ?? layout.focusedPaneId);
        return;
      }
      if (event.altKey && (event.key === 'W' || event.key === 'w')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closePane(layout.focusedPaneId);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [closePane, enabled, focusPane, layout.focusedPaneId, maximizedPaneId, panes, toggleMaximizePane]);
}

interface SplitTreeProps {
  paneHosts: ReadonlyMap<string, HTMLDivElement>;
  node: LayoutNode;
  path: SplitPath;
  dimsInactiveSplits: boolean;
  focusedPaneId: string;
  maximizedPaneId: string | null;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onToggleMaximizePane: (paneId: string) => void;
  onMovePaneToSide: (paneId: string, side: SplitSide) => void;
  onResize: (splitPath: SplitPath, childIndex: number, fraction: number) => void;
  onNavigateInPane: NavigateInPane;
  onBeginPaneDrag: BeginPaneDrag;
}

function PaneSlot({ host, hidden = false }: { host: HTMLDivElement; hidden?: boolean }) {
  const attach = useCallback((slot: HTMLDivElement | null) => {
    if (slot && host.parentElement !== slot) slot.replaceChildren(host);
  }, [host]);
  return <div className="split-pane-slot" hidden={hidden} ref={attach} />;
}

function SplitPane(props: SplitTreeProps & { node: PaneNode; isSplitPane: boolean }) {
  const { node, focusedPaneId, isSplitPane } = props;
  const isFocused = node.paneId === focusedPaneId;
  const isMaximized = isSplitPane && node.paneId === props.maximizedPaneId;
  const isHiddenByMaximize = isSplitPane && props.maximizedPaneId !== null && !isMaximized;
  return (
    <div
      onPointerDown={() => props.onFocusPane(node.paneId)}
      onFocus={() => props.onFocusPane(node.paneId)}
      className={[
        'split-pane',
        isFocused ? 'is-focused' : '',
        isMaximized ? 'is-maximized' : '',
        isHiddenByMaximize ? 'is-hidden' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      data-split-pane-id={node.paneId}
      data-focused={isFocused ? 'true' : 'false'}
      data-maximized={isMaximized ? 'true' : undefined}
      aria-hidden={isHiddenByMaximize || undefined}
    >
      {isSplitPane && paneUsesHostBar(node.content) ? (
        <SplitPaneBar
          content={node.content}
          isMaximized={isMaximized}
          onClose={() => props.onClosePane(node.paneId)}
          onMoveToSide={(side) => props.onMovePaneToSide(node.paneId, side)}
          onToggleMaximize={() => props.onToggleMaximizePane(node.paneId)}
          onBeginDrag={(event, label) => props.onBeginPaneDrag(node.paneId, event, label)}
        />
      ) : null}
      <WorkspacePaneContent
        content={node.content}
        paneId={node.paneId}
        isFocused={isFocused}
        isSplitPane={isSplitPane}
        secondaryPanelRegistry={null}
        onRequestClose={isSplitPane ? () => props.onClosePane(node.paneId) : null}
        isMaximized={isMaximized}
        onToggleMaximize={isSplitPane ? () => props.onToggleMaximizePane(node.paneId) : null}
        onMoveToSide={isSplitPane ? (side) => props.onMovePaneToSide(node.paneId, side) : undefined}
        isBoundedPane={isSplitPane}
        navigateInPane={props.onNavigateInPane}
        onBeginPaneDrag={isSplitPane ? props.onBeginPaneDrag : undefined}
      />
      {isSplitPane && <div
        aria-hidden
        className={`split-pane-scrim${isFocused || !props.dimsInactiveSplits ? '' : ' is-dimmed'}`}
      />}
    </div>
  );
}

function SplitTree(props: SplitTreeProps) {
  const { node, path } = props;
  if (node.type === 'pane') {
    return <PaneSlot host={props.paneHosts.get(node.paneId)!} />;
  }

  return (
    <div className={`split-tree split-tree--${node.dir}`}>
      {node.children.map((child, index) => (
        <Fragment key={paneKey(child)}>
          {index > 0 ? (
            <SplitDivider
              key={JSON.stringify([path, paneKey(node.children[index - 1]!), paneKey(child)])}
              dir={node.dir}
              fraction={(node.sizes[index - 1] ?? 1) / ((node.sizes[index - 1] ?? 1) + (node.sizes[index] ?? 1))}
              hidden={props.maximizedPaneId !== null}
              onResize={(fraction) => props.onResize(path, index - 1, fraction)}
            />
          ) : null}
          <div className="split-tree-child" style={{ flex: `${node.sizes[index] ?? 1} 1 0` }}>
            <SplitTree {...props} node={child} path={[...path, index]} />
          </div>
        </Fragment>
      ))}
    </div>
  );
}

function WorkspacePaneContent({
  content,
  paneId,
  isFocused,
  isSplitPane,
  secondaryPanelRegistry,
  onRequestClose,
  isMaximized,
  onToggleMaximize,
  onMoveToSide,
  isBoundedPane,
  navigateInPane,
  onBeginPaneDrag
}: {
  content: PaneContent;
  paneId: string;
  isFocused: boolean;
  isSplitPane: boolean;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry | null;
  onRequestClose: (() => void) | null;
  isMaximized: boolean;
  onToggleMaximize: (() => void) | null;
  onMoveToSide?: (side: SplitSide) => void;
  isBoundedPane: boolean;
  navigateInPane: NavigateInPane;
  onBeginPaneDrag?: BeginPaneDrag;
}) {
  const beginPaneDrag = useMemo(
    () =>
      onBeginPaneDrag
        ? (event: ReactPointerEvent, label: string) => onBeginPaneDrag(paneId, event, label)
        : undefined,
    [onBeginPaneDrag, paneId]
  );
  const navigateInThisPane = useCallback(
    (threadId: string, projectId: string | null) => navigateInPane(paneId, threadId, projectId),
    [navigateInPane, paneId]
  );
  const value = usePaneContextValue({
    paneId,
    isFocused,
    isSplitPane,
    secondaryPanelRegistry,
    onRequestClose,
    isMaximized,
    onToggleMaximize,
    onMoveToSide,
    isBoundedPane,
    beginPaneDrag,
    navigateInPane: navigateInThisPane
  });

  return (
    <PaneContextProvider value={value}>
      <PaneBody content={content} paneId={paneId} />
    </PaneContextProvider>
  );
}

function PaneBody({
  content,
  paneId
}: {
  content: PaneContent;
  paneId: string;
}) {
  const projects = useData((s) => s.projects);
  if (content.kind === 'thread') {
    return <ThreadDetail key={content.threadId} threadId={content.threadId} />;
  }
  if (content.kind === 'agent-session') {
    return (
      <AgentSessionPage
        key={content.sessionId}
        projectId={content.projectId}
        sessionId={content.sessionId}
      />
    );
  }
  if (content.kind === 'home') {
    return <HomeView />;
  }
  if (content.kind === 'inbox') {
    return <InboxView />;
  }
  if (content.kind === 'agents') {
    return <AgentsView />;
  }
  if (content.kind === 'scheduler') {
    return <SchedulerView />;
  }
  if (content.kind === 'schedule') {
    return (
      <ScheduleDetailPage
        key={content.scheduleId}
        projectId={content.projectId}
        scheduleId={content.scheduleId}
      />
    );
  }
  if (content.kind === 'new-schedule') {
    return (
      <ScheduleDetailPage
        key={`new:${content.projectId ?? ''}`}
        projectId={content.projectId ?? null}
        scheduleId={null}
      />
    );
  }
  if (content.kind === 'new-thread') {
    const project = content.projectId
      ? projects.find((row) => row.id === content.projectId)
      : undefined;
    return <NewThreadView project={project} />;
  }
  if (content.kind === 'plugin-panel') {
    return (
      <PluginPanelPaneView
        pluginId={content.pluginId}
        panelPath={content.panelPath}
        subPath={content.subPath}
      />
    );
  }
  if (content.kind === 'project-view') {
    return (
      <ProjectModePane
        projectId={content.projectId}
        mode={content.mode}
        paneId={paneId}
      />
    );
  }
  if (content.kind === 'empty') {
    return <EmptySplitPane />;
  }
  return <div className="split-pane-empty">This page cannot live in a split pane.</div>;
}

function EmptySplitPane() {
  return (
    <section className="split-pane-empty-well" data-testid="split-pane-empty">
      <div className="split-pane-empty">
        <p className="split-pane-empty-copy">Drop a view here</p>
        <p className="split-pane-empty-hint">Or choose a view from the sidebar.</p>
      </div>
    </section>
  );
}

function paneKey(node: LayoutNode): string {
  return node.type === 'pane' ? node.paneId : listPanes(node).map((pane) => pane.paneId).join('-');
}


/** Routable identity, independent of location in the split tree. */
function paneContentKey(pane: PaneNode): string {
  const content = pane.content;
  switch (content.kind) {
    case 'empty': return JSON.stringify(['empty', pane.paneId]);
    case 'plugin-panel': return JSON.stringify(['plugin-panel', content.pluginId, content.panelPath]);
    case 'agent-session': return JSON.stringify(['agent-session', content.sessionId]);
    case 'schedule': return JSON.stringify(['schedule', content.scheduleId]);
    default: return paneContentRoute(content);
  }
}
