import { PanelLeft, PanelLeftClose, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useUi } from '../store.js';
import { useEnsureThreads } from '../hooks/useEnsureThreads.js';
import { getNewThreadRoutePath } from '../lib/route-paths.js';
import { SidebarHistoryControls } from './SidebarHistoryControls.js';
import { CollapsedUnreadThreads } from './CollapsedUnreadThreads.js';

/**
 * Persistent title-bar chrome: sidebar restore + back/forward. It is a shell
 * sibling of both rail and content so collapsing the rail cannot unmount the
 * arrows, and the rail slides below a fixed target instead of moving these
 * controls between independent route headers. When collapsed, search / new
 * chat / unread threads join the same overlay.
 */
export function SidebarTriggerOverlay() {
  const collapsed = useUi((s) => s.sidebarCollapsed);
  const toggleSidebar = useUi((s) => s.toggleSidebar);
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const label = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
  useEnsureThreads();

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
      <SidebarHistoryControls />
      {collapsed ? (
        <div className="sidebar-trigger-actions" data-testid="sidebar-trigger-collapsed-actions">
          <CollapsedUnreadThreads />
          <button
            type="button"
            className="sidebar-expand-control"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            title="Search"
            data-testid="sidebar-collapsed-search"
          >
            <Search size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sidebar-expand-control"
            onClick={() => navigate(getNewThreadRoutePath())}
            aria-label="New Chat"
            title="New Chat"
            data-testid="sidebar-collapsed-new-chat"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
