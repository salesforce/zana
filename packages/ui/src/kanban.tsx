import type { CSSProperties, ReactNode } from 'react';
import { ChevronRight, PanelLeftClose } from 'lucide-react';
import { useCanvasPan } from './use-canvas-pan.js';
import './kanban.css';

export {
  canvasPanIgnoresTarget,
  canvasPanOffset,
  useCanvasPan,
  type CanvasPanOrigin
} from './use-canvas-pan.js';

export interface KanbanProps {
  children: ReactNode;
  className?: string;
  /** Accessible name for the board canvas. */
  label: string;
  /**
   * Fixed column width in px (PR-style). Omit for fluid columns that share
   * leftover width and fall back to a 200px floor (Agents-style).
   */
  columnWidth?: number;
}

export interface KanbanColumnProps {
  children?: ReactNode;
  className?: string;
  columnId: string;
  label: string;
  count: number;
  icon?: ReactNode;
  /** Extra header chip, e.g. an unread count. */
  badge?: ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: (columnId: string) => void;
}

function kanbanVars(columnWidth?: number): CSSProperties {
  if (columnWidth == null) {
    return {
      '--zcc-kanban-col-min': '200px',
      '--zcc-kanban-col-flex': '1 1 200px',
      '--zcc-kanban-col-width': 'auto'
    } as CSSProperties;
  }
  return {
    '--zcc-kanban-col-min': `${columnWidth}px`,
    '--zcc-kanban-col-flex': `0 0 ${columnWidth}px`,
    '--zcc-kanban-col-width': `${columnWidth}px`
  } as CSSProperties;
}

/**
 * Pannable kanban canvas (drag empty space or two-finger scroll). Columns are
 * layout only — callers own cards and whether items can move between lanes.
 */
export function Kanban({ children, className = '', label, columnWidth }: KanbanProps) {
  const { isPanning, canvasPanProps } = useCanvasPan();
  return (
    <div
      role="list"
      aria-label={label}
      className={['zcc-kanban', isPanning ? 'is-panning' : '', className].filter(Boolean).join(' ')}
      style={kanbanVars(columnWidth)}
      {...canvasPanProps}
    >
      {children}
    </div>
  );
}

export function KanbanColumn({
  children,
  className = '',
  columnId,
  label,
  count,
  icon,
  badge,
  collapsed = false,
  onToggleCollapse
}: KanbanColumnProps) {
  const collapseLabel = collapsed ? `Expand ${label}` : `Collapse ${label}`;
  return (
    <section
      role="listitem"
      className={['zcc-kanban-col', collapsed ? 'is-collapsed' : '', className].filter(Boolean).join(' ')}
      aria-label={`${label} (${count})`}
      data-kanban-column={columnId}
      data-board-column={columnId}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <header className="zcc-kanban-col-header">
        {icon ? (
          <span className="zcc-kanban-col-icon" aria-hidden>
            {icon}
          </span>
        ) : null}
        <span className="zcc-kanban-col-title">{label}</span>
        <span className="zcc-kanban-col-count">{count}</span>
        {badge}
        {onToggleCollapse ? (
          <button
            type="button"
            className="zcc-kanban-col-collapse"
            title={collapseLabel}
            aria-label={collapseLabel}
            aria-expanded={!collapsed}
            onClick={() => onToggleCollapse(columnId)}
          >
            {collapsed ? <ChevronRight size={13} /> : <PanelLeftClose size={13} />}
          </button>
        ) : null}
      </header>
      {!collapsed ? <div className="zcc-kanban-col-body">{children}</div> : null}
    </section>
  );
}
