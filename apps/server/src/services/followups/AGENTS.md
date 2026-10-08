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
