import { useLocation } from 'react-router-dom';
import {
  INITIAL_STORED_ROUTE_MEMORY,
  nextStoredRouteMemory,
  visibleRouteMemory,
  type AppSettingsRouteMemory,
  type StoredRouteMemory
} from '../lib/route-memory.js';

/**
 * Module-level so ProjectScopedNav still sees the last non-project path after
 * the global Sidebar unmounts. A per-component ref reset to Home, so Back
 * either no-op'd on the project URL or dumped the user on New Chat.
 */
let storedMemory: StoredRouteMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
let recordedLocationKey = '';

function locationKey(location: { pathname: string; search: string; hash: string }): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

function rememberLocation(location: { pathname: string; search: string; hash: string }): void {
  const key = locationKey(location);
  if (key === recordedLocationKey) return;
  recordedLocationKey = key;
  storedMemory = nextStoredRouteMemory(storedMemory, location);
}

/** Test-only: drop remembered paths so files don't leak across workers. */
export function resetAppSettingsRouteMemory(): void {
  storedMemory = { ...INITIAL_STORED_ROUTE_MEMORY };
  recordedLocationKey = '';
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
