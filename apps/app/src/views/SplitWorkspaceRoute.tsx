import { useMemo, useSyncExternalStore } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { paneContentForPathname } from '../lib/split-layout/splitThreadNavigation.js';
import { extensionsHubRedirectForPath } from '../plugins/plugin-nav-href.js';
import { listNavPanels, subscribePluginSlots } from '../plugins/plugin-slots.js';
import { SplitThreadArea } from './thread-detail/SplitThreadArea.js';

/**
 * Stable owner for every page that can live in the split workspace.
 * Mounted once from AppRoutes so focus-driven URL changes do not remount
 * the split tree or its thread/compose/plugin panes.
 */
export function SplitWorkspaceRoute() {
  const location = useLocation();
  useSyncExternalStore(subscribePluginSlots, listNavPanels, listNavPanels);
  const hubRedirect = extensionsHubRedirectForPath(location.pathname);
  const routeContent = useMemo(
    () => paneContentForPathname(location.pathname),
    [location.pathname]
  );
  if (hubRedirect) return <Navigate to={hubRedirect} replace />;
  if (routeContent === null) return null;
  return <SplitThreadArea routeContent={routeContent} />;
}
