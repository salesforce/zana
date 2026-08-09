# ZCC Engineering Rules — DRAFT

> **Status: DRAFT for review.** Distilled by the orchestrator from a parallel 8-agent architecture review (see `docs/review-consensus-2026-06.md`) plus a targeted re-review of the slack-as-built-in promotion. Not yet adopted, not yet wired into `CLAUDE.md`. Strict but deliberately lean — each rule is one enforceable line, not a tutorial. Review, cut what you won't enforce, then promote the survivors into `CLAUDE.md`.

These are the rules that, had they existed, would have prevented the findings the reviews surfaced. Each cites the finding it guards. Rules tagged *(slack re-review)* came from the second pass over the in-process built-in tier.

---

## 1. Trust boundaries — authority lives in main, never the renderer

1. **The renderer is untrusted.** Any filesystem path, project id, cwd, or launch arg that originates in the renderer, an agent (MCP), or an extension MUST be validated in the **main process** before use — never rely on a renderer-side gate, which is advisory only. *(findings 4, 5)*
2. **Validate paths against a registered root.** A renderer/agent-supplied path becomes a trust anchor only after `realpath`-comparison against a registered project (or a HOME/base-dir gate). Applies to every IPC handler and MCP tool, not just `fs.*`. *(finding 4)*
3. **Sanitize launch args in main.** Any IPC/MCP path that can spawn or drive a session MUST sanitize `extraArgs` and attribute the caller in the main handler. `terminals.create`/`reply` security must not depend on the renderer. *(finding 5)*
3a. **Gate launch-arg sanitization on "input may be untrusted," not on extension provenance.** A built-in that consumes remote input (Slack commands, webhooks, inbound events) MUST sanitize launch args too — `extensionGrants.has(id)` is the wrong gate the moment a built-in's *input* is remotely controlled. *(slack re-review)*
4. **No third-party renderer code until panels are sandboxed.** Panels share one `window.cc`; only curated/first-party panels may ship until iframe + origin-authenticated `postMessage` (P3-C) lands. *(finding 5)*

## 2. Lifecycle — every acquisition has a matching release

5. **Subscribe long-lived emitters once, at module init — never inside `createWindow()`** or any re-entrant path; if a binding must live with the window, detach it in `win.on('closed')`. *(finding 1)*
6. **Every `window.cc.*.onX` subscription captures its disposer and calls it in a cleanup path** (effect cleanup or a tracked disposer list) — never fire-and-forget, even inside a "runs once" `init()`. *(finding 9)*
7. **Guard one-shot global init with a module-level flag** — never rely on the absence of StrictMode or the stability of an effect dependency. *(finding 9)*
8. **Every per-session resource (PTY buffer, flush timer, agent-status entry, named-session id) is released on the `onExit`/`remove` path**, and the exit path flushes any pending buffer before emitting `exit`. *(findings 1, P1)*
9. **Long-lived `EventEmitter`s that fan out per-session call `setMaxListeners` deliberately** and document the ceiling — the default 10 is a latent-bug detector, not a limit to silence. *(finding 1)*
9a. **Clear timers/intervals on the app-quit path, not only on feature-disable.** A module that installs `setInterval` MUST have its teardown reached by `before-quit` (e.g. a `teardownAll()` on the module host wired next to the disk-ext one) — disk-ext and built-in modules get symmetric shutdown. *(slack re-review)*
9b. **A fixed-cadence `setInterval` driving un-awaited async work needs an in-flight guard** (skip the tick if the previous is still running) and any network call on it needs an explicit timeout/abort — global `fetch` has none. *(slack re-review)*

## 3. Persistence — bounded, serialized, atomic, off the hot path

10. **Every append-only or accumulating store declares a retention bound** (count, age, or ring-buffer) at creation. An unbounded `appendFile`/push-to-disk is a defect. *(findings 2, 7)*
11. **A shared file's read-modify-write is serialized through a single in-process mutex** (or is strictly append-only with no rewriter) — never let two paths independently read-then-rename the same file. *(finding 2)*
12. **All file writes are atomic** via tmp + rename, and the tmp path carries a unique suffix (`pid+timestamp`) — a constant `.tmp` is a corruption vector under concurrency. *(finding 2)*
13. **No synchronous file/DB I/O whose cost scales with stored-data size on the main event loop** — bound it, `LIMIT` it, paginate it, or move it off-thread. *(findings 8, 10)*
14. **Best-effort housekeeping never fails, slows, or drops the operation it piggybacks on**; memoize one-shot side effects *before* the attempt so a failure can't retry-storm. *(findings 2, 8, P2)*
15. **DDL on a database ZCC does not own is additive, `IF NOT EXISTS`, vendor-namespaced, and best-effort** — never block the read path on it. *(P2)*

## 4. Scheduler & background execution

16. **The scheduler enforces both per-task overlap-skip AND a global concurrency cap**, and on restart re-arms to the next future fire (skip missed runs) rather than replaying catch-up. *(finding 7)*
17. **Spawning paths enforce a live-session cap** so a programmatic (scheduler) caller cannot spawn ptys unbounded. *(finding 7)*
18. **Self-triggered file-watch reloads are gated by a generation/identity token or content/mtime compare — never a bare wall-clock suppression window** that can drop a racing external edit. *(finding, scheduler)*

## 5. Extension system — keep it decoupled and isolated

19. **Core never references an extension by id in logic.** The only permitted appearances of a concrete extension id in `src/` are the `MAIN_MODULES`/`APP_MODULES` registration imports — never an `if`/`case`/lookup that changes behavior. *(decoupling)*
20. **Extensions and plugins import core only through `@zana-ai/zcc-extension-sdk`** (`/main`, `/renderer`, `/helpers`). Any import from `../src/` or `@shared/*` is a decoupling violation. *(decoupling)*
21. **An extension's operative identity is one value** — reject at discovery any extension whose `manifest.id` differs from its directory name, or collides with a built-in id. *(finding 6)*
22. **The extension child runs with an explicit minimal environment** — never hand a `utilityProcess` child the parent's full `env`. *(finding 3)*
23. **New capabilities are deny-by-default and broker-gated by provenance**: add a token to `ExtensionPermission`, gate it in `permission-broker.ts` keyed by the host-authenticated id, and reach it from the child only via a `host-child.ts` broker stub. *(isolation)*
24. **Host-child guard layers are append-only** — never remove or weaken a denylist layer or shrink `DENIED_BUILTINS`; a new escape vector gets a new layer. *(isolation)*
25. **Never widen an effective grant without consent + re-prompt** — the grant provider always returns `declared ∩ consented`. *(consent)*

## 6. Trusted (built-in) tier — promotion is a deliberate, bounded act

27. **Trusted-tier parity:** a built-in capability (`builtinExec`, `builtinFetch`, future) MUST be at least as restrictive as its broker-gated twin on every non-permission axis (redirect handling, streaming body cap, argv shape, timeout); it may drop only the permission/allowlist check, never a structural safety control. *(slack re-review)*
28. **Promotion criterion:** an extension may be promoted from disk to built-in only when it provably needs a capability the broker cannot safely grant even scoped; the promoting commit names that capability and why a scoped disk grant is insufficient. "It's curated core" is not by itself sufficient. *(slack re-review)*
29. **A shared capability added to the built-in `MainModuleContext` widens the trusted surface for every built-in** — adding one (e.g. an ungated `fetch`) requires the same scrutiny as a new broker capability, and a structural constraint analogous to `builtinExec`'s `shell:false`+argv. *(slack re-review)*

## 7. Contract & comment truth

26. **A comment that states a security/trust fact must match enforced behavior, updated in the same diff as the behavior** — a stale provenance or grant comment is a hazard, not a nit. Keep "built-in" comments in lockstep with `MAIN_MODULES`. *(finding 11)*

---

### Notes for the reviewer (you)

- **Every rule here is now backed by a shipped fix.** Over this session all the findings these rules guard were fixed across four commits (`92283f6`, `7a9d3d7`, `95e73e5`, + the low-sev pass). So these aren't aspirational — each rule describes a mistake we actually made and corrected. That's the strongest case for adopting them: they're regression-guards, not theory.
- **Candidates to cut if too strict:** #9 (setMaxListeners on every emitter may be noise), #18 (generation-token watch may be over-engineering at this scale), #29 (could fold into #23/#27), #7 (Contract & comment truth #30 could absorb it).
- **Highest-value to adopt** (each maps to a 🔴 we hit): #5/#8 (window re-entrancy), #11/#12 (inbox compaction race), #27/#9a (the slack built-in-tier regressions — parity + teardown). These are where the cost of *not* having the rule was a real bug.
- **Decay-preventers** (codebase passes them today): #19, #20, #23, #24, #28 — they keep the boundary from eroding, which is exactly how the slack regressions slipped in (a promotion that landed after the review).
- **The slack re-review is the cautionary tale:** rules #27–#29 exist because a trust-boundary change (`96e7a2f`) landed *after* the architecture review and silently weakened `ctx.fetch`. Adopt-and-enforce, or re-review every trust-tier change after the fact.
