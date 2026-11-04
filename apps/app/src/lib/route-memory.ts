import { matchPath } from 'react-router-dom';
import {
  APP_ROOT_ROUTE_PATH,
  PROJECT_SETTINGS_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
  getAgentsRoutePath,
  getLocationRoutePath,
  isExtensionsRoutePath,
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
 */
export function resolveProjectBackPath(to?: string | null): string {
  const dest = to && to.length > 0 ? to : getAgentsRoutePath();
  const pathname = dest.split(/[?#]/, 1)[0] ?? dest;
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
  return {
    ...prev,
    lastAppRoutePath: current,
    lastCoreAppRoutePath: current,
    lastNonProjectAppRoutePath: onProject ? prev.lastNonProjectAppRoutePath : current
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

/** Test-only: drop remembered paths so files don't leak across workers. */
export function resetAppSettingsRouteMemory(): void {
  storedMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
  recordedLocationKey = '';
  lastRouteBeforeProjectSettings = APP_ROOT_ROUTE_PATH;
}

/** The "Back to app" destination from Settings, for callers outside React. */
export function getRememberedAppRoutePath(): string {
  return resolveProjectBackPath(storedMemory.lastAppRoutePath);
}

/** The app route seen last before a project's Settings, for callers outside React. */
export function getRouteBeforeProjectSettings(): string {
  return lastRouteBeforeProjectSettings;
}
