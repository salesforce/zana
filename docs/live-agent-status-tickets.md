# Live Agent Status Awareness — Tickets (draft for review)

Companion to `docs/live-agent-status-plan.md`. Each ticket maps to one or more of
the council's **binding conditions** (BC#1–BC#20). Order respects dependencies.

Legend — Size: S (<½d), M (½–1.5d), L (2–4d). **BC** = binding condition satisfied.

---

## Phase 0 — De-risk

### LAS-00 · Confirm Claude hook + `--settings` runtime behavior
**Size:** S · **BC:** 2, 20 (verification) · **Blocks:** LAS-04, LAS-10
Spike. Empirically verify against the installed `claude` binary:
1. Whether a `Notification` hook fires on a **permission prompt** (vs only
   idle-timeout). Record the payload shape.
2. That `--settings` takes a single flag and later occurrences clobber earlier
   (confirms `composeSettings()` is mandatory).
- **AC:** A short findings note appended to `live-agent-status-plan.md` Phase 0.
  If `Notification` does NOT reliably fire on permission prompts (expected),
  `blocked` is screen-scan-only and LAS-04 drops the Notification mapping.
- **Risk addressed:** researcher correctness risk #2.

---

## Phase 1 — Foundation (no UI)

### LAS-01 · `composeSettings()` — single merged `--settings` for all consumers
**Size:** M · **BC:** 20 · **Depends:** — · **Touches:** `src/main/pty.ts`
(`buildStopHookSettings` ~563, spawn assembly ~169-193), `src/main/scheduler.ts`
Build one helper that merges every settings contributor (live-status hooks +
scheduler Stop hook + future Personas) into ONE settings JSON emitted as a single
`--settings` argv element. Mirror the existing `mergeAllowedTools` coalescing.
- **AC:** Only one `--settings` flag is ever emitted. Hooks from multiple sources
  deep-merge (arrays concat, no clobber). **Scheduler auto-close still works**
  (regression test). Unit test for merge precedence.
- **Risk addressed:** researcher correctness risk #3 (clobber breaks auto-close +
  collides with parked Personas).

### LAS-02 · Per-session bearer token + spawn generation/seq
**Size:** M · **BC:** 14, 18 · **Depends:** — · **Touches:** `src/main/pty.ts`
(`sessionId = randomUUID()` :144, `ZCC_HOOK_URL` :206, spawn env)
Mint a second random secret per session, distinct from the session id; bake it
into `ZCC_HOOK_URL` (path segment or `Authorization` header the hook sends). Stamp
a monotonic spawn-generation/seq on each session.
- **AC:** `ZCC_HOOK_URL` carries `<token>`; token + seq stored on the live-session
  record in main. Token never logged. Existing Stop-hook URL shape still resolves.

### LAS-03 · Harden the hook callback route (auth + liveness + ownership)
**Size:** M · **BC:** 14, 15, 18 · **Depends:** LAS-02 · **Touches:**
`src/main/mcp-server.ts` (route matcher :126-194, server :151)
Gate every hook POST: reject if (a) token mismatches the live session, (b)
`ptys.has(projectId, sessionId)` is false, (c) session exited, or (d) seq is
stale. Keep binding to `127.0.0.1` only. Continue draining the body.
- **AC:** Forged/stale/cross-session/post-exit POSTs are dropped (404/ignored) and
  never mutate state. Unit tests for each rejection path.
- **Risk addressed:** security-reviewer spoofing/recycled-id/post-exit-race.

### LAS-04 · New `/hook/event/:proj/:sid/:event` route → state reducer (+ scheduler)
**Size:** M · **BC:** 18, 19 · **Depends:** LAS-03, LAS-00 · **Touches:**
`src/main/mcp-server.ts`, new state module, `src/main/scheduler.ts`
Add a NEW route (do **not** touch `/hook/stop/...`). Event name in the **path**
(body is discarded via `req.resume()`). Map advisory events per the state machine
(`UserPromptSubmit`/`PreToolUse`→working accelerator; `Stop`→done; `SessionEnd`→
terminal; `SubagentStop`/`PostToolUse`/`Notification`→ignored). The `Stop` event
must ALSO drive the scheduler's existing `onAgentFinished` path.
- **AC:** Scheduler done-detection/auto-close unchanged. `SubagentStop` never
  revives a stopped session (regression test). `SessionEnd` is terminal even
  without a preceding `Stop`.
- **Risk addressed:** researcher correctness risks #1 & #3.

### LAS-05 · `AgentState` type + main-side status store (coalesce/debounce)
**Size:** M · **BC:** 7, 11 · **Depends:** LAS-04 · **Touches:**
`src/shared/types.ts`, new `src/main/agent-status-store.ts`
Define `AgentState = 'blocked'|'working'|'done'|'idle'|'unknown'`. Main-owned
per-session state map. Collapse `PreToolUse` spam to one `working`; debounce
emits ~250–500 ms/session.
- **AC:** N rapid `PreToolUse` POSTs → ≤1 emit per debounce window. Unit test for
  coalescing.

### LAS-06 · `seen` flag + done-unseen vs idle-seen
**Size:** S · **BC:** 5 · **Depends:** LAS-05 · **Touches:** `src/shared/types.ts`
(`TerminalSession`, parallel to `headless` :105), main store, `src/preload`
Main-owned per-session `seen` flag (NOT localStorage). `Stop`/scan-idle while
unfocused → `done-unseen`; renderer focusing the tab flips → `idle-seen`.
- **AC:** Focusing a done tab clears its "unread" status within one tick. Survives
  the rollup (lives in main).

---

## Phase 2 — Screen-scan detector (the authority)

### LAS-07 · Port `claude.toml` detection rules to a TS matcher
**Size:** L · **BC:** 1, 2 · **Depends:** — (parallel to Phase 1) · **Touches:**
new `src/main/agent-detect/` (or shared) · **Ref:**
`herdr/src/detect/manifests/claude.toml`, `herdr/src/detect/manifest.rs`
Port the priority-ordered rules: `blocked` ("do you want to proceed?"+"esc to
cancel", permission forms, priorities 840–980); `idle` (❯ prompt box, priority
950); `working` (braille spinner OSC title). Region extraction: bottom non-empty
lines / after last horizontal rule. Pure function: `(textRegion) → AgentState`.
- **AC:** Unit tests with captured fixture buffers for each state. No raw text in
  the output — enum only (**BC 17**).

### LAS-07b · OSC-title / OSC-progress fast-path detector (main-side, **highest value**)
**Size:** M · **BC:** 1, 11, 17 · **Depends:** LAS-05 · **Touches:** `src/main/pty.ts`
(raw `onData` byte stream), main state store · **Ref:** `claude.toml` rules
`osc_title_working` (priority 1100), `osc_title_idle` (250), `osc_progress_idle` (250)
The single cheapest, highest-signal detector — do this **before** the full buffer
scan. Claude emits its state in the **terminal title** (OSC 0/2) and progress
(OSC 9;4): a braille spinner `⠋⠙⠹…` (`U+2800–U+28FF`) while working, a `✳`
(`U+2733`) when idle/done. **Parse it from the raw PTY byte stream in
`pty.ts.onData`** — match `\x1b]0;…\x07` / `\x1b]2;…` / `\x1b]9;4…` — NOT from
xterm. This means:
- **No renderer round-trip, no buffer serialize** — near-zero cost.
- **Works for hidden / unfocused / headless tabs** — herdr cannot do this (it
  reads the *rendered* title; we read the source stream). This is a genuine
  improvement over the reference.
- Emits only the derived enum upward (BC 17); the title string never leaves main.
- **AC:** A working Claude session flips the dot from the title spinner alone, with
  no `claude.toml` buffer scan running, including when its tab is not visible.
  Unit test with captured OSC-title byte fixtures (spinner → working, `✳` → idle).
  Coalesced/debounced through LAS-05 (spinner frames change ~10 Hz).
- **Note:** this is the primary `working` signal; the LAS-07 buffer scan remains
  the authority for `blocked` (permission prompts aren't in the title) and as the
  fallback when a session emits no OSC title.

### LAS-08 · Debounce + content-change skip + startup grace
**Size:** M · **BC:** 12 · **Depends:** LAS-07 · **Ref:**
`herdr/src/pane/agent_detection.rs`
3-scan `working→idle` confirmation, skip scan when buffer content unchanged,
suppress state updates for a startup grace window (~3 s).
- **AC:** A transient idle frame mid-work does not flip the dot; unit tests for the
  debounce window.

### LAS-09 · Gated scan cadence wiring + hybrid resolver (with hook idle-veto)
**Size:** M · **BC:** 12, 1, 17, 21 · **Depends:** LAS-08, LAS-05, LAS-07b ·
**Touches:** `src/renderer/components/TerminalView.tsx`/`TerminalSurface.tsx`
(xterm + `addon-serialize`), bridge to main
Run the buffer scan **only** for: sessions with no OSC-title coverage (LAS-07b)
AND no decisive hook, focused/visible tab, debounced PTY-quiet (~300–500 ms),
bottom region only, single-digit Hz cap.

**Resolver precedence** (signal fusion — the heart of the hybrid):
1. `blocked` ← buffer scan only (permission prompts; never the title/Notification).
2. `working` ← OSC-title spinner (LAS-07b) is primary; buffer scan / `PreToolUse`
   hook are confirmations.
3. `done` ← `Stop` hook (authoritative "turn ended") or OSC-title `✳`.
4. `idle` ← buffer scan `❯` prompt box, **AND** no in-flight tool.

**Hook idle-veto (the enhancement, BC 21):** `PreToolUse` fires when a tool
*starts* and we get no matching `PostToolUse`/`Stop` yet → there is an in-flight
tool. While a tool is in flight, **suppress any `working→idle` emit** that the
buffer scan would otherwise produce during a quiet-screen moment (a long tool call
with no output looks identical to idle on screen). The veto clears on `Stop` /
OSC-idle / `PostToolUse`. This makes our idle strictly more accurate than herdr's
screen-only debounce, which can only *delay* a false idle, not *know* it's false.
- **AC:** Buffer scan never runs for hidden tabs, OSC-covered, or hook-covered
  sessions; a long silent tool call does NOT flip to idle (veto holds); idle is
  emitted within one debounce window after the tool actually ends. No
  full-scrollback serialize.
- **Risk addressed:** performance render/serialize storm + the fundamental
  quiet-tool-call-looks-idle ambiguity.

---

## Phase 3 — Renderer: dots + rollup

### LAS-10 · Dedicated `agentStatus` renderer store + `onAgentStatus` IPC
**Size:** M · **BC:** 7, 9, 10 · **Depends:** LAS-05 · **Touches:**
`src/shared/ipc.ts`, `src/preload/index.ts`, new renderer store,
`src/renderer/store.ts`
New `onAgentStatus(sessionId, state)` IPC channel (separate from `onUpdated`).
Renderer store holds `byId: Record<sessionId, AgentState>` + precomputed
`rollup: Record<projectId, AgentState>` updated imperatively in `set`.
- **AC:** Status updates do NOT rebuild the `terminals` map/array. Rollup read as a
  primitive; no fresh-object selector (guard against the zustand infinite-loop
  trap — see MEMORY `zustand-selector-stable-ref`).

### LAS-11 · Per-tab status dot
**Size:** S · **BC:** 8 · **Depends:** LAS-10 · **Touches:**
`src/renderer/components/TabBar.tsx`
Colored dot per tab (🔴/🟡/🔵/🟢), subscribing by id to a primitive.
- **AC:** One session's transition repaints one dot, not the tab strip (verify via
  render count in dev).

### LAS-12 · Project / sidebar rollup dot
**Size:** S · **BC:** 6, 9 · **Depends:** LAS-10 · **Touches:**
`src/renderer/components/ListPane.tsx`, `Sidebar.tsx`
Show `rollup[projectId]` as a dot; priority Blocked>done-unseen>working>idle-seen.
- **AC:** A blocked session anywhere in a project surfaces on the collapsed project
  row; done-unseen outranks working.

---

## Phase 4 — Notifications

### LAS-13 · Tab-aware, rate-limited transition notifications
**Size:** M · **BC:** 13 · **Depends:** LAS-10 · **Touches:**
`src/renderer/components/Toaster.tsx`, inbox
Toast/sound on →blocked and →done **only when that session is not the
focused/visible one**; coalesce/rate-limit per session within a window.
- **AC:** No toast for the tab you're looking at; a flapping state can't spam.

---

## Phase 5 — Polish & docs

### LAS-14 · Settings, theming, docs, edge-case tests
**Size:** M · **BC:** — · **Depends:** LAS-11..13 · **Touches:**
`SettingsPanel.tsx`, `AppConfig` (`types.ts`), `README.md`, `docs/`
Enable/disable toggle, optional sound, dot colors per theme, docs, and the
edge-case test matrix (SessionEnd-without-Stop, recycled id, repo-local hooks →
`unknown` not stale `idle` per **BC 20**).

---

## Traceability — every binding condition has a ticket

| BC | Condition (short) | Ticket(s) |
|----|-------------------|-----------|
| 1  | screen-scan-primary hybrid | LAS-07, LAS-07b, LAS-09 |
| 2  | blocked from scan, not Notification | LAS-00, LAS-04, LAS-07 |
| 3  | ignore SubagentStop/PostToolUse | LAS-04 |
| 4  | SessionEnd terminal | LAS-04 |
| 5  | main-owned `seen` flag | LAS-06 |
| 6  | rollup priority order | LAS-12 |
| 7  | dedicated status store, not on session obj | LAS-05, LAS-10 |
| 8  | dot subscribes by id (primitive) | LAS-11 |
| 9  | precomputed rollup, no fresh-object selector | LAS-10, LAS-12 |
| 10 | dedicated `onAgentStatus` IPC | LAS-10 |
| 11 | main-side coalesce/debounce | LAS-05 |
| 12 | hard-gated scan cadence | LAS-08, LAS-09 |
| 13 | rate-limited tab-aware notifications | LAS-13 |
| 14 | per-session bearer token | LAS-02 |
| 15 | liveness + ownership validation | LAS-03 |
| 16 | env-only hook commands, no payload interpolation | LAS-04 |
| 17 | no raw buffer text leaves main | LAS-07, LAS-09 |
| 18 | event name in URL path + generation seq | LAS-02, LAS-04 |
| 19 | don't re-key `/hook/stop/`; also drive scheduler | LAS-04 |
| 20 | single composed `--settings` | LAS-00, LAS-01 |
| 21 | hook idle-veto + OSC-title fast-path (enhancement) | LAS-07b, LAS-09 |
