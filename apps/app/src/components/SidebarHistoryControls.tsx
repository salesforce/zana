import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useRouteStateHistoryNavigation } from '../lib/app-route-history.js';

/**
 * Back/Forward controls for the window title bar, moving through the
 * app-owned route history like browser navigation. Always mounted — the
 * shell overlay owns these so a collapsed rail cannot hide them.
 */
export function SidebarHistoryControls({
  label = 'Navigation history'
}: {
  label?: string;
}) {
  const { canGoBack, canGoForward, goBack, goForward } = useRouteStateHistoryNavigation();
  return (
    <div className="sidebar-history-controls" data-testid="sidebar-history-controls" aria-label={label}>
      <button
        type="button"
        aria-label="Go back"
        title="Go back"
        disabled={!canGoBack}
        onClick={goBack}
      >
        <ChevronLeft size={19} />
      </button>
      <button
        type="button"
        aria-label="Go forward"
        title="Go forward"
        disabled={!canGoForward}
        onClick={goForward}
      >
        <ChevronRight size={19} />
      </button>
    </div>
  );
}
