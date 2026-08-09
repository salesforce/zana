# Agent mesh — discovery + messaging (Phases 0 & 1)

**Status:** shipped (Phases 0 & 1 of `docs/tmux-agent-mesh-implementation-plan.md`).
**Scope:** discovery (`register_agent` / `list_agents` / `find_agent`) **and** audited
messaging (`agent_send` / `agent_inbox`). The messaging section is at the end.

## What it does

Lets a Claude agent running in one ZCC tab discover its **peers** — other agents
the user is running — and reference one by a stable handle. This is the
"a way to reference them so they can discover each other" ask, in its smallest,
human-in-the-loop form: an agent can *see* peers, not message them or act on
them autonomously.

Three MCP tools (server `zcc-inbox`, session-scoped route only):

| Tool | Agent-visible input | What it does |
|---|---|---|
| `register_agent` | `handle`, `role?`, `capabilities?` | Announce yourself. `handle` is the short name peers address you by; it is auto-suffixed (`reviewer` → `reviewer-2`) if another agent in the project already holds it. |
| `list_agents` | `allProjects?` | List peers (handle, role, capabilities, **live status**, sessionId). Own-project scope by default. |
| `find_agent` | `handle?`, `role?`, `capability?`, `allProjects?` | Resolve a specific peer. Own-project scope by default. |

All three are **pre-approved** (in `pty.ts`'s `inboxAllow`), so using them never
raises a permission prompt — they are read-only / self-announce. The agent is
told they exist via `AGENT_MESH_GUIDANCE`, appended to the system prompt at spawn.

## Identity & trust model

Identical to `inbox_push`: identity is **server-filled from the URL route**, never
trusted from the agent.

- The tools register **only** on the session-scoped route `/mcp/:projectId/:sessionId`
  (like `schedule_report`). On the legacy project-only route they are absent.
- `sessionId` and `projectId` come from the URL path; `cwd` from
  `PtyManager.getSession()`. The agent's schema exposes **only** the soft fields
  (`handle`, `role`, `capabilities`). An agent therefore cannot forge whose
  record it is or push into another project's registry. (Covered by the
  "safe" integration tests.)
- Live agent **status** (working / idle / blocked) is **not stored** on the
  record — it is fused in at response time from `AgentStatusTracker`, so the
  registry never serves a stale status.

## Record shape & lifecycle

```ts
interface AgentRecord {
  sessionId: string;      // PK — from the URL route (server-filled)
  projectId: string;      // from the URL route (server-filled)
  handle: string;         // agent-chosen, deduped per project
  role?: string;          // agent-supplied
  capabilities?: string[]; // agent-supplied
  cwd: string;            // from the live session (server-filled)
  registeredAt: number;   // set once, preserved across updates
}
```

- **Seed:** every claude-family session is auto-seeded into the registry when it
  spawns (on the `sessionUpdated` event, in `index.ts` `wireBridgeListeners`), so
  it is discoverable even if its agent never calls `register_agent`. Shell tabs
  are not seeded (no agent to discover). The default handle is the tab title;
  `register_agent` later enriches handle/role/capabilities.
- **Drop:** the record is removed on the pty `exit` event, alongside the existing
  agent-status cleanup. An exited session disappears from peers' `list_agents`.
- **Scope:** `handle` is unique per project; the same handle can exist in two
  different projects. Dropping a session frees its handle for re-use.

### Why in-memory only (no persistence)

`AgentRegistryStore` is in-memory, unlike the JSONL-backed `InboxStore`. A record
is strictly session-lifetime-scoped: seeded on spawn, dropped on exit. PTYs do
not survive an app restart in Phase 0 (restore re-spawns and re-seeds), so a
persisted file could only hold tombstones of dead sessions — drift that would
need reconciling against the live pty map every boot. Persistence only becomes
meaningful once sessions themselves persist (the tmux work in Phase 2); that is
the seam to add it.

## The once-binding invariant (consensus finding #1)

The seed/drop handlers hang off `PtyManager`'s `sessionUpdated` / `exit` events
inside `wireBridgeListeners()`, which is guarded by `bridgeListenersWired` and
called **once** at boot — never from `createWindow()` (which re-runs on macOS
window re-activation). Binding there would double-register the handlers on every
window reopen, double-dropping records. `agent-registry-bridge.test.ts` asserts
the listener counts stay at 1 across repeated wiring and that `drop` fires
exactly once per exit.

## Messaging (Phase 1)

Agents can message each other over a channel that is **completely separate from
the user inbox**. `agent_send` and `agent_inbox` live on the same session-scoped
route as the discovery tools.

| Tool | Agent-visible input | Pre-approved? | What it does |
|---|---|---|---|
| `agent_send` | `to`, `message`, `allProjects?` | **No** — prompt-on-first-send | Append the message to the `AgentMessageLog`, then inject it into the target's pty if the target is idle; otherwise leave it queued. |
| `agent_inbox` | `since?` | Yes (read-only) | Drain the calling session's queued messages (marks them delivered). |

### Channel separation (the load-bearing rule)

The user inbox (`InboxStore` / `inbox_push`) is **agent → User only**. Agent↔agent
traffic rides the **separate** `AgentMessageLog` (`src/main/agent-message-log.ts`)
— `agent_send` never calls `InboxStore.append`. The mesh touches the user inbox
only on a real human-in-the-loop event: the first-send permission prompt (the
CLI's own flow, because `agent_send` is left out of `inboxAllow`), or a blocked
escalation. The integration tests assert the user inbox is empty after routine
sends.

### Delivery: pull-first, inject-when-idle

`AgentMessageLog` is both the audit log and the per-target pull queue — the queue
is the **delivery source of truth**:

1. `agent_send` resolves the target via the registry (own-project by default;
   `allProjects` to widen), then **always** appends the message to the log.
2. If the target is `idle`/`done` (per `AgentStatusTracker`), it is also injected
   into the target's pty via `PtyManager.reply()` and marked delivered.
3. Otherwise it stays queued; the target drains it via `agent_inbox`.

Because the queue is authoritative, the debounced (~250ms) idle-gate is safe: a
stale gate, or a `reply()` that fails because the pty just exited, means the
message is **queued, never lost** (the `2b. pull-first safety` test covers this
exact case — `reply()` returns false → message stays undelivered).

### Guardrails

1. Same-project scope by default; cross-project requires explicit `allProjects`.
2. Every send is appended to the `AgentMessageLog` (the audit bar), never the
   user inbox.
3. Inject only when the target is idle/done; otherwise queue.
4. `agent_send` is **not** pre-approved → the user blesses agent-to-agent comms
   on the first send. (`agent_inbox`, read-only, is pre-approved.)
5. You cannot message yourself; sender identity is the URL session, never an
   arg.

## Read-only UI (Agents board)

Shipped (tickets #12, #18). The mesh is surfaced to the human under the global
Agents board via `AgentMeshPanel` (`src/renderer/components/AgentMeshPanel.tsx`),
which self-hides until the mesh is in use. Two sections:

- **Registered agents** — the discovery registry: each session's
  handle/role/capabilities with its live status fused in from `useAgentStatus`
  (the status the registry deliberately doesn't store).
- **Agent messages** — the agent↔agent audit history (`AgentMessageLog`),
  shown from → to with the body and a `queued` badge for undelivered messages.
  This is the user-visible audit surface that keeps the mesh inspectable; it is
  rendered SEPARATELY from the user inbox.

Plumbing (mirrors the inbox channel): an `agents` block in `src/shared/ipc.ts`
(`list` / `messages` / `onRegistryChanged` / `onMessage`), main handlers backed
by `agentRegistry.list` + `agentMessageLog.history` with pushes on
`onChanged` / `onAppended`, a preload bridge, and a `useAgentMesh` renderer
store loaded + subscribed in `initApp`. `AgentRecord` / `AgentMessage` live in
`src/shared/types.ts` (the main stores re-export them) so the renderer shares
the exact shapes.

## Still needing a live check

- **Live smoke test (Phases 0–1):** open two real Claude tabs and confirm
  `list_agents` → `find_agent` → `agent_send` round-trips (injected when idle,
  queued when busy) and that the `AgentMeshPanel` reflects it. Covered by
  integration tests against mocked PTYs, but not yet exercised with the real
  `claude` CLI in the running app.
