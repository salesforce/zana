/**
 * Horizontal kanban board: one column per rollup status, compact cards.
 * Status is GitHub-derived, so columns are a layout — cards are not
 * drag-reordered between lanes. Pan is the shared {@link Kanban} canvas.
 */

import { useMemo } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Eye,
  GitMerge,
  GitPullRequestClosed,
  Loader2,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Kanban, KanbanColumn } from '@zana-ai/zcc-ui/kanban';
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
    <Kanban label="Pull requests by status" columnWidth={260} className="prm-board">
      {visible.map((status) => {
        const cards = columns[status];
        const Icon = COLUMN_ICONS[status];
        const isCollapsed = collapsed.has(status);
        const unread = cards.filter(
          (pr) => pr.lastSeenAt === 0 || pr.lastStatusChange > (pr.lastSeenAt ?? pr.addedAt)
        ).length;
        return (
          <KanbanColumn
            key={status}
            columnId={status}
            className={`prm-board-col--${status}`}
            label={BOARD_COLUMN_LABELS[status]}
            count={cards.length}
            icon={<Icon size={14} aria-hidden />}
            badge={
              unread > 0 ? (
                <span className="zcc-kanban-col-badge" title={`${unread} unread`}>
                  {unread}
                </span>
              ) : null
            }
            collapsed={isCollapsed}
            onToggleCollapse={(columnId) => onToggleCollapse(columnId as PrRollupStatus)}
          >
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
          </KanbanColumn>
        );
      })}
    </Kanban>
  );
}
