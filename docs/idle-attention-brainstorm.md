# Brainstorm: "Need Attention" triage for idle agents

_Date: 2026-06-19. Status: brainstorm / pre-design. Team: 3 explorer agents mapped the LLM helper, the agent-state machine, and settings plumbing._

## TL;DR

The feature you described **already exists in embryo** as the **idle-triage add-on**
(`src/main/idle-triage.ts`). It already reuses the generic LLM helper, already has an
enable/disable setting, and already classifies _why_ an idle agent is idle. What's
missing is exactly three things:

1. A **20-second idle dwell** before triaging (today it fires on the idle _edge_, immediately).
2. **Acting on the verdict** — today the classification is only a small badge on the
   Idle card; it never promotes the agent into a "Need Attention" lane or a "Done" state.
3. The **3-level sensitivity threshold** (genuinely new — does not exist yet).

This means the work is "wire up + one new setting," not "build a subsystem."

---

## What already exists (verified in code)

| Your requirement | Existing piece | File |
|---|---|---|
| Reuse the generic LLM (tab rename / session summary) | `llmService.run(entry, vars, dedupeKey)` → `ClaudeCliProvider` spawns `claude --print`. Same path all three features share. | `src/main/llm-service.ts`, `src/main/llm/claude-cli-provider.ts` |
| Classify an idle agent | `IdleTriageService` reads the last transcript turn and runs `builtin:idle-triage` (Haiku) | `src/main/idle-triage.ts`, `src/main/prompt-registry.ts:48` |
| The verdict vocabulary | `IdleResolution = 'awaiting-reply' \| 'done' \| 'paused' \| 'unknown'` **+ a `confidence` 0–1** | `src/shared/types.ts:325` |
| Enable/disable in Settings | `idleTriageEnabled?: boolean` toggle | `src/renderer/components/SettingsPanel.tsx:343`, `src/main/store.ts:262` |
| Fire on going idle | `idleTriage.observe(sessionId, state)` on every status change; one-shot per idle spell | `src/main/index.ts:1161` |
| Stream verdict to UI | dedicated `onIdleTriage` IPC channel → `useIdleTriage` store → badge on card | `src/shared/ipc.ts`, `src/renderer/components/AgentBoard.tsx:251` |

`IdleResolution` maps **1:1** onto your three outcomes:
- `awaiting-reply` → **Need Attention**
- `done` → **Done**
- `paused` / `unknown` → **stay Idle**

So the model already produces the right verdicts. We just don't _do_ anything with them yet.

---

## The three gaps to close

### Gap 1 — 20-second idle dwell (currently fires immediately)

Today `IdleTriageService.observe()` fires the LLM call the instant an agent crosses
`working → idle`. You asked for "check after 20 sec when an agent is IDLE." This is the
right instinct: agents flicker idle for 1–2s between tool calls, and triaging those
wastes Haiku calls and produces noise.

**Approach:** add a dwell timer (the codebase already has this exact pattern in the
heartbeat feature, `heartbeatDelaySeconds`, clamped 10–600s). On the idle edge, start a
timer; if the agent is still idle when it fires, _then_ triage. Any non-idle state cancels
the timer. The one-shot-per-spell gate already in `observe()` stays.

- Reuse `heartbeatDelaySeconds`' clamping idiom; add `idleTriageDelaySeconds` (default 20).
- This also naturally throttles cost: a busy agent that never sits still for 20s is never triaged.

### Gap 2 — act on the verdict (promote to a lane / mark done)

Today the verdict renders as a **badge inside the Idle lane** (`TRIAGE_BADGE`,
`AgentBoard.tsx:251`) — informative but passive. The board lanes are:

```
blocked ("Needs you") → working → delegating → idle → done(=exited)
```

To make agents that "need attention" actually surface, promote them by verdict:

- **`awaiting-reply` → the "Needs you" lane.** This lane already exists (`key:'blocked'`)
  and is rendered first/most-urgent. Today it only matches `state === 'blocked'` (the
  hook-driven permission-prompt signal). We'd widen its match to also include
  _idle agents whose triage says `awaiting-reply`_. This is the single highest-value change:
  it's the difference between "a badge you might notice" and "the card jumps to the top."
- **`done` → a "Ready" treatment.** ⚠️ The literal `done` lane today means **exited
  sessions only** (`c.session.status === 'exited'`). An idle-but-still-running agent
  classified `done` is NOT exited. Don't overload that lane. Two clean options:
  - (a) keep it in Idle but with a distinct "ready to close" badge + sort it to the
    bottom of Idle (lowest urgency), or
  - (b) add a new `ready` lane between idle and done. Recommend (a) for v1 — less churn,
    and the existing Close-idle action already operates on the Idle lane.
- **`paused` / `unknown` → stay Idle** (current behavior, no change).

This is a renderer-side lane-matching change plus reusing the verdict already in the store —
no new main-process state.

### Gap 3 — the 3-level sensitivity threshold (NEW)

This is the only genuinely new concept. You framed it as "some users want every question
to require attention, others less." That's a **sensitivity dial** governing the
verdict → lane mapping, and we already have `confidence` to drive it.

Proposed `idleAttentionSensitivity?: 'high' | 'medium' | 'low'` (default `medium`):

| Level | Promotes to "Needs you" when… | Effect |
|---|---|---|
| **High** ("tell me everything") | `awaiting-reply` **OR** `paused`/`unknown` | Almost any non-`done` idle agent surfaces. Maximally cautious; more interruptions. |
| **Medium** (default) | `awaiting-reply` (any confidence) | Only genuine questions surface; paused/unknown stay Idle. |
| **Low** ("only when sure") | `awaiting-reply` **AND** `confidence ≥ 0.7` | Only high-confidence questions surface. Quietest; minimal false alarms. |

Why this design:
- It reuses the **`confidence` field that already exists** in `IdleTriageResult` — no new
  LLM output, no prompt change.
- It's a pure **renderer-side mapping** (verdict + confidence + level → lane), so it's
  trivially unit-testable and changing it never spends a token.
- The three named levels match the existing enum-setting idiom (`defaultModel`,
  `theme`) in `store.ts`'s `normalizeConfig` and the `<select>` pattern in `SettingsPanel`.

(Alternative considered: per-level _confidence thresholds_ as raw numbers. Rejected for v1 —
harder for users to reason about than "high/medium/low," and the named levels can encode
the thresholds internally anyway.)

---

## Recommended slice (smallest thing that delivers the value)

1. **`store.ts` + `types.ts`**: add `idleTriageDelaySeconds` (default 20, clamp 10–600) and
   `idleAttentionSensitivity` (`'high'|'medium'|'low'`, default `'medium'`). Follow the
   existing `heartbeatDelaySeconds` / `defaultModel` normalization idioms exactly.
2. **`idle-triage.ts`**: add the dwell timer before firing (cancel on leaving idle). Inject
   `delaySeconds()` the same way `isEnabled()` is injected, so the toggle is live.
3. **`AgentBoard.tsx`**: a pure `verdict + confidence + sensitivity → lane` function; widen
   the "Needs you" lane match to include `awaiting-reply` idle agents per the level; give
   `done` idle agents a "ready to close" badge + bottom sort.
4. **`SettingsPanel.tsx`**: under the existing idle-triage toggle, reveal (when enabled) the
   delay number field and the sensitivity `<select>`. Both follow patterns already on the page.
5. **Tests**: extend `idle-triage` tests for the dwell timer (deterministic via injected
   `now`); add a renderer test for the mapping table (the codebase already has
   `cohort-bar.test.ts` / `favoriteKey.test.ts` style pure-function renderer tests).

Everything reuses an existing seam. No new IPC channel (the `onIdleTriage` channel already
carries the verdict + confidence). No new LLM prompt. No main-process state beyond one timer.

## Open questions for you

1. **Done idle agents** — badge-and-sort within Idle (recommended, less churn), or a
   distinct "Ready" lane?
2. **Auto-close on `done`?** You hinted "we even mark it as DONE." Do you want triage to be
   purely _advisory_ (surface it), or to actually trigger the existing Close-idle action
   automatically for high-confidence `done` agents? (Auto-acting on an LLM verdict is a
   bigger trust step — I'd default to advisory for v1.)
3. **Default sensitivity** — confirm `medium` (only real questions surface) is the right
   out-of-box behavior.
4. **Naming** — keep "idle-triage" internally, surface as "Need Attention" in the UI? Or
   rename throughout?
