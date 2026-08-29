import {
  APP_ROOT_ROUTE_PATH,
  SETTINGS_ROUTE_PATH,
  TOOLS_PLUGINS_ROUTE_PATH,
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
  lastNonProjectAppRoutePath: APP_ROOT_ROUTE_PATH
};

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
    appRoutePath: kind === 'settings' ? stored.lastAppRoutePath : current,
    settingsRoutePath: kind === 'settings' ? current : stored.lastSettingsRoutePath,
    toolsRoutePath: kind === 'extensions' ? current : stored.lastToolsRoutePath,
    toolsBackRoutePath:
      kind === 'extensions' || kind === 'settings'
        ? stored.lastCoreAppRoutePath
        : current,
    projectBackRoutePath: onProject ? stored.lastNonProjectAppRoutePath : current
  };
}
