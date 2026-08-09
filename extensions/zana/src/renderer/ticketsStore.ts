/**
 * `useTickets` — the core zustand store that OWNS the per-project Zana snapshot
 * (tickets / sprints / docs / profiles / KPIs), the optimistic-assign + undo
 * machinery, and a store-level 30s auto-refresh tick.
 *
 * Why a store (and not per-view state): the Tickets view (C2–C4) fully unmounts
 * on every WorkspaceMode tab switch (`Workspace.tsx` renders each mode as a
 * separate conditional block, so toggling modes tears the view down). A
 * mount-effect `getSnapshot`/`listProfiles` would re-hit IPC on every toggle —
 * the per-mount storm. This store caches per source-key so a remount is a cache
 * hit, collapsing N × {getSnapshot+listProfiles} to one fetch per key
 * (Rule 5: bound growing reads). The view becomes a thin reader that calls
 * `ensure`/`startAutoRefresh` on mount.
 *
 * Quarantine (Rule 6): this file imports the B2 `ticketsApi` seam ONLY. It
 * NEVER names the `'zana'` module id, `getHost`, or `window.cc.modules`. Types
 * resolve to `@shared/zana-types` (core), never `plugins/zana/*`.
 *
 * Trust (Rule 1/2): `projectPath` / `useGlobal` / `id` are passed UNMODIFIED to
 * `ticketsApi`; main re-resolves and may throw. The store makes no trust
 * decision and defaults nothing.
 *
 * Timer hygiene (Rule 3): the assign-commit timers, undo auto-dismiss timers,
 * and the one-per-key 30s refresh interval are MODULE-LEVEL (not React refs) so
 * they survive the view's remounts — a mid-undo-window tab switch must still
 * commit. They are released only via `undoAssign` / `clearProject` / HMR
 * dispose, never on a view unmount.
 */

import { create } from 'zustand';
import type { AssignChoice, ZanaProfile, ZanaSnapshot, ZanaTicket } from '@shared/zana-types';
import { ticketsApi, type TicketSource } from './ticketsApi';
import {
  readActiveTab,
  writeActiveTab,
  readAutoRefresh,
  writeAutoRefresh,
  readCollapsed,
  writeCollapsed,
  readBoardDensity,
  writeBoardDensity,
  type ColumnDensity
} from './zanaPrefs';

/** How often the store fires a quiet background reload, per active key. */
const AUTO_REFRESH_MS = 30_000;
/** How long an optimistic assign can be undone before the write commits. */
const UNDO_WINDOW_MS = 6000;
/** Map-key for the global `~/.zana` anchor. NEVER `''` — a falsy key collides
 *  with `if (id)` guards in the view (e.g. ZanaPanel `switchSource`). */
const GLOBAL_KEY = '__global__';

/** Identifies one snapshot source. A project source keys by its `projectId`;
 *  the global anchor keys by {@link GLOBAL_KEY}. `projectPath`/`useGlobal` are
 *  the advisory hints forwarded to main (UNMODIFIED — Rule 1/2). */
export type TicketsKey = {
  projectId: string;
  projectPath?: string;
  useGlobal?: boolean;
};

/** The assignee fields an optimistic assign touches (and undo restores). */
type AssigneeFields = Pick<ZanaTicket, 'assigneeName' | 'assigneeId' | 'assigneeProfileId'>;

/** One source's cached state. Profiles live OUTSIDE the snapshot lifecycle —
 *  they survive an empty/error snapshot and are gated independently. */
export interface TicketsEntry {
  snapshot: ZanaSnapshot | null;
  profiles: ZanaProfile[];
  /** First-load spinner gate (foreground fetch in flight, no snapshot yet). */
  loading: boolean;
  /** Background reload in flight (header spin; board stays on screen). */
  refreshing: boolean;
  error: string | null;
  /** Snapshot freshness / cache-hit gate; null until the first load settles. */
  loadedAt: number | null;
  /** Independent profiles gate; null until the first profiles fetch settles. */
  profilesLoadedAt: number | null;
  /** Auto-refresh pause (modal-open), view-driven; default false. */
  paused: boolean;
  /**
   * Per-status collapse overrides, keyed by `status.trim().toLowerCase()`. A
   * key's presence pins that column; absent statuses fall back to the
   * `isTerminalStatus`-derived default. Durable per-project (D1): seeded from
   * `readCollapsed(projectId)` on the cache-miss path and persisted via
   * `writeCollapsed` on toggle. The view holds NO second source of truth.
   */
  collapsedColumns: Record<string, boolean>;
}

/**
 * The Tickets-view sub-tab strip ids. The full union (incl. `'profiles'`) is
 * the single exported `TicketsSubTab` declared by `ProjectTicketsView.tsx`; the
 * store mirrors it as a string-literal union so the cross-tab UI-state slice can
 * carry it without a runtime import cycle.
 */
export type TicketsSubTab = 'tickets' | 'sprints' | 'docs' | 'profiles';

export interface TicketsState {
  byKey: Record<string, TicketsEntry>;
  /** Active undo banner per map-key (or null when none). */
  assignUndo: Record<string, { id: string; label: string } | null>;
  // ── Cross-tab UI state (C3) ────────────────────────────────────────────────
  // The active sub-tab and the sprint filter MUST live here, not in the view:
  // every WorkspaceMode switch fully unmounts ProjectTicketsView, so a
  // component-local `useState` would reset them on every return to Tickets. The
  // store is a module-singleton, so they persist for the session.
  /** The active intra-view sub-tab. Seeded from `readActiveTab()` (D1). */
  subTab: TicketsSubTab;
  /** Select a sub-tab AND persist it durably (`writeActiveTab`, D1). */
  setSubTab: (t: TicketsSubTab) => void;
  /**
   * Global auto-refresh toggle (shared across all projects — one origin /
   * shared `localStorage`, intentionally global per D1). Seeded from
   * `readAutoRefresh()` (default ON); persisted by `setAutoRefresh`. The store's
   * 30s tick fires only while this is true AND the per-key entry is not paused.
   */
  autoRefresh: boolean;
  /** Flip the global auto-refresh toggle and persist it (`writeAutoRefresh`). */
  setAutoRefresh: (on: boolean) => void;
  /** The active sprint filter (a sprint id), or null when unfiltered. */
  sprintFilter: string | null;
  /** Set/clear the sprint filter. */
  setSprintFilter: (id: string | null) => void;
  /** Jump to a sprint's tickets: set the filter AND switch to the Tickets tab. */
  openSprint: (sprintId: string) => void;
  /** Idempotent first-load trigger; collapses the per-mount IPC storm. */
  ensure: (key: TicketsKey) => void;
  /**
   * Explicit, user-initiated init: create `.zana/` for this key's source, then
   * reload the snapshot. Rejects on failure (the "Init Zana" button surfaces
   * it); resolves `{created}` on success — `false` when already initialized.
   */
  initProject: (key: TicketsKey) => Promise<{ created: boolean }>;
  /**
   * One-shot bulk hydrate of the per-project snapshot cache for the Overview's
   * KPI line (D5). SEQUENTIAL (mirrors `useData.refreshAllGitStatus`,
   * `store.ts`) so we never spawn N `getSnapshot` reads at once — Rule 5: bound
   * the fan-out off a single render. Idempotent per key: a project whose entry
   * already settled (`loadedAt != null`) or is mid-load is skipped, so calling
   * this again (or after `ensure` already warmed a key) is a no-op for that key.
   * Caller supplies the project `{ id, path }` list (the store holds no project
   * registry; the once-at-init seam in `store.ts` has it in scope and passes it,
   * avoiding a `store.ts`↔`ticketsStore.ts` import cycle).
   */
  hydrateAll: (projects?: { id: string; path: string }[]) => Promise<void>;
  /** Reload the snapshot. `background` keeps a good board on screen on failure. */
  refresh: (key: TicketsKey, opts?: { background?: boolean }) => Promise<void>;
  /** Fetch profiles exactly once per key (soft-fail to []). */
  loadProfiles: (key: TicketsKey) => Promise<void>;
  /** Optimistic assign: patch now, defer the write, raise the undo banner. */
  applyAssign: (key: TicketsKey, ticket: ZanaTicket, choice: AssignChoice) => void;
  /** Undo a not-yet-committed assign: cancel the write + restore baseline. */
  undoAssign: (key: TicketsKey, ticketId: string) => void;
  /** Ref-counted subscribe to the 30s tick (one interval per key). */
  startAutoRefresh: (key: TicketsKey) => void;
  /** Ref-counted unsubscribe; clears the interval at refcount zero. */
  stopAutoRefresh: (key: TicketsKey) => void;
  /** Pause/resume the auto-refresh tick for one key (modal-open). */
  setPaused: (key: TicketsKey, paused: boolean) => void;
  /**
   * Toggle one status column's collapse override for a key and persist the
   * resulting per-project map (`writeCollapsed`, D1). `status` is normalized to
   * `status.trim().toLowerCase()`; the new value flips
   * `current[key] ?? defaultCollapsed` so an absent override resolves against the
   * caller-supplied `isTerminalStatus`-derived default.
   */
  toggleColumnCollapsed: (key: TicketsKey, status: string, defaultCollapsed: boolean) => void;
  /**
   * Board-wide render density (`'card'`/`'list'`) for the whole kanban — global,
   * shared across projects, like {@link autoRefresh}. Seeded from
   * `readBoardDensity()` at store-init (default `'card'`); persisted by
   * {@link setBoardDensity}.
   */
  boardDensity: ColumnDensity;
  /** Set the board-wide density and persist it (`writeBoardDensity`). */
  setBoardDensity: (density: ColumnDensity) => void;
  /** Drop a removed project's entry + all its module-level timers/intervals. */
  clearProject: (projectId: string) => void;
}

/** Internal: derive the `byKey` map-key from a {@link TicketsKey}. */
function mapKeyOf(key: TicketsKey): string {
  return key.useGlobal ? GLOBAL_KEY : key.projectId;
}

/** Internal: shape a {@link TicketsKey} into the B2 {@link TicketSource}. */
function sourceOf(key: TicketsKey): TicketSource {
  return key.useGlobal
    ? { kind: 'global' }
    : { kind: 'project', projectPath: key.projectPath ?? '' };
}

/** A fresh, fully-defaulted entry. */
function emptyEntry(): TicketsEntry {
  return {
    snapshot: null,
    profiles: [],
    loading: false,
    refreshing: false,
    error: null,
    loadedAt: null,
    profilesLoadedAt: null,
    paused: false,
    collapsedColumns: {}
  };
}

// ── Module-level timer state (survives view remounts — Rule 3) ───────────────
// These are deliberately NOT React refs: a mid-undo-window tab switch fully
// unmounts the view but must still commit the deferred write. Keyed by
// `${mapKey}::${ticketId}` so the same ticket id in two projects never collides.

/** Pending commit timers, keyed `${mapKey}::${ticketId}`. */
const assignTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Rollback baselines (pre-assign fields), keyed `${mapKey}::${ticketId}`. */
const assignPrev = new Map<string, AssigneeFields>();
/** Undo-banner auto-dismiss timers, keyed by map-key. */
const dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Auto-refresh interval handles, keyed by map-key (one per key). */
const refreshIntervals = new Map<string, ReturnType<typeof setInterval>>();
/** Auto-refresh subscriber refcounts, keyed by map-key. */
const refreshRefcounts = new Map<string, number>();

// ── GLOBAL profiles cache (C5) ───────────────────────────────────────────────
// Profiles are deliberately GLOBAL: `listProfiles` resolves `~/.zana/profiles`
// + Zana's built-ins with NO project arg, so the list is identical for every
// project. They are the single legitimately-global surface inside the otherwise
// strictly per-project Tickets view. We therefore fetch them ONCE for the whole
// app (not once per project key) — switching `projectId` must NOT re-invoke
// `listProfiles` (Rule 5 / IPC-storm guard). The fetched list is mirrored into
// each entry's `profiles` field so the per-project view keeps a single read
// surface (`entry.profiles`), while the snapshot (tickets/sprints/docs) stays
// per-project. `globalProfilesLoadedAt` gates the one fetch (null ⇒ never run).
let globalProfiles: ZanaProfile[] = [];
let globalProfilesLoadedAt: number | null = null;
/** De-dupes concurrent first-load callers onto the single in-flight fetch. */
let globalProfilesInflight: Promise<ZanaProfile[]> | null = null;

/** Compose the per-ticket timer/baseline key. */
function timerKey(mapKey: string, ticketId: string): string {
  return `${mapKey}::${ticketId}`;
}

/**
 * Mirror the GLOBAL profiles cache into one entry so the per-project view keeps
 * a single `entry.profiles` read surface. Stamps the entry's `profilesLoadedAt`
 * from the global gate so a per-entry "loaded once" check still reads truthy.
 * No-ops (no re-render) when the entry already holds the same cached reference.
 */
function mirrorProfilesToEntry(
  set: (fn: (s: TicketsState) => Partial<TicketsState>) => void,
  mapKey: string
): void {
  set((s) => {
    const entry = s.byKey[mapKey] ?? emptyEntry();
    if (entry.profiles === globalProfiles && entry.profilesLoadedAt === globalProfilesLoadedAt) {
      return {};
    }
    return {
      byKey: {
        ...s.byKey,
        [mapKey]: { ...entry, profiles: globalProfiles, profilesLoadedAt: globalProfilesLoadedAt }
      }
    };
  });
}

/** Immutably patch one ticket's assignee fields inside a key's snapshot. */
function patchAssignee(
  set: (fn: (s: TicketsState) => Partial<TicketsState>) => void,
  mapKey: string,
  ticketId: string,
  patch: Partial<AssigneeFields>
): void {
  set((s) => {
    const entry = s.byKey[mapKey];
    if (!entry?.snapshot) return {};
    const snap = entry.snapshot;
    // New snapshot + new entry + new byKey so subscribers re-render.
    return {
      byKey: {
        ...s.byKey,
        [mapKey]: {
          ...entry,
          snapshot: {
            ...snap,
            tickets: snap.tickets.map((t) => (t.id === ticketId ? { ...t, ...patch } : t))
          }
        }
      }
    };
  });
}

export const useTickets = create<TicketsState>((set, get) => ({
  byKey: {},
  assignUndo: {},

  // ── Cross-tab UI state (C3) + durable prefs (D1) ─────────────────────────
  // `subTab` and `autoRefresh` are seeded from the D1 `localStorage` codec at
  // store-init (module-singleton, so this runs once for the app). They are the
  // durable successors to the legacy `host.storage` `activeTab` / `autoRefresh`
  // keys — no second source of truth (the view reads these, never its own copy).
  subTab: readActiveTab(),
  setSubTab: (t) => {
    writeActiveTab(t);
    set({ subTab: t });
  },
  autoRefresh: readAutoRefresh(),
  setAutoRefresh: (on) => {
    writeAutoRefresh(on);
    set({ autoRefresh: on });
  },
  boardDensity: readBoardDensity(),
  setBoardDensity: (density) => {
    writeBoardDensity(density);
    set({ boardDensity: density });
  },
  sprintFilter: null,
  setSprintFilter: (id) => set({ sprintFilter: id }),
  // `openSprint` jumps to the Tickets tab — persist that tab change too so a
  // reload after following a sprint restores the same sub-tab.
  openSprint: (sprintId) => {
    writeActiveTab('tickets');
    set({ sprintFilter: sprintId, subTab: 'tickets' });
  },

  ensure: (key) => {
    const k = mapKeyOf(key);
    const entry = get().byKey[k];
    // Cache hit: a settled first load means the view re-mounted — no IPC.
    if (entry?.loadedAt != null) {
      // Profiles are gated separately; ensure they were fetched at least once.
      void get().loadProfiles(key);
      return;
    }
    // Concurrent first-load guard: a fetch is already in flight.
    if (entry?.loading) return;
    // Cache-miss / first-init: seed the durable per-project collapse map from
    // the D1 codec exactly here (NOT on every mount). `useGlobal` keys read the
    // global anchor id so the global view gets its own (shared) collapse store.
    const seededCollapsed = readCollapsed(k);
    set((s) => ({
      byKey: {
        ...s.byKey,
        [k]: { ...(s.byKey[k] ?? emptyEntry()), loading: true, collapsedColumns: seededCollapsed }
      }
    }));
    void get().refresh(key, { background: false });
    void get().loadProfiles(key);
  },

  initProject: async (key) => {
    const result = await ticketsApi.initProject(sourceOf(key));
    // Reload so the (still-empty, now on-disk) board reflects the fresh state —
    // e.g. a future ticket-create no longer races an absent `.zana/`.
    await get().refresh(key, { background: false });
    return result;
  },

  hydrateAll: async (projects) => {
    const list = projects ?? [];
    // Sequential to avoid spawning N `getSnapshot` reads at once (Rule 5).
    for (const p of list) {
      const k = mapKeyOf({ projectId: p.id });
      const entry = get().byKey[k];
      // Skip keys already warmed (cache hit) or with a fetch in flight — keeps
      // hydrateAll idempotent and harmless to re-invoke, and never clobbers a
      // view that already ran `ensure`.
      if (entry?.loadedAt != null || entry?.loading) continue;
      // background:true keeps this off the first-load spinner gate; a failed
      // probe leaves the entry empty (no error board) so a non-`.zana` project
      // simply renders no KPI line.
      await get().refresh(
        { projectId: p.id, projectPath: p.path },
        { background: true }
      );
    }
  },

  refresh: async (key, opts) => {
    const background = opts?.background ?? false;
    const k = mapKeyOf(key);
    set((s) => {
      const entry = s.byKey[k] ?? emptyEntry();
      return {
        byKey: {
          ...s.byKey,
          [k]: {
            ...entry,
            // Foreground sets the spinner gate; background only the header spin.
            ...(background ? { refreshing: true } : { loading: true, error: null })
          }
        }
      };
    });
    try {
      const snap = await ticketsApi.getSnapshot(sourceOf(key));
      set((s) => {
        const entry = s.byKey[k] ?? emptyEntry();
        return {
          byKey: {
            ...s.byKey,
            [k]: {
              ...entry,
              snapshot: snap,
              loadedAt: Date.now(),
              loading: false,
              refreshing: false,
              error: null
            }
          }
        };
      });
    } catch (err) {
      // A failed BACKGROUND reload must not blank a good board nor set error.
      set((s) => {
        const entry = s.byKey[k] ?? emptyEntry();
        if (background) {
          return { byKey: { ...s.byKey, [k]: { ...entry, refreshing: false } } };
        }
        return {
          byKey: {
            ...s.byKey,
            [k]: {
              ...entry,
              snapshot: null,
              loading: false,
              refreshing: false,
              error: err instanceof Error ? err.message : String(err)
            }
          }
        };
      });
    }
  },

  loadProfiles: async (key) => {
    const k = mapKeyOf(key);
    // Profiles are GLOBAL (C5): fetch exactly ONCE for the whole app, then
    // mirror the cached list into every entry. A project switch therefore never
    // re-invokes `listProfiles` — the gate is the module-level
    // `globalProfilesLoadedAt`, NOT the per-entry `profilesLoadedAt`.
    if (globalProfilesLoadedAt != null) {
      // Already loaded once — just mirror the cached list into this entry (no IPC).
      mirrorProfilesToEntry(set, k);
      return;
    }
    // De-dupe concurrent first-load callers onto one in-flight fetch.
    if (!globalProfilesInflight) {
      globalProfilesInflight = (async () => {
        let list: ZanaProfile[] = [];
        try {
          const fetched = await ticketsApi.listProfiles();
          if (Array.isArray(fetched)) list = fetched;
        } catch {
          // No profiles available — picker still offers free-text + clear.
        }
        globalProfiles = list;
        globalProfilesLoadedAt = Date.now();
        globalProfilesInflight = null;
        return list;
      })();
    }
    await globalProfilesInflight;
    mirrorProfilesToEntry(set, k);
  },

  applyAssign: (key, ticket, choice) => {
    const k = mapKeyOf(key);
    const tk = timerKey(k, ticket.id);

    // Cancel a still-pending write for this ticket (re-assign before commit).
    const pending = assignTimers.get(tk);
    if (pending) {
      clearTimeout(pending);
      assignTimers.delete(tk);
    }
    // Record the rollback baseline ONCE (so undo restores the true pre-edit
    // state even across rapid re-assigns).
    if (!assignPrev.has(tk)) {
      assignPrev.set(tk, {
        assigneeName: ticket.assigneeName,
        assigneeId: ticket.assigneeId,
        assigneeProfileId: ticket.assigneeProfileId
      });
    }

    let patch: Partial<AssigneeFields>;
    let args: { profileId?: string | null; assigneeName?: string };
    let label: string;
    if (choice.kind === 'clear') {
      patch = { assigneeName: undefined, assigneeId: undefined, assigneeProfileId: undefined };
      args = { profileId: null };
      label = 'Unassigned';
    } else if (choice.kind === 'profile') {
      patch = { assigneeName: choice.displayName, assigneeProfileId: choice.profileId };
      args = { profileId: choice.profileId };
      label = choice.displayName;
    } else {
      patch = { assigneeName: choice.assigneeName, assigneeProfileId: undefined };
      args = { assigneeName: choice.assigneeName };
      label = choice.assigneeName;
    }

    // Optimistic patch (immutable).
    patchAssignee(set, k, ticket.id, patch);

    // Deferred write after the undo window.
    const commit = setTimeout(() => {
      assignTimers.delete(tk);
      ticketsApi
        .assignTicket(sourceOf(key), ticket.id, args)
        .then(() => {
          assignPrev.delete(tk);
          // Quietly refresh to pick up the fresh audit entry.
          void get().refresh(key, { background: true });
        })
        .catch((err) => {
          const prev = assignPrev.get(tk);
          if (prev) patchAssignee(set, k, ticket.id, prev); // roll back
          assignPrev.delete(tk);
          // No toast — the store has no host. Surface via the entry error field
          // for the view to render.
          set((s) => {
            const entry = s.byKey[k];
            if (!entry) return {};
            return {
              byKey: {
                ...s.byKey,
                [k]: {
                  ...entry,
                  error: `Couldn't assign ${label} — ${err instanceof Error ? err.message : String(err)}`
                }
              }
            };
          });
        });
    }, UNDO_WINDOW_MS);
    assignTimers.set(tk, commit);

    // Raise the undo banner + arm its auto-dismiss (reset on re-assign).
    const priorDismiss = dismissTimers.get(k);
    if (priorDismiss) clearTimeout(priorDismiss);
    const dismiss = setTimeout(() => {
      dismissTimers.delete(k);
      set((s) => ({ assignUndo: { ...s.assignUndo, [k]: null } }));
    }, UNDO_WINDOW_MS);
    dismissTimers.set(k, dismiss);
    set((s) => ({ assignUndo: { ...s.assignUndo, [k]: { id: ticket.id, label } } }));
  },

  undoAssign: (key, ticketId) => {
    const k = mapKeyOf(key);
    const tk = timerKey(k, ticketId);
    const timer = assignTimers.get(tk);
    if (timer) {
      clearTimeout(timer);
      assignTimers.delete(tk);
    }
    const prev = assignPrev.get(tk);
    if (prev) {
      patchAssignee(set, k, ticketId, prev);
      assignPrev.delete(tk);
    }
    const dismiss = dismissTimers.get(k);
    if (dismiss) {
      clearTimeout(dismiss);
      dismissTimers.delete(k);
    }
    set((s) => ({ assignUndo: { ...s.assignUndo, [k]: null } }));
  },

  startAutoRefresh: (key) => {
    const k = mapKeyOf(key);
    const next = (refreshRefcounts.get(k) ?? 0) + 1;
    refreshRefcounts.set(k, next);
    if (next === 1 && !refreshIntervals.has(k)) {
      const handle = setInterval(() => {
        // Read `autoRefresh`/`paused` fresh each tick so a mid-interval toggle or
        // pause takes effect. The global `autoRefresh` toggle (D1) gates every
        // key; the per-key `paused` flag additionally pauses a single view.
        const s = get();
        if (s.autoRefresh && !s.byKey[k]?.paused) void s.refresh(key, { background: true });
      }, AUTO_REFRESH_MS);
      refreshIntervals.set(k, handle);
    }
  },

  stopAutoRefresh: (key) => {
    const k = mapKeyOf(key);
    const cur = refreshRefcounts.get(k) ?? 0;
    if (cur <= 1) {
      refreshRefcounts.delete(k);
      const handle = refreshIntervals.get(k);
      if (handle) {
        clearInterval(handle);
        refreshIntervals.delete(k);
      }
    } else {
      refreshRefcounts.set(k, cur - 1);
    }
  },

  setPaused: (key, paused) => {
    const k = mapKeyOf(key);
    set((s) => {
      const entry = s.byKey[k];
      if (!entry || entry.paused === paused) return {};
      return { byKey: { ...s.byKey, [k]: { ...entry, paused } } };
    });
  },

  toggleColumnCollapsed: (key, status, defaultCollapsed) => {
    const k = mapKeyOf(key);
    // Preserve the normalization the override lookup depends on.
    const statusKey = status.trim().toLowerCase();
    set((s) => {
      const entry = s.byKey[k] ?? emptyEntry();
      const next = {
        ...entry.collapsedColumns,
        [statusKey]: !(entry.collapsedColumns[statusKey] ?? defaultCollapsed)
      };
      // Persist the per-project map (D1). Keyed by the same `k` the entry uses,
      // so a `useGlobal` view persists under the global anchor id.
      writeCollapsed(k, next);
      return { byKey: { ...s.byKey, [k]: { ...entry, collapsedColumns: next } } };
    });
  },

  clearProject: (projectId) => {
    // Cancel + delete every module-level timer for this key.
    const prefix = `${projectId}::`;
    for (const [tk, timer] of assignTimers) {
      if (tk.startsWith(prefix)) {
        clearTimeout(timer);
        assignTimers.delete(tk);
      }
    }
    for (const tk of [...assignPrev.keys()]) {
      if (tk.startsWith(prefix)) assignPrev.delete(tk);
    }
    const dismiss = dismissTimers.get(projectId);
    if (dismiss) {
      clearTimeout(dismiss);
      dismissTimers.delete(projectId);
    }
    const interval = refreshIntervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      refreshIntervals.delete(projectId);
    }
    refreshRefcounts.delete(projectId);

    set((s) => {
      if (!(projectId in s.byKey) && !(projectId in s.assignUndo)) return {};
      const byKey = { ...s.byKey };
      delete byKey[projectId];
      const assignUndo = { ...s.assignUndo };
      delete assignUndo[projectId];
      return { byKey, assignUndo };
    });
  }
}));

// ── Selector hooks (stable primitives only — no fresh-object selectors) ──────
// Returning a freshly-built array/object from a selector triggers zustand's
// infinite-loop trap; these expose stored references directly (or null/undefined).

/** The whole cached entry for a key (or undefined before first ensure). */
export function useTicketsEntry(key: TicketsKey): TicketsEntry | undefined {
  return useTickets((s) => s.byKey[mapKeyOf(key)]);
}

/**
 * The whole keyed cache (D5 Overview KPI line). One coarse subscription for the
 * full project grid — the consumer reads `byKey[projectId]?.snapshot?.kpis` as a
 * pure object lookup per card (zero IPC on render; Rule 5). The reference is
 * stable between snapshot writes, so the Overview only re-renders when a
 * snapshot actually lands.
 */
export function useTicketsByKey(): Record<string, TicketsEntry> {
  return useTickets((s) => s.byKey);
}

/** The KPIs for a key's snapshot (or null). */
export function useTicketsKpis(key: TicketsKey) {
  return useTickets((s) => s.byKey[mapKeyOf(key)]?.snapshot?.kpis ?? null);
}

/** Release every module-level timer/interval. Used by HMR dispose + tests. */
function disposeTicketsTimers(): void {
  for (const t of assignTimers.values()) clearTimeout(t);
  for (const t of dismissTimers.values()) clearTimeout(t);
  for (const i of refreshIntervals.values()) clearInterval(i);
  assignTimers.clear();
  assignPrev.clear();
  dismissTimers.clear();
  refreshIntervals.clear();
  refreshRefcounts.clear();
  // Reset the GLOBAL profiles cache (C5) so a fresh dispose/test re-fetches.
  globalProfiles = [];
  globalProfilesLoadedAt = null;
  globalProfilesInflight = null;
}

/**
 * Reset ALL module-level state (timers + maps + store) between test cases —
 * fake timers and module state persist across cases in one vitest file.
 */
export function __resetTicketsStoreForTest(): void {
  disposeTicketsTimers();
  // Re-seed the durable prefs from the codec (D1) so a test that primes
  // `localStorage` before resetting sees its values, and a clean test gets the
  // documented defaults (`'tickets'` / auto-refresh ON).
  useTickets.setState(
    {
      byKey: {},
      assignUndo: {},
      subTab: readActiveTab(),
      autoRefresh: readAutoRefresh(),
      boardDensity: readBoardDensity(),
      sprintFilter: null
    },
    false
  );
}

// HMR hygiene (Rule 3): module-level timers leak across dev reloads. Gated
// behind optional-chain so production and the no-Vite vitest env are unaffected.
import.meta.hot?.dispose(() => {
  disposeTicketsTimers();
});
