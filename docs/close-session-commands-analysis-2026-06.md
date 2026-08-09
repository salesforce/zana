> **UPDATE 2026-06-15 — IMPLEMENTED.** All three recommendations below shipped:
> (1) main-side `CloseSummaryService.summarizeAndClose()` helper, (2) CLI
> `zcc term close-summary` (operator), (3) MCP `close_session` /
> `close_session_with_summary` (agent self-close, gated by the
> `agentSelfCloseEnabled` Settings toggle). A latent bug was found and fixed in
> the process: `normalizeConfig` (store.ts) is a strict allow-list and was
> silently dropping `idleTriageEnabled`, `closeIdleEnabled`, AND the new
> `agentSelfCloseEnabled` on save — so those toggles never persisted. All three
> are now enumerated, with a round-trip regression test guarding every boolean
> flag. The analysis below is the original design rationale, kept for reference.

---

# Close-session commands: where they belong (CLI / MCP / plugins)

**Date:** 2026-06-15
**Question:** Do we have a plugin/command surface for the Command Center? Could we add a command to *close a session* (terminate its terminal), and another to *close + write an inbox summary first*? CLI? MCP?

**Short answer:** You have **three** automation surfaces — a mature **CLI** (`zcc` over a UDS control plane), a **session-scoped MCP server**, and an **extension/command-palette** system. The two commands map cleanly onto two *different* surfaces with two *different* intents:

- **Operator closing someone else's session** → **CLI** (`zcc term close` already exists; add `term close-summary`).
- **An agent closing _its own_ session when done** → **MCP** (new `close_session` / `close_session_with_summary` tools).

These are not redundant — they serve different actors with different trust. Details below.

---

## The three surfaces at a glance

| Surface | What it is | Actor | Auth | Can close a session today? |
|---|---|---|---|---|
| **CLI** (`zcc`) | UDS control plane at `~/.zcc/control.sock`, client in `packages/cli` | A human operator at a shell (or a script) | Bearer token + per-boot nonce (`~/.zcc/control.token`, 0600) | **Yes** — `zcc term close <id>` already exists |
| **MCP** | HTTP server, session-scoped route `/mcp/:projectId/:sessionId` | A running agent (Claude), about itself/peers | Identity baked into the URL path; never agent-supplied | **No** — no close/exit tool exists |
| **Extensions** | In-process modules (`@zana-ai/zcc-extension-sdk`), can contribute command-palette entries | App code / trusted extensions | In-process, per-capability permission | **No** — host API has `launchSession`/`replyToSession`/`writeToSession` but no `closeSession` |

---

## 1. CLI — the natural home for *operator* close

The CLI is real and well-built. `packages/cli` ships a `zcc` binary; it talks to `src/main/control-plane.ts` over the UDS socket.

**`zcc term close <sessionId>` already works** — it's wired end to end:
- op `term.close` in `KNOWN_OPS` (`control-plane.ts:177`), dispatched to `deps.closeTerminal(id)` → `ptys.close(id)`
- CLI subcommand in `packages/cli/src/lib/run-cli.ts:134`

**Key auth fact (this shapes the whole design):** the control plane classifies callers into **operator** vs **agent** (`control-plane.ts:193`). An agent is any caller carrying a `ZCC_SESSION_ID` (the CLI forwards it from the pty env). **Agent-class callers are restricted to a read-only op set** (`AGENT_ALLOWED_OPS` — `control-plane.ts:165`); `term.close` is *deliberately denied* to them, with an explicit refusal message telling the agent to use the MCP mesh or ask the user (`control-plane.ts:221-229`). Fail-safe: a forged/stale id degrades *toward* agent, never up to operator.

**So: the CLI is the operator's tool.** A human (or a cron/script run from a non-agent shell) can close any session. An agent cannot use it to close itself or a sibling — by design.

### Adding `zcc term close-summary` (operator, multi-session, summary-first)

Low effort — the summary engine already exists (`CloseSummaryService`, added with the Close-idle feature). Three edits:

1. **`control-plane.ts`** — add `'term.close-summary'` to `KNOWN_OPS` (keep it OUT of `AGENT_ALLOWED_OPS`); add a dispatch case that calls `closeSummary.summarize(projectId, sessionIds)` **and then** `closeTerminal` for each. Add `closeSummaryService` (or a thin `summarizeSessions` fn) to `ControlPlaneDeps`.
2. **`src/main/index.ts`** — pass the already-instantiated `closeSummary` into the `startControlPlane({...})` deps (it's created at `index.ts:393`).
3. **`packages/cli/src/lib/run-cli.ts`** — add the `term close-summary <projectId> <id...>` subcommand + a help line.

⚠️ **One gap to close:** `CloseSummaryService.summarize()` today **only summarizes and writes the inbox entry — it does NOT close** (`close-summary.ts:153-207`). The summary→close *orchestration* currently lives only in the renderer store (`closeIdleAgents`). For a CLI/MCP path you want the close to happen in **main**, not the renderer. Recommended refactor: add a small `summarizeAndClose(projectId, sessionIds)` helper in main that calls `summarize()` then `closeTerminal()` per id, and have both the new CLI op and the renderer reuse it. That keeps "summarize then kill" in one place instead of duplicating it per surface.

---

## 2. MCP — the natural home for an *agent closing itself*

The MCP server (`src/main/mcp-server.ts`) exposes tools on two routes:
- **project-scoped** `/mcp/:projectId` → `inbox_push`, `register_project`
- **session-scoped** `/mcp/:projectId/:sessionId` → also `schedule_report`, `register_agent`, `list_agents`, `find_agent`, `agent_send`, `agent_inbox`

The crucial security property: **a tool's identity (`projectId`, `sessionId`, `cwd`) is closed over from the URL path, never read from agent input** — so an agent literally cannot target a session other than its own through a session-scoped tool. That makes a self-close tool *safe by construction*.

**Today there is no close/exit/terminate tool.** The closest existing mechanism is `onStopHook` (`mcp-server.ts:53`) — Claude's Stop hook can already ping back to auto-close a finished session. So "close when done" partly exists as a *hook*, but not as a tool the agent can *deliberately* call with a summary.

### Adding `close_session` + `close_session_with_summary` (agent self-close)

Low effort, and a genuinely nice UX: an agent that's finished can leave a note and close its own tab.

- **`close_session`** (no args): calls `closeTerminal(sessionId)` for its *own* path-derived session. Empty input schema.
- **`close_session_with_summary`** (`{ summary: string }`): `inboxStore.append({ projectId, sessionId, comments })` then `closeTerminal(sessionId)`.

Wiring:
1. New file `src/main/close-session-mcp-tool.ts` following the `schedule-report-mcp-tool.ts` pattern (description const + Zod input shape + `registerX(server, opts)`).
2. Add a `closeSession?: (sessionId) => boolean` (and reuse `inboxStore`) to `McpServerOptions` (`mcp-server.ts:42`), register the tools on the **session-scoped** branch of `buildProjectMcpServer` (after `mcp-server.ts:212`).
3. In `index.ts`'s `startMcpServer({...})`, pass `closeSession: (id) => ptys.close(id)`.

**Design choice — whether the agent's summary should use the LLM:** the agent *is* the LLM, so for self-close it should just **write its own summary** in the tool arg (no extra `claude --print` call needed — cheaper and higher-quality than re-summarizing its own transcript). That's different from the Close-idle feature, where the operator triggers a summary of an *idle* agent that isn't actively producing text, so a micro-call is warranted. Worth keeping that distinction.

⚠️ **Safety note:** a self-closing tool means an agent can end its own session mid-turn. The Stop-hook auto-close already does something similar, so the blast radius is understood, but consider: (a) only register it when a config flag is on (mirrors how Close-idle is gated), and (b) ensure the tool's text response is flushed before the pty dies (return the response, *then* close on next tick) so the agent's final acknowledgement isn't lost.

---

## 3. Extensions / command palette — possible, but not the right fit yet

There are actually two "command" notions, neither of which is a Zana-native automation API:

- **Extension command palette** (`@zana-ai/zcc-extension-sdk`, `renderer.ts`): an `AppModule` can contribute `ExtensionCommand[]` to the in-app palette. But the extension **host API has no `closeSession()` capability** — it offers `launchSession`, `replyToSession`, `writeToSession`, `pushInbox`. So an extension command *cannot* close a tab today without either (a) a new host capability, or (b) shelling out to `zcc term close` (needs exec permission).
- **Slash commands** (`src/main/commands.ts`): these are **Claude Code's own** `.claude/commands/**/*.md`, merely *discovered* and surfaced — not a hook into ZCC operations.

**Verdict:** an extension-palette "Close session" is doable but needs a new `ModuleHost.closeSession()` capability first, and it duplicates what the CLI + MCP already cover. Defer unless you specifically want a palette button.

---

## Recommendation

| Command | Best surface | Effort | Why |
|---|---|---|---|
| Close a session (operator) | **CLI** | ✅ Done — `zcc term close <id>` | Operator tool; token-gated; already exists |
| Close + summary (operator, N sessions) | **CLI** `term close-summary` | Low | Reuses `CloseSummaryService`; needs the `summarizeAndClose` main-side helper |
| Close own session (agent) | **MCP** `close_session` | Low | Session-scoped identity = safe self-close only |
| Close own session + note (agent) | **MCP** `close_session_with_summary` | Low | Agent writes its own summary (no LLM micro-call needed) |
| Close session (palette) | Extension | Medium | Needs new host capability; redundant — defer |

**Sequencing suggestion:**
1. **First**, refactor the summarize→close orchestration into a main-side `summarizeAndClose(projectId, sessionIds)` (today it lives only in the renderer store). This unblocks every other surface and removes future duplication.
2. **Then** add the CLI `term close-summary` op (operator path).
3. **Then** add the MCP `close_session` / `close_session_with_summary` tools (agent self-close), gated behind a config flag and careful about flushing the tool response before the pty dies.

No code written — analysis only. All anchors are current as of 2026-06-15.

### Key file anchors
- CLI control plane: `src/main/control-plane.ts` (ops `:174`, auth `:193`/`:221`, dispatch `:239`)
- CLI client/commands: `packages/cli/src/lib/run-cli.ts` (`term close` `:134`, help `:166`)
- MCP server: `src/main/mcp-server.ts` (options `:42`, routes/builder `:147`, Stop-hook `:53`)
- MCP tool pattern: `src/main/schedule-report-mcp-tool.ts`, `src/main/agent-messaging-mcp-tools.ts`
- Close path: `src/main/pty.ts` `close()` `:763`; IPC `terminals:close` in `index.ts`
- Summary engine: `src/main/close-summary.ts` (`summarize()` `:153` — summary-only, does NOT close)
- Summary→close orchestration (renderer only today): `src/renderer/store.ts` `closeIdleAgents`
- Extension SDK: `packages/extension-sdk/src/renderer.ts` (host API, `ExtensionCommand`)
