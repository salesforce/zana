/**
 * Horizontal kanban board: one column per rollup status, compact cards.
 * Status is GitHub-derived, so columns are a layout — cards are not
 * drag-reordered between lanes.
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Eye,
  GitMerge,
  GitPullRequestClosed,
  Loader2,
  PanelLeftClose,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleHost } from './host.js';
import type { MonitoredPr, MonitoredRepo, PrRollupStatus } from '../../lib/types.js';
import { resolveBuildThresholds } from '../../lib/types.js';
import { DEFAULT_TIS_DANGER_HOURS, DEFAULT_TIS_WARN_HOURS } from './formatHelpers.js';
import { BOARD_COLUMN_LABELS, groupPrsByStatus, visibleBoardColumns } from './pr-board.js';
import { PrBoardCard } from './PrBoardCard.js';

const COLUMN_ICONS: Record<PrRollupStatus, LucideIcon> = {
  conflict: ShieldAlert,
  failed: XCircle,
  yellow: AlertTriangle,
  'review-required': Eye,
  pending: CircleDashed,
  integrating: Loader2,
  green: CheckCircle2,
  'closed-merged': GitMerge,
  'closed-abandoned': GitPullRequestClosed,
};

interface Props {
  prs: MonitoredPr[];
  host: ModuleHost;
  tisWarnHours?: number;
  tisDangerHours?: number;
  repositories?: MonitoredRepo[];
  selected: Set<string>;
  selectMode?: boolean;
  showEmpty?: boolean;
  collapsed: ReadonlySet<PrRollupStatus>;
  onToggleCollapse: (status: PrRollupStatus) => void;
  onToggleSelect: (url: string) => void;
  onDismiss: (url: string) => void;
  onOpen: (url: string) => void;
}

export function PrBoard({
  prs,
  host,
  tisWarnHours,
  tisDangerHours,
  repositories,
  selected,
  selectMode = false,
  showEmpty = false,
  collapsed,
  onToggleCollapse,
  onToggleSelect,
  onDismiss,
  onOpen,
}: Props) {
  const columns = useMemo(() => groupPrsByStatus(prs), [prs]);
  const visible = useMemo(() => visibleBoardColumns(columns, { showEmpty }), [columns, showEmpty]);
  const selectionActive = selected.size > 0 || selectMode;

  return (
    <div className="prm-board" role="list" aria-label="Pull requests by status">
      {visible.map((status) => {
        const cards = columns[status];
        const Icon = COLUMN_ICONS[status];
        const isCollapsed = collapsed.has(status);
        const unread = cards.filter(
          (pr) => pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt)
        ).length;
        return (
          <section
            key={status}
            className={`prm-board-col prm-board-col--${status}${isCollapsed ? ' prm-board-col--collapsed' : ''}`}
            aria-label={`${BOARD_COLUMN_LABELS[status]} (${cards.length})`}
            data-board-column={status}
            data-collapsed={isCollapsed ? 'true' : 'false'}
          >
            <header className="prm-board-col-header">
              <Icon size={14} className="prm-board-col-icon" aria-hidden />
              <span className="prm-board-col-title">{BOARD_COLUMN_LABELS[status]}</span>
              <span className="prm-board-col-count">{cards.length}</span>
              {unread > 0 && (
                <span className="prm-board-col-unread" title={`${unread} unread`}>
                  {unread}
                </span>
              )}
              <button
                type="button"
                className="prm-board-col-collapse"
                title={isCollapsed ? `Expand ${BOARD_COLUMN_LABELS[status]}` : `Collapse ${BOARD_COLUMN_LABELS[status]}`}
                aria-label={isCollapsed ? `Expand ${BOARD_COLUMN_LABELS[status]}` : `Collapse ${BOARD_COLUMN_LABELS[status]}`}
                aria-expanded={!isCollapsed}
                onClick={() => onToggleCollapse(status)}
              >
                {isCollapsed ? <ChevronRight size={13} /> : <PanelLeftClose size={13} />}
              </button>
            </header>
            {!isCollapsed && (
              <div className="prm-board-col-body">
                {cards.length === 0 ? (
                  <div className="prm-board-col-empty">No PRs</div>
                ) : (
                  cards.map((pr) => {
                    const build = resolveBuildThresholds(
                      pr.repo,
                      repositories,
                      tisWarnHours ?? DEFAULT_TIS_WARN_HOURS,
                      tisDangerHours ?? DEFAULT_TIS_DANGER_HOURS
                    );
                    const repoRec = (repositories ?? []).find(
                      (r) => `${r.owner}/${r.repo}`.toLowerCase() === pr.repo.toLowerCase()
                    );
                    return (
                      <PrBoardCard
                        key={pr.url}
                        pr={pr}
                        host={host}
                        tisWarnHours={build.warnHours}
                        tisDangerHours={build.dangerHours}
                        ignoredFailingChecks={repoRec?.ignoredFailingChecks}
                        selected={selected.has(pr.url)}
                        selectionActive={selectionActive}
                        selectMode={selectMode}
                        onToggleSelect={onToggleSelect}
                        onDismiss={onDismiss}
                        onOpen={onOpen}
                      />
                    );
                  })
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
