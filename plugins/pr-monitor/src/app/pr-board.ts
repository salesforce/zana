/**
 * Kanban board grouping for monitored PRs.
 *
 * Status columns follow the same triage-severity order as the list tabs.
 * Occupied lanes are always shown. Empty active columns stay hidden unless
 * `showEmpty` is on; terminal Merged/Closed columns appear only when they
 * hold cards (matching the BB tasks board's on-demand Canceled column).
 */

import type { MonitoredPr, PrRollupStatus } from '../../lib/types.js';

/** Workflow columns in triage order (worst → best). Empty ones are optional. */
export const BOARD_COLUMNS: readonly PrRollupStatus[] = [
  'conflict',
  'failed',
  'yellow',
  'review-required',
  'pending',
  'integrating',
  'green',
];

/** Appended only when the column has at least one PR. */
export const TERMINAL_BOARD_COLUMNS: readonly PrRollupStatus[] = [
  'closed-merged',
  'closed-abandoned',
];

/** Short column headers — the full status words are too long for a 260px lane. */
export const BOARD_COLUMN_LABELS: Record<PrRollupStatus, string> = {
  conflict: 'Conflict',
  failed: 'Failing',
  yellow: 'Blocked',
  'review-required': 'Review',
  pending: 'Pending',
  integrating: 'Merging',
  green: 'Ready',
  'closed-merged': 'Merged',
  'closed-abandoned': 'Closed',
};

export type ListViewMode = 'list' | 'board';

export function isListViewMode(value: unknown): value is ListViewMode {
  return value === 'list' || value === 'board';
}

export type BoardColumnMap = Record<PrRollupStatus, MonitoredPr[]>;

export function emptyBoardColumns(): BoardColumnMap {
  return {
    conflict: [],
    failed: [],
    yellow: [],
    'review-required': [],
    pending: [],
    integrating: [],
    green: [],
    'closed-merged': [],
    'closed-abandoned': [],
  };
}

/** Group PRs into columns, preserving input order within each lane. */
export function groupPrsByStatus(prs: readonly MonitoredPr[]): BoardColumnMap {
  const columns = emptyBoardColumns();
  for (const pr of prs) columns[pr.status].push(pr);
  return columns;
}

export function boardColumnCounts(columns: BoardColumnMap): Record<PrRollupStatus, number> {
  return {
    conflict: columns.conflict.length,
    failed: columns.failed.length,
    yellow: columns.yellow.length,
    'review-required': columns['review-required'].length,
    pending: columns.pending.length,
    integrating: columns.integrating.length,
    green: columns.green.length,
    'closed-merged': columns['closed-merged'].length,
    'closed-abandoned': columns['closed-abandoned'].length,
  };
}

const ALL_BOARD_STATUSES: readonly PrRollupStatus[] = [
  ...BOARD_COLUMNS,
  ...TERMINAL_BOARD_COLUMNS,
];

export function isPrRollupStatus(value: unknown): value is PrRollupStatus {
  return typeof value === 'string' && (ALL_BOARD_STATUSES as readonly string[]).includes(value);
}

/**
 * Columns to paint. Default hides empty lanes so Conflict/Failing aren't
 * crowded out by Blocked/Merging at zero. `showEmpty` restores the seven
 * active columns (terminal empties stay hidden either way).
 */
export function visibleBoardColumns(
  columns: BoardColumnMap,
  opts: { showEmpty?: boolean } = {}
): PrRollupStatus[] {
  const counts = boardColumnCounts(columns);
  if (!opts.showEmpty) {
    return ALL_BOARD_STATUSES.filter((status) => counts[status] > 0);
  }
  return [
    ...BOARD_COLUMNS,
    ...TERMINAL_BOARD_COLUMNS.filter((status) => counts[status] > 0),
  ];
}

/** How many always-on workflow columns are currently empty (for "Empty (n)"). */
export function emptyActiveColumnCount(columns: BoardColumnMap): number {
  const counts = boardColumnCounts(columns);
  return BOARD_COLUMNS.filter((status) => counts[status] === 0).length;
}

/** Trailing segment of `owner/repo`. */
export function shortRepoName(repo: string): string {
  const i = repo.lastIndexOf('/');
  return i >= 0 ? repo.slice(i + 1) : repo;
}
