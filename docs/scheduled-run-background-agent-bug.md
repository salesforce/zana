# Scheduled run kills the background agent it just dispatched

**Status:** Root-caused; guidance fix applied (2026-06-11)
**Symptom:** A scheduled monitor run dispatched a "background read-only agent", filed its
schedule report as `success`, and the session showed `[session exited]` while stop hooks were
still propagating (2/5). The dispatched background agent was orphaned and its work never landed.

---

## Root cause — lifecycle contradiction, not a crash

The scheduled run is *told* to dispatch background work, then *immediately torn down* the moment
its main turn ends. Claude Code's `run_in_background` sub-agents live inside the **same process
tree** as the parent `claude` process, so they die with it.

```
fire() spawns headless claude (scheduled:true, autoCloseOnFinish)   scheduler.ts:471-491
  main agent turn dispatches a background sub-agent (run_in_background)
  agent calls schedule_report(success)  ← "will finish in the background"
  main turn ENDS → Stop hook fires → /hook/stop/... → onAgentFinished()
    autoCloseOnFinish → closeExpected() → proc.kill()                scheduler.ts:687-689 → pty.ts:429
      PTY master dies → SIGHUP → background sub-agent ORPHANED        pty.ts:244 (no detach/setsid)
  scheduled session auto-reaped from the UI on exit                  store.ts:1436  →  just "[session exited]"
```

### Why it happens (file:line evidence)
1. **Scheduled runs are headless + auto-close** — `src/main/scheduler.ts:471-491` (`headless:true,
   scheduled:true, autoCloseOnFinish`).
2. **Guidance assumes turn-end = run done** — `src/main/pty.ts:61` (`SCHEDULE_REPORT_GUIDANCE`):
   *"the session is killed the moment you stop."*
3. **Stop hook → kill** — main turn ends → `onAgentFinished()` → `scheduler.ts:687-689`
   `if (autoCloseOnFinish) ptys.closeExpected(sessionId)` → `pty.ts:429 proc.kill()`.
4. **No process-group isolation** — `pty.ts:244` `pty.spawn()` has no `detached`/`setsid`, so killing
   the PTY master SIGHUPs the entire child tree.
5. **Reaped from view** — `src/renderer/store.ts:1436` auto-removes `scheduled` sessions on exit, so
   there isn't even a tombstone to inspect.

### The core conflict
**Claude Code's background-agent model and the scheduler's auto-close-on-turn-end are mutually
incompatible.** The Stop hook fires when the *main agent's turn* ends — it has no visibility into
`run_in_background` sub-agents. Auto-close always wins the race. The agent's own line in the
report — *"The dispatched agent will finish in the background and post its answer"* — describes
something the scheduler architecture cannot deliver.

---

## Fix applied — steer scheduled agents to work inline (chosen direction)

Rather than re-engineer the teardown to wait for an idle process tree (capable but complex —
needs process-tree introspection + deferred close), the chosen fix matches the existing auto-close
model: **tell scheduled agents not to dispatch background work in the first place.**

`src/main/pty.ts` — appended to `SCHEDULE_REPORT_GUIDANCE`:

> Do ALL of your work INLINE, within this single turn. Do NOT dispatch background /
> run_in_background agents and do NOT hand work off to "finish later": this session is torn down
> the instant your turn ends, which kills the entire process tree and orphans any background agent
> mid-flight — its work is lost and never lands. If a task would normally be delegated to a
> background agent, perform it yourself and wait for the result before you call `schedule_report`
> and stop.

This is appended to the scheduled run's system prompt via `--append-system-prompt` (`pty.ts:194`),
so every scheduled `claude` invocation receives it.

### Why guidance, not a hard block
The orphaning only *bites* when `autoCloseOnFinish` is on, but a background agent that survives
merely because the session happened to stay open is a latent bug regardless. Guidance covers both
cases without touching the lifecycle. We cannot mechanically prevent the model from calling the
Agent tool, so the system prompt is the right lever.

---

## Alternative considered (not taken) — defer auto-close until tree idle
Keep background dispatch working: on Stop, check whether the `claude` process still has live
children; if so, defer the kill and poll until the tree goes idle (with a max-wait cap). More
capable, but requires process-tree introspection in `pty.ts` and a deferred-close mechanism in the
scheduler. Parked unless a future use case genuinely needs scheduled runs to fan out.

---

## Verification
- `npm run typecheck` — clean.
- `npx vitest run` — 185/185 pass. No test asserts on the guidance string.
- Behavioral check (manual, recommended): trigger a scheduled run whose prompt previously delegated
  to a background agent; confirm the work now completes inline before `[session exited]`.
