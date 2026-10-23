import { matchPath, useLocation } from 'react-router-dom';
import {
  INITIAL_STORED_ROUTE_MEMORY,
  nextStoredRouteMemory,
  resolveProjectBackPath,
  shellRouteKind,
  visibleRouteMemory,
  type AppSettingsRouteMemory,
  type StoredRouteMemory
} from '../lib/route-memory.js';
import { PROJECT_SETTINGS_ROUTE_PATH, getLocationRoutePath } from '../lib/route-paths.js';

/**
 * Module-level so ProjectScopedNav still sees the last non-project path after
 * the global Sidebar unmounts. A per-component ref reset to Home, so Back
 * either no-op'd on the project URL or dumped the user on New Chat.
 */
let storedMemory: StoredRouteMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
let recordedLocationKey = '';
/** Last app route that wasn't a project's Settings: where closing it returns. */
let lastRouteBeforeProjectSettings = '/';

function locationKey(location: { pathname: string; search: string; hash: string }): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function rememberLocation(location: { pathname: string; search: string; hash: string }): void {
  const key = locationKey(location);
  if (key === recordedLocationKey) return;
  recordedLocationKey = key;
  storedMemory = nextStoredRouteMemory(storedMemory, location);
  if (shellRouteKind(location.pathname) === 'app' && !matchPath(PROJECT_SETTINGS_ROUTE_PATH, location.pathname)) {
    lastRouteBeforeProjectSettings = getLocationRoutePath(location);
  }
}

/** Test-only: drop remembered paths so files don't leak across workers. */
export function resetAppSettingsRouteMemory(): void {
  storedMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
  recordedLocationKey = '';
  lastRouteBeforeProjectSettings = '/';
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
 * Remembers the most recently visited core-app, Settings, and Extensions
 * routes while the app shell is mounted. Extensions / project-rail Back
 * buttons read the remembered core-app path rather than hard-coding Home.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  rememberLocation(location);
  return visibleRouteMemory(storedMemory, location);
}
