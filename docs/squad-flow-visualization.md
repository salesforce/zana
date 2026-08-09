# Issue: Squad Flow Visualization — see the squad and who's working right now

**Status:** Ready to implement. Designed by the `feature-squad` native team (architect + 2 backend devs); blocked from self-implementing in the host session (see [Why this is a doc, not a diff](#why-this-is-a-doc-not-a-diff)).

**Branch context:** authored on `feat/launcher-squad-picker`. Independent of the existing launcher squad-*picker* work already on that branch — this is the runtime *flow view*, a different feature.

---

## What the user asked for

> "when running a squad i want some way to visualize the squad and who is working right now basically seeing the flow of the squad"

Three things, concretely:
1. **Who exists** in a running squad (the roster).
2. **Who is working right now** (live per-agent status).
3. **The flow** — the handoffs between squad members, rendered as a directed graph.

## What this delivers

A new **`flow` view mode** in the existing Agents board (alongside `board` kanban and `list` mesh). For each running squad it renders the orchestrator→worker graph: nodes are agents (label + live status dot), edges are directed handoffs (agent→agent messages), with the most-recent handoff highlighted so the "flow" reads visually. Empty state when no squad is running.

This reuses the app's existing live data — it is **not** a new persistent store.

---

## Why this is a doc, not a diff

The `feature-squad` team ran to completion at the *design* level but could not write code in the host Claude Code session, for two environment reasons:

1. **Background subagents can't get write permission.** Both backend devs investigated the codebase and produced exact change-sets, then blocked asking for `Write`/`Edit` approval — which can't be granted to a backgrounded agent non-interactively.
2. **`SendMessage` is disabled in this session.** The native-team auto-handoff (`architect → devs → reviewer`) can't propagate; the host had to route each stage manually.

**To implement via the squad as intended:** re-run with agents that have `Write`/`Edit` permission and with `SendMessage` enabled, then hand them this doc. Each track below is self-contained and codes against the shared contract, so the two backend devs can run in parallel on disjoint files.

---

## Context discovered (existing code the design builds on)

The app already tracks everything a squad-flow view needs; it just isn't grouped *by squad*:

| Need | Existing source |
|------|-----------------|
| Who exists | `agentRegistry` (`AgentRecord[]` keyed by `sessionId`) — `src/main/agent-registry-store.ts`, surfaced via `agents:list` (`src/main/index.ts:1724`) |
| Who's working now | `AgentStatusTracker` (`src/main/agent-status.ts`) → renderer `useAgentStatus.byId` (`working`/`blocked`/`done`/`idle`/`unknown`), pushed over `terminals:onAgentStatus` |
| The flow / handoffs | `agentMessageLog` (`src/main/agent-message-log.ts`) — agent→agent audit trail via `agents:messages` + `agents:onMessage`; each `AgentMessage` has `fromSessionId`/`fromHandle` → `toSessionId`/`toHandle` |
| Existing UI surface | `GlobalAgentsBoard` (`src/renderer/components/GlobalAgentsBoard.tsx`) — kanban (`board`) + `list` mode (`AgentMeshPanel`), toggled by `AgentViewToggle` reading `useUi.agentsBoardView` (`'board' | 'list'`, persisted via `config.agentsBoardView`). `AgentMeshPanel.tsx` already renders agents-with-status + message edges — **closest prior art.** |

**The one genuinely new piece of data is *squad membership*** — grouping live agent sessions into the squad they belong to. Track A computes that grouping + the flow edges; Track B renders the graph.

### Rule-6 compliance (hard requirement)
Core must never branch on the literal string `'zana'` in logic (enforced by `src/renderer/__tests__/rule6-zana-literal.guard.test.ts`). Squad identity must ride **host-stamped metadata + the generic message graph** — never a string-match on `/zana:team` or `'zana'`. User-facing UI text is fine; logic branches are not.

---

## Shared contract (both tracks code against this — keep identical)

Track A authors these in `src/shared/types.ts`; Track B imports them.

```ts
/** One agent node in a running squad's live flow graph. */
export interface SquadFlowNode {
  sessionId: string;            // un-forgeable pty session id (graph node key)
  handle?: string;              // authoritative @handle if registered
  displayName?: string;         // live tab title (drifts) — fallback label
  role?: string;                // e.g. "architect", "backend-dev" (registry-supplied)
  projectId: string;
  /** True for the agent that launched/orchestrates the squad. */
  isOrchestrator: boolean;
  /** Live agent state; main fuses it in at read time from AgentStatusTracker.
   *  Renderer overlays its own live useAgentStatus value on top of this seed. */
  state: AgentState;            // 'working' | 'blocked' | 'done' | 'idle' | 'unknown'
}

/** One directed handoff edge (a message that flowed between two squad members). */
export interface SquadFlowEdge {
  id: string;                   // = AgentMessage.id (stable, dedupe key)
  fromSessionId: string;
  toSessionId: string;
  ts: number;                   // epoch ms
  delivered: boolean;           // AgentMessage.deliveredAt !== undefined
}

/** A running squad and its live membership + flow. */
export interface SquadFlow {
  /** Squad instance key. Host-derived, NEVER a hardcoded literal (Rule 6).
   *  Falls back to the orchestrator's sessionId when no squad id was captured. */
  squadKey: string;
  squadId?: string;             // squad template id if host-stamped at launch
  squadName?: string;
  projectId: string;
  nodes: SquadFlowNode[];
  edges: SquadFlowEdge[];
  lastActivityAt: number;       // wall-clock of most recent node/edge activity
}
```

IPC channel — new `squadFlow:` group in `src/shared/ipc.ts`, kept **off** the existing `squads:` daemon-template-lister group:

```ts
squadFlow: {
  list: 'squadFlow:list',          // invoke → Promise<SquadFlow[]> (one-shot snapshot)
  onChanged: 'squadFlow:onChanged' // payload-less push → renderer re-fetches list()
}
```

Preload bridge in `src/preload/index.ts` (mirror the existing `agents` bridge):
- `window.cc.squadFlow.list(): Promise<SquadFlow[]>`
- `window.cc.squadFlow.onChanged(cb): () => void`

**Contract semantics both sides agree on:**
- `list()` returns a full in-memory snapshot (cheap). `onChanged` is a **payload-less ping** → renderer re-fetches `list()` (exact pattern of `agents:onChanged`). Avoids edge-trigger races.
- `state` in the snapshot is a **seed**; the renderer overlays `useAgentStatus.byId[sessionId]` so dots stay live without waiting for `onChanged`.
- Empty array when no squad is running. **Never throws** (`safeHandle` with `() => []` onError, like `agents:list`).
- A "running squad" = a group of ≥1 live registry records sharing a `squadKey`. A solo non-squad agent is **not** returned (it already shows in the normal board).

---

## Track A — main / IPC / data layer (backend-dev)

**Owns:** `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/main/*`. **Does not touch** any `src/renderer/**` file.

1. **Capture squad identity at launch (Rule-6-clean).** In the launch/pty seam where the `/zana:team <id>` body is assembled, capture the squad id into **host-controlled launch metadata** (do not re-parse the command string in core logic later). Thread it to `agentRegistry.upsert` as new optional **host-stamped** fields `squadId?: string` / `squadName?: string` on `AgentRecord` (host-stamped only, never accepted from the agent — same trust rule as `sessionId`/`cwd`). Investigate `src/main/pty.ts` + `LaunchPanel.tsx`'s `onLaunch` / `terminals:create` handler for the cleanest capture point.
2. **Build the aggregator** — new `src/main/squad-flow-store.ts`, a **read-time projection** (not a long-lived store) joining:
   - `agentRegistry.list()` → nodes (with host-stamped squadId/role),
   - `agentStatusTracker.get(sessionId)` → fused `state` at read time (never store stale status),
   - `agentMessageLog.history(projectId)` → edges, filtered so **both** endpoints are squad members.
   - Group by `squadKey` (see [open fork](#open-design-fork-squad-identity)); mark `isOrchestrator` = node carrying the squadId (or the component root). **Rule 5:** cap edges per squad (newest ≤200) and cap squad count.
3. **Wire IPC** in `src/main/index.ts`: `safeHandle(IPC.squadFlow.list, () => buildSquadFlows(...), () => [])`. Emit `IPC.squadFlow.onChanged` (payload-less, via `safeSend`) from `agentRegistry.onChanged`, `agentMessageLog.onAppended`, and the agent-status change event — **coalesce/debounce** bursts into one ping. **Subscribe once at app init (Rule 3); release on shutdown.**
4. **Add** the IPC group, preload bridge, and shared types per the contract.
5. **Tests** (mirror `src/main/__tests__/*`): unit-test the aggregator — grouping, orchestrator detection, edge filtering, caps — with fabricated registry/log/status inputs. Keep `squad-flow-store.ts` free of any `'zana'` literal (Rule-6 guard must stay green).

---

## Track B — renderer visualization (backend-dev-2)

**Owns:** new `src/renderer/components/SquadFlowView.tsx`, a new store slice in `src/renderer/store.ts`, the `AgentViewToggle` extension, and CSS in `src/renderer/styles/global.css`. **Does not touch** `src/main/**`, `src/shared/**`, `src/preload/**` (imports `SquadFlow*` from `@shared/types`).

1. **Add a `useSquadFlow` store slice** in `src/renderer/store.ts` (mirror `useAgentMesh`): `{ squads: SquadFlow[], setSquads }`. In the boot-wiring block (next to `agents.onRegistryChanged`), do a one-shot `window.cc.squadFlow.list()` then subscribe `onChanged` → re-fetch. Best-effort try/catch (leave empty on failure), like the mesh block.
2. **Build `SquadFlowView`.** For each running squad: orchestrator node at top/left, worker nodes connected by **directed** edges. Each node shows label (`handle ?? displayName ?? sessionId` — reuse the `prettyHandle` helper from `AgentMeshPanel.tsx`) and a live status dot (existing `tab-agent-dot agent-${state}` classes). **Overlay live status:** read `useAgentStatus((s) => s.byId)` and prefer it over the node's seed `state`. Highlight/animate the most-recent edge (`lastActivityAt`). Presentational + reactive only. Empty state ("No squads running") when `squads` is empty.
   - **Layout:** lightweight CSS/SVG layered layout (orchestrator → worker columns + connectors). **Do not add a graph library** unless trivially justified — check `package.json` first. Reuse `lucide-react` icons already imported (`Users`, `ArrowRight`, `Network`, `Workflow`, `GitBranch`).
3. **Add a third view mode.** Extend `AgentsBoardView` to `'board' | 'list' | 'flow'` in `store.ts` (and the config-load guard where the persisted value is validated), add a `flow` option to `AgentViewToggle.tsx` (icon e.g. `Workflow`/`GitBranch`), and render `<SquadFlowView />` in `GlobalAgentsBoard.tsx` when `boardView === 'flow'`.
4. **Styling:** add `squad-flow-*` classes to `src/renderer/styles/global.css`. **Do not reuse `gus-*` classes** (CLAUDE.md coupling note — they also style the live gus panel and core Tickets view). Reusing `tab-agent-dot agent-*` status dots is fine (shared status vocabulary).
5. **Tests:** component test rendering a fabricated `SquadFlow[]` → asserts nodes/edges/orchestrator marker render **and** that a `useAgentStatus` override wins over the seed `state`.

---

## Open design fork: squad identity

**Undecided — needs an owner call before/at implementation.** How a live agent session is grouped into its squad:

- **Hybrid (suggested):** host-stamp `squadId` at launch **and** fall back to the message-graph connected-component. Works even when agents don't message each other (e.g. `SendMessage` disabled, as in the originating session). Slightly more code in the launch seam.
- **Message-graph only:** group by connected components of the agent message log. Rule-6-clean and self-organizing, but renders an **empty graph** when agents don't message each other.
- **Launch-stamp only:** group purely by a launch-captured squad id. Precise, but agents not launched with that metadata won't group, and the capture point may be awkward.

> Risk note: a pure message-graph approach can over-group if unrelated agents message across squads, and shows nothing in message-less sessions. Launch-stamping is the more robust anchor; the message-graph is the good fallback. The architect leaned message-graph for Rule-6 cleanliness; the host flagged that hybrid avoids the empty-graph failure mode. **Left open per owner's "skip."**

---

## Critical files

- `src/main/agent-registry-store.ts`
- `src/main/agent-status.ts`
- `src/main/agent-message-log.ts`
- `src/main/index.ts`
- `src/renderer/components/AgentMeshPanel.tsx` (prior art)
- `src/renderer/components/GlobalAgentsBoard.tsx`
- `src/renderer/components/AgentViewToggle.tsx`
- Shared boundary: `src/shared/types.ts`, `src/shared/ipc.ts`, `src/preload/index.ts`, `src/renderer/store.ts`

## Trade-offs & assumptions (from the architect)

- **Read-time projection vs. persistent store:** chose projection — all inputs already live in stores with change events; avoids a third source of truth that can go stale.
- **Assumption:** squad workers register in the existing `agentRegistry` (real Claude sessions/peers). Daemon-side workers that never hit the local registry would not appear — acceptable for v1; note it in the UI/empty state if needed.
