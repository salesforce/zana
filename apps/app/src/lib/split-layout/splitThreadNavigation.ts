import { matchPath } from 'react-router-dom';
import {
  APP_ROOT_ROUTE_PATH,
  NEW_THREAD_ROUTE_PATH,
  PLUGIN_PANEL_ROOT_ROUTE_PATH,
  PLUGIN_PANEL_ROUTE_PATH,
  PROJECT_NEW_THREAD_ROUTE_PATH,
  PROJECT_THREAD_ROUTE_PATH,
  THREAD_ROUTE_PATH,
  getNewThreadRoutePath,
  getPluginDetailRoutePath,
  getPluginPanelRoutePath,
  getRootRoutePath,
  getThreadRoutePath
} from '../route-paths.js';
import { decideThreadDrop, type SplitZone } from '../split-drag/zones.js';
import {
  countPanes,
  findPane,
  findPaneByContent,
  findPaneByThread,
  MAX_PANES,
  replacePaneContent,
  setFocus,
  splitPane
} from '../split-layout/ops.js';
import type { PaneContent, SplitLayout } from '../split-layout/types.js';

const FIRST_PANE_ID = 'pane-1';

export function threadPaneContent(threadId: string, projectId: string | null): PaneContent {
  return { kind: 'thread', projectId, threadId };
}

export function createSinglePaneLayout(content: PaneContent): SplitLayout {
  return {
    root: { type: 'pane', paneId: FIRST_PANE_ID, content },
    focusedPaneId: FIRST_PANE_ID
  };
}

export function paneContentRoute(content: PaneContent): string {
  if (content.kind === 'thread') {
    return getThreadRoutePath(content.threadId, content.projectId);
  }
  if (content.kind === 'home') {
    return getRootRoutePath();
  }
  if (content.kind === 'new-thread') {
    return getNewThreadRoutePath(content.projectId ?? undefined);
  }
  if (content.kind === 'plugin-detail') {
    return getPluginDetailRoutePath(content.pluginId);
  }
  return getPluginPanelRoutePath({
    pluginId: content.pluginId,
    path: content.panelPath,
    subPath: content.subPath
  });
}

function param(match: ReturnType<typeof matchPath>, name: string): string | undefined {
  const value = match?.params[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function splatParam(match: ReturnType<typeof matchPath>): string {
  const splat = (match?.params as Record<string, string | undefined> | undefined)?.['*'];
  return typeof splat === 'string' ? splat : '';
}

/** The pane content a pathname addresses, or null when the page cannot live in a split pane. */
export function paneContentForPathname(pathname: string): PaneContent | null {
  if (pathname === APP_ROOT_ROUTE_PATH) return { kind: 'home' };
  if (pathname === NEW_THREAD_ROUTE_PATH) return { kind: 'new-thread' };
  const projectNew = matchPath(PROJECT_NEW_THREAD_ROUTE_PATH, pathname);
  if (projectNew) {
    return { kind: 'new-thread', projectId: param(projectNew, 'projectId') ?? null };
  }
  const projectThread = matchPath(PROJECT_THREAD_ROUTE_PATH, pathname);
  if (projectThread) {
    const threadId = param(projectThread, 'threadId');
    if (!threadId) return null;
    return {
      kind: 'thread',
      projectId: param(projectThread, 'projectId') ?? null,
      threadId
    };
  }
  const globalThread = matchPath(THREAD_ROUTE_PATH, pathname);
  if (globalThread) {
    const threadId = param(globalThread, 'threadId');
    if (!threadId) return null;
    return { kind: 'thread', projectId: null, threadId };
  }
  const panel =
    matchPath(PLUGIN_PANEL_ROUTE_PATH, pathname) ?? matchPath(PLUGIN_PANEL_ROOT_ROUTE_PATH, pathname);
  if (panel) {
    const pluginId = param(panel, 'pluginId');
    const panelPath = param(panel, 'panelPath');
    if (pluginId && panelPath) {
      return {
        kind: 'plugin-panel',
        pluginId,
        panelPath,
        subPath: splatParam(panel)
      };
    }
  }
  return null;
}

export function isSplitWorkspacePath(pathname: string): boolean {
  return paneContentForPathname(pathname) !== null;
}

/** Reconciles any splittable page route into the focused pane. */
export function reconcileLayoutForContent(
  layout: SplitLayout | null,
  content: PaneContent
): SplitLayout {
  if (layout === null) return createSinglePaneLayout(content);
  const existing = findPaneByContent(layout.root, content);
  if (existing !== null) {
    const withRouteState =
      existing.content.kind === 'plugin-panel' &&
      content.kind === 'plugin-panel' &&
      existing.content.subPath !== content.subPath
        ? replacePaneContent(layout, existing.paneId, content)
        : layout;
    return withRouteState.focusedPaneId === existing.paneId
      ? withRouteState
      : setFocus(withRouteState, existing.paneId);
  }
  return replacePaneContent(layout, layout.focusedPaneId, content);
}

export function focusedPaneRoute(layout: SplitLayout): string | null {
  const focused = findPane(layout.root, layout.focusedPaneId);
  return focused === null ? null : paneContentRoute(focused.content);
}

export type ThreadOpenSplit = SplitZone | 'down' | 'replace';

function threadOpenSplitZone(split: ThreadOpenSplit): SplitZone {
  return split === 'replace' ? 'center' : split === 'down' ? 'bottom' : split;
}

export function applyThreadOpenToLayout(
  layout: SplitLayout | null,
  threadId: string,
  projectId: string | null,
  split: ThreadOpenSplit
): SplitLayout {
  const content = threadPaneContent(threadId, projectId);
  if (layout === null) return createSinglePaneLayout(content);
  const existing = findPaneByThread(layout.root, projectId, threadId);
  const decision = decideThreadDrop({
    zone: threadOpenSplitZone(split),
    threadAlreadyOpen: existing !== null,
    atMaxPanes: countPanes(layout.root) >= MAX_PANES
  });
  if (existing !== null) {
    return layout.focusedPaneId === existing.paneId ? layout : setFocus(layout, existing.paneId);
  }
  return decision.zone === 'center'
    ? replacePaneContent(layout, layout.focusedPaneId, content)
    : splitPane(layout, layout.focusedPaneId, decision.zone, content);
}
