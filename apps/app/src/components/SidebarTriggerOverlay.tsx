import { PanelLeft, PanelLeftClose } from 'lucide-react';
import { useUi } from '../store.js';

/**
 * The one sidebar control for the window. It is deliberately a shell sibling
 * of both rail and content so the rail slides below a fixed target instead of
 * moving the target between independent route headers.
 */
export function SidebarTriggerOverlay() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  return (
    <div className="sidebar-trigger-overlay" data-testid="sidebar-trigger-overlay">
      <button
        type="button"
        className="sidebar-expand-control"
        onClick={toggleSidebar}
        aria-label={label}
        aria-expanded={!collapsed}
        title={label}
      >
        {collapsed ? <PanelLeft size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
