import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction
} from 'react';
import { useNavigate } from 'react-router-dom';
import { HomeView } from '../home/HomeView.js';
import { NewThreadView } from '../threads/NewThreadView.js';
import { ThreadDetail } from '../threads/ThreadDetailView.js';
import { useData } from '../../store.js';
import { useIsCompactViewport } from '../../hooks/useIsCompactViewport.js';
import {
  beginSplitDrag,
  decidePaneDrop,
  SPLIT_PANE_DATA_ATTR
} from '../../lib/split-drag/index.js';
import {
  clampSplitPairFraction,
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
  type SplitPath,
  type SplitSide
} from '../../lib/split-layout/index.js';
import { useSplitWorkspace } from '../../lib/split-layout/store.js';
import {
  focusedPaneRoute,
  paneContentRoute,
  reconcileLayoutForContent
} from '../../lib/split-layout/splitThreadNavigation.js';
import {
  createPaneSecondaryPanelRegistry,
  PaneContextProvider,
  usePaneContextValue,
  type PaneSecondaryPanelRegistry
} from './PaneContext.js';
import { PluginPanelPaneView } from './PluginPanelPaneView.js';
import { SplitWorkspaceSecondaryPanelHost } from './SplitWorkspaceSecondaryPanelHost.js';

const EMPTY_PATH: SplitPath = [];
const PANE_DRAG_ENGAGE_DISTANCE_PX = 8;

type NavigateInPane = (paneId: string, threadId: string, projectId: string | null) => void;
type BeginPaneDrag = (paneId: string, event: ReactPointerEvent, label: string) => void;

export function SplitThreadArea({ routeContent }: { routeContent: PaneContent }) {
  const navigate = useNavigate();
  const isCompact = useIsCompactViewport();
  const layout = useSplitWorkspace((s) => s.layout);
  const setLayout = useSplitWorkspace((s) => s.setLayout);
  const updateLayout = useSplitWorkspace((s) => s.updateLayout);
  const dimsInactiveSplits = useSplitWorkspace((s) => s.dimInactiveSplits);
  const maximizedPaneId = useSplitWorkspace((s) => s.maximizedPaneId);
  const setMaximizedPaneIdAtom = useSplitWorkspace((s) => s.setMaximizedPaneId);
  const secondaryPanelRegistry = useMemo(() => createPaneSecondaryPanelRegistry(), []);

  useEffect(() => {
    updateLayout((previous) => reconcileLayoutForContent(previous, routeContent));
  }, [routeContent, updateLayout]);

  const effectiveLayout: SplitLayout =
    layout ?? reconcileLayoutForContent(null, routeContent);
  const panes = listPanes(effectiveLayout.root);
  const isSplitActive = !isCompact && panes.length > 1;
  const maximizedPane =
    maximizedPaneId !== null ? findPane(effectiveLayout.root, maximizedPaneId) : null;
  const effectiveMaximizedPaneId =
    countPanes(effectiveLayout.root) > 1 && maximizedPaneId !== null && maximizedPane !== null
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
    if (countPanes(effectiveLayout.root) < 2 || maximizedPane === null) {
      setMaximizedPaneId(null);
      return;
    }
    if (effectiveLayout.focusedPaneId !== maximizedPaneId) {
      setMaximizedPaneId(effectiveLayout.focusedPaneId);
    }
  }, [effectiveLayout, maximizedPane, maximizedPaneId, setMaximizedPaneId]);

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
      if (pane !== null) navigate(paneContentRoute(pane.content), { replace: true });
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
      const startLayout = useSplitWorkspace.getState().layout ?? effectiveLayout;
      if (countPanes(startLayout.root) < 2) return;
      const restoreMaximizeAfterDrag = useSplitWorkspace.getState().maximizedPaneId === paneId;
      const sourceEl =
        event.currentTarget instanceof Element
          ? event.currentTarget.closest<HTMLElement>(`[${SPLIT_PANE_DATA_ATTR}]`)
          : null;
      const startX = event.clientX;
      const startY = event.clientY;
      beginSplitDrag({
        ghostLabel: label,
        sourceEl,
        shouldEngage: (x, y) => Math.hypot(x - startX, y - startY) > PANE_DRAG_ENGAGE_DISTANCE_PX,
        onEngage: restoreMaximizeAfterDrag ? () => setMaximizedPaneId(null) : undefined,
        onEnd: restoreMaximizeAfterDrag
          ? () => {
              const current = useSplitWorkspace.getState().layout;
              if (current !== null && findPane(current.root, current.focusedPaneId) !== null) {
                setMaximizedPaneId(current.focusedPaneId);
              }
            }
          : undefined,
        decide: (targetPaneId, zone) => decidePaneDrop({ zone, isSelf: targetPaneId === paneId }),
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

  if (isCompact || panes.length <= 1) {
    const firstPane = panes[0];
    return (
      <div className="split-workspace" data-testid="split-workspace" data-split="false">
        <WorkspacePaneContent
          content={firstPane?.content ?? routeContent}
          paneId={firstPane?.paneId ?? 'pane-1'}
          isFocused
          isSplitPane={false}
          secondaryPanelRegistry={null}
          onRequestClose={null}
          isMaximized={false}
          onToggleMaximize={null}
          isBoundedPane={false}
          navigateInPane={navigateInPane}
        />
      </div>
    );
  }

  return (
    <div className="split-workspace" data-testid="split-workspace" data-split="true">
      <SplitWorkspaceSecondaryPanelHost
        focusedPaneId={effectiveMaximizedPaneId ?? effectiveLayout.focusedPaneId}
        registry={secondaryPanelRegistry}
      >
        <SplitTree
          node={effectiveLayout.root}
          path={EMPTY_PATH}
          dimsInactiveSplits={dimsInactiveSplits}
          focusedPaneId={effectiveMaximizedPaneId ?? effectiveLayout.focusedPaneId}
          maximizedPaneId={effectiveMaximizedPaneId}
          secondaryPanelRegistry={secondaryPanelRegistry}
          onFocusPane={focusPane}
          onClosePane={closePane}
          onToggleMaximizePane={toggleMaximizePane}
          onMovePaneToSide={movePaneToSide}
          onResize={resize}
          onNavigateInPane={navigateInPane}
          onBeginPaneDrag={beginPaneDrag}
        />
      </SplitWorkspaceSecondaryPanelHost>
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
  node: LayoutNode;
  path: SplitPath;
  dimsInactiveSplits: boolean;
  focusedPaneId: string;
  maximizedPaneId: string | null;
  secondaryPanelRegistry: PaneSecondaryPanelRegistry;
  onFocusPane: (paneId: string) => void;
  onClosePane: (paneId: string) => void;
  onToggleMaximizePane: (paneId: string) => void;
  onMovePaneToSide: (paneId: string, side: SplitSide) => void;
  onResize: (splitPath: SplitPath, childIndex: number, fraction: number) => void;
  onNavigateInPane: NavigateInPane;
  onBeginPaneDrag: BeginPaneDrag;
}

function SplitTree(props: SplitTreeProps) {
  const { node, path, focusedPaneId } = props;
  if (node.type === 'pane') {
    const isFocused = node.paneId === focusedPaneId;
    const isMaximized = node.paneId === props.maximizedPaneId;
    const isHiddenByMaximize = props.maximizedPaneId !== null && !isMaximized;
    return (
      <div
        onPointerDown={() => props.onFocusPane(node.paneId)}
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
        <WorkspacePaneContent
          content={node.content}
          paneId={node.paneId}
          isFocused={isFocused}
          isSplitPane
          secondaryPanelRegistry={props.secondaryPanelRegistry}
          onRequestClose={() => props.onClosePane(node.paneId)}
          isMaximized={isMaximized}
          onToggleMaximize={() => props.onToggleMaximizePane(node.paneId)}
          onMoveToSide={(side) => props.onMovePaneToSide(node.paneId, side)}
          isBoundedPane
          navigateInPane={props.onNavigateInPane}
          onBeginPaneDrag={props.onBeginPaneDrag}
        />
        <div
          aria-hidden
          className={`split-pane-scrim${isFocused || !props.dimsInactiveSplits ? '' : ' is-dimmed'}`}
        />
      </div>
    );
  }

  return (
    <div className={`split-tree split-tree--${node.dir}`}>
      {node.children.map((child, index) => (
        <Fragment key={paneKey(child)}>
          {index > 0 ? (
            <SplitDivider
              dir={node.dir}
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
    navigateInPane: (threadId, projectId) => navigateInPane(paneId, threadId, projectId)
  });

  return (
    <PaneContextProvider value={value}>
      <PaneBody content={content} />
    </PaneContextProvider>
  );
}

function PaneBody({ content }: { content: PaneContent }) {
  const projects = useData((s) => s.projects);
  if (content.kind === 'thread') {
    return <ThreadDetail key={content.threadId} threadId={content.threadId} />;
  }
  if (content.kind === 'home') {
    return <HomeView />;
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
  return <div className="split-pane-empty">This page cannot live in a split pane.</div>;
}

function SplitDivider({
  dir,
  hidden,
  onResize
}: {
  dir: 'row' | 'col';
  hidden: boolean;
  onResize: (fraction: number) => void;
}) {
  const horizontal = dir === 'row';
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const hitTarget = event.currentTarget;
      const divider = hitTarget.parentElement;
      if (!(divider instanceof HTMLDivElement)) return;
      const previous = divider.previousElementSibling;
      const next = divider.nextElementSibling;
      if (!(previous instanceof HTMLElement) || !(next instanceof HTMLElement)) return;
      const previousRect = previous.getBoundingClientRect();
      const nextRect = next.getBoundingClientRect();
      const start = horizontal ? previousRect.left : previousRect.top;
      const end = horizontal ? nextRect.right : nextRect.bottom;
      const span = end - start;
      if (span <= 0) return;
      hitTarget.setPointerCapture(event.pointerId);
      divider.dataset.dragging = 'true';
      const previousGrow = Number.parseFloat(window.getComputedStyle(previous).flexGrow);
      const nextGrow = Number.parseFloat(window.getComputedStyle(next).flexGrow);
      const pairTotal =
        Number.isFinite(previousGrow) && Number.isFinite(nextGrow) && previousGrow + nextGrow > 0
          ? previousGrow + nextGrow
          : 1;
      const previousFlex = previous.style.flex;
      const nextFlex = next.style.flex;
      let pendingFraction: number | null = null;
      let finished = false;
      const onMove = (moveEvent: PointerEvent) => {
        const pointer = horizontal ? moveEvent.clientX : moveEvent.clientY;
        const fraction = clampSplitPairFraction((pointer - start) / span);
        pendingFraction = fraction;
        previous.style.flex = `${pairTotal * fraction} 1 0px`;
        next.style.flex = `${pairTotal * (1 - fraction)} 1 0px`;
      };
      const finish = (commit: boolean) => {
        if (finished) return;
        finished = true;
        delete divider.dataset.dragging;
        hitTarget.removeEventListener('pointermove', onMove);
        hitTarget.removeEventListener('pointerup', onUp);
        hitTarget.removeEventListener('pointercancel', onCancel);
        if (commit && pendingFraction !== null) {
          onResize(pendingFraction);
          return;
        }
        previous.style.flex = previousFlex;
        next.style.flex = nextFlex;
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      hitTarget.addEventListener('pointermove', onMove);
      hitTarget.addEventListener('pointerup', onUp);
      hitTarget.addEventListener('pointercancel', onCancel);
    },
    [horizontal, onResize]
  );

  return (
    <div
      role="separator"
      aria-orientation={horizontal ? 'vertical' : 'horizontal'}
      className={`split-divider split-divider--${dir}${hidden ? ' is-hidden' : ''}`}
    >
      <div
        aria-hidden
        className="split-divider-hit"
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}

function paneKey(node: LayoutNode): string {
  return node.type === 'pane' ? node.paneId : listPanes(node).map((pane) => pane.paneId).join('-');
}
