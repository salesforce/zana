import { useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import { rememberLocation, visibleRouteMemory, type AppSettingsRouteMemory } from '../lib/route-memory.js';
import { getRemovedRoutesVersion, liveRoutePath, subscribeRemovedRoutes } from '../lib/removed-routes.js';
import { APP_ROOT_ROUTE_PATH, getAgentsRoutePath } from '../lib/route-paths.js';

export { resetAppSettingsRouteMemory } from '../lib/route-memory.js';

/**
 * Remembers the most recently visited core-app, Settings, and Extensions
 * routes while the app shell is mounted. Extensions / project-rail Back
 * buttons read the remembered core-app path rather than hard-coding Home.
 * A Back target whose thread or session was removed falls back (see
 * `liveRoutePath`), and the links re-render when one is removed.
 */
export function useAppSettingsRouteMemory(): AppSettingsRouteMemory {
  const location = useLocation();
  useSyncExternalStore(subscribeRemovedRoutes, getRemovedRoutesVersion, getRemovedRoutesVersion);
  const memory = visibleRouteMemory(rememberLocation(location), location);
  return {
    ...memory,
    appRoutePath: liveRoutePath(memory.appRoutePath, APP_ROOT_ROUTE_PATH),
    toolsBackRoutePath: liveRoutePath(memory.toolsBackRoutePath, APP_ROOT_ROUTE_PATH),
    projectBackRoutePath: liveRoutePath(memory.projectBackRoutePath, getAgentsRoutePath())
  };
}
