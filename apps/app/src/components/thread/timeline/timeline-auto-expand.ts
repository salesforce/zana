import {
  assertNever,
  findTimelineFrontierRow,
  hasTimelineExplorationIntent,
  type ThreadTimelineViewRow,
  type TimelineViewWorkRow
} from '@zana-ai/zcc-thread-view';

interface CollectTimelineAutoExpansionRowIdsArgs {
  rows: readonly ThreadTimelineViewRow[];
  scopeActive: boolean;
}

export interface TimelineAutoExpansionRowIds {
  liveFrontierRowIds: ReadonlySet<string>;
  terminalFrontierRowIds: ReadonlySet<string>;
}

export function isWorkRowExpandable(row: TimelineViewWorkRow): boolean {
  switch (row.workKind) {
    case 'web-search':
    case 'web-fetch':
    case 'approval':
      return false;
    case 'image-view':
      return true;
    case 'question':
      return row.lifecycle === 'answered' || row.lifecycle === 'resolving';
    case 'command':
    case 'tool':
      return !hasTimelineExplorationIntent(row);
    case 'file-change':
      return true;
    case 'file-read':
    case 'search':
      return false;
    case 'plan-steps':
      return row.steps.length > 0;
    case 'extension':
      return (
        row.presentation.detail !== undefined
        && row.presentation.detail.trim().length > 0
      );
    case 'delegation':
      return row.childRows.length > 0 || row.output.trim().length > 0;
    case 'workflow':
      return row.workflow !== null || row.summary !== null || row.error !== null;
    default:
      return assertNever(row);
  }
}

export function isRowExpandable(row: ThreadTimelineViewRow): boolean {
  switch (row.kind) {
    case 'conversation':
      return false;
    case 'system':
      return row.detail !== null && row.detail.trim().length > 0;
    case 'bundle-summary':
    case 'step-summary':
      return row.children.length > 0;
    case 'turn':
      return true;
    case 'work':
      return isWorkRowExpandable(row);
    default:
      return assertNever(row);
  }
}

export function isNonExpandableSummary(children: readonly TimelineViewWorkRow[]): boolean {
  return children.length > 0 && children.every((child) => !isWorkRowExpandable(child));
}

function shouldAutoExpandLiveFrontierRow(row: ThreadTimelineViewRow): boolean {
  if (!isRowExpandable(row)) return false;
  switch (row.kind) {
    case 'system':
      return row.status === 'pending';
    case 'work':
      // Tool/command rows stay collapsed; the user opens them. Only rows that
      // are themselves a container (delegation) or a live progress surface
      // (workflow / image) auto-open at the frontier. Bundle summaries
      // ("Running N tools") stay collapsed until clicked.
      return (
        row.workKind === 'delegation'
        || row.workKind === 'image-view'
        || (row.workKind === 'workflow' && row.status === 'pending')
      );
    case 'conversation':
    case 'bundle-summary':
    case 'step-summary':
    case 'turn':
      return false;
    default:
      return assertNever(row);
  }
}

function shouldAutoExpandTerminalFrontierRow(row: ThreadTimelineViewRow): boolean {
  if (!isRowExpandable(row)) return false;
  if (row.kind === 'system' && row.status === 'error') return true;
  return row.kind === 'turn' && row.status === 'interrupted';
}

function visitForTerminalFrontierAutoExpand(
  rows: readonly ThreadTimelineViewRow[],
  ids: Set<string>
): void {
  const tail = rows[rows.length - 1];
  if (tail && shouldAutoExpandTerminalFrontierRow(tail)) {
    ids.add(tail.id);
  }
  const latestInterrupted = [...rows].reverse().find(
    (row) => row.kind === 'turn' && row.status === 'interrupted'
  );
  if (latestInterrupted) ids.add(latestInterrupted.id);
  for (const row of rows) {
    if (row.kind === 'work' && row.workKind === 'delegation' && row.status === 'pending') {
      visitForTerminalFrontierAutoExpand(row.childRows, ids);
    }
  }
}

function visitForLiveFrontierAutoExpand(
  rows: readonly ThreadTimelineViewRow[],
  scopeActive: boolean,
  ids: Set<string>
): void {
  if (!scopeActive) return;
  const frontier = findTimelineFrontierRow(rows);
  if (frontier && shouldAutoExpandLiveFrontierRow(frontier)) {
    ids.add(frontier.id);
  }
  for (const row of rows) {
    if (row.kind === 'work' && row.workKind === 'delegation' && row.status === 'pending') {
      visitForLiveFrontierAutoExpand(row.childRows, true, ids);
    }
  }
}

export function collectTimelineAutoExpansionRowIds({
  rows,
  scopeActive
}: CollectTimelineAutoExpansionRowIdsArgs): TimelineAutoExpansionRowIds {
  const terminalFrontierRowIds = new Set<string>();
  const liveFrontierRowIds = new Set<string>();
  visitForTerminalFrontierAutoExpand(rows, terminalFrontierRowIds);
  visitForLiveFrontierAutoExpand(rows, scopeActive, liveFrontierRowIds);
  return { liveFrontierRowIds, terminalFrontierRowIds };
}

export function isAutoExpandedRow(
  rowId: string,
  expansion: TimelineAutoExpansionRowIds
): boolean {
  return expansion.liveFrontierRowIds.has(rowId) || expansion.terminalFrontierRowIds.has(rowId);
}
