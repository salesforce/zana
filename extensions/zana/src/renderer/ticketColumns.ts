/**
 * Pure column / sort helpers for the core `ProjectTicketsView` kanban (C2).
 *
 * Lifted verbatim (logic-identical) from the live extension panel's
 * column machine so the board groups, orders and ranks tickets the same way —
 * but with ZERO host / IPC / extension-id coupling (Rule 6). These are plain
 * data transforms over `@shared/zana-types`, so they're cheaply unit-testable
 * and keep the substance-sort off the render hot path (Rule 5) when memoised by
 * the view.
 */

import type { ZanaSnapshot, ZanaSprint, ZanaTicket } from '@shared/zana-types';

/** Canonical ordering for kanban columns; unknown statuses sort after these. */
const STATUS_ORDER = [
  'backlog',
  'todo',
  'to do',
  'in-progress',
  'in progress',
  'doing',
  'review',
  'in review',
  'blocked',
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
];

/** Rank a raw status against {@link STATUS_ORDER}; unknown statuses trail. */
export function statusRank(status: string): number {
  const i = STATUS_ORDER.indexOf(status.trim().toLowerCase());
  return i === -1 ? STATUS_ORDER.length : i;
}

/**
 * Statuses whose columns are terminal (done/cancelled/etc). These hold the
 * least-actionable tickets — usually the bulk of the board — so their columns
 * start collapsed and, when expanded, render as dense one-line rows rather than
 * full cards.
 */
const TERMINAL_STATUSES = new Set([
  'done',
  'closed',
  'completed',
  'cancelled',
  'canceled',
  'rejected'
]);

/** Whether a status's column is terminal (collapsed by default). */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.trim().toLowerCase());
}

/** Clip a long id to a readable short form for the card footer. */
export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Resolve a sprint id to a REAL display name, or undefined. The main module
 * synthesises `Sprint <hash>` for unnamed sprints; we treat that as "no real
 * name" so the card doesn't show a mystery hash chip.
 */
export function resolveSprintName(
  sprintId: string | undefined,
  sprints: ZanaSprint[]
): string | undefined {
  if (!sprintId) return undefined;
  const name = sprints.find((s) => s.id === sprintId)?.name;
  if (!name) return undefined;
  if (name === `Sprint ${sprintId.slice(0, 8)}`) return undefined; // synthetic fallback
  return name;
}

/**
 * Titles Zana's own integration tests leave behind (e.g. `test-1778…-claim`,
 * `Test ticket`, bare `Updated`/`blocked`). These carry no real content, so we
 * rank them below substantive tickets within a column rather than hide them.
 */
const TEST_TITLE_RE = /^(test-\d+|test ticket|updated|blocked|round-trip test)\b/i;

/**
 * A rough "substance" score so meaningful tickets surface above bare test
 * fixtures within each kanban column. Higher = more real content. Purely a
 * display sort — nothing is filtered out or mutated.
 */
export function substanceScore(t: ZanaTicket): number {
  let score = 0;
  if ((t.description ?? '').trim().length > 0) score += 3;
  if (t.sprintId) score += 1;
  if (t.labels.length > 0) score += 1;
  if (t.assigneeName) score += 1;
  if (TEST_TITLE_RE.test(t.title.trim())) score -= 4;
  return score;
}

/**
 * Client-side text filter over tickets (title + labels + assignee), plus an
 * optional sprint filter and assignee filter. Mirrors the panel's
 * `filteredTickets` memo body.
 */
export function filterTickets(
  tickets: ZanaTicket[],
  query: string,
  sprintFilter: string | null,
  assigneeFilter?: string | null
): ZanaTicket[] {
  const q = query.trim().toLowerCase();
  return tickets.filter((t) => {
    if (sprintFilter && t.sprintId !== sprintFilter) return false;
    if (assigneeFilter !== undefined && assigneeFilter !== null) {
      if (assigneeFilter === '__unassigned__') {
        if (t.assigneeName) return false;
      } else if ((t.assigneeName ?? '') !== assigneeFilter) {
        return false;
      }
    }
    if (!q) return true;
    return (
      t.title.toLowerCase().includes(q) ||
      t.labels.some((l) => l.toLowerCase().includes(q)) ||
      (t.assigneeName ?? '').toLowerCase().includes(q)
    );
  });
}

/**
 * Extract unique assignee names from a tickets list, sorted alphabetically.
 */
export function extractAssignees(tickets: ZanaTicket[]): string[] {
  const names = new Set<string>();
  for (const t of tickets) {
    if (t.assigneeName) names.add(t.assigneeName);
  }
  return [...names].sort((a, b) => a.localeCompare(b));
}

/**
 * Group filtered tickets into kanban columns keyed by raw status, ordered by
 * the canonical sequence with unknown statuses trailing alphabetically. Within
 * each column, rank substantive tickets above bare test fixtures, keeping the
 * incoming `updatedAt`-desc order as the tiebreaker (a stable sort on score
 * alone preserves it).
 */
export function buildColumns(tickets: ZanaTicket[]): Array<[string, ZanaTicket[]]> {
  const map = new Map<string, ZanaTicket[]>();
  for (const t of tickets) {
    const key = t.status || 'unknown';
    (map.get(key) ?? map.set(key, []).get(key)!).push(t);
  }
  for (const items of map.values()) {
    items.sort((a, b) => substanceScore(b) - substanceScore(a));
  }
  return [...map.entries()].sort(([a], [b]) => {
    const ra = statusRank(a);
    const rb = statusRank(b);
    return ra !== rb ? ra - rb : a.localeCompare(b);
  });
}

/**
 * Whether a RESOLVED snapshot holds no data of any kind. Derived from the
 * snapshot ARRAYS (not a `kpis` zero-check — kpis can read all-zero with stale
 * arrays), per the C2 empty-state contract.
 */
export function isSnapshotEmpty(snapshot: ZanaSnapshot | null): boolean {
  if (!snapshot) return false;
  return (
    snapshot.tickets.length === 0 &&
    snapshot.sprints.length === 0 &&
    snapshot.artifacts.length === 0
  );
}
