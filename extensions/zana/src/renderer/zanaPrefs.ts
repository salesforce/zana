/**
 * Tickets-view UI-preference codec — the single, greppable, unit-tested home for
 * the durable `localStorage` keys behind the core Tickets dashboard.
 *
 * History (D1): the legacy extension panel persisted four UI prefs via the
 * module KV store (`host.storage` → `~/.zcc/modules/<id>.json`): the active
 * sub-tab, the selected source id, auto-refresh, and the collapsed-columns map.
 * The Sprint-C core view orphaned them. D1 re-homes the three survivors
 * (active-tab / auto-refresh / collapsed-columns) onto renderer-local
 * `localStorage` so they outlive D3's deletion of the extension package, and
 * RETIRES the dead source-id key (the source rail it backed is being removed).
 *
 * Rule 6 (core never names a specific extension in logic): the keys use the
 * NEUTRAL `zcc.tickets.*` prefix — no extension-id literal appears here. There
 * is deliberately NO legacy-read migration shim: porting the old values would
 * have to name the old module-id namespace in core code (a Rule-6 regression)
 * for a few low-value UI prefs. A one-time reset to defaults is accepted and is
 * documented in D6.
 *
 * Rule 5 (bounded reads): every read is a synchronous, tiny `localStorage` get.
 * `collapsedColumns` is bounded by the handful of distinct statuses; per-project
 * keys (`zcc.tickets.collapsedColumns.<projectId>`) keep it from growing into a
 * single unbounded blob.
 *
 * Codec shape mirrors `store.ts` (`readCollapsedSections` + `setWorkbenchEnabled`):
 * guard `typeof localStorage === 'undefined'`, try/catch-swallow quota, and a
 * hardened `parsed && typeof parsed === 'object'` guard (so `null`/number JSON
 * does not slip through a bare `?? {}`).
 */

import type { TicketsSubTab } from './ticketsStore';

/** Active Tickets-view sub-tab (`tickets|sprints|docs|profiles`). */
const ACTIVE_TAB_KEY = 'zcc.tickets.activeTab';
/** Global auto-refresh toggle, stored as `'true'`/`'false'`. */
const AUTO_REFRESH_KEY = 'zcc.tickets.autoRefresh';
/** Per-project collapsed-column map prefix; the project id is appended. */
const COLLAPSED_PREFIX = 'zcc.tickets.collapsedColumns.';
/** Board-wide render density (`'card'`/`'list'`) for the whole kanban. Global
 *  (shared across projects), like the auto-refresh toggle. */
const BOARD_DENSITY_KEY = 'zcc.tickets.boardDensity';

/** The valid sub-tab values; a stored value outside this set falls back. */
const SUB_TABS: readonly TicketsSubTab[] = ['tickets', 'sprints', 'docs', 'profiles'];
const DEFAULT_SUB_TAB: TicketsSubTab = 'tickets';

/** Project-scoped collapsed-columns key. A storage namespace, NOT a filesystem
 *  path — so Rules 1/2 (path confinement) do not apply. */
export function collapsedKey(projectId: string): string {
  return `${COLLAPSED_PREFIX}${projectId}`;
}

/** The board's render density: full cards, or dense one-line rows. */
export type ColumnDensity = 'card' | 'list';

/** Read a raw string from `localStorage`, degrading to `null` when storage is
 *  absent (SSR/test) or throws. */
export function safeGet(key: string): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a raw string to `localStorage`, swallowing a quota error or an absent
 *  store (write is best-effort; a failure must never throw into the UI). */
export function safeSet(key: string, value: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / unavailable storage
  }
}

/** The persisted sub-tab, validated against the enum; garbage/absent →
 *  `'tickets'` so a stale value can never render a dead tab. */
export function readActiveTab(): TicketsSubTab {
  const raw = safeGet(ACTIVE_TAB_KEY);
  return (SUB_TABS as readonly string[]).includes(raw ?? '')
    ? (raw as TicketsSubTab)
    : DEFAULT_SUB_TAB;
}

/** Persist the active sub-tab. */
export function writeActiveTab(tab: TicketsSubTab): void {
  safeSet(ACTIVE_TAB_KEY, tab);
}

/** Auto-refresh preference. DEFAULT ON: only an explicit stored `'false'`
 *  disables it (a naive `=== 'true'` would silently flip the default OFF for
 *  every existing user). */
export function readAutoRefresh(): boolean {
  return safeGet(AUTO_REFRESH_KEY) !== 'false';
}

/** Persist the auto-refresh toggle. */
export function writeAutoRefresh(on: boolean): void {
  safeSet(AUTO_REFRESH_KEY, on ? 'true' : 'false');
}

/** The per-project collapsed-columns map (status → collapsed). Returns `{}` on
 *  absent/malformed JSON AND on non-object JSON (`null`, numbers, arrays-as-…) —
 *  the `typeof === 'object'` guard rejects what a bare `?? {}` would let slip. */
export function readCollapsed(projectId: string): Record<string, boolean> {
  const raw = safeGet(collapsedKey(projectId));
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}

/** Persist one project's collapsed-columns map. */
export function writeCollapsed(projectId: string, map: Record<string, boolean>): void {
  safeSet(collapsedKey(projectId), JSON.stringify(map));
}

/** The board-wide density. DEFAULT `'card'`; only an explicit stored `'list'`
 *  switches it (any other/garbage value falls back to the default). */
export function readBoardDensity(): ColumnDensity {
  return safeGet(BOARD_DENSITY_KEY) === 'list' ? 'list' : 'card';
}

/** Persist the board-wide density. */
export function writeBoardDensity(density: ColumnDensity): void {
  safeSet(BOARD_DENSITY_KEY, density);
}
