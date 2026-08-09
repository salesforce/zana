# 5 New Feature Ideas for Zana Command Center

These proposals emerge from a cross-team codebase analysis of ZCC's agent lifecycle primitives, scheduling subsystem, MCP surface, and renderer components. Each builds on proven patterns already in the code and is classified by architectural tier: **Tier 0** (pure projection / renderer-only), **Tier 1** (new IPC channel), **Tier 2** (new durable store), **Tier 3** (new authority / side-effect).

---

## 1. Fleet Activity History & Daily Digest

**Problem Statement:** All agent mesh state — registrations, messages, status transitions, autonomous run outcomes — lives in memory with a 1-hour TTL. Users who run overnight agent teams have zero visibility into what happened. There is no audit trail and no "what did my fleet do while I slept?" view.

**Proposed Solution:** Introduce a bounded, append-only run-history store at `~/.zcc/fleet-history.jsonl`. Each entry captures a per-session summary: start/end timestamps, persona used, token estimate (via `prompt-registry.ts`), outcome (exit code + close-summary text), and sub-agent count.

The write path hooks into the existing `agentStatus.on('status')` edge in `agent-status.ts` plus the `close-summary.ts` LLM micro-call that already generates human-readable summaries on session exit. A scheduled LLM micro-call (reusing the `PromptRegistry` + `scheduler.ts` machinery) produces a **daily digest** — a standup-formatted summary pushed to the inbox each morning.

Opt-in via AppConfig flag (`fleetHistory.enabled`), default OFF. Retention cap: 30 days or 10,000 entries, whichever is hit first (Rule 5 — bound growing reads). Atomic writes via tmp + rename (Rule 4).

**Stretch goal:** A "Replay" mode in the renderer that scrubs through persisted history entries as an animated timeline (composable with Feature 4's graph view).

**Architectural Fit:** Tier 2 (new durable store) + Tier 0 (renderer timeline is a pure projection over IPC-fetched data). Rides the status-edge + LLM micro-call + inbox triad. No new authority — the data is already produced; this feature persists and surfaces it. Respects Rule 5 with explicit retention bounds.

**Expected Impact:** Unlocks daily standups, overnight digests, and fleet debugging — moving ZCC from a live-only tool to an auditable command center, a prerequisite for team-scale adoption.

---

## 2. Token Budget & Cost Guardrails

**Problem Statement:** No cost tracking or budget enforcement exists in ZCC. Users running autonomous teams (especially with `forceYolo`) cannot set a spend ceiling, see cumulative token usage, or receive alerts. The existing `maxRounds` and `timeoutMs` in `AutonomousRunLimits` are poor proxies — a single round can vary 100x in token consumption.

**Proposed Solution:**

1. **Per-session token counter** — Parse token-usage data from the Claude CLI's PTY output (it emits token counts in its status line). A lightweight regex in `PtyManager.onData` (`pty.ts`) extracts input/output token tallies per turn.
2. **New limit: `maxTokens`** — Added to `AutonomousRunLimits` alongside `maxRounds` and `timeoutMs` in `autonomous-run-supervisor.ts`. When the cumulative token count crosses this threshold, the supervisor triggers a graceful stop (same `closeSession()` primitive it already uses).
3. **Per-project budget config** — `AppConfig.tokenBudget: { alertAt, hardStopAt, resetInterval }` defines soft and hard ceilings.
4. **Token meter badge** — A small inline badge on each agent tab in the renderer showing cumulative session tokens.
5. **Alert & enforcement** — When `alertAt` is crossed → inbox push via `pushInbox()`. When `hardStopAt` is crossed → send `/stop` to the PTY.
6. **Fleet rollup** — Aggregate view in `OverviewPanel.tsx` showing per-project and per-run totals.

Default OFF, opt-in. The feature itself *is* the cost gate.

**Architectural Fit:** Tier 1 (new IPC channel for token-count push to renderer) + lightweight persistence (append counter to existing session record in `store.ts`). Parsing happens in `pty.ts`'s data handler — Tier 0 at the data plane. The enforcement arm reuses the same `reply()` / `closeSession()` primitives injected into `AutonomousRunSupervisorDeps`. The `maxTokens` field is a natural extension of the existing limits interface.

**Expected Impact:** First-class cost visibility with automated protection — critical for teams running expensive autonomous overnight runs, and a clear differentiator vs. raw CLI usage.

---

## 3. Smart Inbox Triage & Filtering

**Problem Statement:** The inbox supports only basic string matching and an unread toggle. As agent fleets scale from 5 to 50 concurrent agents, it becomes a firehose. There is no way to filter by agent, persona, priority, or topic, and no mechanism to separate "needs human attention" from "FYI."

**Proposed Solution:**

1. **Structured metadata** — Enrich `InboxEntry` (in `shared/types.ts`) with optional fields: `persona?: string`, `teamRunId?: string`, `priority?: 'action-required' | 'informational' | 'error'`. Stamped at `inbox_push` time from the calling session's context in `inbox-mcp-tool.ts`.
2. **Faceted filter bar** — In `InboxSidebar.tsx`: project, persona, priority, and date-range facets. Pure renderer projection over existing IPC-fetched data.
3. **LLM-powered auto-triage** — On each `inbox_push`, run a micro-call through `PromptRegistry` (`prompt-registry.ts`) to classify priority. One new prompt template; runs the same lightweight path as `close-summary.ts`. Opt-in via `AppConfig.inboxTriageEnabled`.
4. **"Needs Attention" smart section** — A pinned section at the top of `InboxSidebar.tsx` surfacing only `action-required` items, distinct from the chronological feed.

Filters are always available (no config needed). LLM triage is default OFF.

**Architectural Fit:** Tier 0–1 (metadata enrichment on existing `InboxEntry` type + one new LLM prompt + filter is a pure renderer projection). No new store — `inbox-store.ts` already persists the item shape; this adds backward-compatible optional fields. The LLM micro-call layer is proven and rate-bounded.

**Expected Impact:** Scales the inbox from "works for 5 agents" to "works for 50 agents," reducing human attention overhead by surfacing only what requires action.

---

## 4. Interactive Squad Flow Graph

**Problem Statement:** The Squad Flow view (`SquadFlowView.tsx`) is purely presentational — read-only, flat, and non-interactive. Users can see agent mesh topology but cannot act on it: no click-to-focus-terminal, no contextual actions, no way to control agents from the graph.

**Proposed Solution:**

1. **Click node → focus terminal** — Dispatches existing `focusTab` IPC to bring up that agent's terminal tab.
2. **Right-click context menu** — Stop (`closeSession`), Nudge (`pty.write` with the heartbeat message), Send Message (`agent_send` MCP tool), View Inbox Items (filter inbox to that session). Each dispatches an existing IPC call.
3. **Zoom/pan** — Standard canvas controls (wheel + drag) via CSS transforms on the graph container.
4. **Visual annotations** — Edge labels showing the last message snippet (from `AgentMessageLog`); node badges showing token count (composable with Feature 2) and time-in-state (already computed by `sinceLabel()` in `SquadFlowView.tsx`).
5. **Replay mode** — Scrub through the ephemeral message log to animate how the graph evolved. Composable with Feature 1's persistent history for longer replay windows.

**Architectural Fit:** Tier 0 (pure projection + renderer interaction handlers). `buildSquadFlow()` in `src/renderer/util/squadFlow.ts` is already a pure function deriving the graph from store slices (`useAgentMesh`, `useAgentStatus`, `useSubagents`). All proposed interactions dispatch existing IPC calls — no new main-side code needed. The `squad-flow-*` CSS prefix (per CLAUDE.md coupling note) keeps styling isolated.

**Expected Impact:** Transforms Squad Flow from a passive visualization into the primary control surface for multi-agent work — users manage their fleet spatially instead of tab-switching.

---

## 5. Event-Driven Agent Triggers (Webhook-to-Launch Bridge)

**Problem Statement:** Agents can only be launched manually (UI/CLI) or on a timer (`scheduler.ts`). There is no way to trigger agent work in response to external events — a GitHub PR opened, a Slack message received, a file changed, a CI build failed. The Slack bot's `CommandDispatcher` proves the reactive-launch pattern works, but it is a one-off, not a generalized system.

**Proposed Solution:**

1. **Triggers subsystem** — A new module (`src/main/triggers.ts`) that listens for events and launches persona/team sessions in response.
2. **Pluggable event-source registry:**
   - **File-watcher** — `fs.watch` on project roots (Node built-in, already used by `scheduler-store.ts` for hot-reload).
   - **Webhook receiver** — A new HTTP route on the existing MCP server (`POST /trigger/:projectId` in `mcp-server.ts`).
   - **Scheduler** — The existing scheduler, now unified as one trigger source among many.
   - **Extension-contributed** — Via `MainModuleContext.registerTrigger()`, following the same `PersonaTeamRegistry` pattern for extension-sourced capabilities.
3. **Trigger definition** — `{ source, filter, action: 'launch-persona' | 'launch-team' | 'inbox-push', config }`.
4. **Triggers panel** — In project settings UI: create/edit trigger rules with a live event preview and test-fire button.
5. **Security** — Triggers that launch sessions pass through the same trust-boundary validation as `ptys.create` (Rule 1 — main authorizes; Rule 2 — path confined to registered project). Extension-contributed sources route through the permission broker with explicit user consent.

**Architectural Fit:** Tier 3 (new authority — triggering a session launch is a side-effect that must be authorized). The webhook endpoint is a small addition to `mcp-server.ts`'s existing HTTP listener. File-watcher uses Node's `fs.watch` (already employed by the scheduler store). Extension sources follow the proven `persona-team-registry.ts` contribution pattern. This is the heaviest proposal but has the strongest roadmap evidence: GUS-CDC integration, CLI parity plans, and the Slack bot all point toward event-driven launch.

**Expected Impact:** Makes ZCC reactive to the development environment — "PR opened → reviewer agent starts" or "build failed → debugger agent launches" — moving from "a command center you operate" to "a command center that operates itself."

---

## Summary

| # | Feature | Tier | Effort | Value |
|---|---------|------|--------|-------|
| 1 | Fleet Activity History & Daily Digest | Tier 2 | Medium | High |
| 2 | Token Budget & Cost Guardrails | Tier 1 | Medium | High |
| 3 | Smart Inbox Triage & Filtering | Tier 0–1 | Low–Medium | High |
| 4 | Interactive Squad Flow Graph | Tier 0 | Medium | Medium–High |
| 5 | Event-Driven Agent Triggers | Tier 3 | High | Very High |
