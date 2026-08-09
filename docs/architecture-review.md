# Architecture Review — Zana Command Center

**Reviewed:** 2026-06-13 · **Version:** 0.5.0 · **Design point:** personal cockpit (one power user, ~10–20 projects, up to ~20 concurrent terminals, ~10 schedules, months of history)

> This plan file *is* the deliverable. On approval I will save it verbatim to `docs/architecture-review.md` (the only write). No code changes.

---

## Context

You asked three questions: (1) is the architecture **correct**, (2) are extensions **properly disconnected/decoupled**, (3) can it **scale**. A team of explorers swept the core runtime, the extension/plugin system, and the persistence/scheduler/scaling paths; I then verified the load-bearing claims directly against source. This document records the verdict, the evidence, and a severity-ranked fix list scoped to a personal-cockpit workload.

**Headline:** The architecture is **sound and, in places, genuinely sophisticated.** Process boundaries, the typed IPC contract, the single-mount terminal, and especially the extension trust model are well above the bar for a solo-built Electron app. Decoupling is **excellent** — verified, not just claimed. The real risks are **operational scaling sharp edges** (3 of them) and **doc/comment drift**, not structural flaws.

---

## Verdict at a glance

| Dimension | Verdict | Confidence |
|---|---|---|
| Process model & security hardening | ✅ Strong | High (verified) |
| IPC contract & segmentation | ✅ Strong | High (verified) |
| Terminal / PTY architecture | ✅ Strong design, ⚠️ one hot-path gap | High (verified) |
| **Extension decoupling** | ✅ **Excellent** | High (verified) |
| Extension trust/isolation (main) | ✅ Strong | High |
| Extension trust/isolation (renderer panels) | ⚠️ Curated-trust only (by design, deferred) | High |
| Persistence / unbounded growth | ⚠️ 2 sharp edges | High (verified) |
| Scheduler / background execution | ✅ Solid, ⚠️ no global cap | High |
| Doc & comment accuracy | ⚠️ Drifted | High (verified) |

---

## 1. Is the architecture correct?

**Yes.** The bones are right.

- **Clean 3-process Electron model** with hardened defaults: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, webview scheme allowlist (`src/main/index.ts:432`). No raw `ipcRenderer` leak — renderer talks only through the typed `window.cc` bridge (`src/preload/index.ts`). This is the gold-standard config; many shipping Electron apps get it wrong.
- **Typed IPC contract** in `src/shared/ipc.ts` — domain-namespaced channels (`projects.*`, `terminals.*`, `scheduler.*`, …), not a god-channel. `safeHandle` wraps every handler so one failure can't take down IPC (`index.ts:380`). High-frequency events (`onData`, `onAgentStatus`) ride dedicated channels, and `onAgentStatus` is deliberately kept *off* `onUpdated` to avoid render storms (`ipc.ts:30`).
- **Single-mount terminal** (`TerminalSurface.tsx`): one xterm instance per session, portaled into the active view and toggled with `display:none` rather than unmounted — scrollback survives navigation without a main-side replay buffer. This is the right trade and a non-obvious one.
- **Agent-status tracker** (`agent-status.ts`) parses OSC titles + braille spinner off the render path, debounced 250ms. Cheap, works for hidden tabs.

**Structural weaknesses (low severity at this scale):**
- `src/main/index.ts` is ~1,744 lines, ~780 of which are IPC handler registration. Not wrong, but it's the one file that will keep growing; extracting handlers into per-domain `ipc/*.ts` modules would age better.
- `useUi` zustand store (~610 lines) holds many per-project maps. Fine at 10–20 projects; worth watching, not fixing.
- **Renderer crash = scrollback loss.** Main keeps PTYs alive but the renderer's xterm instances (and their history) are gone. Accepted trade for the no-replay design; flagging so it's a *known* trade, not a surprise.

---

## 2. Are extensions properly disconnected? — **Yes, verified**

This was the central question, and the answer is the strongest part of the review.

### The "two parallel mechanisms" is not duplication

`extensions/` and `plugins/` look like competing generations but are a deliberate **two-tier source→packaging** split:

- **`plugins/<id>/`** = the *feature source* (main logic, renderer panels, shared types).
- **`extensions/<id>/`** = a thin *packaging layer*: a vite build + entry wrappers + React shims + an `extension.json` manifest that turns that source into two self-contained ESM artifacts (`dist/main.mjs`, `dist/renderer.js`).

Verified directly — `extensions/gus/src/main-entry.ts` is literally:
```ts
import { gusMainModule } from '../../../plugins/gus/main/gus-main.js';
export default gusMainModule;
```
gus exists in both places because it **dogfoods the full disk-extension pipeline** (built from `plugins/`, shipped as an isolated disk extension). No logic is duplicated.

### Core has near-zero knowledge of specific extensions — verified

A full grep of `src/` for plugin/extension imports and hardcoded module IDs returns:
- **Exactly two** compile-time imports of a specific module: `zanaModule` (renderer) and `zanaMainModule` (main). Both are *intentional* — zana uses native `better-sqlite3` and can't cross the process boundary, so it stays in-process.
- **Zero** `if (moduleId === 'gus')` / `case 'gus'` style branches anywhere. Discovery, loading, dispatch, storage, and UI all operate on `moduleId` as an opaque string.
- `APP_MODULES = [zanaModule]` / `MAIN_MODULES = [zanaMainModule]` are the only registration points; disk extensions are merged in generically (`src/renderer/modules/index.ts:35`).

That is **textbook decoupling**: a one-way dependency (extensions → SDK), a generic registry, and no identity-switching in core.

### Isolation model is real

- **Disk extensions** run out-of-process — one Electron `utilityProcess` each (`process-host.ts`), bootstrapped by a trusted `host-child.ts` that then `import()`s untrusted code behind a **3-layer Node-builtin denylist** (ESM loader hook + CJS `require` patch + neutered `process.binding`, in `host-child-guard.ts`).
- Capabilities (`exec`, `fs`, `fetch`) are **deny-by-default** and brokered against the manifest (`permission-broker.ts`), e.g. gus declares `permissions: ["exec", …]` with `execAllowlist: ["sf"]` and gets nothing else.
- The published contract lives in `packages/extension-sdk` with an API-version gate (`engines.zccApi: "^1.0.0"`, `checkApiCompat`).

### The one honest limitation (by design)

**Renderer panels are curated-trust, not sandboxed.** Panels are blob-imported into the *main* renderer and share one `window.cc`, so a malicious panel could bypass the injected `host` and call `window.cc.fs.writeFile` etc. directly. The host gate is **advisory** at the renderer boundary. This is documented and deliberately deferred (P3-C: iframe-per-panel). The catastrophic vector — untrusted *main-side* code running in-process — is already eliminated. For a curated/first-party extension set this is the correct line; revisit only if you accept third-party panels.

**Decoupling fix needed: none structural.** Only doc/comment drift (see §4).

---

## 3. Can it scale? — Yes for a personal cockpit, after 3 sharp edges

At the target scale the architecture holds. Three hot paths will bite even a single heavy user and are worth fixing; the rest are "watch, don't fix."

### 🔴 P1 — PTY output is unbatched across IPC
`pty.ts:371` emits on every `proc.onData` chunk and `index.ts:481` forwards each one as an individual IPC message — no coalescing. A chatty command (`npm install`, `git log`) at several busy sessions floods the main→renderer pipe with hundreds of tiny messages/sec, and there's no backpressure if the renderer is slow.
- **Fix:** coalesce per-session on a ~8–16ms timer (or size threshold) before `safeSend`. Small, localized change in the `ptys.on('data')` path. Keep `agentStatus.observeData` on the raw stream.
- **Effort:** S.

### 🔴 P2 — Zana SQLite has no indexes, full-scans on the main thread
Verified: **zero `CREATE INDEX`** in `plugins/zana/main/zana-db.ts`. Every ticket list is `SELECT * FROM tickets ORDER BY updatedAt DESC` — full scan + in-memory sort, synchronous on the Electron main loop. Fine at dozens of tickets; a few thousand and the UI stutters on every panel open.
- **Fix:** add `CREATE INDEX idx_tickets_updated ON tickets(updatedAt DESC)` (+ any status/sprint filters you query on) at table-init. Optionally cap/paginate the list query. No worker thread needed at this scale.
- **Effort:** S.

### 🔴 P3 — Inbox JSONL grows unbounded; O(n) read + full-rewrite delete
`inbox-store.ts` parses the entire `entries.jsonl` on every `read()` and rewrites the whole file to delete one entry. Already 461 entries today; scheduled runs append steadily with no retention. Months of history → noticeable blocking on inbox open/delete.
- **Fix (pick one):** (a) tail-read last N + paginate, plus a retention cap / monthly rotation; or (b) move inbox to the same SQLite store with an index on timestamp. (a) is the smaller change and matches the cockpit scale.
- **Effort:** S–M.

### 🟠 Worth doing, lower urgency
- **No session cap** (`pty.ts` create has no guard). Unlikely to hit 20 by hand, but the scheduler can spawn headless sessions. Add a soft warn at ~20 and/or a hard cap. *Effort: S.*
- **No global scheduler concurrency cap.** Per-schedule `overlap: 'skip'` prevents single-schedule stampedes, but N schedules firing together = N concurrent `claude` processes. At ~10 schedules this is fine; add a small global parallel cap (e.g. 5) as cheap insurance. *Effort: S.*
- **`PtyManager` / `SchedulerManager` don't `setMaxListeners`** — cosmetic "possible memory leak" warning past 10 sessions (listeners *are* cleaned up on exit). Set to ~100. *Effort: XS.*

### 🟡 Watch, don't fix at this scale
xterm 5000-line scrollback × many tabs (~16MB at 20 tabs — acceptable); schedule JSON rewritten twice per fire (fine at ~10 schedules); `.mcp.json` not cleaned on project removal (minor litter).

### Strengths to preserve
Atomic tmp+rename writes everywhere; zana WAL read-only isolation; schedule history ring-buffer (bounded); quit confirmation guarding live sessions; robust child-process teardown on quit.

---

## 4. Doc & comment drift (cheap, high-clarity wins)

Verified inaccuracies that will mislead the next reader (or you, in three months):

- Comments in `permission-broker.ts:6`, `module-router.ts:5`, `index.ts:1521` say **"built-in MAIN_MODULES (gus, zana)"** but `MAIN_MODULES = [zanaMainModule]` only — **gus is now a disk extension**. Update comments to say zana-only.
- `@xterm/addon-serialize` is a dependency (`package.json`) but **unused** — the no-replay design never serializes. Either remove the dep or note why it's retained.
- The `docs/extensions-phase*` series describes intent across phases; a short "current state" note (zana = only built-in; gus/slack/cu = disk; renderer sandbox = deferred P3-C) at the top of `docs/extensions.md` would save future archaeology.

*Effort: XS. No code behavior change.*

---

## Recommended sequencing

1. **Doc/comment drift (§4)** — XS, do first; makes everything else readable.
2. **P2 zana index** + **P3 inbox retention** — S each; remove the two unbounded-growth/main-thread-block edges.
3. **P1 PTY batching** — S; the one true runtime hot path.
4. **Soft session cap + global scheduler cap + `setMaxListeners`** — S/XS; cheap insurance.
5. Leave renderer-panel sandboxing (P3-C) deferred unless third-party panels enter scope.

None of these are rewrites. The architecture is correct; this is hardening the three operational edges and truing up the docs.

---

## Verification (how to confirm the fixes end-to-end)

- **PTY batching:** open a session, run `yes | head -100000` (or `npm install`), confirm output renders smoothly and main-process CPU stays flat; assert in a unit test that N rapid `proc.onData` chunks within the window produce 1 `safeSend`.
- **Zana index:** `EXPLAIN QUERY PLAN SELECT * FROM tickets ORDER BY updatedAt DESC` shows index use, not `SCAN`; seed ~5k tickets and confirm panel-open stays sub-frame.
- **Inbox retention:** append past the cap, confirm `read()` reads only the tail and delete no longer rewrites the whole file; existing `inbox-store` tests stay green.
- **Caps:** spawn sessions past the soft limit → warning fires; arm > cap schedules to fire simultaneously → only the cap run concurrently, rest queue/skip.
- **Docs:** re-grep `MAIN_MODULES` comments for "gus" → none remain in the built-in context.
- Run `npm test` and `npm run typecheck` after each change.
