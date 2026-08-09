# Squad Flow Visualization — Architecture Plan (Frontend Squad run, 2026-06-21)

**Provenance:** Produced by a native `frontend-squad` run via `/zana:team` (architect →
ux-designer → 2× frontend-dev). Only the **architect** completed real work — the
`ux-designer` and both `frontend-dev` workers came to rest waiting for a handoff,
because **`SendMessage` is not available in this Claude Code session** (the native-team
auto-handoff cannot propagate). This file captures the architect's full plan so it
survives the transcript.

> Companion to [`squad-flow-visualization.md`](./squad-flow-visualization.md) — the
> *prior* squad's design of the same feature. The two agree on the core shape (live
> mesh + message-graph projection, new `flow` view mode, Rule-6 cleanliness, no `gus-*`
> reuse). This run's architect additionally pins down a recommended derivation strategy
> (renderer-derived) and a precise `SquadFlowGraph` contract.

---

## Goal

A runtime "Squad Flow" view that shows, for a running squad/team:
1. **Roster** — which subagents (members) the squad has
2. **Live status** — who is working right now (working / blocked / idle / done)
3. **Handoff flow** — the directed graph of who-handed-off-to-whom

## Critical finding (load-bearing)

- **Squad rosters** (`SquadSummary` from `daemon-team-store.ts`, sourced from
  `~/.zana/teams/*.json`) are **design-time templates only** — read-only metadata
  (id, name, icon, description, workerCount). They carry no per-member identity and
  there is **no runtime link** from a squad template to the live sessions running it.
- **Live "who is running"** comes from two independent main-side stores fused at read time:
  - `AgentRegistryStore` (`agent-registry-store.ts`) — live sessions with
    `handle`/`role`/`capabilities`, keyed by `sessionId`. The roster of live peers.
  - `AgentStatusTracker` (`agent-status.ts`) — per-session `AgentState`
    (`working`/`blocked`/`done`/`idle`/`unknown`), streamed over `onAgentStatus`.
- **Sub-agents (Task tool spawns)** are tracked as a **bare count only**. The hook route
  `/hook/subagent/:projectId/:sessionId/:start|stop` (`mcp-server.ts:415`,
  `matchSubagentHookRoute`) carries **no subagent type/name/description** —
  `onSubagentHook(projectId, sessionId, 'start'|'stop')`. So "which subagents" cannot mean
  "which Task sub-agent types" without a hook-payload change.
- **Handoff flow** has a real signal: `AgentMessageLog` (`agent-message-log.ts`) records
  every agent→agent `agent_send` as
  `AgentMessage { fromSessionId, fromHandle, toSessionId, toHandle, projectId, body, ts, deliveredAt }`.
  This is the directed-edge source. A handoff edge is literally `fromHandle → toHandle`.

### Decision: what "squad flow" means at runtime

Because squad templates have no runtime member binding, the smallest honest design is:

> **The "squad" we visualize is the live agent mesh, optionally scoped to a project (one
> project = one running squad).** Nodes = registered/live agents
> (`AgentRegistryStore` ∪ live terminal sessions), node status = `AgentStatusTracker`
> state, edges = `AgentMessageLog` traffic aggregated into handoff counts. The squad
> *template* (`SquadSummary`) is surfaced as an optional header descriptor — "this
> project is running the `feature-squad` squad (6 workers expected, 4 live)" — but the
> graph is built from runtime signals, not the template.

No new persistence, no new hook, no Rule-6 violation (never branch on the literal
`'zana'`; squad listing already goes through the `squads.list` IPC, a clean read of
`~/.zana/teams`).

---

## Architecture overview

```
~/.zana/teams/*.json ──(read)──► daemon-team-store ──► squads.list (existing)
                                                            │
AgentRegistryStore ──┐                                      │
AgentStatusTracker ──┼──(fuse in main)──► squad-flow-builder ──► IPC squadFlow.get / onChanged
AgentMessageLog    ──┘                                      │
                                                            ▼
                                          preload bridge ──► useSquadFlow store slice
                                                            │
                                                            ▼
                                          SquadFlowPanel (graph) + SquadFlowToggle
```

Two derivation strategies; **Strategy B (renderer-derived) recommended for v1** because all
three inputs already stream to the renderer and a main-side builder would duplicate state.

- **Strategy A (main-derived):** new `squad-flow-builder.ts` fuses the three stores and
  emits a `SquadFlowGraph` over a new IPC channel. Cleaner contract, but duplicates state
  already in the renderer and adds churn-prone wiring.
- **Strategy B (renderer-derived) — RECOMMENDED:** the renderer already has `useAgentMesh`
  (agents + messages), `useAgentStatus`, `useSubagents`. A pure memoized selector
  `selectSquadFlow(projectId)` builds the `SquadFlowGraph` from existing slices. Track A's
  only job becomes the shared types + a verification test.

The contract is **identical regardless of strategy**, so both tracks proceed in parallel
against the type and the builder location can swap later.

---

## Shared TypeScript contract (both tracks code against this)

Add to `src/shared/types.ts`. (`AgentState`, `AgentRecord`, `AgentMessage`, `SquadSummary`
already exist — reuse, do not redefine.)

```ts
/**
 * One node in the Squad Flow graph: a live (or recently-exited) agent in the
 * mesh, scoped to one project ("squad"). Fused at build time from the agent
 * registry (identity), the status tracker (live state), and the live session
 * list (title / liveness). NEVER persisted — rebuilt from live signals.
 */
export interface SquadFlowNode {
  sessionId: string;            // un-forgeable session id — stable key (= AgentRecord.sessionId)
  label: string;                // handle ?? displayName ?? sessionId (see agentLabel())
  handle?: string;              // authoritative handle if registered
  displayName?: string;         // live tab title (drifts); secondary line
  role?: string;
  capabilities?: string[];
  state: AgentState;            // live state fused from AgentStatusTracker (default 'unknown')
  stateSince?: number;          // epoch ms entered current state (for "working for 2m")
  liveSubagents: number;        // in-flight Task-tool sub-agents under this node (badge only)
  exited: boolean;              // backing pty exited — render faded, no edges in
  isOrchestrator: boolean;      // highest out-degree, tie-broken by earliest registeredAt (heuristic)
}

/**
 * One directed handoff edge, aggregated from AgentMessageLog traffic. Keyed by
 * sessionId pairs so it survives a handle rename mid-session.
 */
export interface SquadFlowEdge {
  fromSessionId: string;
  toSessionId: string;
  count: number;                // messages along this edge (line weight)
  lastTs: number;               // epoch ms of most recent message (recency highlight / fade)
  pending: boolean;             // latest message still queued (deliveredAt === undefined)
}

/**
 * The full runtime graph for one squad (= one project's live mesh). Built by
 * selectSquadFlow() in the renderer (Strategy B) or squad-flow-builder in main
 * (Strategy A) — identical shape either way.
 */
export interface SquadFlowGraph {
  projectId: string | null;     // scope; null = whole fleet across projects
  squad?: SquadSummary;         // template descriptor when project runs a known squad (loose match)
  nodes: SquadFlowNode[];
  edges: SquadFlowEdge[];
  summary: { total: number; working: number; blocked: number; idle: number; exited: number; };
  builtAt: number;              // epoch ms graph was built (one consistent "now")
}
```

Edges are keyed by `sessionId` pairs (not handles) because handles drift; the renderer maps
to labels at draw time via the node map. Node `label` uses the same fallback chain as
`agentLabel()` / the renderer's `prettyHandle()` in `AgentMeshPanel.tsx`.

---

## Track A — Main / IPC / Data layer

- **A0. Contract (do first, shared):** add the three interfaces to `src/shared/types.ts`.
  Unblocks Track B immediately.
- **A1. (Strategy B, recommended) Minimal main work.** Confirm the three streams already
  seed a freshly-opened window (they do): `agents.list` + `agents.onRegistryChanged`;
  `agents.messages` + `agents.onMessage` + `agents.onMessagesPruned`;
  `terminals.agentStatusSnapshot` + `onAgentStatus`; `terminals.subagentSnapshot` +
  `onSubagents`; `squads.list`. Deliverable: a read-only verification + unit test that
  `AgentMessageLog.history(projectId)` and `AgentRegistryStore.list(projectId)` expose every
  field the node/edge types need.
- **A2. (Strategy A, only if main-derived chosen) `src/main/squad-flow-builder.ts`:** pure
  `buildSquadFlow(deps, projectId): SquadFlowGraph`; new IPC `squadFlow.get` /
  `squadFlow.onChanged` wired in `index.ts` next to `agents:*`, debounced; subscribe once at
  app init (Rule 3), release on shutdown; add to `IPC`, `CcApi`, preload bridge.
  **Not recommended for v1** — duplicates renderer state for zero new data.
- **A3. (Phase 2, out of scope) True per-subagent nodes.** Widen `matchSubagentHookRoute` +
  `onSubagentHook` to carry `subagent_type`/`description`, add a per-session sub-agent
  registry, extend `SquadFlowNode` with child rows. The only path to literally "which Task
  subagents." Explicitly deferred.

**Files Track A touches:** `src/shared/types.ts` (A0), `src/main/__tests__/` (A1). Strategy A
only: `src/main/squad-flow-builder.ts`, `src/main/index.ts`, `src/shared/ipc.ts`,
`src/preload/index.ts`.

---

## Track B — Renderer visualization

- **B1. Selector `selectSquadFlow(projectId)`** — new pure helper in `src/renderer/store.ts`
  (or `src/renderer/util/squadFlow.ts`). Nodes: union of `useAgentMesh.agents` and live
  non-shell terminal sessions for the project; state from `useAgentStatus.byId`,
  `stateSince` from `useAgentStatus.since`, badge from `useSubagents.byId`, `exited` from
  `session.status === 'exited'`. Edges: aggregate `useAgentMesh.messages` (filtered to
  `projectId`) into `(fromSessionId,toSessionId)` buckets → `count`, `lastTs`, `pending`.
  `isOrchestrator`: highest out-degree, tie-broken by earliest `registeredAt`. `squad`:
  loose name match against `useData` squads list. **Must be `useMemo`'d over raw slices**
  (render-storm guard).
- **B2. `SquadFlowPanel.tsx`** — new component sibling to `AgentMeshPanel.tsx`, props
  `{ projectId?: string; fullView?: boolean }`. Header (squad name/icon + rollup), directed
  graph (nodes as status-colored cards reusing `tab-agent-dot agent-${state}`, weighted
  arrows, recent/pending edges highlighted), empty state, node click →
  `useUi.getState().openAgentModal(sessionId, projectId)`. **Graph layout + visual language
  is the UX designer's call.**
- **B3. View toggle.** Extend `AgentsBoardView` (`store.ts:113`) `'board' | 'list'` →
  `'board' | 'list' | 'flow'`; add a `'flow'` option (e.g. `Network` icon) to
  `AgentViewToggle.tsx` `OPTIONS`; render `<SquadFlowPanel fullView />` in
  `GlobalAgentsBoard.tsx` when `boardView === 'flow'`. Confirm `AppConfig.agentsBoardView`
  union / `persistAgentsBoardView` accepts the new value.
- **B4. Styling.** New `squad-flow-*` classes in `src/renderer/styles/global.css`. **Do NOT
  reuse `gus-*` or `agent-mesh-*` base classes** (CLAUDE.md coupling note). Reuse only the
  `tab-agent-dot agent-${state}` status dots.

**Files Track B touches:** `SquadFlowPanel.tsx` (new), `AgentViewToggle.tsx`,
`GlobalAgentsBoard.tsx`, `store.ts`, `global.css`. Optional: `src/renderer/util/squadFlow.ts`.

---

## Sequencing

1. **A0 (shared contract)** lands in `types.ts` — unblocks both tracks.
2. **Parallel:** Track B (B1 → B2 → B3 → B4) and Track A (A1 verification test). Meet only at
   the `SquadFlowGraph` type.
3. **UX designer** designs graph layout/colors against `SquadFlowGraph` (needs only A0).
4. Strategy A (A2) only if a main-authoritative graph is later wanted.

## Risks / unknowns / assumptions

- **"Which subagents" ambiguity (highest risk).** If the user means the *Task-tool
  sub-agents* a single agent spawns, that data does not exist at runtime today (count only).
  v1 interprets "subagents" as the squad's **member agents** and shows a sub-agent *count*
  badge per member. Design the node to host a future expandable "N sub-agents" badge so A3
  can slot in without a redesign.
- **Squad template → live session binding does not exist.** "One project = one running
  squad"; the template descriptor is surfaced loosely. Precise binding needs a spawn-time
  `squadId` stamp on `TerminalSession`/`AgentRecord` — a separate, larger change.
- **Edges require `agent_send` traffic.** An edge-less squad (members never message) is
  correct, not broken — design a clean "roster, no handoffs yet" state.
- **In-memory only.** Registry + message log do not persist across restart; the flow view is
  live-only.
- **Render-storm guard.** The selector MUST be memoized over raw slices; never fold
  status/subagent ticks into one combined slice.
- **Rule 6.** Nothing branches on the literal `'zana'`; `squads.list` is already a clean IPC
  seam. No quarantine needed.

### Critical files
- `src/shared/types.ts`
- `src/renderer/store.ts`
- `src/renderer/components/GlobalAgentsBoard.tsx`
- `src/renderer/components/AgentMeshPanel.tsx` (prior art)
- `src/main/agent-message-log.ts`
