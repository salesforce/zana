# Architecture Review — Dimension §1.4: Concurrency & Resource-Lifecycle / Performance

**Reviewer:** Researcher B · **Date:** 2026-06-26 · **Dimension:** §1.4 (Rules 3 & 5)
**Scope traced:** `src/main/**` event-loop hot paths, stores, per-session resources, app lifecycle.
**Method:** input→sink trace per suspect; QA review (`docs/qa-expert-review-2026-06-26.md` #5/#6) cross-referenced but independently re-cited. Confidence capped at `likely`/`needs-followup` per contract §4 (a later verify pass confirms high/critical).

---

## Coverage notes — reviewed-clean attestations

- **transcript-reader.ts** — *the correct windowing twin.* `readLastAssistantText` (256 KB tail) and `readSessionDigest` (2 MB tail) use async `readFile` then slice the string tail BEFORE `JSON.parse`, so the parse cost is bounded regardless of file size; both swallow errors and never throw (`transcript-reader.ts:161-204`). **Reviewed clean: traced 3 entry points** (index.ts:436, 525 last-text; 542 digest).
- **inbox-store.ts** — *the exemplary store.* Append-only JSONL, tiered retention caps (5000 protected / 500 quiet, `inbox-store.ts:109-120`), amortized compaction with slack (`246-299`), single in-process mutex `runExclusive` on every read-modify-write (`211-220`), atomic tmp+uniquely-suffixed rename, paginated `read()` with `limit` (`411-442`). **Reviewed clean: traced append/read/delete/deleteMany/coalesce.**
- **agent-message-log.ts** — in-memory; retention `prune(maxAgeMs)` (`120-134`) IS wired to a `setInterval` armed once at app init (`index.ts:3103-3105`) and cleared in `before-quit` (`index.ts:3363-3366`). Append/pull/history are O(n) over a pruned array. **Reviewed clean: traced append/prune lifecycle.**
- **agent-registry-store.ts** — in-memory `Map`, strictly session-lifetime-scoped: seeded on `sessionUpdated`, dropped on pty exit (`index.ts:1152`); `setMaxListeners(50)`, dispose-returning `onChanged`. No unbounded growth. **Reviewed clean: traced upsert/drop/find.**
- **pty.ts** — per-session output buffers + flush timers are created lazily and torn down on exit via `clearDataBuffer` (`pty.ts:302-307`, clears the pending `setTimeout`); a hard live-session cap fails BEFORE allocating a process/fd (`assertCapacity`, `338-346`). **Reviewed clean: traced bufferData/flushData/clear + capacity gate.**
- **agent-status.ts** — single-armed debounce timer per session (`schedule` guards re-arm, `301-306`), cleared and entry deleted on `remove()` called from the pty-exit bridge (`319-323`, `index.ts:1141`). **Reviewed clean.**
- **scheduler.ts** — per-task `setTimeout` cleared on disarm/stopAll (`448-456`); the per-run `ptys.on('exit', onExit)` self-removes inside the handler (`scheduler.ts:606`) so handlers don't accumulate; `stopWatching()`+`stopAll()` run in `before-quit` (`index.ts:3340-3341`). **Reviewed clean: traced fire/arm/onExit + shutdown.**
- **llm-service.ts** — in-flight de-dupe `Map` keyed by `dedupeKey`, cleared in `.finally` with an identity guard (`llm-service.ts:73-79`); bounded by concurrent distinct calls. **Reviewed clean.**
- **library-store.ts** — `FSWatcher`s tracked in `userWatcher` + `projectWatchers` map, all `.close()`d and the debounce cleared on `stop()` (`362-373`); watcher errors self-heal with re-attach; refresh coalesced by a 150 ms debounce (`886-893`). `stop()` is called in `before-quit` (`index.ts:3350`). **Reviewed clean: traced start/stop/watcher-error.** *Minor (debt, not a finding):* `list()` does synchronous `readManifest` + `reconcile` (fs walk) on every call, but over bounded user-authored content on an explicit list action.
- **index.ts app lifecycle** — `wireBridgeListeners()` is idempotent and called exactly once at init (`1128-1131`), with an explicit comment documenting the prior duplicate-send leak when it lived in `createWindow`; `createWindow` binds only window-scoped listeners (`closed`/`resize`/`move`) and a per-window save timer (`1053-1097`); `before-quit` releases scheduler, every `*-store` `.stop()`, `extProcessHost`/`moduleHost.teardownAll()`, the prune interval, `ptys.killAll()`, MCP server, and control plane (`3307-3373`). **Reviewed clean: traced createWindow + wire-once + shutdown release.**

> Renderer heavy-component sweep was not exhaustive in this dimension (focus was `src/main/**` per the brief); the `ProjectTickets` full-snapshot render path is flagged to the API/data dimensions rather than claimed here.

---

## Findings

### PERF-001 — `listClaudeSessions` reads & fully parses EVERY transcript JSONL synchronously on the main process
| Field | Value |
|---|---|
| **id** | PERF-001 |
| **title** | Resume picker blocks the main event loop reading all of a project's multi-MB transcripts synchronously |
| **dimension** | §1.4 Concurrency & resource-lifecycle / performance (Rule 5) |
| **location** | `src/main/claude.ts:90-115` (loop), esp. `:100` `readFileSync(full,'utf8')` and `:104-105` `raw.split('\n')` + full-array `filter`; reached via `src/main/index.ts:1485` |
| **severity** | medium |
| **evidence** | The loop over every `.jsonl` in the project dir does, per file: `raw = readFileSync(full, 'utf8')` (`:100`), then `const lines = raw.split('\n')` and `lines.filter((l) => l.trim().length > 0).length` (`:104-105`), then `extractFirstUserPrompt(lines)` + `extractTitle(lines)` which each scan the WHOLE line array (`:112-113`). No tail window, no async, no cap. The function is exported synchronous and bound to an IPC handler at `index.ts:1485`. The sibling module documents the hazard it avoids: *"transcripts grow to multiple MB ... we read at most `tailBytes` from the end"* (`transcript-reader.ts:159-178`). |
| **reachability** | Untrusted renderer — opening the Claude "resume session" picker for a project invokes the `index.ts:1485` IPC handler, which calls `listClaudeSessions(projectPath)` directly on the main process. |
| **impact** | A project with N historical sessions, each a multi-MB JSONL, is fully read+split+parsed synchronously in one call. This stalls the main event loop (every window's IPC, PTY data flush, agent-status) for the duration — a heavy-user freeze on each picker open. Pure DoS-within-trust; no compromise. |
| **remediation** | Mirror `transcript-reader.ts`'s twin: read async (`fs/promises.readFile`) and bound the parse by slicing a tail window before `split`/parse; derive `messageCount` from a cheap bounded measure (or accept an approximate count) rather than a full-file line scan. The title/first-prompt extraction can run over the same bounded slice. Cite `readLastAssistantText`/`readSessionDigest` as the established windowing pattern. |
| **effort** | S |
| **confidence** | likely |

### PERF-002 — `ModuleStorage.set` synchronously rewrites the entire (unbounded) cache on every key set, from the main loop
| Field | Value |
|---|---|
| **id** | PERF-002 |
| **title** | `ctx.storage.set` drives an unbounded, un-debounced synchronous whole-cache `writeFileSync` on the main event loop — renderer- and disk-ext-reachable |
| **dimension** | §1.4 Concurrency & resource-lifecycle / performance (Rule 5) |
| **location** | `src/main/modules/registry.ts:177-182` (`set`), with the unbounded backing cache at `:155-156` / `:164-171`; reached via `:354-355` `storageSet` → renderer IPC (`index.ts:2474-2476`, preload `storageSet`) AND disk-ext child (`extensions/host-child.ts:154` → `extensions/process-host.ts:376-377`) |
| **severity** | medium |
| **evidence** | `set(key, value)` does `this.cache[key] = value;` then `writeFileSync(tmp, JSON.stringify(this.cache, null, 2)); renameSync(tmp, this.file)` (`:177-182`) — it re-serializes and fsync-writes the ENTIRE accumulated cache object synchronously, on every single `set`. `cache` is a `Record<string, unknown>` with no key-count cap, no value-size cap, no retention, and no debounce (`:155-156`). The write is atomic (tmp + uniquely-suffixed rename — Rule 4 OK), but synchronous and whole-object. Reachable from the untrusted renderer: `window.cc.modules.storageSet` (preload `index.ts:379-380`) → IPC `modules:storageSet` (`index.ts:2474-2476`) → `moduleRouter.storageSet` → `builtins.storageSet`. Also from an out-of-process disk extension: `broker('storage.set', …)` (`host-child.ts:154`) → `process-host.ts:376-377` → `storage.set(id, …)`. |
| **reachability** | BOTH the untrusted renderer (direct IPC) and a sandboxed disk extension (fire-and-forget broker call). Neither path rate-limits or bounds the value. |
| **impact** | A renderer or disk-ext that calls `set` in a tight loop forces a synchronous full-cache JSON serialize + `writeFileSync` per call on the main thread → main-loop stall (UI/IPC/PTY freeze) that grows worse as the cache accumulates, plus unbounded growth of `~/.zcc/modules/<id>.json` (no retention cap). Sustained-load DoS + disk exhaustion within trust; no host compromise. |
| **remediation** | (1) Make the write async and debounced/coalesced — follow the `*-store` writers' debounced-flush pattern (e.g. `template-store.ts:468-469`, `persona-store.ts:578-579`: `clearTimeout(debounce); debounce = setTimeout(flush, …)`), and/or batch multiple `set`s into one write. (2) Add a key-count / total-size cap (the retention discipline inbox-store applies, `inbox-store.ts:109-120`/`246-299`). (3) Consider rate-limiting the broker `storage.set` per extension. Keep the atomic tmp+rename. |
| **effort** | M |
| **confidence** | likely |

### PERF-003 — `listAllSchedules` reads every schedule file synchronously across global + all project dirs
| Field | Value |
|---|---|
| **id** | PERF-003 |
| **title** | Schedule reload synchronously stats+reads every schedule JSON across all project dirs on the main loop |
| **dimension** | §1.4 Concurrency & resource-lifecycle / performance (Rule 5) |
| **location** | `src/main/scheduler-store.ts:118-174` — `readFileSync` (`:124`), `readdirSync` per dir (`:144`), iterated over global dir + every project dir (`:169-172`) |
| **severity** | low |
| **evidence** | `readScheduleFile` does `JSON.parse(readFileSync(path,'utf8'))` (`:124`); `listInDir` `readdirSync(dir)` then reads each `.json` (`:144-150`); `listAllSchedules` runs `listInDir` for the global dir AND once per project (`:169-172`) — all synchronous on the main process. Per-file payload is bounded (history `retain` defaults to 10, `scheduler-store.ts:88`), so each read is small; the cost scales with (#projects × #schedules). |
| **reachability** | Operator/local — invoked on scheduler reload and on project add (`index.ts:1234` `scheduler.rebindWatchers()`), and behind a debounced fs-watch on schedule dirs (`scheduler.ts:326-327`). Not on a renderer keystroke path. |
| **impact** | With many projects each holding several schedule files, a reload performs a synchronous fan-out of small reads on the main loop — a brief stall proportional to total schedule count. Bounded per-file; only an issue at large fan-out. |
| **remediation** | Convert the load path to async (`fs/promises`) and/or read project dirs concurrently; the writes already use atomic `writeJsonAtomic` (`:24-29`, Rule 4 OK) so only the read fan-out needs un-blocking. Low priority — bounded payloads, infrequent trigger. |
| **effort** | S |
| **confidence** | needs-followup |

---

## Cross-reference to QA review
- QA #5 (`listClaudeSessions`, `claude.ts:98-114`) ↔ **PERF-001** — independently re-traced to `claude.ts:90-115`/`:100` and caller `index.ts:1485`; agree medium.
- QA #6 (`ctx.storage.set`, `registry.ts:177-182`) ↔ **PERF-002** — independently confirmed; **broadened**: QA framed it as disk-ext-only, but the same sink is directly reachable from the untrusted renderer via `modules:storageSet` (`index.ts:2474-2476`) and adds an unbounded-growth (no-retention) facet.
- PERF-003 is not in the QA register (new, low).
