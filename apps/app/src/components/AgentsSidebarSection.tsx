import { useState, type CSSProperties, type HTMLAttributes, type MouseEvent as ReactMouseEvent } from 'react';
import { ChevronRight, LayoutDashboard, MessageCirclePlus } from 'lucide-react';
import { useUi } from '../store.js';
import { AgentTray } from './AgentTray.js';

export const AGENTS_SECTION_KEY = 'sidebar:agents';
const AGENTS_SECTION_ID = 'sidebar-agents-list';
const AGENTS_SECTION_HEIGHT_KEY = 'zcc.sidebarAgentsHeight';
const AGENTS_SECTION_DEFAULT_HEIGHT = 176;
const AGENTS_SECTION_MIN_HEIGHT = 64;
const AGENTS_SECTION_MAX_HEIGHT = 420;

function clampAgentsSectionHeight(value: number): number {
  return Math.max(AGENTS_SECTION_MIN_HEIGHT, Math.min(AGENTS_SECTION_MAX_HEIGHT, value));
}

function readAgentsSectionHeight(): number {
  if (typeof localStorage === 'undefined') return AGENTS_SECTION_DEFAULT_HEIGHT;
  const value = Number(localStorage.getItem(AGENTS_SECTION_HEIGHT_KEY));
  return Number.isFinite(value) ? clampAgentsSectionHeight(value) : AGENTS_SECTION_DEFAULT_HEIGHT;
}

/**
 * Collapsible Agents collection used by both the global Sidebar and the
 * project rail. The dashboard control opens the Agents board; the list is
 * the live tray (optionally scoped to one project).
 */
export function AgentsSidebarSection({
  dragHandle,
  projectId,
  onOpenDashboard
}: {
  dragHandle?: HTMLAttributes<HTMLElement>;
  projectId?: string;
  onOpenDashboard?: () => void;
}) {
  const collapsed = useUi((s) => !!s.collapsedSections[AGENTS_SECTION_KEY]);
  const toggleSection = useUi((s) => s.toggleSection);
  const setLauncherOpen = useUi((s) => s.setLauncherOpen);
  const setNav = useUi((s) => s.setNav);
  const [height, setHeight] = useState(readAgentsSectionHeight);

  const setSectionHeight = (next: number) => {
    const clamped = clampAgentsSectionHeight(next);
    setHeight(clamped);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(AGENTS_SECTION_HEIGHT_KEY, String(clamped));
    }
  };

  const onResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    document.body.classList.add('resizing-sidebar-section');
    const onMove = (moveEvent: MouseEvent) => setSectionHeight(startHeight + moveEvent.clientY - startY);
    const onUp = () => {
      document.body.classList.remove('resizing-sidebar-section');
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const openDashboard = () => {
    if (onOpenDashboard) {
      onOpenDashboard();
      return;
    }
    setNav('agents');
  };

  return (
    <section
      className={`sidebar-agents ${collapsed ? 'sidebar-agents--collapsed' : ''}`}
      style={collapsed ? undefined : { '--sidebar-agents-height': `${height}px` } as CSSProperties}
    >
      <header className="sidebar-agents-header">
        <button
          type="button"
          className="sidebar-agents-heading"
          {...dragHandle}
          onClick={() => toggleSection(AGENTS_SECTION_KEY)}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} Agents section`}
          aria-controls={AGENTS_SECTION_ID}
          aria-expanded={!collapsed}
          title={`${collapsed ? 'Expand' : 'Collapse'} Agents`}
        >
          <span>Agents</span>
          <ChevronRight
            size={14}
            aria-hidden="true"
            className={`sidebar-agents-chevron ${collapsed ? '' : 'open'}`}
          />
        </button>
        <div className="sidebar-agents-actions">
          <button
            type="button"
            className="icon-btn"
            aria-label="Open Agents dashboard"
            title="Open Agents dashboard"
            onClick={openDashboard}
          >
            <LayoutDashboard size={18} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="New quick agent"
            title="New quick agent"
            onClick={() => setLauncherOpen(true)}
          >
            <MessageCirclePlus size={18} />
          </button>
        </div>
      </header>
      <div id={AGENTS_SECTION_ID} className="sidebar-agents-body" hidden={collapsed}>
        <AgentTray placement="inline" projectId={projectId} />
      </div>
      {!collapsed && (
        <div
          className="sidebar-agents-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-valuemin={AGENTS_SECTION_MIN_HEIGHT}
          aria-valuemax={AGENTS_SECTION_MAX_HEIGHT}
          aria-valuenow={height}
          title="Drag to resize · double-click to reset"
          onMouseDown={onResizeMouseDown}
          onDoubleClick={() => setSectionHeight(AGENTS_SECTION_DEFAULT_HEIGHT)}
        />
      )}
    </section>
  );
}
