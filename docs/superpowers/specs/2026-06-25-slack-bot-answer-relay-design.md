# Slack bot answer-relay — design

**Date:** 2026-06-25
**Status:** approved (design); pending implementation
**Branch:** `feat/squad-flow-subagent-nodes` (carries the prior Slack parser fix, still uncommitted)

## Problem

The Slack live bot (Tier C) can launch a Claude session from a `run <prompt>`
command and posts a "🚀 Launching a session…" confirmation into the thread. But
it never relays the session's **answer** back. A `run`-launched session is an
*interactive* `claude` — it answers, then idles at the prompt rather than
exiting — so the only existing reply-back paths (`blocked` → approval prompt,
`exit` → "Session finished") rarely or never fire. The user posts `run is core
running`, the session answers in the ZCC tab, and Slack stays silent.

Verified live 2026-06-25: `run is core running` launched session
`3f54faa6-7d99-4006-af64-53780816fe88`; the bot posted the launch confirmation,
the session answered and went idle (PID still alive 7+ min later), and nothing
came back to the thread. Working as built — there is simply no answer-relay path.

## Goal

When a **bot-launched** session finishes a turn (transitions to `idle`), post a
short **LLM summary of that turn** into the session's Slack thread. This makes
the thread a real back-and-forth: `run X` → answer, `hint Y` → next answer.

## Decisions (locked with the user)

1. **Trigger:** every `idle` edge (each turn), not just the first and not exit.
2. **Content:** an LLM summary of the turn (not raw transcript text).
3. **Config:** always-on for bot sessions — no new toggle/UI.
4. **Architecture:** main-side `ctx` capability — the summary text never crosses
   into the renderer.

## Architecture

Three parts, each respecting an existing trust/ownership boundary:

```
renderer (SlackBot.tsx)
  host.on('session:agentStatus','idle')
     → host.call('sessionEvent','idle', sessionId)   // already forwards blocked/exit
        (no summary text crosses this IPC boundary)

slack-main (slack-main.ts)  — BotRuntime.handleSessionEvent('idle', id)
  row = threadStore.findBySession(id)        // bot-launched? else {handled:false}
  if (!row) return {handled:false}
  if (relayedSig.get(id) === sig(lastTurn))  return {handled:true}   // dedup same turn
  const r = await ctx.summarizeSession(id, { scope:'lastTurn' })     // NEW generic ctx cap
  if (r?.ok && r.text) {
     postBotReply(row.channel, row.parentTs, formatAnswer(r.text))   // 🤖-stamped, echo-safe
     relayedSig.set(id, sig(r.sourceLastTurn))
  }
  return {handled:true}

core (index.ts wires ctx.summarizeSession)
  confine id → live session (CLAUDE.md #1)
  readLastTurn(cwd, claudeSessionId)         // existing transcript-reader, ≤4 KB
  → runTurnSummary(lastTurn)                 // NEW builtin:turn-summary, haiku
  → RETURN { ok, text }                      // NO inbox push
```

**Why this shape**
- *Summary produced by core* — transcript reads + the `claude --print` micro-call
  are main-only and need the session's `cwd`+`claudeSessionId`, which only core's
  session registry has. `plugins/slack` cannot reach any of that.
- *Posted by slack-main* — it owns the thread store (channel+parentTs ↔ sessionId)
  and the echo-safe, prefix-stamping `postBotReply`.
- *Generic seam* — `ctx.summarizeSession` is Slack-agnostic (mirrors the existing
  optional `ctx.resolveProjectRoot`), so core never names Slack (CLAUDE.md #6).
- *Text bypasses the renderer* — user's chosen tradeoff; one in-process call in the
  trusted built-in tier instead of 2–3 IPC round-trips through the renderer.

**Precedent reused:** `src/main/close-summary.ts` already does
`readLastTurn/readDigest → runSummary/runSessionSummary`. The relay adds a
sibling method that returns the text instead of pushing to the inbox.

## Idle-edge semantics

- **Dedup per turn.** `idle` can re-fire for the same turn. `BotRuntime` keeps a
  `Map<sessionId, sig>` where `sig` is a cheap signature (length + tail) of the
  `lastTurn` the summary was built from. A matching sig means the same turn was
  re-reported → skip. This is what makes "every idle" mean "every *new* turn."
- **Launch turn** is just the first real turn — relayed normally, no special case.
- **`blocked` vs `idle`** are mutually exclusive edges (`blocked` overlay wins in
  `agent-status.ts` `resolve()`), so the approval prompt and the answer relay never
  double-post for the same pause.
- **`exit`** keeps its existing "✅ Session finished" notice; the relay does not
  fire on exit.
- **Empty/unreadable/failed** → post nothing (silent skip), mirroring
  `close-summary`. The relay is a courtesy, never a source of error chatter.
- **State lifetime:** the dedup map is in-memory in `BotRuntime`, cleared on
  session `exit` (next to the existing `pendingApprovals.delete(id)`). A restart
  loses it, but the thread link is also gone on restart, so nothing over-posts.

## New summary prompt

`builtin:turn-summary` in `src/main/prompt-registry.ts`, between the existing
`close-summary` (terse did/left JSON, whole session) and `session-summary`
(rich whole-arc, sonnet):

- Input: **last turn** (`readLastTurn`, ≤4 KB) — not the whole-session digest.
- Model: **haiku** (runs every turn; must be cheap). `maxOutputChars ≈ 600`,
  `timeoutMs 30_000`.
- System prompt: summarize what the agent just said/did in its latest turn for a
  teammate reading on Slack; 1–3 terse sentences/bullets; if it asked the user a
  question, lead with that; plain text, no preamble, no code fences, no tool use.

Why not reuse the existing prompts: `close-summary` emits did/left JSON (wrong
shape for a chat reply); `session-summary` re-summarizes the *entire* conversation
on sonnet from a 2 MB digest — repetitive and costly to run on every idle edge.

## Message format

`formatAnswer(text)` — pure helper in `plugins/slack/shared/notify-format.ts`:

```
🤖 <summary text>
```

- The `🤖` (`:robot_face:`) prefix is the bot's durable self-filter (`botPrefix`);
  `postBotReply` stamps it, so `formatAnswer` returns the body and lets the poster
  stamp. The helper hard-caps the body (~2 KB) with a `…(truncated)` marker as a
  backstop against a runaway summary.

## Components changed

| File | Change |
|---|---|
| `packages/extension-sdk/src/main.ts` | Add optional `summarizeSession?(sessionId, opts?: { scope?: 'lastTurn' }) → Promise<{ ok: boolean; text?: string }>` to `MainModuleContext` (optional, like `exec`/`fetch`/`resolveProjectRoot`). |
| `src/main/close-summary.ts` | Add `summarizeTurn(projectId, sessionId) → { ok, text? }` reusing `readLastTurn` + a new injected `runTurnSummary` dep; no inbox push. Same confinement as `summarizeOne`. |
| `src/main/prompt-registry.ts` | Add `builtin:turn-summary` template. |
| `src/main/index.ts` | Wire `runTurnSummary` into `CloseSummaryService`; expose `ctx.summarizeSession` on the built-in module ctx (resolve+confine the id to a live session before reading). |
| `plugins/slack/main/slack-main.ts` | `handleSessionEvent` gains an `'idle'` case + per-session relay dedup map (cleared on exit); `BotRuntime` accepts `ctx.summarizeSession`. |
| `plugins/slack/renderer/SlackBot.tsx` | Forward the `idle` agentStatus edge via `host.call('sessionEvent','idle', id)` (it already forwards `blocked`/`exit`). |
| `plugins/slack/shared/notify-format.ts` | `formatAnswer(text)` pure helper. |

## Error handling

Every failure path is a silent no-op: no thread row (not a bot session),
unreadable/empty transcript, failed micro-call, or failed post. The relay never
surfaces an error into the thread or blocks any other bot behavior.

## Testing (TDD, red→green)

- `plugins/slack/shared/notify-format.test.ts` — `formatAnswer` passthrough +
  truncation marker.
- `close-summary` test — `summarizeTurn` returns text on success; `{ok:false}`
  on empty turn / failed micro-call; foreign/stale id rejected (confinement).
- `slack-main` test — `handleSessionEvent('idle')`: relays on first turn; **skips
  a duplicate same-turn idle** (dedup); no-ops for a non-bot session; posts
  nothing when `ctx.summarizeSession` returns `{ok:false}`; clears dedup state on
  exit.
- Regression: existing 19 `mcp-client` tests + the full Slack suite stay green;
  typecheck clean.

## Out of scope (YAGNI)

- No toggle/UI (always-on, per decision 3).
- No raw-transcript or whole-session-digest mode for the relay (last-turn summary
  only).
- No relay for non-bot sessions (the bot only has a thread for sessions it
  launched).
- No streaming/partial updates — one summary per completed turn.
