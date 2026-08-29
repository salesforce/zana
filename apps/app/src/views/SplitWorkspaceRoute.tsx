import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { paneContentForPathname } from '../lib/split-layout/splitThreadNavigation.js';
import { SplitThreadArea } from './thread-detail/SplitThreadArea.js';

/**
 * Stable owner for every page that can live in the split workspace.
 * Mounted once from AppRoutes so focus-driven URL changes do not remount
 * the split tree or its thread/compose/plugin panes.
 */
export function SplitWorkspaceRoute() {
  const location = useLocation();
  const routeContent = useMemo(
    () => paneContentForPathname(location.pathname),
    [location.pathname]
  );
  if (routeContent === null) return null;
  return <SplitThreadArea routeContent={routeContent} />;
}
