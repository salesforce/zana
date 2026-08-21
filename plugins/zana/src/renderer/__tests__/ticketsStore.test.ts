/**
 * B4 CANONICAL sweep for the B3 `useTickets` store (`../ticketsStore.ts`).
 *
 * Companion to the B3 smoke test (`util/__tests__/ticketsStore.smoke.test.ts`,
 * 9 cases). This is the canonical behavioural lock and the headline Rule-5
 * IPC-storm guard. Covers, per the B4 acceptance criteria:
 *   1. projectId keying — two snapshots coexist independently.
 *   2. NO re-fetch on remount — `ensure` x3 ⇒ exactly 1 getSnapshot + 1
 *      listProfiles (the per-mount-storm guard); `refresh(force)` re-calls.
 *   3. optimistic assign — patches in-store immediately, defers the write past
 *      UNDO_WINDOW_MS, then commits once.
 *   4. undo — restores the pre-edit baseline, write never fires; rapid
 *      re-assign-then-undo restores the ORIGINAL baseline (baseline-once).
 *   5. rollback on write failure — commit rejects ⇒ optimistic patch reverts.
 *   6. profiles cached once — `loadProfiles` x2 ⇒ 1 listProfiles.
 *
 * RECONCILIATION (vs. the B4 spec's assumed contract):
 *   - The spec assumed action names `load`/`load(force)` and a `byProject` map.
 *     The SHIPPED B3 uses `ensure` / `refresh(key,{background})` and a `byKey`
 *     map keyed by `mapKeyOf(key)` (= `projectId`, or `'__global__'` when
 *     `useGlobal`) — `ticketsStore.ts:73,97-99,174,192`. We drive the REAL API.
 *   - The spec mocked `getInitialState()` for reset. B3 instead ships
 *     `__resetTicketsStoreForTest()` (`ticketsStore.ts:481`), which also clears
 *     the MODULE-LEVEL timer maps (assign/undo/refresh) that `getInitialState`
 *     can't see. We use it — without it the "called once" assertions leak across
 *     cases. (No devDependencies / jsdom added; the store is fully observable via
 *     `getState()` — no React-hook-only surface, so no B3 defect to flag.)
 *   - The spec's assign signature was `(p,t,{kind,profileId,displayName})`. B3's
 *     real `applyAssign(key, ticket, choice)` takes a discriminated `AssignChoice`
 *     ({kind:'profile'|'name'|'clear'}) — `ticketsStore.ts:83`, `zana-types:152`.
 *
 * Style: zero-DOM; mock the `ticketsApi` data layer (NOT the raw bus); drive the
 * vanilla zustand store via `getState()` + actions (mirrors `host.test.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ZanaProfile, ZanaSnapshot, ZanaTicket } from '@shared/zana-types';

const getSnapshot = vi.fn();
const listProfiles = vi.fn();
const assignTicket = vi.fn();

vi.mock('../ticketsApi', () => ({
  ticketsApi: {
    getSnapshot: (...a: unknown[]) => getSnapshot(...a),
    listProfiles: (...a: unknown[]) => listProfiles(...a),
    assignTicket: (...a: unknown[]) => assignTicket(...a)
  }
}));

import { useTickets, __resetTicketsStoreForTest, type TicketsKey } from '../ticketsStore';

const KEY1: TicketsKey = { projectId: 'p1', projectPath: '/p1' };
const KEY2: TicketsKey = { projectId: 'p2', projectPath: '/p2' };

/** Minimal in-memory `localStorage` stub (node, no jsdom) — backs the D1 codec
 *  cases below. Installed in their own beforeEach so the rest of the file keeps
 *  running with `localStorage` absent (the codec then yields defaults). */
function installLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() {
      return store.size;
    }
  } as Storage;
  return store;
}

function snap(tickets: ZanaTicket[] = []): ZanaSnapshot {
  return {
    source: { kind: 'project', label: 'p', path: '/p/.zana' },
    kpis: {
      totalTickets: 0,
      openTickets: 0,
      closedTickets: 0,
      blockedTickets: 0,
      byStatus: {},
      byPriority: {},
      sprintCount: 0,
      artifactCount: 0
    },
    tickets,
    sprints: [],
    artifacts: [],
    isInitialized: true
  };
}

function mkTicket(over: Partial<ZanaTicket> = {}): ZanaTicket {
  return { id: 't1', title: 'T', status: 'backlog', labels: [], blockedBy: [], ...over };
}

const profile = (id: string): ZanaProfile =>
  ({ id, name: id, category: 'general' }) as unknown as ZanaProfile;

const st = () => useTickets.getState();

beforeEach(() => {
  vi.useFakeTimers();
  getSnapshot.mockReset().mockImplementation(() => Promise.resolve(snap([mkTicket()])));
  listProfiles.mockReset().mockResolvedValue([]);
  assignTicket.mockReset().mockResolvedValue(undefined);
  __resetTicketsStoreForTest();
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
  vi.clearAllMocks();
});

// ── 1. projectId keying ──────────────────────────────────────────────────────
describe('useTickets — keyed by projectId', () => {
  it('two project snapshots coexist independently under their own keys', async () => {
    getSnapshot.mockImplementation((src: { kind: string; projectPath?: string }) =>
      Promise.resolve(
        snap([mkTicket({ id: src.projectPath === '/p1' ? 'a' : 'b', title: src.projectPath ?? '' })])
      )
    );
    st().ensure(KEY1);
    st().ensure(KEY2);
    await vi.runAllTimersAsync();

    const { byKey } = st();
    expect(Object.keys(byKey).sort()).toEqual(['p1', 'p2']);
    expect(byKey['p1']?.snapshot?.tickets[0].id).toBe('a');
    expect(byKey['p2']?.snapshot?.tickets[0].id).toBe('b');
    // Independent: clearing p1 leaves p2 intact.
    st().clearProject('p1');
    expect(st().byKey['p1']).toBeUndefined();
    expect(st().byKey['p2']?.snapshot?.tickets[0].id).toBe('b');
  });
});

// ── 2. No re-fetch on remount (Rule-5 IPC-storm headline guard) ──────────────
describe('useTickets — no re-fetch when cached (anti-IPC-storm)', () => {
  it('ensure(key) x3 ⇒ exactly 1 getSnapshot + 1 listProfiles', async () => {
    st().ensure(KEY1); // first mount
    st().ensure(KEY1); // synchronous double-mount (in-flight guard)
    await vi.runAllTimersAsync();
    st().ensure(KEY1); // remount after the first load settled (cache hit)
    await vi.runAllTimersAsync();

    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(st().byKey['p1']?.snapshot?.tickets).toHaveLength(1);
    expect(st().byKey['p1']?.loadedAt).not.toBeNull();
  });

  it('refresh(key) DOES re-call getSnapshot after a cache hit', async () => {
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);

    await st().refresh(KEY1); // explicit user/auto refresh — must re-hit
    expect(getSnapshot).toHaveBeenCalledTimes(2);
  });
});

// ── 3. Optimistic assign ─────────────────────────────────────────────────────
describe('useTickets — optimistic assign', () => {
  it('patches the in-store ticket immediately; defers the write to UNDO_WINDOW_MS', async () => {
    st().ensure(KEY1);
    await vi.runAllTimersAsync();

    st().applyAssign(KEY1, mkTicket(), { kind: 'profile', profileId: 'pr1', displayName: 'Bot' });

    // Patched NOW, before the deferred write.
    const t = st().byKey['p1']?.snapshot?.tickets[0];
    expect(t?.assigneeName).toBe('Bot');
    expect(t?.assigneeProfileId).toBe('pr1');
    expect(assignTicket).not.toHaveBeenCalled();
    expect(st().assignUndo['p1']).toEqual({ id: 't1', label: 'Bot' });

    // Commit fires after the undo window.
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).toHaveBeenCalledTimes(1);
    expect(assignTicket).toHaveBeenCalledWith(
      { kind: 'project', projectPath: '/p1' },
      't1',
      { profileId: 'pr1' }
    );
  });

  it('free-text (name) assign routes { assigneeName } and clears the profile id', async () => {
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    st().applyAssign(KEY1, mkTicket({ assigneeProfileId: 'old' }), {
      kind: 'name',
      assigneeName: 'Ada'
    });
    const t = st().byKey['p1']?.snapshot?.tickets[0];
    expect(t?.assigneeName).toBe('Ada');
    expect(t?.assigneeProfileId).toBeUndefined();
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).toHaveBeenCalledWith(
      { kind: 'project', projectPath: '/p1' },
      't1',
      { assigneeName: 'Ada' }
    );
  });

  it('clear assign routes { profileId:null } and blanks the assignee fields', async () => {
    getSnapshot.mockResolvedValue(
      snap([mkTicket({ assigneeName: 'Old', assigneeProfileId: 'pr0', assigneeId: 'a0' })])
    );
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    st().applyAssign(KEY1, st().byKey['p1']!.snapshot!.tickets[0], { kind: 'clear' });
    const t = st().byKey['p1']?.snapshot?.tickets[0];
    expect(t?.assigneeName).toBeUndefined();
    expect(t?.assigneeProfileId).toBeUndefined();
    expect(t?.assigneeId).toBeUndefined();
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).toHaveBeenCalledWith(
      { kind: 'project', projectPath: '/p1' },
      't1',
      { profileId: null }
    );
  });
});

// ── 4. Undo restores baseline (incl. rapid re-assign true-baseline) ──────────
describe('useTickets — undo', () => {
  it('undo before commit restores baseline and the write never fires', async () => {
    getSnapshot.mockResolvedValue(snap([mkTicket({ assigneeName: 'Original', assigneeProfileId: 'p0' })]));
    st().ensure(KEY1);
    await vi.runAllTimersAsync();

    st().applyAssign(KEY1, st().byKey['p1']!.snapshot!.tickets[0], {
      kind: 'profile',
      profileId: 'pr1',
      displayName: 'Bot'
    });
    expect(st().byKey['p1']?.snapshot?.tickets[0].assigneeName).toBe('Bot');

    st().undoAssign(KEY1, 't1');
    const t = st().byKey['p1']?.snapshot?.tickets[0];
    expect(t?.assigneeName).toBe('Original');
    expect(t?.assigneeProfileId).toBe('p0');
    expect(st().assignUndo['p1']).toBeNull();

    // The deferred write was cancelled.
    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).not.toHaveBeenCalled();
  });

  it('rapid re-assign then undo restores the ORIGINAL baseline (baseline-once)', async () => {
    getSnapshot.mockResolvedValue(snap([mkTicket({ assigneeName: 'Original', assigneeProfileId: 'p0' })]));
    st().ensure(KEY1);
    await vi.runAllTimersAsync();

    const base = st().byKey['p1']!.snapshot!.tickets[0];
    // Assign twice in a row, BEFORE any commit. The baseline must remain
    // 'Original', not the intermediate 'First'.
    st().applyAssign(KEY1, base, { kind: 'name', assigneeName: 'First' });
    const afterFirst = st().byKey['p1']!.snapshot!.tickets[0];
    expect(afterFirst.assigneeName).toBe('First');
    st().applyAssign(KEY1, afterFirst, { kind: 'name', assigneeName: 'Second' });
    expect(st().byKey['p1']?.snapshot?.tickets[0].assigneeName).toBe('Second');

    st().undoAssign(KEY1, 't1');
    const t = st().byKey['p1']?.snapshot?.tickets[0];
    expect(t?.assigneeName).toBe('Original'); // NOT 'First'
    expect(t?.assigneeProfileId).toBe('p0');

    await vi.advanceTimersByTimeAsync(6000);
    expect(assignTicket).not.toHaveBeenCalled();
  });
});

// ── 5. Rollback on write failure ─────────────────────────────────────────────
describe('useTickets — rollback on commit failure', () => {
  it('a rejected commit rolls the optimistic patch back to baseline + sets error', async () => {
    assignTicket.mockRejectedValue(new Error('boom'));
    getSnapshot.mockResolvedValue(snap([mkTicket({ assigneeName: 'Original' })]));
    st().ensure(KEY1);
    await vi.runAllTimersAsync();

    st().applyAssign(KEY1, st().byKey['p1']!.snapshot!.tickets[0], {
      kind: 'name',
      assigneeName: 'Ada'
    });
    expect(st().byKey['p1']?.snapshot?.tickets[0].assigneeName).toBe('Ada');

    await vi.advanceTimersByTimeAsync(6000); // commit fires
    await vi.runAllTimersAsync(); // flush the rejection microtasks

    const entry = st().byKey['p1'];
    expect(entry?.snapshot?.tickets[0].assigneeName).toBe('Original'); // rolled back
    expect(entry?.error).toContain('boom');
    expect(entry?.error).toContain('Ada'); // label surfaced in the message
  });
});

// ── 6. Profiles cached once ──────────────────────────────────────────────────
describe('useTickets — profiles cached once', () => {
  it('loadProfiles(key) x2 ⇒ listProfiles called exactly once', async () => {
    listProfiles.mockResolvedValue([profile('arch'), profile('impl')]);
    await st().loadProfiles(KEY1);
    await st().loadProfiles(KEY1);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(st().byKey['p1']?.profiles).toHaveLength(2);
    expect(st().byKey['p1']?.profilesLoadedAt).not.toBeNull();
  });

  it('a zero-profile fetch still gates — no re-fetch forever', async () => {
    listProfiles.mockResolvedValue([]);
    await st().loadProfiles(KEY1);
    await st().loadProfiles(KEY1);
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(st().byKey['p1']?.profiles).toEqual([]);
  });

  // C5 — profiles are GLOBAL: a project switch must NOT re-invoke listProfiles
  // (IPC-storm guard). The single fetch is mirrored into every project's entry.
  it('switching projectId does NOT re-invoke listProfiles (global slice)', async () => {
    listProfiles.mockResolvedValue([profile('arch'), profile('impl')]);
    await st().loadProfiles(KEY1); // project p1 mounts
    await st().loadProfiles(KEY2); // user switches to project p2
    await st().loadProfiles(KEY1); // back to p1
    expect(listProfiles).toHaveBeenCalledTimes(1);
    // Both projects' entries see the same global profiles list.
    expect(st().byKey['p1']?.profiles).toHaveLength(2);
    expect(st().byKey['p2']?.profiles).toHaveLength(2);
    expect(st().byKey['p1']?.profiles).toBe(st().byKey['p2']?.profiles);
  });

  it('ensure(p1) then ensure(p2) fires listProfiles exactly once across projects', async () => {
    listProfiles.mockResolvedValue([profile('arch')]);
    st().ensure(KEY1);
    st().ensure(KEY2);
    await vi.runAllTimersAsync();
    expect(listProfiles).toHaveBeenCalledTimes(1);
    expect(st().byKey['p1']?.profiles).toHaveLength(1);
    expect(st().byKey['p2']?.profiles).toHaveLength(1);
  });
});

// ── C3 — cross-tab UI state (subTab / sprintFilter / openSprint) ─────────────
// These MUST live in the module-singleton store, not component state, because
// the Tickets view fully unmounts on every WorkspaceMode switch.
describe('useTickets — sub-tab / sprint-filter UI slice (C3)', () => {
  it('defaults to the tickets sub-tab and a null sprint filter', () => {
    expect(st().subTab).toBe('tickets');
    expect(st().sprintFilter).toBeNull();
  });

  it('setSubTab switches the active sub-tab', () => {
    st().setSubTab('docs');
    expect(st().subTab).toBe('docs');
    st().setSubTab('sprints');
    expect(st().subTab).toBe('sprints');
  });

  it('openSprint sets sprintFilter and jumps to the tickets sub-tab', () => {
    st().setSubTab('sprints');
    st().openSprint('sprint-42');
    expect(st().sprintFilter).toBe('sprint-42');
    expect(st().subTab).toBe('tickets');
  });

  it('setSprintFilter(null) clears the filter', () => {
    st().openSprint('sprint-42');
    st().setSprintFilter(null);
    expect(st().sprintFilter).toBeNull();
  });

  it('subTab + sprintFilter persist across a simulated view remount (singleton)', () => {
    st().openSprint('sprint-7');
    st().setSubTab('docs');
    // A WorkspaceMode switch unmounts/remounts the view — the store survives, so
    // a fresh getState() (the remounted view re-reading) sees the same values.
    const afterRemount = useTickets.getState();
    expect(afterRemount.subTab).toBe('docs');
    expect(afterRemount.sprintFilter).toBe('sprint-7');
  });
});

// ── D1 — durable UI prefs (activeTab / autoRefresh / collapsedColumns) ───────
// The store is the single source of truth: it SEEDS these from the localStorage
// codec on init / per-project cache-miss and PERSISTS them on the toggle actions.
describe('useTickets — durable prefs seed + persist (D1)', () => {
  let ls: Map<string, string>;
  beforeEach(() => {
    ls = installLocalStorage();
  });
  afterEach(() => {
    delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
  });

  it('seeds subTab + autoRefresh from localStorage on reset/init', () => {
    ls.set('zcc.tickets.activeTab', 'docs');
    ls.set('zcc.tickets.autoRefresh', 'false');
    __resetTicketsStoreForTest(); // re-seeds from the codec
    expect(st().subTab).toBe('docs');
    expect(st().autoRefresh).toBe(false);
  });

  it('setSubTab persists the active tab durably', () => {
    st().setSubTab('sprints');
    expect(ls.get('zcc.tickets.activeTab')).toBe('sprints');
  });

  it('setAutoRefresh persists the toggle (default ON, only false disables)', () => {
    st().setAutoRefresh(false);
    expect(ls.get('zcc.tickets.autoRefresh')).toBe('false');
    expect(st().autoRefresh).toBe(false);
    st().setAutoRefresh(true);
    expect(ls.get('zcc.tickets.autoRefresh')).toBe('true');
  });

  it('auto-refresh OFF suppresses the 30s tick; ON resumes it', async () => {
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    getSnapshot.mockClear();
    st().startAutoRefresh(KEY1);
    st().setAutoRefresh(false);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(0); // globally gated off
    st().setAutoRefresh(true);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    st().stopAutoRefresh(KEY1);
  });

  it('seeds collapsedColumns from localStorage on the per-project cache-miss path', async () => {
    ls.set('zcc.tickets.collapsedColumns.p1', JSON.stringify({ done: true }));
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    expect(st().byKey['p1']?.collapsedColumns).toEqual({ done: true });
  });

  it('toggleColumnCollapsed flips against the default, normalizes the key, and persists per-project', async () => {
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    // Mixed-case/whitespace status, default-collapsed false → toggles to true.
    st().toggleColumnCollapsed(KEY1, '  In Progress  ', false);
    expect(st().byKey['p1']?.collapsedColumns).toEqual({ 'in progress': true });
    expect(JSON.parse(ls.get('zcc.tickets.collapsedColumns.p1')!)).toEqual({
      'in progress': true
    });
    // Toggling again flips it back to false.
    st().toggleColumnCollapsed(KEY1, 'IN PROGRESS', false);
    expect(st().byKey['p1']?.collapsedColumns).toEqual({ 'in progress': false });
  });

  it("collapsedColumns is per-project — project A's map does not leak to B", async () => {
    ls.set('zcc.tickets.collapsedColumns.p1', JSON.stringify({ done: true }));
    st().ensure(KEY1);
    st().ensure(KEY2);
    await vi.runAllTimersAsync();
    expect(st().byKey['p1']?.collapsedColumns).toEqual({ done: true });
    expect(st().byKey['p2']?.collapsedColumns).toEqual({}); // B uses its own defaults
  });

  it('remount (re-ensure) rehydrates pref state from cache WITHOUT a duplicate getSnapshot', async () => {
    ls.set('zcc.tickets.collapsedColumns.p1', JSON.stringify({ done: true }));
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    st().toggleColumnCollapsed(KEY1, 'backlog', false);
    // Simulated WorkspaceMode remount: ensure() again — must be a cache hit.
    st().ensure(KEY1);
    await vi.runAllTimersAsync();
    expect(getSnapshot).toHaveBeenCalledTimes(1); // no IPC storm
    // The toggled override survived the remount (store-owns-state).
    expect(st().byKey['p1']?.collapsedColumns).toEqual({ done: true, backlog: true });
  });

  it('seeds boardDensity from localStorage on reset/init (default card)', () => {
    ls.set('zcc.tickets.boardDensity', 'list');
    __resetTicketsStoreForTest();
    expect(st().boardDensity).toBe('list');
  });

  it('setBoardDensity persists the board-wide density', () => {
    st().setBoardDensity('list');
    expect(ls.get('zcc.tickets.boardDensity')).toBe('list');
    expect(st().boardDensity).toBe('list');
    st().setBoardDensity('card');
    expect(ls.get('zcc.tickets.boardDensity')).toBe('card');
    expect(st().boardDensity).toBe('card');
  });
});
