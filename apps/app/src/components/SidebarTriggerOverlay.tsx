import { Menu, PanelLeft, PanelLeftClose, PanelLeftOpen, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { titleWithShortcut } from '../lib/keyboard-shortcut-settings.js';
import { useUi } from '../store.js';
import { useCompactLayout } from '../hooks/useCompactLayout.js';
import { useEnsureThreads } from '../hooks/useEnsureThreads.js';
import { getNewThreadRoutePath, getRootRoutePath } from '../lib/route-paths.js';
import { getScopedProjectId } from '../lib/windowScope.js';
import { SidebarHistoryControls } from './SidebarHistoryControls.js';
import { CollapsedUnreadThreads } from './CollapsedUnreadThreads.js';
import { MobileAgentsBack } from './MobileAgentsBack.js';

/**
 * Persistent title-bar chrome: sidebar restore + back/forward. It is a shell
 * sibling of both rail and content so collapsing the rail cannot unmount the
 * arrows, and the rail slides below a fixed target instead of moving these
 * controls between independent route headers. When collapsed, search / new
 * chat / unread threads join the same overlay.
 */
/** Label naming what the next click does. Rail -> hidden only exists in three-state. */
function nextStateLabel({ collapsed, sidebarMode, threeState, overridden }: {
  collapsed: boolean;
  sidebarMode: 'expanded' | 'rail' | 'hidden';
  threeState: boolean;
  overridden: boolean;
}): string {
  if (!collapsed) return 'Collapse sidebar';
  if (!overridden && threeState && sidebarMode === 'rail') return 'Hide sidebar';
  return 'Expand sidebar';
}

export function SidebarTriggerOverlay({
  collapsed: collapsedOverride,
  mode: modeOverride,
  onToggle
}: { collapsed?: boolean; mode?: 'expanded' | 'rail' | 'hidden'; onToggle?: () => void } = {}) {
  const compact = useCompactLayout();
  const storedMode = useUi((s) => s.sidebarMode);
  const sidebarMode = modeOverride ?? storedMode;
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  const projectId = getScopedProjectId() ?? focusedProjectId;
  // `collapsed` = sidebar not fully expanded (rail or hidden). The click cycles
  // expanded -> rail -> hidden -> expanded (three-state) or expanded <-> hidden
  // (two-state, default), so the label names the NEXT state.
  const collapsed = collapsedOverride ?? sidebarMode !== 'expanded';
  const hidden = collapsedOverride ?? sidebarMode === 'hidden';
  const toggleSidebar = useUi((s) => s.cycleSidebarMode);
  const threeState = useUi((s) => s.sidebarCollapseBehavior) === 'three-state';
  const setPaletteOpen = useUi((s) => s.setPaletteOpen);
  const navigate = useNavigate();
  const label = nextStateLabel({ collapsed, sidebarMode, threeState, overridden: collapsedOverride !== undefined });
  useEnsureThreads();
  return (
    <div className="sidebar-trigger-overlay" data-testid="sidebar-trigger-overlay">
      <button
        type="button"
        className="sidebar-expand-control"
        onClick={onToggle ?? toggleSidebar}
        aria-label={label}
        aria-expanded={!collapsed}
        title={titleWithShortcut(label, 'sidebar.rail.toggle')}
      >
        {compact ? <Menu size={20} aria-hidden="true" /> : hidden ? <PanelLeft size={18} aria-hidden="true" /> : collapsed ? <PanelLeftOpen size={18} aria-hidden="true" /> : <PanelLeftClose size={18} aria-hidden="true" />}
      </button>
      <MobileAgentsBack hidden={!hidden} />
      <SidebarHistoryControls />
      {hidden ? (
        <div className="sidebar-trigger-actions" data-testid="sidebar-trigger-collapsed-actions">
          <CollapsedUnreadThreads />
          <button
            type="button"
            className="sidebar-expand-control"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search"
            title={titleWithShortcut('Search', 'thread.search')}
            data-testid="sidebar-collapsed-search"
          >
            <Search size={18} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="sidebar-expand-control"
            onClick={() => navigate(projectId ? getNewThreadRoutePath(projectId) : getRootRoutePath())}
            aria-label="New Chat"
            title={titleWithShortcut('New Chat', 'thread.new')}
            data-testid="sidebar-collapsed-new-chat"
          >
            <Plus size={18} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
