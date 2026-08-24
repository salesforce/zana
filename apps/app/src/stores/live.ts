import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AgentState,
  AgentRecord,
  AgentMessage,
  SubagentChild,
  InboxEntry,
  Suggestion,
  InboxDigest,
  DetailedInboxDigest,
  LibraryDoc,
  McpServerEntry,
  PluginEntry,
  SavedRecord,
  SavedRecordInput,
  ScheduledTask,
  ScheduleTemplate,
  ScheduleGroup,
  Goal,
  FollowUp,
  Persona,
  AutonomousRun,
  Team,
  UpdateProgress,
  UpdateStatus,
  ReleaseNote,
  SetupStatus,
  IdleTriageResult,
  CatchUpSummaryResult,
  OverseerActivity,
  Project,
  TerminalSession
} from '@zana-ai/zcc-domain/product';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';
import { getScopedProjectId } from '../lib/windowScope.js';
import { product } from '../lib/product-client.js';
import { isClaudeProfile, knownProfile, projectDefaultProfile } from '../lib/launchProfile.js';
import { buildFollowUpAnswerPrompt, followUpAgentTitle } from '../lib/followUpPrompt.js';
import { classifyEntry } from '@zana-ai/zcc-domain/feed-categories';
import {
  errorMessage,
  liveTerminals,
  pushErrorToast,
  useData,
  useUi
} from '../store.js';

// ============================================================================
// Inbox — entries feed, selection, per-entry read tracking.
//
// Three cooperating pieces of live state:
// - feed: push-driven (onAppended/onRemoved), no polling. Initial load is
//   one history call from useData.init().
// - selection: ephemeral, not persisted.
// - read: per-entry, persisted to localStorage. SELECTION marks read —
//   never bulk-on-visibility, since bulk-on-view destroys triage in an
//   inbox-flow product.
// ============================================================================

interface InboxLiveState {
  entries: InboxEntry[];
  loading: boolean;
  /** Replace the current list (used by initial load + reconciliation). */
  setEntries: (entries: InboxEntry[]) => void;
  /** Push a freshly-appended entry to the front. */
  prepend: (entry: InboxEntry) => void;
  /**
   * Apply a coalesced (`onUpdated`) entry: replace the existing row with the
   * same id and re-sort it to the front (its `ts` was just bumped). Falls back
   * to a prepend if the id isn't present (e.g. it was evicted/cleared) so a
   * coalesce can't silently drop the refreshed entry.
   */
  upsert: (entry: InboxEntry) => void;
  /** Remove an entry from local state (optimistic delete or push echo). */
  removeLocal: (id: string) => void;
  /** Remove many entries at once (optimistic bulk clear). */
  removeManyLocal: (ids: string[]) => void;
}

export const useInbox = create<InboxLiveState>((set) => ({
  entries: [],
  loading: true,
  setEntries: (entries) => set({ entries, loading: false }),
  prepend: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  upsert: (entry) =>
    set((s) => {
      const rest = s.entries.filter((e) => e.id !== entry.id);
      // Re-front: the coalesced entry's ts was just bumped, so it's newest.
      return { entries: [entry, ...rest] };
    }),
  removeLocal: (id) =>
    set((s) => {
      if (!s.entries.some((e) => e.id === id)) return s;
      return { entries: s.entries.filter((e) => e.id !== id) };
    }),
  removeManyLocal: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const drop = new Set(ids);
      const next = s.entries.filter((e) => !drop.has(e.id));
      return next.length === s.entries.length ? s : { entries: next };
    })
}));

// ============================================================================
// Suggested Actions launcher (afl-03) — a SIBLING store to the inbox, NOT a feed
// category. Mirrors `useInbox`'s live shape (setEntries / prepend / upsert /
// removeLocal / removeManyLocal) fed by the `suggestions:on*` IPC pushes. The
// entries are runnable actions the operator triggers with one click; `run`
// happens in main (each step re-authorized, Rule 1/2). Empty when the feature is
// off (no rail entry, no fetch).
// ============================================================================

interface SuggestionsLiveState {
  entries: Suggestion[];
  loading: boolean;
  setEntries: (entries: Suggestion[]) => void;
  prepend: (entry: Suggestion) => void;
  upsert: (entry: Suggestion) => void;
  removeLocal: (id: string) => void;
  removeManyLocal: (ids: string[]) => void;
}

export const useSuggestions = create<SuggestionsLiveState>((set) => ({
  entries: [],
  loading: true,
  setEntries: (entries) => set({ entries, loading: false }),
  prepend: (entry) =>
    set((s) =>
      s.entries.some((e) => e.id === entry.id)
        ? s
        : { entries: [entry, ...s.entries] }
    ),
  upsert: (entry) =>
    set((s) => {
      const rest = s.entries.filter((e) => e.id !== entry.id);
      return { entries: [entry, ...rest] };
    }),
  removeLocal: (id) =>
    set((s) => {
      if (!s.entries.some((e) => e.id === id)) return s;
      return { entries: s.entries.filter((e) => e.id !== id) };
    }),
  removeManyLocal: (ids) =>
    set((s) => {
      if (ids.length === 0) return s;
      const drop = new Set(ids);
      const next = s.entries.filter((e) => !drop.has(e.id));
      return next.length === s.entries.length ? s : { entries: next };
    })
}));

/**
 * Live agent status (working / blocked / done / idle), kept in its OWN store —
 * deliberately not on the `TerminalSession` objects in `useData`. Status ticks
 * far more often than session metadata; routing it through `useData` would
 * rebuild the `terminals` map on every tick and re-render every list/strip that
 * selects it (the render-storm the arch council made binding — BC 7/10).
 *
 * `byId` is the per-session state. `rollup` is the precomputed per-project
 * most-urgent state, updated imperatively in `apply` (O(affected project), not
 * O(projects × sessions)) so consumers read `rollup[projectId]` as a stable
 * primitive and never run a fresh-object selector — the zustand infinite-loop
 * trap (see MEMORY `zustand-selector-stable-ref`).
 */
const AGENT_STATE_RANK: Record<AgentState, number> = {
  blocked: 4,
  done: 3,
  working: 2,
  idle: 1,
  unknown: 0
};

/** Resolve which project a session belongs to from the live terminals map.
 *  Returns null if the session isn't known yet (e.g. a status push that races
 *  ahead of the sessionUpdated that registers the tab). */
export function findProjectIdForSession(sessionId: string): string | null {
  const { terminals } = useData.getState();
  for (const [projectId, list] of Object.entries(terminals)) {
    if (list.some((t) => t.id === sessionId)) return projectId;
  }
  return null;
}

interface AgentStatusState {
  byId: Record<string, AgentState>;
  /**
   * Timestamp (ms, renderer clock) at which each session ENTERED its current
   * state. Set on every real state change in {@link apply} (a deduped re-apply
   * of the same state leaves it untouched, so it marks the *start* of the
   * current spell, not the last tick). Lets the Idle lane show "idle for X" and
   * order itself most-recently-idle first. Dropped with the session.
   */
  since: Record<string, number>;
  rollup: Record<string, AgentState>;
  /** Last seq we've seen (the cursor for {@link agentStatusSince}). Starts at 0
   *  (a fresh renderer), advanced by {@link apply} on each live push. Main owns
   *  the seq; this is the advisory cursor (Rule 1). */
  lastSeq: number;
  /** Per-session high-water seq mark. The GLOBAL {@link lastSeq} can't gate a
   *  write (seq is global, so an unrelated session's push would suppress this
   *  session's replay), so we track the freshest seq applied PER session. Guards
   *  the reseed-vs-live-push race: a replayed/snapshot state can't clobber a
   *  newer live push that raced ahead of the async {@link agentStatusSince}
   *  reseed on init. Dropped with the session. */
  seqById: Record<string, number>;
  /** Apply one session's new state. `projectId` lets us recompute that one
   *  project's rollup without scanning every project. The optional `seq` is
   *  passed through from the live push or replay event to advance {@link lastSeq}. */
  apply: (sessionId: string, projectId: string, state: AgentState, seq?: number) => void;
  /** Drop a session (pty exited / tab closed) and refresh its project rollup. */
  clear: (sessionId: string, projectId: string) => void;
  /** Drop a whole project (project removed): forget every session's state and
   *  its rollup entry so no phantom dot lingers. */
  clearProject: (projectId: string) => void;
}

export const useAgentStatus = create<AgentStatusState>((set, get) => ({
  byId: {},
  since: {},
  rollup: {},
  lastSeq: 0,
  seqById: {},
  apply: (sessionId, projectId, state, seq) =>
    set((s) => {
      // Per-session staleness guard (Rule 1: seq is main's, authoritative). A
      // write carrying a seq NO NEWER than the freshest we've applied for this
      // session is a stale reseed event that raced behind a live push — drop it
      // so it can't clobber the newer state. We still advance the GLOBAL cursor
      // (a stale-for-this-session seq may be the newest overall), but never touch
      // byId. Writes without a seq (snapshot fallback) skip the guard.
      if (seq !== undefined && s.seqById[sessionId] !== undefined && seq <= s.seqById[sessionId]) {
        return seq > s.lastSeq ? { ...s, lastSeq: seq } : s;
      }
      if (s.byId[sessionId] === state) {
        // State unchanged — but advance the cursors if a (fresher) seq is given.
        if (seq !== undefined) {
          const seqById =
            seq > (s.seqById[sessionId] ?? 0) ? { ...s.seqById, [sessionId]: seq } : s.seqById;
          const lastSeq = Math.max(s.lastSeq, seq);
          if (seqById !== s.seqById || lastSeq !== s.lastSeq) return { ...s, seqById, lastSeq };
        }
        return s;
      }
      const byId = { ...s.byId, [sessionId]: state };
      // Stamp the moment this session entered its new state. Deduped above, so
      // this only advances on a *real* transition — i.e. it marks when the
      // current (idle/working/…) spell began, which the Idle lane reads to show
      // "idle for X" and to order most-recently-idle first.
      const since = { ...s.since, [sessionId]: Date.now() };
      const lastSeq = seq !== undefined ? Math.max(s.lastSeq, seq) : s.lastSeq;
      const seqById =
        seq !== undefined ? { ...s.seqById, [sessionId]: seq } : s.seqById;
      return { byId, since, rollup: recomputeRollup(byId, projectId, s.rollup), lastSeq, seqById };
    }),
  clear: (sessionId, projectId) =>
    set((s) => {
      if (!(sessionId in s.byId) && !(sessionId in s.seqById)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      const since = { ...s.since };
      delete since[sessionId];
      // Drop the high-water mark too, so a reused session id starts clean.
      const seqById = { ...s.seqById };
      delete seqById[sessionId];
      return { byId, since, seqById, rollup: recomputeRollup(byId, projectId, s.rollup) };
    }),
  clearProject: (projectId) =>
    set((s) => {
      // Read membership before the caller wipes the terminals map. Drop every
      // session's state plus the project's rollup entry in one pass.
      const sessions = useData.getState().terminals[projectId] ?? [];
      const ids = new Set(sessions.map((t) => t.id));
      const hadRollup = projectId in s.rollup;
      if (ids.size === 0 && !hadRollup) return s;
      const byId = { ...s.byId };
      const since = { ...s.since };
      const seqById = { ...s.seqById };
      for (const id of ids) {
        delete byId[id];
        delete since[id];
        delete seqById[id];
      }
      const rollup = { ...s.rollup };
      delete rollup[projectId];
      return { byId, since, seqById, rollup };
    })
}));

/**
 * Recompute one project's rollup = the most-urgent agent state across its live
 * sessions. Reads session→project membership from `useData` so we don't have to
 * thread it through every status event. Returns a new `rollup` object only when
 * that project's value actually changed (keeps the reference stable otherwise).
 */
function recomputeRollup(
  byId: Record<string, AgentState>,
  projectId: string,
  prev: Record<string, AgentState>
): Record<string, AgentState> {
  const sessions = useData.getState().terminals[projectId] ?? [];
  let best: AgentState = 'unknown';
  for (const sess of sessions) {
    const st = byId[sess.id];
    if (st && AGENT_STATE_RANK[st] > AGENT_STATE_RANK[best]) best = st;
  }
  if (prev[projectId] === best) return prev;
  return { ...prev, [projectId]: best };
}

/**
 * Idle-triage results (idle-agent add-on; off by default). Keyed by session id,
 * holding the latest {@link IdleTriageResult} for an agent's current idle spell.
 * Deliberately a SEPARATE slice from {@link useAgentStatus} — the badge it backs
 * updates on its own cadence (an LLM call), and keeping it apart means a triage
 * push never invalidates the status/session selectors (render-storm guard).
 */
interface IdleTriageState {
  byId: Record<string, IdleTriageResult>;
  apply: (result: IdleTriageResult) => void;
  /** Drop one session's triage (agent left idle, or tab closed). */
  clear: (sessionId: string) => void;
}

export const useIdleTriage = create<IdleTriageState>((set) => ({
  byId: {},
  apply: (result) =>
    set((s) => {
      const prev = s.byId[result.sessionId];
      // Skip a no-op re-apply (same resolution + summary) so subscribers with a
      // stable-ref selector don't churn.
      if (prev && prev.resolution === result.resolution && prev.summary === result.summary) {
        return s;
      }
      return { byId: { ...s.byId, [result.sessionId]: result } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Per-session Overseer activity (auto-approve cascade; experimental, off by
 * default). Keyed by session id, holding the latest {@link OverseerActivity}
 * rollup main pushes for an agent. A SEPARATE slice from {@link useAgentStatus}
 * for the same reason as {@link useIdleTriage}: it updates on its own cadence
 * (every decided tool call, debounced) and must never invalidate the
 * status/session selectors (render-storm guard). Backs the "auto-approved ×N"
 * card badge.
 */
interface OverseerActivityState {
  byId: Record<string, OverseerActivity>;
  apply: (activity: OverseerActivity) => void;
  /** Drop one session's activity (tab closed / project removed). */
  clear: (sessionId: string) => void;
}

export const useOverseerActivity = create<OverseerActivityState>((set) => ({
  byId: {},
  apply: (activity) =>
    set((s) => {
      const prev = s.byId[activity.sessionId];
      // Skip a no-op re-apply (identical counts) so stable-ref subscribers don't
      // churn — the debounced push can repeat the same rollup.
      if (
        prev &&
        prev.autoApproved === activity.autoApproved &&
        prev.wouldApprove === activity.wouldApprove &&
        prev.askedBack === activity.askedBack
      ) {
        return s;
      }
      return { byId: { ...s.byId, [activity.sessionId]: activity } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Catch-up summary results (catch-up-summary add-on; EXPERIMENTAL, off by
 * default). Keyed by session id, holding the latest {@link CatchUpSummaryResult}
 * for an agent that sat idle or blocked long enough for the add-on to fire. A
 * SEPARATE slice from {@link useAgentStatus} — the summary is precomputed
 * background LLM work, and keeping it apart means a summary push never
 * invalidates the status/session selectors (render-storm guard, same pattern as
 * {@link useIdleTriage} and {@link useOverseerActivity}).
 */
interface CatchUpSummaryState {
  bySession: Record<string, CatchUpSummaryResult>;
  apply: (result: CatchUpSummaryResult) => void;
  /** Drop one session's summary (tab closed). */
  clear: (sessionId: string) => void;
  /** Drop all summaries for a project (project closed / removed). */
  clearProject: (projectId: string) => void;
}

export const useCatchUpSummary = create<CatchUpSummaryState>((set) => ({
  bySession: {},
  apply: (result) =>
    set((s) => {
      const prev = s.bySession[result.sessionId];
      // Skip a no-op re-apply (same text + trigger) so subscribers with a
      // stable-ref selector don't churn.
      if (prev && prev.text === result.text && prev.trigger === result.trigger) {
        return s;
      }
      return { bySession: { ...s.bySession, [result.sessionId]: result } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.bySession)) return s;
      const bySession = { ...s.bySession };
      delete bySession[sessionId];
      return { bySession };
    }),
  clearProject: (projectId) =>
    set((s) => {
      // Read membership before the caller wipes the terminals map. Drop every
      // session's summary in one pass.
      const sessions = useData.getState().terminals[projectId] ?? [];
      const ids = new Set(sessions.map((t) => t.id));
      if (ids.size === 0) return s;
      const bySession = { ...s.bySession };
      let changed = false;
      for (const id of ids) {
        if (id in bySession) {
          delete bySession[id];
          changed = true;
        }
      }
      return changed ? { bySession } : s;
    })
}));

/**
 * Live sub-agent (Task tool) spawn counts, keyed by parent session id. A
 * SEPARATE slice from {@link useAgentStatus} on purpose: a session running
 * sub-agents is still `working`, so the count rides its own channel and must
 * never invalidate the status/session selectors (render-storm guard). Backs the
 * "N sub-agents running" badge on the parent's card. Zero is the default, so
 * entries are dropped (not stored as 0) once the count drains.
 */
interface SubagentsState {
  byId: Record<string, number>;
  /** Apply one session's new sub-agent count. Drops the entry at 0 so the
   *  map only ever holds live fan-outs. */
  apply: (sessionId: string, count: number) => void;
  /** Drop one session (pty exited / tab closed). */
  clear: (sessionId: string) => void;
}

export const useSubagents = create<SubagentsState>((set) => ({
  byId: {},
  apply: (sessionId, count) =>
    set((s) => {
      const next = count > 0 ? count : 0;
      if ((s.byId[sessionId] ?? 0) === next) return s;
      const byId = { ...s.byId };
      if (next === 0) delete byId[sessionId];
      else byId[sessionId] = next;
      return { byId };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

/**
 * Per-child sub-agent records keyed by parent session id (A3 — the addressable
 * version of {@link useSubagents}'s count). Mirrors that slice: its own channel
 * + store slice so a start/stop never rebuilds the status/session selectors
 * (render-storm guard). Backs the named child nodes under each Squad Flow
 * parent; entries with no children are dropped (the count badge is the
 * fallback). Pushed as the full array per session (not deltas), so `apply` is a
 * trivial replace.
 */
interface SubagentChildrenState {
  byId: Record<string, SubagentChild[]>;
  /** Replace one session's child list. Drops the entry when empty. */
  apply: (sessionId: string, children: SubagentChild[]) => void;
  /** Drop one session (pty exited / tab closed). */
  clear: (sessionId: string) => void;
}

export const useSubagentChildren = create<SubagentChildrenState>((set) => ({
  byId: {},
  apply: (sessionId, children) =>
    set((s) => {
      if (!children || children.length === 0) {
        if (!(sessionId in s.byId)) return s;
        const byId = { ...s.byId };
        delete byId[sessionId];
        return { byId };
      }
      return { byId: { ...s.byId, [sessionId]: children } };
    }),
  clear: (sessionId) =>
    set((s) => {
      if (!(sessionId in s.byId)) return s;
      const byId = { ...s.byId };
      delete byId[sessionId];
      return { byId };
    })
}));

interface InboxSelectionState {
  selectedEntryId: string | null;
  select: (id: string | null) => void;
}

export const useInboxSelection = create<InboxSelectionState>((set) => ({
  selectedEntryId: null,
  select: (id) => set({ selectedEntryId: id })
}));

interface InboxReadState {
  /** Object-shaped (not Set) so Zustand `persist` can JSON-serialise it. */
  readIds: Record<string, true>;
  markRead: (id: string) => void;
  markUnread: (id: string) => void;
  /** Reserved for an explicit "Mark all read" affordance — not auto-fired. */
  markAllRead: (ids: string[]) => void;
  /** Drop read flags for the given ids (entry removed or evicted by retention). */
  pruneRead: (removedIds: string[]) => void;
}

export const useInboxRead = create<InboxReadState>()(
  persist(
    (set) => ({
      readIds: {},
      markRead: (id) =>
        set((s) => (s.readIds[id] ? s : { readIds: { ...s.readIds, [id]: true } })),
      markUnread: (id) =>
        set((s) => {
          if (!s.readIds[id]) return s;
          const next = { ...s.readIds };
          delete next[id];
          return { readIds: next };
        }),
      markAllRead: (ids) =>
        set((s) => {
          if (ids.length === 0) return s;
          const next = { ...s.readIds };
          for (const id of ids) next[id] = true;
          return { readIds: next };
        }),
      pruneRead: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.readIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { readIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-read.v1', version: 1 }
  )
);

interface InboxAnsweredState {
  /**
   * Entries the user has replied to via the inbox reply box. Object-shaped
   * (not Set) so Zustand `persist` can JSON-serialise it. Mirrors
   * `useInboxRead` — read and answered are independent axes (an entry can be
   * read but unanswered, or answered which implies read).
   */
  answeredIds: Record<string, true>;
  markAnswered: (id: string) => void;
  /** Drop answered flags for the given ids (entry removed or evicted). */
  pruneAnswered: (removedIds: string[]) => void;
}

export const useInboxAnswered = create<InboxAnsweredState>()(
  persist(
    (set) => ({
      answeredIds: {},
      markAnswered: (id) =>
        set((s) =>
          s.answeredIds[id] ? s : { answeredIds: { ...s.answeredIds, [id]: true } }
        ),
      pruneAnswered: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.answeredIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { answeredIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-answered.v1', version: 1 }
  )
);

interface SchedulerLiveState {
  tasks: ScheduledTask[];
  loading: boolean;
}

export const useScheduler = create<SchedulerLiveState>(() => ({
  tasks: [],
  loading: true
}));

interface GoalsLiveState {
  goals: Goal[];
  loading: boolean;
}

/**
 * Live goal list — driven by the `goals:onChanged` push from the main process,
 * which fires after every CRUD action, every iteration spawn, and every
 * evaluator verdict. Like {@link useScheduler}, the panel never polls.
 */
export const useGoals = create<GoalsLiveState>(() => ({
  goals: [],
  loading: true
}));

interface FollowUpsLiveState {
  followups: FollowUp[];
  loading: boolean;
}

/**
 * Live follow-up list — driven by the `followups:onChanged` push from the main
 * process, which fires after every CRUD action and every idle-triage →
 * follow-up bridge. Like {@link useGoals}, the panel never polls.
 */
export const useFollowUps = create<FollowUpsLiveState>(() => ({
  followups: [],
  loading: true
}));

/**
 * Auto-update state — driven by the `updates:onStatus`/`onProgress` pushes from
 * the main process (electron-updater). `progress` is only meaningful while
 * `status.kind === 'downloading'`.
 */
interface UpdatesLiveState {
  status: UpdateStatus;
  progress: UpdateProgress | null;
}

export const useUpdates = create<UpdatesLiveState>(() => ({
  status: { kind: 'idle' },
  progress: null
}));

/**
 * "What's New" modal state. `notes` are the curated release-notes docs to show;
 * `open` gates the modal. Opened two ways: automatically on first launch after
 * an update (the boot `consumeWhatsNew` pull, which also advances the seen
 * baseline in main), or on demand from the About tab (`openWhatsNewAll`). Kept
 * separate from `useUpdates` so the modal is independent of the live updater
 * status stream.
 */
interface WhatsNewState {
  open: boolean;
  notes: ReleaseNote[];
  /** Heading context — the version range this batch covers, when known. */
  toVersion: string | null;
  openWith(notes: ReleaseNote[], toVersion: string | null): void;
  close(): void;
}

export const useWhatsNew = create<WhatsNewState>((set) => ({
  open: false,
  notes: [],
  toVersion: null,
  openWith(notes, toVersion) {
    if (notes.length === 0) return;
    set({ open: true, notes, toVersion });
  },
  close() {
    set({ open: false });
  }
}));

/**
 * Open the What's New modal with ALL bundled release notes (the About-tab
 * on-demand path — no version clamp). Best-effort: a read failure or an empty
 * set simply doesn't open the modal.
 */
export async function openWhatsNewAll(): Promise<void> {
  try {
    const notes = await product.updates.getReleaseNotes();
    useWhatsNew.getState().openWith(notes, notes[0]?.version ?? null);
  } catch {
    // Degrade closed — the About tab keeps its "View on GitHub" fallback link.
  }
}

/**
 * First-run dependency-doctor state — driven by `deps:onStatus`/`onProgress`
 * pushes from the main process. `status` is the full setup snapshot (every
 * tracked dependency + its phase); `progress` is the most recent per-step
 * install log line, keyed by dependency id (cleared when a fresh status lands).
 */
interface SetupLiveState {
  status: SetupStatus;
  /** Latest install log line per dependency id (for the spinner caption). */
  progress: Record<string, string>;
}

export const useSetup = create<SetupLiveState>(() => ({
  status: { busy: false, items: [] },
  progress: {}
}));

/**
 * Whether the setup checklist has anything worth showing — any dependency that
 * is missing or failed to install. Gates the first-run auto-open and the
 * Sidebar/Settings affordance.
 */
export function hasMissingSetup(status: SetupStatus): boolean {
  return status.items.some((i) => i.phase === 'missing' || i.phase === 'failed');
}

/**
 * Session-scoped dismissal for the update banner. The banner's data (whether an
 * update is available / downloading / downloaded, and the target version) comes
 * straight from `useUpdates` (the electron-updater status stream). This slice
 * only tracks the per-session "I clicked ×" choice — a persisted "skip this
 * version" goes through `product.updates.skip`, which the updater honors
 * across launches. Kept tiny and separate so the banner can hide without
 * disturbing the shared updater status the About section also reads.
 */
interface UpdateBannerState {
  dismissed: boolean;
  dismiss: () => void;
  /** Re-show (e.g. a newer version arrives after an earlier dismiss). */
  reset: () => void;
}

export const useUpdateBanner = create<UpdateBannerState>((set) => ({
  dismissed: false,
  dismiss() {
    set({ dismissed: true });
  },
  reset() {
    set({ dismissed: false });
  }
}));

/**
 * Single source of truth for "is the update banner showing". Both the banner
 * component (its render gate) and App.tsx (which reserves the shell grid row)
 * call this, so the row can't reserve space without a banner or vice-versa.
 */
export function isUpdateBannerVisible(kind: UpdateStatus['kind'], dismissed: boolean): boolean {
  if (dismissed) return false;
  return kind === 'available' || kind === 'downloading' || kind === 'downloaded';
}

/**
 * Saved inbox reports — live mirror of `~/.zcc/saved/`. Full-list
 * replacement on every `saved:onChanged` push (low volume), like useScheduler.
 */
interface SavedLiveState {
  records: SavedRecord[];
  loading: boolean;
}

export const useSaved = create<SavedLiveState>(() => ({
  records: [],
  loading: true
}));

/**
 * Which saved report is open in the detail pane. Mirrors {@link
 * useInboxSelection} — the Saved tab's list drives it, the detail pane reads it.
 * A separate store (not shared with the inbox selection) so switching tabs
 * preserves each side's own selection.
 */
interface SavedSelectionState {
  selectedSavedId: string | null;
  selectSaved: (id: string | null) => void;
}

export const useSavedSelection = create<SavedSelectionState>((set) => ({
  selectedSavedId: null,
  selectSaved: (id) => set({ selectedSavedId: id })
}));

/**
 * Inter-agent mesh, read-only mirror for the Agents board: the live discovery
 * registry (`agents`) and the agent↔agent message history (`messages`). Kept in
 * its own store — distinct from `useInbox` (agent→User) and from `useData`'s
 * session list. Registry changes re-fetch the whole list (cheap, like
 * `useSaved`); messages prepend per push. `setAll`/`prependMessage` are called
 * from the boot subscriptions in `initApp`.
 */
interface AgentMeshState {
  agents: AgentRecord[];
  messages: AgentMessage[];
  setAgents: (agents: AgentRecord[]) => void;
  setMessages: (messages: AgentMessage[]) => void;
  prependMessage: (msg: AgentMessage) => void;
  /** Drop messages evicted by main's retention sweep (the onMessagesPruned push). */
  removeMessages: (removedIds: string[]) => void;
}

export const useAgentMesh = create<AgentMeshState>((set) => ({
  agents: [],
  messages: [],
  setAgents: (agents) => set({ agents }),
  setMessages: (messages) => set({ messages }),
  prependMessage: (msg) =>
    set((s) =>
      s.messages.some((m) => m.id === msg.id) ? s : { messages: [msg, ...s.messages] }
    ),
  removeMessages: (removedIds) =>
    set((s) => {
      if (removedIds.length === 0) return s;
      const drop = new Set(removedIds);
      const next = s.messages.filter((m) => !drop.has(m.id));
      return next.length === s.messages.length ? s : { messages: next };
    })
}));

/**
 * Per-inbox-entry "saved" marker, persisted to localStorage (mirrors
 * useInboxAnswered). Lets the detail view show a "Saved ✓" state without
 * scanning the saved records for a matching sourceEntryId on every render.
 */
interface SavedMarkState {
  savedEntryIds: Record<string, true>;
  markSaved: (entryId: string) => void;
  /** Drop saved-marks for the given ids (entry removed or evicted). */
  pruneSaved: (removedIds: string[]) => void;
}

export const useSavedMark = create<SavedMarkState>()(
  persist(
    (set) => ({
      savedEntryIds: {},
      markSaved: (entryId) =>
        set((s) =>
          s.savedEntryIds[entryId]
            ? s
            : { savedEntryIds: { ...s.savedEntryIds, [entryId]: true } }
        ),
      pruneSaved: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.savedEntryIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { savedEntryIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-saved.v1', version: 1 }
  )
);

/**
 * The persisted identity of a starred agent. We key on `claudeSessionId` when
 * present, NOT the live `session.id`: `session.id` is an ephemeral UUID minted
 * fresh on every pty spawn (and a restored tab gets a brand-new one — see
 * sessionRestore.ts), so a star keyed on it could never survive a relaunch. The
 * `claudeSessionId` is the conversation id we force with `--session-id` and
 * resume with `--resume <id>`, so it's STABLE across restart — a restored agent
 * comes back carrying the same one, and its star reattaches. Non-claude agents
 * (no claudeSessionId) fall back to `session.id`: they aren't restored anyway,
 * so the star is session-scoped for them, matching the old behavior.
 */
export function favoriteKey(s: { id: string; claudeSessionId?: string }): string {
  return s.claudeSessionId ?? s.id;
}

/**
 * Starred ("favorite") agents — a set of {@link favoriteKey}s the user has
 * flagged to follow, surfaced in the right-edge Favorites drawer. Persisted to
 * localStorage (like the inbox-saved store) so the set survives relaunch, and
 * wired into {@link installInboxCrossWindowSync} so starring in one window
 * reflects in every other open window. A starred key whose agent isn't
 * currently live is simply filtered out at render (the badge count uses the
 * same live intersection, so the two can't diverge); a restored agent that
 * comes back with the same `claudeSessionId` keeps its star.
 *
 * v2: the key scheme changed from the ephemeral `session.id` to {@link
 * favoriteKey}. Old v1 entries are session-id-keyed and can never match a
 * restored agent, so the migration drops them (the user re-stars — they were
 * already non-functional across restart, which is the bug this fixes).
 */
interface FavoriteAgentsState {
  favoriteIds: Record<string, true>;
  toggleFavorite: (key: string) => void;
}

export const useFavoriteAgents = create<FavoriteAgentsState>()(
  persist(
    (set) => ({
      favoriteIds: {},
      toggleFavorite: (key) =>
        set((s) => {
          const next = { ...s.favoriteIds };
          if (next[key]) delete next[key];
          else next[key] = true;
          return { favoriteIds: next };
        })
    }),
    {
      name: 'zcc.favorite-agents.v1',
      version: 2,
      // v1 → v2: drop the old session-id-keyed set (incompatible + unrecoverable).
      migrate: () => ({ favoriteIds: {} })
    }
  )
);

/**
 * Library docs — live mirror of both scopes (global + per-project). Full-list
 * replacement on every `library:onChanged` push (low volume), like useScheduler.
 * CRITICAL: expose the raw `docs` slice — do NOT add selectors that return fresh
 * `?? []` / `.filter()` arrays (infinite-loop trap, see `zustand-selector-stable-ref`).
 */
interface LibraryLiveState {
  docs: LibraryDoc[];
  loading: boolean;
}

export const useLibrary = create<LibraryLiveState>(() => ({
  docs: [],
  loading: true
}));

/**
 * Per-inbox-entry "Keep" flag (star), persisted to localStorage like the other
 * inbox marker stores. A kept entry is protected from "Clear inbox" — it's the
 * user's explicit "don't sweep this away" signal, independent of read/answered/
 * saved. Toggleable (unlike the one-way markers) since keep is a user decision
 * they may reverse.
 */
interface InboxKeepState {
  keptIds: Record<string, true>;
  toggleKeep: (entryId: string) => void;
  /** Drop keep flags for ids no longer present (housekeeping after a clear). */
  pruneKeep: (presentIds: string[]) => void;
  /** Drop keep flags for the given REMOVED ids (entry deleted or evicted). */
  pruneKeptByIds: (removedIds: string[]) => void;
}

export const useInboxKeep = create<InboxKeepState>()(
  persist(
    (set) => ({
      keptIds: {},
      toggleKeep: (entryId) =>
        set((s) => {
          const next = { ...s.keptIds };
          if (next[entryId]) delete next[entryId];
          else next[entryId] = true;
          return { keptIds: next };
        }),
      pruneKeep: (presentIds) =>
        set((s) => {
          const present = new Set(presentIds);
          const next: Record<string, true> = {};
          let changed = false;
          for (const id of Object.keys(s.keptIds)) {
            if (present.has(id)) next[id] = true;
            else changed = true;
          }
          return changed ? { keptIds: next } : s;
        }),
      pruneKeptByIds: (removedIds) =>
        set((s) => {
          let changed = false;
          const next = { ...s.keptIds };
          for (const id of removedIds) {
            if (next[id]) {
              delete next[id];
              changed = true;
            }
          }
          return changed ? { keptIds: next } : s;
        })
    }),
    { name: 'zcc.inbox-keep.v1', version: 1 }
  )
);

/**
 * Persisted inbox subgroup-collapse state. The sidebar groups entries by time
 * bucket → project; this remembers which (bucket, project) subgroups the user
 * folded so expanding "Today / my-project" doesn't auto-expand "Yesterday /
 * my-project". Keyed by `subGroupKey(bucket, projectId)`.
 *
 * The render layer also AUTO-folds a project whose entries are all read (an
 * implicit default); this store only records EXPLICIT user toggles, so an
 * explicit choice always wins over the all-read default (see InboxSidebar).
 */
interface InboxCollapsedState {
  /** Explicitly user-toggled subgroup keys → their collapsed bool. Absence means
   *  "no explicit choice" → fall back to the all-read auto-fold default. */
  byKey: Record<string, boolean>;
  /** Flip one subgroup key's explicit collapsed state. */
  toggle: (key: string) => void;
  /** Set every given subgroup key's explicit state at once (header collapse-all). */
  setMany: (keys: string[], collapsed: boolean) => void;
}

export const useInboxCollapsed = create<InboxCollapsedState>()(
  persist(
    (set) => ({
      byKey: {},
      toggle: (key) =>
        set((s) => ({
          byKey: { ...s.byKey, [key]: !s.byKey[key] }
        })),
      setMany: (keys, collapsed) =>
        set((s) => {
          if (keys.length === 0) return s;
          const next = { ...s.byKey };
          for (const key of keys) next[key] = collapsed;
          return { byKey: next };
        })
    }),
    { name: 'zcc.inbox-collapsed.v2', version: 2 }
  )
);

/**
 * Persisted collapse state for the agent detail panel — the right-hand rail that
 * shows one agent's facts + transcript insights beside its live terminal. Two
 * independent surfaces host it (the List-view monitor and the agent-inspector
 * modal), so each remembers its own preference under a distinct key: collapsing
 * the panel in the modal shouldn't fold the monitor's rail and vice-versa.
 * Collapsed gives the terminal the width; the choice sticks across reloads.
 */
interface AgentPanelState {
  /** Per-surface collapsed bit. Absence ⇒ expanded (the default). */
  collapsed: Record<'monitor' | 'modal', boolean>;
  toggle: (surface: 'monitor' | 'modal') => void;
}

export const useAgentPanel = create<AgentPanelState>()(
  persist(
    (set) => ({
      collapsed: { monitor: false, modal: false },
      toggle: (surface) =>
        set((s) => ({ collapsed: { ...s.collapsed, [surface]: !s.collapsed[surface] } }))
    }),
    { name: 'zcc.agent-panel.v1', version: 1 }
  )
);

/**
 * The Inbox "AI Summary" card state, keyed by scope: `'__all__'` for the
 * cross-project digest, else a projectId for the focused/scoped digest. Each
 * scope caches its last digest plus the inbox-content `signature` it was
 * generated from, so we only spend a (paid) micro-call when the inbox actually
 * changed and the prior digest has gone stale. In-memory only — a digest is
 * cheap to regenerate and a persisted one would just show stale on next launch.
 */
const ALL_SCOPE_KEY = '__all__';
/** Minimum gap between AUTOMATIC (view-driven) regenerations of one scope, so an
 *  inbox that's churning doesn't trigger a call on every push. A manual refresh
 *  (the card's button) bypasses this. 10 min mirrors the "every X minutes if
 *  changed" cadence without a background timer — the card asks when viewed. */
export const INBOX_SUMMARY_AUTO_MIN_MS = 10 * 60_000;

export interface InboxSummaryCacheItem {
  digest: InboxDigest | null;
  /** Epoch ms of the last successful generation, or null if never generated. */
  generatedAt: number | null;
  loading: boolean;
  /** 'empty' (nothing to summarize) | 'failed' | null. Drives the card's fallback. */
  error: 'empty' | 'failed' | null;
  /** Inbox-content signature the cached digest reflects (see inboxContentSignature). */
  signature: string;
}

interface InboxSummaryState {
  byScope: Record<string, InboxSummaryCacheItem>;
  setItem: (scopeKey: string, patch: Partial<InboxSummaryCacheItem>) => void;
}

export const useInboxSummary = create<InboxSummaryState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        digest: null,
        generatedAt: null,
        loading: false,
        error: null,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

export const scopeKeyFor = (projectId: string | null): string => projectId ?? ALL_SCOPE_KEY;

/**
 * A stable signature of the inbox entries in a scope — id + timestamp +
 * occurrence count per entry. Changes whenever an entry is added, removed, or
 * coalesced (which bumps ts/occurrences), so it's exactly "did the inbox change
 * in a way worth re-summarizing". Order-independent count + a cheap join keep it
 * O(n) without hashing. Pure.
 */
export function inboxContentSignature(entries: InboxEntry[]): string {
  if (entries.length === 0) return '0';
  // entries are newest-first and stable-ordered; join is enough (no sort needed).
  let sig = `${entries.length}:`;
  for (const e of entries) sig += `${e.id}@${e.ts}#${e.occurrences ?? 1};`;
  return sig;
}

/**
 * Run the inbox-summary micro-call for one scope and fold the result into the
 * cache. Sets `loading` around the call. Never throws (the IPC resolves to a
 * tagged result). `signature` is stamped so a later staleness check can tell the
 * digest still reflects the current inbox.
 */
export async function refreshInboxSummary(
  projectId: string | null,
  signature: string
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { setItem } = useInboxSummary.getState();
  setItem(scopeKey, { loading: true });
  try {
    const res = await product.inbox.summarize(projectId);
    if (res.ok) {
      setItem(scopeKey, {
        digest: res.digest,
        generatedAt: Date.now(),
        loading: false,
        error: null,
        signature
      });
    } else {
      setItem(scopeKey, {
        loading: false,
        error: res.reason === 'empty' ? 'empty' : 'failed',
        // Stamp the signature even on a soft failure so we don't hammer the model
        // on every render for an inbox that simply can't be summarized yet.
        signature
      });
    }
  } catch {
    setItem(scopeKey, { loading: false, error: 'failed', signature });
  }
}

/**
 * View-driven, throttled auto-refresh of a scope's AI summary. Called by the
 * card when the Inbox is open: regenerates only when (a) not already loading,
 * (b) the inbox content changed since the cached digest (or there is none), and
 * (c) it's been at least {@link INBOX_SUMMARY_AUTO_MIN_MS} since the last
 * generation. This is the "regenerate every X minutes if things changed" rule
 * without a background timer — nothing runs while the user isn't looking.
 */
export function maybeRefreshInboxSummary(projectId: string | null, entries: InboxEntry[]): void {
  const scopeKey = scopeKeyFor(projectId);
  const item = useInboxSummary.getState().byScope[scopeKey];
  if (item?.loading) return;
  const signature = inboxContentSignature(entries);
  const unchanged = item && item.signature === signature && item.generatedAt !== null;
  if (unchanged) return; // inbox hasn't changed since last (success OR soft-fail)
  // Throttle automatic regens: if we generated recently, wait — a manual refresh
  // bypasses this by calling refreshInboxSummary directly.
  if (item?.generatedAt && Date.now() - item.generatedAt < INBOX_SUMMARY_AUTO_MIN_MS) return;
  void refreshInboxSummary(projectId, signature);
}

/* ------------------------------------------------------------------------- *
 * Feed-noise classifier overlay — the OPTIONAL "Routine" demotion.          *
 * ------------------------------------------------------------------------- *
 * Mirrors {@link useInboxSummary}: an advisory, per-scope cache of the entry
 * ids main judged routine, keyed by the same {@link inboxContentSignature} so a
 * stable inbox never re-spends tokens. NON-PERSISTED — recomputed each session,
 * applied only as a grouping overlay ({@link groupByBucketThenProject}'s
 * `routineIds`). Gated by `feedNoiseClassifierEnabled`; when off, the hook never
 * fetches and the overlay stays empty (every report inline). */
export interface FeedNoiseCacheItem {
  /** Ids to demote into the folded "Routine" section. */
  routineIds: Set<string>;
  generatedAt: number | null;
  loading: boolean;
  /** Inbox-content signature the cached verdict reflects. */
  signature: string;
}

interface FeedNoiseState {
  byScope: Record<string, FeedNoiseCacheItem>;
  setItem: (scopeKey: string, patch: Partial<FeedNoiseCacheItem>) => void;
}

export const useFeedNoise = create<FeedNoiseState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        routineIds: new Set<string>(),
        generatedAt: null,
        loading: false,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

/**
 * Run the feed-noise classify call for one scope and fold the id set into the
 * cache. Never throws (the IPC resolves to `{ routineIds: [] }` on failure).
 */
export async function refreshFeedNoise(
  projectId: string | null,
  signature: string
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { setItem } = useFeedNoise.getState();
  setItem(scopeKey, { loading: true });
  try {
    const res = await product.inbox.classifyNoise(projectId);
    setItem(scopeKey, {
      routineIds: new Set(res.routineIds),
      generatedAt: Date.now(),
      loading: false,
      signature
    });
  } catch {
    // Degrade to "nothing demoted" — the overlay is advisory, never load-bearing.
    setItem(scopeKey, { routineIds: new Set(), loading: false, signature });
  }
}

/**
 * View-driven, throttled refresh of a scope's routine overlay — the classifier
 * twin of {@link maybeRefreshInboxSummary}, same discipline: only when enabled,
 * not already loading, the inbox changed since the cached verdict, and it's been
 * at least {@link INBOX_SUMMARY_AUTO_MIN_MS} since the last run. When disabled it
 * is a no-op (and the caller ignores the empty overlay).
 */
export function maybeRefreshFeedNoise(
  projectId: string | null,
  entries: InboxEntry[],
  enabled: boolean
): void {
  if (!enabled) return;
  const scopeKey = scopeKeyFor(projectId);
  const item = useFeedNoise.getState().byScope[scopeKey];
  if (item?.loading) return;
  const signature = inboxContentSignature(entries);
  const unchanged = item && item.signature === signature && item.generatedAt !== null;
  if (unchanged) return;
  if (item?.generatedAt && Date.now() - item.generatedAt < INBOX_SUMMARY_AUTO_MIN_MS) return;
  void refreshFeedNoise(projectId, signature);
}

/* ------------------------------------------------------------------------- *
 * Detailed inbox digest — backs the "Details" modal on the AI Summary card. *
 * ------------------------------------------------------------------------- *
 * Unlike the short card digest, the detailed one is ON-DEMAND ONLY: it is
 * never background-warmed (no standing pre-warm justification for the deeper,
 * pricier call). It's cached per scope keyed by the same
 * {@link inboxContentSignature}, so reopening the modal while the inbox hasn't
 * changed is free; a content change (or a manual regen) re-fetches. */
export interface DetailedInboxSummaryCacheItem {
  digest: DetailedInboxDigest | null;
  generatedAt: number | null;
  loading: boolean;
  error: 'empty' | 'failed' | null;
  /** Inbox-content signature the cached digest reflects (see inboxContentSignature). */
  signature: string;
}

interface DetailedInboxSummaryState {
  byScope: Record<string, DetailedInboxSummaryCacheItem>;
  setItem: (scopeKey: string, patch: Partial<DetailedInboxSummaryCacheItem>) => void;
}

export const useInboxDetailedSummary = create<DetailedInboxSummaryState>((set) => ({
  byScope: {},
  setItem: (scopeKey, patch) =>
    set((s) => {
      const prev = s.byScope[scopeKey] ?? {
        digest: null,
        generatedAt: null,
        loading: false,
        error: null,
        signature: ''
      };
      return { byScope: { ...s.byScope, [scopeKey]: { ...prev, ...patch } } };
    })
}));

/**
 * Run the detailed inbox-summary micro-call for one scope and fold the result
 * into the cache. Sets `loading` around the call; loading-guarded so a double
 * open can't fire two calls. Never throws (the IPC resolves to a tagged result).
 * `force` bypasses the signature cache-hit check (the modal's "regenerate").
 */
export async function refreshDetailedInboxSummary(
  projectId: string | null,
  signature: string,
  force = false
): Promise<void> {
  const scopeKey = scopeKeyFor(projectId);
  const { byScope, setItem } = useInboxDetailedSummary.getState();
  const item = byScope[scopeKey];
  if (item?.loading) return;
  // Cache hit: same inbox content since the last successful gen → nothing to do.
  if (!force && item?.digest && item.signature === signature && item.generatedAt !== null) return;
  setItem(scopeKey, { loading: true });
  try {
    const res = await product.inbox.summarizeDetailed(projectId);
    if (res.ok) {
      setItem(scopeKey, {
        digest: res.digest,
        generatedAt: Date.now(),
        loading: false,
        error: null,
        signature
      });
    } else {
      setItem(scopeKey, {
        loading: false,
        error: res.reason === 'empty' ? 'empty' : 'failed',
        signature
      });
    }
  } catch {
    setItem(scopeKey, { loading: false, error: 'failed', signature });
  }
}

/**
 * Usage / cost dashboard state (WARP R2 B7). Holds the last {@link UsageSummary}
 * fetched from main, plus a loading flag. The summary is a whole-workspace
 * rollup (not scoped), so a single cached value is enough — the panel calls
 * {@link UsageState.refresh} on mount and on an explicit refresh click.
 */
interface UsageState {
  summary: UsageSummary | null;
  loading: boolean;
  /** True once a fetch has completed at least once (so we can tell "not loaded
   *  yet" from "loaded an empty summary"). */
  loaded: boolean;
  refresh: () => Promise<void>;
}

export const useUsage = create<UsageState>((set, get) => ({
  summary: null,
  loading: false,
  loaded: false,
  refresh: async () => {
    // De-dupe concurrent refreshes (mount effect + a click can race).
    if (get().loading) return;
    set({ loading: true });
    try {
      // getSummary never throws — main resolves to an empty summary on failure.
      const summary = await product.usage.getSummary();
      set({ summary, loading: false, loaded: true });
    } catch {
      // Defensive: even if the bridge itself rejects, don't wedge the panel.
      set({ loading: false, loaded: true });
    }
  }
}));

/**
 * Prune every persisted per-entry marker for a set of removed/evicted entry ids.
 * Called from the inbox `onRemoved` (single delete) and `onPruned` (retention
 * eviction) subscriptions so the read/answered/saved/keep localStorage maps
 * don't accumulate dead ids as inbox history rolls over. A no-op per store when
 * none of the ids were marked (each pruner returns the same state ref).
 */
export function pruneInboxMarkers(removedIds: string[]): void {
  if (removedIds.length === 0) return;
  useInboxRead.getState().pruneRead(removedIds);
  useInboxAnswered.getState().pruneAnswered(removedIds);
  useSavedMark.getState().pruneSaved(removedIds);
  useInboxKeep.getState().pruneKeptByIds(removedIds);
}

/**
 * Cross-window sync for the inbox user-state stores. These four are Zustand
 * `persist` stores backed by localStorage, which is shared across every window
 * of the app (same origin) — but `persist` only READS localStorage at boot, so
 * a change made in one window (e.g. marking an entry read in a per-project
 * window) wouldn't reach an already-open main window until it reloaded.
 *
 * The browser `storage` event fires in OTHER windows when localStorage changes
 * (never in the window that made the write), so re-hydrating the matching store
 * on that event keeps read / answered / saved / kept state live across windows.
 * Call once at app init; returns an unsubscribe.
 */
const INBOX_PERSIST_STORES: Record<string, { persist: { rehydrate: () => void | Promise<void> } }> = {
  'zcc.inbox-read.v1': useInboxRead,
  'zcc.inbox-answered.v1': useInboxAnswered,
  'zcc.inbox-saved.v1': useSavedMark,
  'zcc.inbox-keep.v1': useInboxKeep,
  // Not strictly inbox state, but the same localStorage-only persist store that
  // wants to stay live across windows — starring an agent in one window should
  // update the Favorites drawer in every other window.
  'zcc.favorite-agents.v1': useFavoriteAgents,
  // Agent detail-panel collapse: keep the folded/expanded rail consistent across
  // windows so the terminal-vs-details split doesn't jump when you switch.
  'zcc.agent-panel.v1': useAgentPanel
};

export function installInboxCrossWindowSync(): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (!e.key) return; // null key ⇒ storage.clear(); ignore
    const store = INBOX_PERSIST_STORES[e.key];
    if (store) void store.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

interface ScheduleTemplatesState {
  templates: ScheduleTemplate[];
  loading: boolean;
}

export const useScheduleTemplates = create<ScheduleTemplatesState>(() => ({
  templates: [],
  loading: true
}));

interface PersonasState {
  personas: Persona[];
  loading: boolean;
}

/**
 * Launchable personas — fed from `zcc.personas.list` on boot and refreshed by
 * the main process's `personas:onChanged` push (same one-shot + push pattern as
 * useScheduleTemplates). Read-only in the renderer; authoring is by editing the
 * JSON files the "Reveal" action opens.
 */
export const usePersonas = create<PersonasState>(() => ({
  personas: [],
  loading: true
}));

interface TeamsState {
  teams: Team[];
  loading: boolean;
}

/**
 * Launchable teams — fed from `cc.teams.list` on boot and refreshed by the main
 * process's `teams:onChanged` push (same one-shot + push pattern as
 * usePersonas). Read-only in the renderer; authoring is by the editor / the JSON
 * files the "Reveal" action opens.
 */
export const useTeams = create<TeamsState>(() => ({
  teams: [],
  loading: true
}));

interface AutonomousRunsState {
  runs: AutonomousRun[];
}

/**
 * In-memory autonomous team runs, fed from `cc.autonomousRuns.list` on boot and
 * refreshed by the main process's `autonomousRuns:onChanged` push. Runs are
 * live-only (die with the app), so there is no persistence here.
 */
export const useAutonomousRuns = create<AutonomousRunsState>(() => ({
  runs: []
}));

interface ScheduleGroupsState {
  groups: ScheduleGroup[];
  loading: boolean;
}

export const useScheduleGroups = create<ScheduleGroupsState>(() => ({
  groups: [],
  loading: true
}));

interface PluginsLiveState {
  entries: PluginEntry[];
  loading: boolean;
}

export const usePlugins = create<PluginsLiveState>(() => ({
  entries: [],
  loading: true
}));

interface McpLiveState {
  entries: McpServerEntry[];
  loading: boolean;
}

export const useMcpCatalogue = create<McpLiveState>(() => ({
  entries: [],
  loading: true
}));

/**
 * Sidebar/titlebar notification count for inbox: unread entries whose feed
 * category is SIGNAL we want to actively notify about (`question` or `report`).
 * Everything else (goal outcomes + folded/noise categories) stays in inbox but
 * does not increment the notification badge.
 */
/**
 * The project the inbox is currently scoped to, or `null` for all-projects.
 * A per-project WINDOW (hard URL lock via {@link getScopedProjectId}) wins;
 * absent that, the MAIN WINDOW's `focusedProjectId` (soft, store-driven focus).
 * This is the inbox twin of {@link isProjectFocusedView} — when the shell is
 * drilled into one project, the inbox shows only that project's entries.
 */
export function useInboxScopeProjectId(): string | null {
  const focusedProjectId = useUi((s) => s.focusedProjectId);
  return getScopedProjectId() ?? focusedProjectId;
}

export function useUnreadInboxCount(): number {
  const entries = useInbox((s) => s.entries);
  const readIds = useInboxRead((s) => s.readIds);
  // Scope to the focused/scoped project so the badge tracks exactly what the
  // Inbox view shows. A scoped window's `entries` are already project-filtered
  // at the source (see init); a focused main window holds every project's
  // entries, so this filter is what actually narrows the count there.
  const scopeProjectId = useInboxScopeProjectId();
  let n = 0;
  for (const e of entries) {
    if (scopeProjectId && e.projectId !== scopeProjectId) continue;
    if (readIds[e.id]) continue;
    const category = classifyEntry(e);
    if (category !== 'question' && category !== 'report') continue;
    n += 1;
  }
  return n;
}

/** Sidebar-badge count: scheduled tasks that are enabled (armed to fire). */
export function useEnabledSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  let n = 0;
  for (const t of tasks) if (t.enabled) n += 1;
  return n;
}

/**
 * Sidebar-badge count: scheduled tasks with a live terminal session right
 * now. Mirrors the "Running now" computation in SchedulerOverview — a task
 * counts as running when any of its run-history records points at a session
 * that is still `running`/`starting` in the project's terminals.
 */
export function useRunningSchedulerCount(): number {
  const tasks = useScheduler((s) => s.tasks);
  const terminals = useData((s) => s.terminals);
  const live = new Set<string>();
  for (const [pid, list] of Object.entries(terminals)) {
    for (const s of list) {
      if (s.status === 'running' || s.status === 'starting') {
        live.add(`${pid}:${s.id}`);
      }
    }
  }
  let n = 0;
  for (const t of tasks) {
    for (const r of t.status?.runs ?? []) {
      if (r.sessionId && live.has(`${t.projectId}:${r.sessionId}`)) {
        n += 1;
        break;
      }
    }
  }
  return n;
}

/** Sidebar-badge count: goals that are armed (status `active`) right now. */
export function useActiveGoalCount(): number {
  const goals = useGoals((s) => s.goals);
  let n = 0;
  for (const g of goals) if (g.status === 'active') n += 1;
  return n;
}

/** Sidebar-badge count: open (unresolved) follow-ups across all projects. */
export function useOpenFollowUpCount(): number {
  const followups = useFollowUps((s) => s.followups);
  let n = 0;
  for (const f of followups) if (f.status === 'open') n += 1;
  return n;
}

/** Count of `active` goals for ONE project — backs the per-project Goals tab badge. */
export function useProjectActiveGoalCount(projectId: string): number {
  const goals = useGoals((s) => s.goals);
  let n = 0;
  for (const g of goals) if (g.projectId === projectId && g.status === 'active') n += 1;
  return n;
}

/**
 * Count of schedules that spawn a terminal in ONE project — backs the
 * per-project Scheduler tab badge. Counts by `t.projectId` (the spawn target),
 * NOT `t.source` (where the JSON lives), so a global-scoped schedule that runs
 * in this project is still counted here. Matches the per-project SchedulerPanel
 * filter.
 */
export function useProjectScheduleCount(projectId: string): number {
  const tasks = useScheduler((s) => s.tasks);
  let n = 0;
  for (const t of tasks) if (t.projectId === projectId) n += 1;
  return n;
}

/**
 * Count of live plain SHELL terminals in ONE project — backs the per-project
 * Terminals tab badge. Deliberately counts only `profile === 'shell'` sessions
 * (the Agents badge, `useAgentNavCounts`, owns the agent profiles), so this
 * badge answers "do I have a plain terminal still running here?" without
 * double-counting a working/blocked agent. Uses `listedTerminals` (drops
 * scheduler jobs) and keeps only non-exited sessions, matching the "live" set
 * the Terminals view treats as running.
 */
export function useProjectRunningTerminalCount(projectId: string): number {
  const terminals = useData((s) => s.terminals);
  return liveTerminals(terminals[projectId]).filter((t) => t.profile === 'shell').length;
}

/** Count of `open` follow-ups for ONE project — backs the per-project Follow-ups tab badge. */
export function useProjectOpenFollowUpCount(projectId: string): number {
  const followups = useFollowUps((s) => s.followups);
  let n = 0;
  for (const f of followups) if (f.projectId === projectId && f.status === 'open') n += 1;
  return n;
}

/**
 * Sidebar-badge counts for the Agents nav item. `active` is every agent that
 * is working or blocked right now (headless included — same set the Agents
 * board surfaces); `blocked` is how many of those need the user. The Agents nav
 * shows `active` as the badge and reds it when `blocked`. Reads the same two
 * stores the Agents board does (terminals + agent status).
 *
 * Scope: a per-project WINDOW (hard URL lock via {@link getScopedProjectId})
 * always wins; absent that, an explicit `projectId` narrows the count to one
 * project (the {@link ProjectScopedNav} rail, which heads a per-project Agents
 * board). With neither, it counts the whole fleet across every project (the
 * global {@link Sidebar}). This mirrors {@link useInboxScopeProjectId}: the
 * scoped-rail badge must track exactly what its scoped board shows, not the
 * fleet — otherwise a project-focused rail reads the whole fleet's count.
 */
export function useAgentNavCounts(projectId?: string): { active: number; blocked: number } {
  const terminals = useData((s) => s.terminals);
  const byId = useAgentStatus((s) => s.byId);
  const scopeProjectId = getScopedProjectId() ?? projectId ?? null;
  const lists = scopeProjectId
    ? [terminals[scopeProjectId] ?? []]
    : Object.values(terminals);
  let active = 0;
  let blocked = 0;
  for (const list of lists) {
    for (const session of list) {
      // A `shell` tab is not an agent — the Agents board / list exclude it, so
      // the "Agents" badge must too, or a shell that happens to emit a spinner
      // (npm install, a manually-launched claude) would be counted as "working"
      // here while showing zero rows in the list it heads. Match the list.
      if (session.profile === 'shell') continue;
      const state = byId[session.id];
      if (state === 'blocked') {
        active += 1;
        blocked += 1;
      } else if (state === 'working') {
        active += 1;
      }
    }
  }
  return { active, blocked };
}

/**
 * Optimistic delete + IPC. Called from the detail view's trash button and
 * the Delete/Backspace shortcut. Removes locally first so the UI doesn't
 * lag the IPC round-trip; the main process's onRemoved push echoes back
 * and is a no-op (already filtered out).
 */
export async function deleteInboxEntry(id: string): Promise<void> {
  useInbox.getState().removeLocal(id);
  try {
    await product.inbox.delete(id);
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to delete inbox entry'));
  }
}

/**
 * Clear the inbox, preserving entries the user has flagged "Keep" (star).
 *
 * We compute the explicit list of ids to REMOVE from the current visible
 * entries minus the kept set — never "keep only these" — so the main store
 * deletes exactly what the user saw, and any entry appended after this call
 * survives. Optimistic local removal first, then one bulk IPC. Returns the
 * number removed (0 when there was nothing to clear).
 */
export async function clearInbox(projectId?: string | null): Promise<number> {
  const { entries, removeManyLocal } = useInbox.getState();
  const { keptIds } = useInboxKeep.getState();
  // When scoped to a project (focused/scoped view), only clear that project's
  // entries — the button's count and the view already reflect that scope.
  const toRemove = entries
    .filter((e) => !keptIds[e.id] && (!projectId || e.projectId === projectId))
    .map((e) => e.id);
  if (toRemove.length === 0) return 0;

  removeManyLocal(toRemove);
  try {
    await product.inbox.deleteMany(toRemove);
    useUi.getState().pushToast(
      `Cleared ${toRemove.length} ${toRemove.length === 1 ? 'message' : 'messages'}`,
      'info'
    );
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to clear inbox'));
  }
  return toRemove.length;
}

/** Toggle the "Keep" flag on an entry (protects it from Clear inbox). */
export function toggleInboxKeep(entryId: string): void {
  useInboxKeep.getState().toggleKeep(entryId);
}

/**
 * Save an inbox report for later reuse. The caller (InboxDetail) assembles the
 * `SavedRecordInput` — it already holds the resolved project + freshly-read doc
 * snapshots — and this just persists it via IPC, marks the source entry saved
 * (so the UI can show "Saved ✓"), and toasts. Main returns null on failure.
 */
export async function saveInboxEntry(
  input: SavedRecordInput,
  sourceEntryId?: string
): Promise<boolean> {
  try {
    const rec = await product.saved.save(input);
    if (!rec) throw new Error('save returned null');
    if (sourceEntryId) useSavedMark.getState().markSaved(sourceEntryId);
    useUi.getState().pushToast('Saved for later', 'info');
    return true;
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to save report'));
    return false;
  }
}

/** Delete a saved report by id. The onChanged push reconciles the list. */
export async function deleteSavedRecord(id: string): Promise<void> {
  try {
    await product.saved.delete(id);
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to delete saved report'));
  }
}

/**
 * Reply to an inbox entry's originating terminal — the write-back half of the
 * inbox question/answer loop. The agent pushes a question via `inbox_push`
 * (stamped with its sessionId); this sends the user's answer straight to that
 * pty's stdin, so the conversation continues without leaving the inbox.
 *
 * If the session is headless (e.g. a background scheduled run), we DON'T
 * promote it to a visible tab — replying in place is the whole point. The
 * "Open in session" button remains the explicit promotion path. We mark the
 * entry answered (localStorage, mirrors read-state) and toast confirmation.
 *
 * Returns true on success. A dead session (pty already exited) is reported as
 * an error toast and returns false — the caller's UI already shows a tombstone
 * in that case, so this is the belt-and-braces path for a race.
 */
export async function replyToInboxEntry(
  entryId: string,
  sessionId: string,
  text: string
): Promise<boolean> {
  const body = text.trim();
  if (!body) return false;
  try {
    // The pty reply is best-effort but NOT always deliverable: `terminals.reply`
    // resolves false when the target pty already exited (the agent died between
    // the question landing in the inbox and the user answering). Don't claim
    // success or mark the entry answered in that case — surface it so the user
    // reopens the agent (resume/fresh) instead of losing the reply silently.
    const delivered = await product.terminals.reply(sessionId, body);
    if (!delivered) {
      pushErrorToast('Agent is no longer running — reopen it to continue.');
      return false;
    }
    useInboxAnswered.getState().markAnswered(entryId);
    useUi.getState().pushToast('Reply sent', 'info');
    return true;
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to send reply'));
    return false;
  }
}

/** How a follow-up's answer was delivered — drives the caller's toast + navigation. */
export interface FollowUpAnswerResult {
  ok: boolean;
  /** Which tier fired: injected into a live tab, resumed the transcript, or a fresh spawn. */
  tier?: 'inject' | 'resume' | 'spawn';
  /** The live/created session to navigate to (absent for the inject tier when it stays headless). */
  session?: TerminalSession | null;
  /** The follow-up's project (so the caller can navigate without re-looking-up). */
  project?: Project;
}

/**
 * Answer a follow-up — the write-back half of the Follow-ups question loop, the
 * durable twin of {@link replyToInboxEntry} + the inbox three-tier reopen. The
 * agent parked a question via `followup_create` (or it was bridged from idle);
 * this delivers the human's answer to the RIGHT agent, best-to-worst:
 *
 *  1. **inject** — the originating pty is still alive → send the answer to its
 *     stdin (`terminals.reply`), exactly like an inbox reply. No new tab.
 *  2. **resume** — the tab is gone but the origin captured a resumable claude
 *     transcript → spawn `claude --resume <id> <answer>`: the answer lands as the
 *     next turn in the exact conversation that asked, full history intact.
 *  3. **spawn** — no resumable transcript (user-filed / non-claude / legacy) →
 *     spawn a FRESH agent seeded with the question AND the answer so it can act.
 *
 * On success the follow-up is marked resolved with the answer as its resolution
 * (tiers 2/3 also `markSpawned` for the in-progress lock). Returns a result the
 * caller uses to toast + navigate. The originating session id / resume coords are
 * host-stamped on the follow-up (Rule 1) — this never trusts renderer state for
 * the reopen target beyond what main already authorized.
 */
export async function answerFollowUp(
  followUp: FollowUp,
  answer: string
): Promise<FollowUpAnswerResult> {
  const body = answer.trim();
  if (!body) return { ok: false };
  const project = useData.getState().projects.find((p) => p.id === followUp.projectId);
  if (!project) {
    pushErrorToast('Answer failed: this follow-up’s project is no longer registered.');
    return { ok: false };
  }

  const origin = followUp.origin;
  const originSessionId = origin.source !== 'user' ? origin.sessionId : undefined;
  const resume = origin.source !== 'user' ? origin.resume : undefined;

  // Tier 1 — inject into the live originating tab if it's still running (not a
  // tombstoned/exited pty, which would silently drop the write).
  const liveOrigin = originSessionId
    ? (useData.getState().terminals[followUp.projectId] ?? []).find(
        (t) => t.id === originSessionId && t.status !== 'exited'
      )
    : undefined;

  try {
    if (liveOrigin) {
      const delivered = await product.terminals.reply(liveOrigin.id, body);
      if (!delivered) {
        // Raced: the agent died between parking and answering. Fall through to
        // the resume/spawn tiers rather than losing the answer silently.
      } else {
        await markFollowUpAnswered(followUp.id, body);
        useUi.getState().pushToast(`Answer sent to ${liveOrigin.title}`, 'info');
        return { ok: true, tier: 'inject', session: liveOrigin, project };
      }
    }

    // Tier 2 — resume the exact conversation, delivering the answer as its next
    // turn. Only when the origin captured a claude transcript id + a claude-family
    // profile to relaunch on (the resume coords are host-stamped — Rule 1).
    const resumeProfile = knownProfile(resume?.profile) ?? 'claude';
    const canResume = !!resume?.claudeSessionId && isClaudeProfile(resumeProfile);
    if (canResume) {
      const created = await useData.getState().createTerminal(project.id, resumeProfile, 80, 24, {
        // `--resume <id>` as extraArgs + the answer as the positional prompt →
        // `claude --resume <id> <answer>` (persona-store appends prompt last).
        extraArgs: ['--resume', resume!.claudeSessionId!],
        prompt: body,
        personaId: resume?.personaId,
        cwd: resume?.cwd,
        title: `↺ ${followUpAgentTitle(followUp)}`
      });
      if (created) {
        await markFollowUpAnswered(followUp.id, body);
        void product.followups.markSpawned(followUp.id);
        useUi.getState().pushToast('Resumed the agent with your answer', 'info');
        return { ok: true, tier: 'resume', session: created, project };
      }
      // createTerminal already toasted its failure; don't double-report.
      return { ok: false };
    }

    // Tier 3 — fresh agent seeded with the question + the answer so it can act on
    // the decision the human just made.
    const freshProfile =
      knownProfile(resume?.profile) ?? projectDefaultProfile(project);
    const created = await useData.getState().createTerminal(project.id, freshProfile, 80, 24, {
      prompt: buildFollowUpAnswerPrompt(followUp, body),
      personaId: resume?.personaId,
      profileSource: resume?.profile ? undefined : 'seeded-default',
      cwd: resume?.cwd,
      title: `↺ ${followUpAgentTitle(followUp)}`
    });
    if (created) {
      await markFollowUpAnswered(followUp.id, body);
      void product.followups.markSpawned(followUp.id);
      useUi.getState().pushToast('Spawned an agent with your answer', 'info');
      return { ok: true, tier: 'spawn', session: created, project };
    }
    return { ok: false };
  } catch (err) {
    pushErrorToast(errorMessage(err, 'Failed to send answer'));
    return { ok: false };
  }
}

/**
 * Resolve a follow-up recording the human's answer as its resolution — the
 * common tail of every {@link answerFollowUp} tier. Best-effort: the answer was
 * already delivered to the agent, so a failed status write only means the record
 * stays open (it doesn't undo the delivery), and we surface it quietly.
 */
async function markFollowUpAnswered(id: string, answer: string): Promise<void> {
  try {
    const resolution = answer.length > 140 ? `${answer.slice(0, 139)}…` : answer;
    const result = await product.followups.setStatus(id, 'resolved', resolution);
    if (!result.ok) {
      useUi.getState().pushToast(`Answer sent, but marking resolved failed: ${result.message}`, 'error');
    }
  } catch {
    /* delivery already succeeded — a failed resolve is non-fatal */
  }
}
