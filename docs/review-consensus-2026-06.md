# Architecture Review — Team Consensus (2026-06-14)

**Method:** 8 reviewers, 2 per section (an **architect** for design/scale + a **code-reviewer** for defects), run in parallel, each independently validating-or-challenging the prior solo review (`docs/architecture-review.md`) and the recent P1–P3 commit (`42f4f20`). This document is the orchestrator's convergence: where the pair **agreed**, where they **diverged**, and the **cross-section themes** that emerged. It feeds the drafted Claude rules (`docs/claude-rules-DRAFT.md`).

Sections: **Core** (main/IPC/pty/preload) · **Extension system** · **Persistence & Scheduler** · **Renderer & State**.

---

## Headline

The architecture is **confirmed sound** by every pair — decoupling is genuinely excellent, the security broker has no critical bypass, selector discipline and the single-mount terminal are correct. But the parallel review surfaced **defects the solo review missed**, including **one real data-loss bug in code we just shipped**. The most valuable outcome: two independent reviewers converged on the same Core bug, and a second reviewer caught a race in the P3 inbox fix that passed its own tests.

### Severity-ranked consensus findings

| # | Sev | Finding | Section(s) | Agreement |
|---|-----|---------|-----------|-----------|
| 1 | 🔴 | **`createWindow()` re-subscribes `ptys`/`agentStatus` listeners with no teardown** → on window reopen, every PTY chunk is sent to the renderer 2×, 3×… + listener leak | Core (×2) | **Both Core reviewers, independently** — high confidence |
| 2 | 🔴 | **Inbox compaction can silently drop a concurrently-appended entry** (read-rewrite race; appends are fire-and-forget). Introduced/widened by P3. | Persistence | rev-persist; not caught by P3's own tests |
| 3 | 🟠 | **Extension child inherits full parent `env`** — untrusted `setup()` sees every secret in the main process; exfiltrable via one granted capability | Extension | rev-ext (new; not in residuals doc) |
| 4 | 🟠 | **`register_project` (MCP) + `modules.pushInbox` accept paths/projectIds with no trust/existence gate** — agent/extension input becomes a trust anchor | Core, Extension | rev-core; arch-ext (cross-confirmed angle) |
| 5 | 🟠 | **`window.cc` is reachable raw from panels** — `terminals.create` does no main-side `extraArgs` sanitization; the renderer gate is advisory | Core, Extension | arch-ext + arch-core + rev-core (3×) |
| 6 | 🟠 | **Extension `manifest.id` never reconciled with directory name** — folder name is the real security identity; rename detaches consent/storage; can shadow a built-in | Extension | rev-ext (new) |
| 7 | 🟠 | **No global scheduler concurrency cap; no live-session cap** — N aligned schedules spawn N `claude` processes; scheduler can spawn ptys unbounded | Persistence, Core | arch-persist + rev-core + rev-persist |
| 8 | 🟠 | **Zana list query has no `LIMIT`** — P2 index fixed the sort, but every ticket is still parsed on the main thread per panel open | Persistence | arch-persist + rev-persist |
| 9 | 🟠 | **`store.ts init()` opens ~14 IPC subscriptions, discards every disposer** — bounded today (no StrictMode), latent on remount/HMR | Renderer | rev-render |
| 10 | 🟠 | **Sync I/O on the main event loop** (`getConfig` per-call, `library-store.list()` full-dir scan, scheduler/store/library sync `fs`) | Core, Persistence | arch-core + arch-persist |
| 11 | 🟡 | **Doc/comment drift**: "built-in MAIN_MODULES (gus, zana)" at ≥4 sites (gus is now disk); stale `grantFromManifest` "granted = declared" comment; unused `addon-serialize` dep | All sections | unanimous |

### What the parallel review corrected in the solo doc (`architecture-review.md`)

- **Store size**: claimed "~610 lines" → actually **2309 lines, 15 stores** (`arch-render`). "Watch, don't fix" understated it.
- **Extensions framing**: "every extension is a packaging shim over `plugins/`" → only true for gus/slack; **cu is self-contained** (no `plugins/cu`), proving an extension needs nothing from `plugins/` (`arch-ext`). Better decoupling than claimed, wrong mental model.
- **`pushInbox` "`_moduleId` ignored"**: **stale/fixed** — it is now broker-gated (`arch-ext`).
- **Persistence model**: "UI prefs via localStorage" → actually **three channels** (raw `cc.*`, zustand `persist` `cc.*.vN`, IPC `config.set`), split by durability need, not UI-vs-server (`arch-render`).
- **Listener note**: solo doc called it a "cosmetic maxListeners warning, cleaned up on exit" → **wrong mechanism**; the real leak is manager-singleton re-subscription via `createWindow` (`arch-core`).

### Where reviewers diverged / nuanced (preserved, not averaged)

- **P1 PTY batching**: both Core reviewers ruled it **correct** (ordering, flush-before-exit, timer cleanup) — but `rev-core` added that `killAll()` on quit doesn't *synchronously* drain, so the "no bytes dropped" comment is not strictly true on deliberate quit (cosmetic). `arch-core` rated it fully clean. **Consensus: correct, with a one-line caveat on the quit path.**
- **Persistence strategy**: `arch-persist` judged the four storage shapes (JSONL / per-file JSON / per-dir manifest / SQLite) **defensible, do not converge** — but flagged the sync-vs-async `fs` inconsistency as real drift. Converge the *I/O discipline*, not the stores.
- **OSC-title detection on coalesced stream**: `rev-core` noted merging is strictly *better* for detection; the residual (a sequence split across two 8ms windows) **pre-existed** batching and is not a regression. No action.

### Strong positive confirmations (verified, not assumed)

- **Decoupling**: entire compile-time coupling is **2 lines** (zana); zero `if (moduleId===)` branching; one-way SDK dependency holds across all 3 extensions + 3 plugins.
- **Security broker**: deny-by-default enforced; fs gate does lexical + realpath double-check (symlink escape closed); fetch re-asserts `net` per redirect hop (SSRF closed); exec is `shell:false` + basename allowlist; net check fail-closed on subdomains/trailing-dot; `checkApiCompat` fails closed. **No critical main-side bypass.**
- **Renderer**: selector discipline rigorous (zero offending inline selectors; Explorer over-flagged 3, all verified safe); single-mount portal invariant holds; session restore is parse-safe, idempotent, well-tested.
- **Scheduler**: missed-fire **skip-not-replay** on restart is correct for a no-daemon design; per-schedule `overlap:'skip'` correct; run-history ring-buffer bounded.

---

## Per-section verdicts

- **Core** — *Adequate.* Strong process model + IPC contract; one real 🔴 (window re-entrancy) + trust-gate gaps. P1 validated.
- **Extension** — *Strong.* Decoupling + main-side isolation genuinely excellent and evolved past the phase-3 doc (P3-A/B/D landed). Real gaps: env inheritance, id↔dir identity, renderer curated-trust ceiling (P3-C, accepted).
- **Persistence** — *Sound, one 🔴.* Atomic writes universal; P2/P3 designs right; the compaction race + tmp-collision are concrete bugs; sync-I/O + unbounded-beyond-inbox are latent.
- **Renderer** — *Strong.* Best-reasoned code in the tree (restore, rollup). One latent subscription-disposal gap; store growth under-tracked.

---

## Cross-section themes (these drive the rules)

1. **Trust boundary discipline** — renderer/agent/extension-supplied input (paths, projectIds, launch args) becomes a trust anchor without main-side validation (findings 4, 5, 6). The renderer gate is advisory; **authority must live in main.**
2. **Lifecycle & resource release** — subscriptions and per-session resources registered without a matching teardown (findings 1, 9). Re-entrancy (`createWindow`, `init`) turns "runs once" assumptions into leaks.
3. **Bounded & serialized persistence** — unbounded growth, un-serialized read-rewrite races, sync I/O scaling with data size (findings 2, 7, 8, 10). Only the inbox got a bound, and its compaction introduced a race.
4. **Provenance & isolation integrity** — the two-tier trust model is sound but leaks at the edges (env, identity); guard layers and consent intersection must stay intact (findings 3, 6).
5. **Comment/contract truth** — provenance comments and seam comments have drifted and *mislead trust reasoning* (finding 11). In security code, a stale comment is a hazard.
