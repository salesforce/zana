import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAppSettingsRouteMemory } from '../hooks/useAppSettingsRouteMemory.js';
import { useRouteState } from '../hooks/useRouteState.js';
import { getProjectRoutePath } from '../lib/route-paths.js';

/** Keep mounted across mobile routes so Settings remembers where it was opened. */
export function MobileSettingsBack({ hidden = false, onNavigate }: { hidden?: boolean; onNavigate?: () => void } = {}) {
  const routeMemory = useAppSettingsRouteMemory();
  const route = useRouteState();
  if (route.nav !== 'settings' || hidden) return null;
  const to = route.isProjectSettings && route.focusedProjectId
    ? getProjectRoutePath(route.focusedProjectId)
    : routeMemory.appRoutePath;
  return (
    <Link to={to} className="mobile-settings-back" onClick={onNavigate}>
      <ArrowLeft size={16} strokeWidth={1.7} aria-hidden="true" />
      Back to app
    </Link>
  );
}
