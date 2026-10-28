# apps/server/src/services/followups — Coupling Notes

Load-bearing invariants for auto-close-idle feature.

## Auto-close-idle (auto-close-idle.ts)

Closes non-background, non-delegating agent after idle for `autoCloseIdleMinutes` (default 15, clamp [1,240]). OFF by default; `autoCloseIdleEnabled` master switch, sidebar + Settings toggle.

### Invariants

1. Two-clock spare reads `TerminalSession.lastInputAt`, stamped only in `PtyManager.write` (`apps/host-daemon/src/pty.ts`, human keystrokes), never in `reply()` (agent injection). If future change routes agent text through `write()`, idle agents stop auto-closing.

2. `preserveParkedQuestion` reuses same `followups.createFromIdle` bridge as live idle→follow-up path, fed from `lastTriageBySession` cache in `apps/desktop/src/host.ts` (filled on `idleTriage` `triage` edge, capped at 200, dropped on pty exit). Parked question survives silent close at zero token cost.

3. Foreground-spare reads `activeForegroundSessionId`, set by advisory `terminals.setActiveSession` IPC (renderer-reported, spare-only — can never authorize close, Rule 1).

4. Favorite-spare: `favoriteAgentKeys` (set by advisory `terminals.setFavorites` IPC from renderer's persisted `useFavoriteAgents` star set) — starred agent is pinned by user, idle timer never reclaims it. Only explicit close (person, or agent-driven `close_idle_agents` tool which deliberately does not consult favorites) may close. Spare-only — like foreground spare, can never authorize close (Rule 1).

### Why

`HeartbeatService`-shaped timer service — every eligibility gate re-checked at fire time because long dwell lets state drift.

### Implementation

- `lastInputAt` stamped only in `PtyManager.write`, never `reply()`
- `lastTriageBySession` cache: cap 200, filled on `idleTriage` `triage` edge, dropped on pty exit
- `isFavorite` resolves session key as `claudeSessionId ?? id` to match renderer's `favoriteKey`, spare reattaches across restore
- `setFavorites` calls `armAllIdle()` so un-starring already-idle agent re-arms without waiting for working→idle cycle
- `close_idle_agents` tool deliberately ignores favorites (explicit agent-driven close)

### When changing

Route agent text through `PtyManager.write` (`apps/host-daemon/src/pty.ts`) → idle timer breaks (currently only human keystrokes trigger `lastInputAt`).

Touch `lastTriageBySession` cache (size, fill, drop) → verify parked question bridge still works.

Modify foreground/favorite spares → verify they remain advisory-only, never authorize (Rule 1).

Touch `isFavorite` key resolution → verify reattach across restore.

## Wrap up before closing (wrap-up-close.ts)

### Invariants

1. Types only into a resting, local, Claude-family agent with no pending draft, as ONE line (`oneLine`) through `reply()`. Codex, OpenCode, remote Claude, `blocked` and `unknown` agents are summarised and recorded without a wrap-up, never typed into.

2. Yields to the human through `lastKeyInputAt` (real keys only), not `lastInputAt`, which also moves on mouse and focus reports. The baseline is taken at the click, when the session is registered. A change keeps the agent open as `typed`.

3. Every gate (state, `lastKeyInputAt`, session still there) is re-checked when the settle timer fires, after the summary, and again after the inbox record is written: a key press or new work at any of those points keeps the agent open as `typed`. On the no-wrap-up path only a change INTO `working` counts, so a forced close of an agent that was already working still closes. Every timer and pending entry is released on every path (Rule 3).

4. Every session of a run is registered at the click, and at most `MAX_ACTIVE_WRAP_UPS` wrap-up turns run at once; the rest wait in `queued` until a slot frees (the renderer sends every agent at once on purpose). While `isWrappingUp(sessionId)`, which includes `queued`: auto-close-idle spares the session (host.ts ORs it into `isFavorite`); heartbeat sees no session (host.ts heartbeat `getSession` returns null), so no nudge, armed or new, types into it; peer messages stay queued (host.ts `injectToSession` declines and mail drain does not pull).

5. The wrap-up turn is tracked through Claude's own hooks as well as the debounced status: `onTurnStarted` (UserPromptSubmit) and `onTurnFinished` (Stop), wired in host.ts `onNotifyHook`/`onStopHook`. A turn that starts and ends inside one 250 ms status debounce still finishes; a Stop before the wrap-up turn began is ignored. `onTurnFailed` (StopFailure, an API error) keeps the agent open with a `turn-error` note.

6. A failed summary never blocks the close: the agent stays closeable and the failure is reported. A question, an unanswered prompt, typing, a failed turn or the 15-minute timeout keep the agent open (`keptOpen`).

7. The off path is today's `summarizeAndFollowUp`: `IPC.terminals.closeFollowup` calls the service only when `closeWrapUpEnabled === true`.

### When changing

Type into a non-resting agent, or a multi-line text → `reply()` wedges the TUI or submits each line.

Use `lastInputAt` for the typed check → mouse and focus reports end the wrap-up early.

Add a timer or per-session map → release it in `finish`/`forget`.

Add another service that types into resting agents (`reply()` on an idle edge) → exclude a wrapping-up session from it, as heartbeat does.
