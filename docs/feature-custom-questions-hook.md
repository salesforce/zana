# Feature Brief: Custom Questions Component for Claude `AskUserQuestion`

**Status:** proposed / to build
**Gate:** Settings → Experimental, defaulted OFF
**Author:** orchestration lead (pre-analysis for the expert team)

## Goal

When a Claude Code session (a "claude" tab / agent in Zana Command Center) invokes
the built-in **`AskUserQuestion`** tool, instead of the user having to answer inside
the terminal, we want to surface the question in a **custom in-app Questions component**
(the same Cursor-style lettered picker the inbox already renders via `QuestionBlock`).
The terminal remains a valid fallback — the user can still answer there. This is a UX
enhancement.

**This entire behavior MUST be gated behind a new experimental setting in
Settings → Experimental, defaulted to `false`.**

## Current architecture (verified by pre-analysis — trust but re-verify)

### 1. How `AskUserQuestion` is detected today
- `src/main/harness/spawn-plan.ts` → `buildHookSettings()` (around line 570–653) builds
  the inline `--settings` JSON that registers per-session Claude hooks.
- Today, when `opts.notify` is on, it registers:
  - `hooks.PreToolUse` matched to `AskUserQuestion` → runs `postBlocked` which **reads
    and DISCARDS stdin** (`cat >/dev/null`) and POSTs to `$ZCC_NOTIFY_URL/blocked`.
  - `hooks.PostToolUse` matched to `AskUserQuestion` → `postUnblocked` → POSTs `/unblocked`.
  - `hooks.Notification` (match permission_prompt / elicitation_dialog substrings) → `/blocked`.
  - `hooks.UserPromptSubmit` + `Stop` → `/unblocked`.
- **Key insight:** the PreToolUse hook currently throws away the tool payload. To render
  the actual question + options in our component, we must instead **forward the tool-call
  JSON** (stdin) to a new host endpoint — exactly like the `firstprompt` hook does
  (`postFirstPrompt` forwards stdin via `curl --data-binary @-`).

### 2. Hook HTTP endpoints (the "control plane")
- Routes are matched in `src/main/mcp-server.ts`:
  - `matchNotifyHookRoute` → `/hook/notify/:projectId/:sessionId/:action` (blocked|unblocked)
  - `matchFirstPromptHookRoute` → `/hook/firstprompt/:projectId/:sessionId` (forwards body)
  - overseer/subagent/orchestrator routes also exist (synchronous ones echo a decision).
- The env vars (`ZCC_NOTIFY_URL`, `ZCC_FIRSTPROMPT_URL`, `ZCC_HOOK_URL`) are set per-session
  in `src/main/pty.ts` (~line 770: `${base}/hook/notify/${projectId}/${sessionId}`).
- Handlers wired in `mcp-server.ts` (`onNotifyHook`, first-prompt handler ~line 972–1038).
  A NEW endpoint (e.g. `/hook/question/:projectId/:sessionId`) that captures the question
  payload should follow the `firstprompt` pattern (drain body, invoke handler, always 200).

### 3. The answer-injection path (how the answer gets back to the agent)
- `inbox_ask` (`src/main/inbox-ask-mcp-tool.ts`) is the existing proof that we can inject a
  user's structured answer back into a live session "as if typed": it uses the same
  `terminals.reply` channel the free-text ReplyBox uses.
- `src/preload/index.ts` exposes `terminals.reply`. Search `terminals.reply` for the full path.
- **BUT:** `AskUserQuestion` is a *tool call the agent is blocking on inside its own turn*,
  not a between-turns prompt. Injecting text via `terminals.reply` may or may not satisfy the
  tool. The team MUST verify how answering works: does typing a letter in the terminal answer
  the AskUserQuestion prompt? If so, injecting the chosen letter(s) via the same pty write is
  the mechanism. **This is the highest-risk unknown — validate it early.**

### 4. The renderer Questions UI (reuse, don't rebuild)
- `QuestionBlock` is already used in `src/renderer/components/InboxDetail.tsx` and
  `FollowUpsPanel.tsx`. The structured-question schema + host-side letter assignment live in
  `src/main/inbox-question-schema.ts` (`InboxQuestion`, `InboxQuestionOption`, `buildInboxQuestion`,
  `MAX_OPTIONS`, `MAX_QUESTIONS`). Reuse this schema/rendering for consistency.
- `AskUserQuestion`'s own payload shape (questions[], each with header/question/options[],
  multiSelect) must be mapped into `InboxQuestion`. Verify the exact tool-input JSON shape
  from a real Claude hook fire.

### 5. The Experimental settings pattern (copy an existing flag)
- Experimental flags live in `src/shared/types.ts` (search `EXPERIMENTAL` — e.g. Teams, Chat,
  Goals, Follow-ups master switches ~lines 1291–1321; inbox_ask question form ~line 1222).
- UI: `src/renderer/components/SettingsPanel.tsx` renders the Experimental tab.
- State: `src/renderer/store.ts`. IPC contract: `src/shared/ipc.ts`.
- **Follow the exact same pattern** as an existing experimental boolean (e.g. the inbox_ask
  question-form flag or the Goals master switch): add the flag to the settings type, default
  false, wire the toggle in SettingsPanel, thread it into `buildHookSettings` so the
  question-forwarding hook is ONLY registered when the flag is on.

## Deliverables expected from the team
1. **Analysis/RFC** (researcher + architect): confirm the mechanism above against the real
   code, resolve the "how does answering AskUserQuestion actually work" unknown, and produce
   a concrete step-by-step implementation plan with exact files/functions to touch.
2. **Implementation** (backend-dev + frontend-dev): the gated feature end-to-end.
3. **Review** (code-reviewer): correctness, the gate is truly default-off & fail-safe (feature
   off ⇒ zero behavior change), no regression to the existing blocked/unblocked status.
4. **Tests**: unit tests for the new hook route + schema mapping; the gate on/off behavior.

## Hard constraints
- Default OFF. When off, behavior is byte-for-byte identical to today.
- Fail-open: a hook must never block or crash the agent (exit 0, best-effort curl).
- Terminal remains a working fallback for answering.
- Reuse `QuestionBlock` + `inbox-question-schema` — do not build a second question UI.
