import { matchPath } from 'react-router-dom';
import {
  APP_ROOT_ROUTE_PATH,
  INBOX_ROUTE_PATH,
  NEW_SCHEDULE_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SCHEDULER_ROUTE_PATH,
  SCHEDULE_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  getAgentsRoutePath,
  getLocationRoutePath,
  isExtensionsRoutePath,
  isProjectInboxRoutePath,
  isProjectRoutePath,
  isSettingsRoutePath
} from './route-paths.js';

export interface AppSettingsRouteMemory {
  appRoutePath: string;
  settingsRoutePath: string;
  toolsRoutePath: string;
  toolsBackRoutePath: string;
  projectBackRoutePath: string;
}

export interface StoredRouteMemory {
  lastAppRoutePath: string;
  lastSettingsRoutePath: string;
  lastToolsRoutePath: string;
  lastCoreAppRoutePath: string;
  lastNonProjectAppRoutePath: string;
}

export const INITIAL_STORED_ROUTE_MEMORY: StoredRouteMemory = {
  lastAppRoutePath: APP_ROOT_ROUTE_PATH,
  lastSettingsRoutePath: SETTINGS_ROUTE_PATH,
  lastToolsRoutePath: TOOLS_PLUGINS_ROUTE_PATH,
  lastCoreAppRoutePath: APP_ROOT_ROUTE_PATH,
  lastNonProjectAppRoutePath: getAgentsRoutePath()
};

/**
 * Project-rail Back must leave `/projects/:id`. Empty or project dests fall
 * back to Agents — the cross-project home — never the current project URL.
 * A project's Inbox leaves to the cross-project Inbox, where it went while
 * that view was the plain `/inbox` route.
 */
export function resolveProjectBackPath(to?: string | null): string {
  const dest = to && to.length > 0 ? to : getAgentsRoutePath();
  const pathname = dest.split(/[?#]/, 1)[0] ?? dest;
  if (isProjectInboxRoutePath(pathname)) return `${INBOX_ROUTE_PATH}${dest.slice(pathname.length)}`;
  return isProjectRoutePath(pathname) ? getAgentsRoutePath() : dest;
}

export type ShellRouteKind = 'app' | 'settings' | 'extensions';

export function shellRouteKind(pathname: string): ShellRouteKind {
  if (isExtensionsRoutePath(pathname)) return 'extensions';
  if (isSettingsRoutePath(pathname)) return 'settings';
  return 'app';
}

export function nextStoredRouteMemory(
  prev: StoredRouteMemory,
  location: { pathname: string; search: string; hash: string }
): StoredRouteMemory {
  const current = getLocationRoutePath(location);
  const kind = shellRouteKind(location.pathname);
  const onProject = isProjectRoutePath(location.pathname);

  if (kind === 'settings') {
    return { ...prev, lastSettingsRoutePath: current };
  }
  if (kind === 'extensions') {
    return { ...prev, lastToolsRoutePath: current, lastAppRoutePath: current };
  }
  // A project's Inbox counts as the cross-project Inbox for project Back.
  const nonProjectPath = isProjectInboxRoutePath(location.pathname)
    ? resolveProjectBackPath(current)
    : onProject || location.pathname.startsWith('/setup/')
      ? prev.lastNonProjectAppRoutePath
      : current;
  return {
    ...prev,
    lastAppRoutePath: current,
    lastCoreAppRoutePath: current,
    lastNonProjectAppRoutePath: nonProjectPath
  };
}

export function visibleRouteMemory(
  stored: StoredRouteMemory,
  location: { pathname: string; search: string; hash: string }
): AppSettingsRouteMemory {
  const current = getLocationRoutePath(location);
  const kind = shellRouteKind(location.pathname);
  const onProject = isProjectRoutePath(location.pathname);
  return {
    appRoutePath:
      kind === 'settings' ? resolveProjectBackPath(stored.lastAppRoutePath) : current,
    settingsRoutePath: kind === 'settings' ? current : stored.lastSettingsRoutePath,
    toolsRoutePath: kind === 'extensions' ? current : stored.lastToolsRoutePath,
    toolsBackRoutePath:
      kind === 'extensions' || kind === 'settings'
        ? stored.lastCoreAppRoutePath
        : current,
    projectBackRoutePath: onProject
      ? resolveProjectBackPath(stored.lastNonProjectAppRoutePath)
      : current
  };
}

/**
 * Module-level so ProjectScopedNav still sees the last non-project path after
 * the global Sidebar unmounts. A per-component ref reset to Home, so Back
 * either no-op'd on the project URL or dumped the user on New Chat.
 */
let storedMemory: StoredRouteMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
let recordedLocationKey = '';
/** Last app route that wasn't a project's Settings: where closing it returns. */
let lastRouteBeforeProjectSettings = APP_ROOT_ROUTE_PATH;
/** Last route that wasn't an Inbox: where Ctrl/Cmd+I returns. Null until one is seen. */
let lastRouteBeforeInbox: string | null = null;
/** Last route that wasn't the Scheduler: where Ctrl/Cmd+J returns. Null until one is seen. */
let lastRouteBeforeScheduler: string | null = null;

/** The cross-project `/inbox` or a project's `/projects/:id/inbox`. */
export function isInboxRoutePath(pathname: string): boolean {
  return pathname === INBOX_ROUTE_PATH || isProjectInboxRoutePath(pathname);
}

/**
 * The routes that open the top-level Scheduler (`nav === 'scheduler'`): its
 * overview, a new schedule and a schedule's detail. A project's Scheduler tab
 * is a project view, so Ctrl/Cmd+J can return to it.
 */
export function isSchedulerRoutePath(pathname: string): boolean {
  return (
    pathname === SCHEDULER_ROUTE_PATH ||
    pathname === NEW_SCHEDULE_ROUTE_PATH ||
    matchPath(SCHEDULE_ROUTE_PATH, pathname) !== null
  );
}

/** Records a rendered location (once per distinct URL) and returns the memory. */
export function rememberLocation(location: {
  pathname: string;
  search: string;
  hash: string;
}): StoredRouteMemory {
  const current = getLocationRoutePath(location);
  if (current === recordedLocationKey) return storedMemory;
  recordedLocationKey = current;
  storedMemory = nextStoredRouteMemory(storedMemory, location);
  if (shellRouteKind(location.pathname) === 'app' && !matchPath(PROJECT_SETTINGS_ROUTE_PATH, location.pathname)) {
    lastRouteBeforeProjectSettings = current;
  }
  return storedMemory;
}

/**
 * Records a committed route as Ctrl/Cmd+I's return target. Called only from a
 * commit-phase effect, never during render: a render React discards must not
 * become the place Ctrl+I goes back to. Inbox routes are skipped, so moving
 * between Inboxes keeps the last non-Inbox view.
 */
export function rememberInboxReturnRoute(location: {
  pathname: string;
  search: string;
  hash: string;
}): void {
  if (isInboxRoutePath(location.pathname)) return;
  lastRouteBeforeInbox = getLocationRoutePath(location);
}

/**
 * Ctrl/Cmd+J's counterpart of `rememberInboxReturnRoute`, under the same
 * commit-phase rule. Scheduler routes are skipped, so opening a schedule and
 * going back to the overview keeps the view the Scheduler was opened from.
 */
export function rememberSchedulerReturnRoute(location: {
  pathname: string;
  search: string;
  hash: string;
}): void {
  if (isSchedulerRoutePath(location.pathname)) return;
  lastRouteBeforeScheduler = getLocationRoutePath(location);
}

/** Test-only: drop remembered paths so files don't leak across workers. */
export function resetAppSettingsRouteMemory(): void {
  storedMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
  recordedLocationKey = '';
  lastRouteBeforeProjectSettings = APP_ROOT_ROUTE_PATH;
  lastRouteBeforeInbox = null;
  lastRouteBeforeScheduler = null;
}

/** The "Back to app" destination from Settings, for callers outside React. */
export function getRememberedAppRoutePath(): string {
  return resolveProjectBackPath(storedMemory.lastAppRoutePath);
}

/** The app route seen last before a project's Settings, for callers outside React. */
export function getRouteBeforeProjectSettings(): string {
  return lastRouteBeforeProjectSettings;
}

/**
 * The route seen last before the Inbox (any page, Settings included), for
 * Ctrl/Cmd+I's return trip. Null when the Inbox is all this window has shown.
 */
export function getRouteBeforeInbox(): string | null {
  return lastRouteBeforeInbox;
}

/**
 * The route seen last before the Scheduler, for Ctrl/Cmd+J's return trip.
 * Null when the Scheduler is all this window has shown.
 */
export function getRouteBeforeScheduler(): string | null {
  return lastRouteBeforeScheduler;
}
