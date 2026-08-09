# Autonomous Teams — Design Spec

**Date:** 2026-06-22
**Status:** Approved (design), pending implementation plan
**Branch context:** `feat/squad-flow-subagent-nodes`

## Goal

Add a persistent, reusable option in Zana Command Center to launch a **fully
autonomous team**: an orchestrator agent plus worker agents that talk to each
other (via the existing agent-mesh) and keep working until a stated **goal** is
reached, then stop and report. The user supplies the goal; the app keeps the
team engaged until the orchestrator declares the goal met.

This is **not** a one-off hand-spawned team — it is a first-class feature
surfaced in the app UI.

## Decisions (locked)

| Axis | Decision |
|---|---|
| Coordination | **Orchestrator-driven**: one orchestrator agent holds the goal, delegates to workers, judges progress, declares done. |
| Where it runs | **In-session / in-app** (real terminal tabs in this app), not the headless daemon autopilot. |
| Drive loop | **App-side supervisor** that re-nudges idle agents until the goal is reached (robust against premature idle). |
| Done signal | Orchestrator calls the **existing `close_session_with_summary`** MCP tool; supervisor treats the orchestrator session closing as "goal reached". No new MCP surface. |
| Stop conditions | Goal-reached (primary) **+** manual Stop button **+** max-rounds backstop **+** wall-clock timeout backstop **+** orchestrator-gone safety. All three backstops accepted. |
| Launch UI | **Agent view (`LaunchPanel`)**, project-scoped — via a `Single agent \| Autonomous team` mode toggle at the top. **Not** `TeamsPanel` (it is not project-specific, which the user explicitly disliked). |
| Observe/stop UI | The project-scoped agents board / `SquadFlowView` shows a run banner (goal + state) and a Stop button. |

## Why this is mostly wiring (reuse story)

The heavy machinery already exists in the codebase; this feature wires it
together plus one new run-lifecycle component:

- **Nudge loop** → `HeartbeatService` (`src/main/heartbeat.ts`) already watches
  idle agents, nudges them via `pty.reply`, caps consecutive nudges, skips
  agents delegating to sub-agents, and pushes an inbox notice on give-up. The
  new supervisor mirrors this proven pattern.
- **Idle detection** → `AgentStatusTracker` (`src/main/agent-status.ts`) already
  emits debounced per-session `working`/`blocked`/`idle` `status` events.
- **Nudge primitive** → `Ptys.reply(sessionId, text)` (`src/main/pty.ts:810`)
  injects a line "as if typed and Entered" (body + deferred CR).
- **Done + summary** → `close_session_with_summary` (`src/main/mcp-server.ts:296`)
  + the host-stamped `orchestratorSessions` set
  (`src/main/index.ts:841,917`) already exist.
- **Launch** → `launchTeam(teamId, projectId)` (`src/main/index.ts:857`) already
  opens orchestrator-first + worker tabs through the confined pty path.
- **Live visualization** → `SquadFlowView` (`src/renderer/components/SquadFlowView.tsx`)
  already renders the project's live agent mesh and the directed handoff graph.
- **Cross-agent messaging** → agents in separate tabs talk via the agent-mesh
  (`agent_send` / `agent_inbox`, audited in `AgentMessageLog`), which is exactly
  the traffic `SquadFlowView` draws. (Native `SendMessage` is NOT available
  across separate tabs — that only works between subagents inside one session —
  so the agent-mesh is the correct channel.)

## Architecture

```
LaunchPanel (agent view, scoped to project.id)
  │  mode = "Autonomous team"; user picks Team + types GOAL
  │  clicks "⚡ Launch autonomous team"
  ▼
window.cc.teams.launchAutonomous(teamId, projectId, goal)   ← NEW IPC
  ▼  main authorizes: team from store, project confined, goal trimmed+capped
launchTeam(teamId, projectId, { goal })   ← EXTENDED
  │   • prepends the goal to the orchestrator's opening prompt
  │   • returns launched session ids (today returns only a count)
  ▼
AutonomousRunSupervisor.start(run)   ← NEW (sibling of HeartbeatService)
  │   • holds the run: goal, orchestratorSessionId, workerSessionIds, limits
  │   • subscribes to AgentStatusTracker 'status' for its sessions
  │   • on idle (goal not done, not delegating) → pty.reply(goal-aware nudge)
  │   • on orchestrator pty 'exit' → goal reached → stop, close workers, summary→inbox
  │   • on max-rounds / timeout / manual stop → stop, inbox notice
  │   • emits autonomousRuns:onChanged
  ▼
SquadFlowView / agents board (project-scoped)
      run banner (goal + state) + Stop button
```

### Why a new supervisor rather than reusing `HeartbeatService` directly

`HeartbeatService` is gated on a **global master switch** + a **per-agent
opt-in** and nudges with a **generic configured message**. An autonomous run
must nudge **regardless of the global heartbeat config**, with a
**goal-aware message** (orchestrator vs worker variants), and it carries
**run-level** stop conditions (max-rounds, timeout, manual stop, orchestrator
exit = success) that heartbeat does not model. Building
`AutonomousRunSupervisor` as a sibling reuses the same primitives
(`AgentStatusTracker` stream + `pty.reply` + the consecutive-nudge cap pattern)
while leaving the generic heartbeat feature untouched (no regression).

## Data model

New types in `src/shared/types.ts`:

```ts
interface AutonomousRun {
  runId: string;
  teamId: string;
  projectId: string;
  goal: string;                         // length-capped, sanitized in main
  orchestratorSessionId: string;
  workerSessionIds: string[];
  state: 'running' | 'completed' | 'stopped' | 'failed';
  startedAt: number;
  endedAt?: number;
  rounds: number;                       // total nudges issued across the run
  stopReason?: 'goal-reached' | 'max-rounds' | 'timeout' | 'manual' | 'orchestrator-gone';
  limits: { maxRounds: number; timeoutMs: number };
  summary?: string;                     // orchestrator's close summary, when present
}
```

Runs are **in-memory only**, consistent with the existing agent registry /
message log (also live-only, do not survive an app restart). One run per
orchestrator session. A hard cap on concurrent runs bounds memory (Rule 5).

New config defaults in `AppConfig` (`src/shared/types.ts` + `src/main/store.ts`):

- `autonomousMaxRounds` — default **30** (0 disables the cap)
- `autonomousTimeoutMs` — default **45 min** (0 disables the timeout)
- `autonomousNudgeDelaySeconds` — idle delay before a nudge (reuse heartbeat-like default)

## Run lifecycle

### Start

1. `LaunchPanel` (autonomous-team mode) calls
   `window.cc.teams.launchAutonomous(teamId, project.id, goal)`. The Team list
   comes from `window.cc.teams.list()` (persona-slot ZCC Teams that
   `launchTeam` understands) — **not** the `squads.list()` daemon-squad picker.
2. Main validates: team looked up from the store (not trusted from renderer),
   project confined via the existing `createTerminalConfined` path, `goal`
   trimmed and length-capped (empty goal rejected).
3. Main calls the extended `launchTeam()` which **prepends the goal** to the
   orchestrator's opening prompt and **returns the launched session ids**.
   Orchestrator opening prompt (appended to the team's own `initialPrompt`):

   > Autonomous team run. **Goal:** `<goal verbatim>`. You are the orchestrator.
   > Delegate to your workers via `agent_send`, coordinate until the goal is
   > fully met, then call `close_session_with_summary` with a summary of what
   > was accomplished. Do not stop until the goal is met.

4. Main registers the run with `AutonomousRunSupervisor` and emits
   `autonomousRuns:onChanged`; the UI reflects "running".

### Drive loop (supervisor)

- Subscribe to `AgentStatusTracker` `status` events for the run's sessions.
- On a session going **`idle`** (goal not yet done, session not busy with
  sub-agents): after `autonomousNudgeDelaySeconds`, `pty.reply(sessionId, nudge)`
  with goal-aware text:
  - **orchestrator** → "The goal is `<goal>`. Keep delegating/coordinating; when
    it's fully met, call `close_session_with_summary`."
  - **worker** → "Continue toward the goal `<goal>`; check your inbox
    (`agent_inbox`) for the orchestrator's instructions."
  - Re-arm if it stays idle. **Never nudge a `blocked` agent** (it is at a
    permission / interactive prompt — reuse heartbeat's safety rule).
- Each nudge increments `run.rounds`.

### Stop conditions

| Condition | Trigger | Outcome |
|---|---|---|
| **Goal reached** (primary) | Orchestrator pty `exit` (it called `close_session_with_summary`) | `state='completed'`, `stopReason='goal-reached'`, close workers, summary → inbox |
| **Manual stop** | UI Stop button → `teams.stopAutonomous(runId)` | `state='stopped'`, `stopReason='manual'`, close all, inbox notice |
| **Max rounds** | `run.rounds >= limits.maxRounds` (default 30; 0 = off) | `state='stopped'`, `stopReason='max-rounds'`, inbox notice w/ partial status |
| **Wall-clock timeout** | `now - startedAt >= limits.timeoutMs` (default 45 min; 0 = off) | `state='stopped'`, `stopReason='timeout'`, inbox notice |
| **Orchestrator gone** | Orchestrator exits unexpectedly (non-zero / no summary) | `state='failed'`, `stopReason='orchestrator-gone'`, inbox notice |

**On any stop:** unsubscribe from status events, clear all timers, close the
run's worker sessions **by their specific session ids** via the `closeSession`
primitive (`src/main/mcp-server.ts:168` / the `Ptys` close path) — applied to
each `workerSessionIds` entry, regardless of idle state. (This is deliberately
*not* the `close_idle_agents` resolver, which only targets *idle* peers; an
autonomous stop must tear down every worker, busy or not.) Then release the
`orchestratorSessions` host-stamp, mark the run ended, and push **exactly one**
inbox entry summarizing the outcome (the orchestrator's summary on success;
partial status + reason otherwise).

## UI changes

### `LaunchPanel` (`src/renderer/components/LaunchPanel.tsx`) — launch entry point

- Add a `Single agent | ⚡ Autonomous team` **mode toggle** at the top.
- In **Autonomous team** mode:
  - Show a **Team picker** (from `window.cc.teams.list()`).
  - Relabel the prompt box to **"Goal"**.
  - Hide the Profile / Persona / Squad rows (not relevant to a team launch).
  - Button becomes **"⚡ Launch autonomous team"** → calls
    `launchAutonomous(teamId, project.id, goal)`.
- Single-agent mode is **unchanged** (pristine existing flow).
- Distinction preserved: the existing **Squad** picker (single agent running
  `/zana:team <id>` orchestrating daemon subagents in one session) is a separate
  control from the **Team** picker (orchestrator + worker tabs driven by the
  supervisor). They are not merged.

### Agents board / `SquadFlowView` — observe + stop

- A **run banner** (goal text + run state) when an autonomous run is active for
  the project, with a **Stop** button (→ `stopAutonomous(runId)`).
- Live progress is the existing `SquadFlowView` graph — no change to its graph
  logic; it already renders the run's agents and handoffs.
- Run state is fed by a new `useAutonomousRuns` store slice subscribed to
  `autonomousRuns:onChanged`.

### `TeamsPanel`

- **Out of scope / untouched.** The launch entry point moved to the agent view.

## File-by-file change list

**New files**
- `src/main/autonomous-run-supervisor.ts` — run-scoped supervisor; all
  collaborators injected (like `HeartbeatService`) for unit-testability without
  Electron/pty. Owns the run map, status subscription, nudge timers, stop
  conditions, teardown.
- `src/main/__tests__/autonomous-run-supervisor.test.ts` — fake-timer unit tests
  (idle→nudge, max-rounds cap, timeout, manual stop, orchestrator-exit→complete,
  blocked-never-nudged), mirroring `heartbeat`'s test style.

**Main process**
- `src/main/index.ts` — instantiate the supervisor once at app init (Rule 3);
  extend `launchTeam()` to accept an optional `goal` (prepend to orchestrator
  prompt) and **return launched session ids**; add `launchAutonomous` /
  `stopAutonomous` handlers; release supervisor state on pty exit alongside the
  existing `orchestratorSessions` cleanup.
- `src/main/store.ts` — add the three `autonomous*` config defaults.

**Shared / preload**
- `src/shared/types.ts` — `AutonomousRun` + config-default fields.
- `src/shared/ipc.ts` — new channels: `teams:launchAutonomous`,
  `teams:stopAutonomous`, `autonomousRuns:list`, `autonomousRuns:onChanged`.
- `src/preload/index.ts` — bridge new channels onto `window.cc.teams.*` +
  `window.cc.autonomousRuns.*`.

**Renderer**
- `src/renderer/components/LaunchPanel.tsx` — mode toggle + Team picker + goal
  box + autonomous-launch button.
- `src/renderer/store.ts` — `useAutonomousRuns` slice (list + onChanged, seeded
  once at window open).
- Agents board / `SquadFlowView` host component — run banner + Stop button.

**Tests**
- Extend team-launch tests for the goal-prepend + returned session ids.

## Engineering-rule compliance

- **Rule 1/2 (renderer untrusted; confine paths):** main looks up the team from
  the store, confines the project through `createTerminalConfined`, and
  sanitizes/caps the goal. Renderer-supplied `teamId`/`projectId`/`goal` are
  never trusted as-is.
- **Rule 3 (subscribe once at init; release on shutdown):** the supervisor is
  instantiated at app init; every status subscription and timer is released on
  run stop and on pty exit.
- **Rule 4 (atomic shared writes):** N/A — runs are in-memory, no shared-file
  writes added.
- **Rule 5 (bound unbounded work):** runs are in-memory with a hard concurrent-
  run cap; nudges bounded by `maxRounds`; the loop is timer-driven and off the
  hot path; the timeout bounds wall-clock.
- **Rule 6 (no literal extension ids in logic):** nothing branches on the
  literal `'zana'`; this is core Teams + agent-mesh + status machinery.
- **Rule 7 (promotion deliberate):** no new built-in promotion; reuses the
  already-gated `close_session_with_summary` surface.

## Risks / open questions

- **Cleanly-finished vs. paused idle is indistinguishable** from the status
  stream alone (both show the idle glyph). Mitigation: the goal-aware nudge tells
  a finished agent to say so / hand back to the orchestrator; the max-rounds and
  timeout backstops bound the cost of nudging a genuinely-done-but-idle agent.
  This is the same known imprecision `HeartbeatService` documents.
- **`close_session_with_summary` must be enabled** (`agentSelfCloseEnabled`
  config flag) for the primary "goal reached" path to fire. If it is off, the
  orchestrator cannot self-close and the run will only end via a backstop. The
  implementation plan must decide whether launching an autonomous run implies/
  requires this flag (recommended: require it, surface a clear message if off).
- **Worker teardown** uses the `closeSession` primitive against each specific
  worker session id (resolved at stop, see lifecycle above). Confirm a clean
  close-by-id path is reachable from main outside the MCP route wiring (the MCP
  `closeSession` is wired session-scoped; the supervisor needs the underlying
  `Ptys` close for arbitrary ids).
- **No persistence across app restart** — a run dies with the app (matches the
  in-session decision). Headless/daemon autopilot remains the path for
  restart-surviving autonomy.
