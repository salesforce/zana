# Zana Command Center — Final QA + Expert Review

> Generated 2026-06-26 by a multi-agent review (9 subsystem reviewers × `code-review` agent, every finding adversarially verified, then synthesized). 32 agents total; 19 findings confirmed after refutation (several false positives were dropped by the verify pass — a claimed PTY close race, a ticketsStore interval leak, and a broker body-cap bypass were all refuted).

## Executive Summary

The codebase is broadly healthy and shows a consistent, well-reasoned security and concurrency posture — the mutating filesystem handlers, the sync MCP-config writer, and the transcript tail-reader all already embody the engineering rules, which is what makes the deviations below stand out as gaps rather than systemic weakness. Across nine reviewed subsystems we confirmed **18 distinct findings (after merging duplicates): 0 critical, 4 high, 6 medium, 8 low** (severities use the adjusted verdict, which lowered several originals). The high-severity items cluster in one theme — **renderer- and extension-supplied paths/ids reaching filesystem and git sinks without project confinement** — plus one SOQL-injection gap in the `gus` plugin. None are remotely exploitable without a pre-existing renderer/extension compromise or local org access, but the path/id confinement asymmetry (writes/deletes gated, an adjacent sink not) is a real Rule 1/2 trust-boundary inconsistency worth closing deliberately.

---

## High

### 1. Renderer-supplied path to `fs.writeFile` is never confined to a registered project
- **File:** `src/main/index.ts:1491-1495` (sink: `src/main/fs.ts:108-127`)
- **Rule/category:** Rule 1/2 — renderer untrusted, confine before trusting / security
- **Impact:** The `IPC.fs.writeFile` handler passes the raw renderer path straight to `fsWriteFile`, which only checks the target exists as a regular file and is ≤2 MB — no `confine()`, no `trustedProjectRoot`. The sibling create/rename/delete handlers (`index.ts:1537-1568`) all route through `trustedProjectRoot(root)`; `writeFile` is the one mutating op left out. A compromised/buggy renderer can overwrite any existing uid-writable regular file (`~/.zshrc`, `~/.claude/settings.json`, a project `package.json`), escalating to host code execution on the next login-shell spawn. (This finding and its main-IPC duplicate are merged.)
- **Fix:** Add a `root` parameter to `fs.writeFile`, route the handler through `trustedProjectRoot(root)` + `confine(root, p)` exactly as create/rename/delete do, and move the `writeFile` body below `fs.ts`'s "every mutating op below is confined" block.

### 2. Renderer-supplied extension `id` builds filesystem paths without confinement (path traversal)
- **File:** `src/main/extensions/discovery.ts:580-582` (`extensionDir`), `491-523` (`readRendererEntry`), `600-646` (`addExtensionPermission`); callers `src/main/index.ts:1929-1949,1977-1989`
- **Rule/category:** Rule 1/2 — main authorizes renderer ids, confine before trusting / security
- **Impact:** `extensionDir(id) = join(getExtensionsDir(), id)` never validates `id`. `resolveContained(dir, MANIFEST_NAME)` only confines `extension.json` *within* `dir` — it never checks that `dir` itself stayed inside the extensions root, so an `id` containing `../` escapes. The three direct-by-id IPC handlers bypass `discoverExtensions` (which enforces `id === dirName`) and pass the raw string. Result for a compromised renderer: `reveal` → `shell.openPath` of an arbitrary dir; `addExtensionPermission` → read + atomic rewrite of any `<dir>/extension.json` that parses as a JSON object; `readRendererEntry` → read of an attacker-chosen parent's renderer file.
- **Fix:** Validate `id` at the top of `extensionDir` (reject `..`, path separators, absolute paths; or require it to match a discovered entry), and have the by-id handlers resolve against `extensionEntries.find(...)` the way `grantConsent` already does.

### 3. Git mutation/read handlers confine to "any git repo," not to a registered project
- **File:** `src/main/index.ts:1721-1724` (sinks in `src/main/git.ts`)
- **Rule/category:** Rule 1/2 — trust anchor must realpath-match a registered project / security
- **Impact:** `git.discard`/`git.status`/`git.showHead`/`git.listWorktrees` pass the raw renderer path with no project gate. `discardChanges()` confines only to `findToplevel()`'s discovered `.git` (walks up to *any* repo), then destructively `unlinkSync` (untracked) or `git checkout HEAD -- rel` (tracked). The sibling fs-mutation handlers gate the identical surface via `trustedProjectRoot()`; these git handlers skip it, widening the destructive surface to every repo on the machine (and leaking info from arbitrary repos via the read ops).
- **Fix:** Route all four handlers through `trustedProjectRoot(root)` and confine the supplied path beneath it before calling into `git.ts`, mirroring the create/rename/delete gate.

### 4. CDC trigger object/fields concatenated raw into SOQL (injection from untrusted renderer config)
- **File:** `plugins/gus/main/gus-main.ts:766` (config sink: `cdcSaveTrigger`, line 660)
- **Rule/category:** Rule 1 — main authorizes untrusted renderer input / security (injection)
- **Impact:** `SELECT ${uniqueFields.join(', ')} FROM ${trigger.object} ${whereClause} ...` interpolates `trigger.object` and `trigger.fields` (renderer-supplied via `cdcSaveTrigger`, persisted verbatim) with no escaping or allowlist; the TS literal type is erased at runtime and the dispatch path does no validation. Every value-bearing query elsewhere is `soqlEscape`'d — only these CDC structural fragments are not. A crafted field/object rewrites the SOQL and lets the bot read any object/field the authed org user can access. Bounded to the org user's read perms over no-shell brokered exec (data exfiltration within the org, not RCE).
- **Fix:** Validate `trigger.object` and each `trigger.fields` entry against a strict allowlist / SObject-identifier regex in `cdcSaveTrigger` before persisting (escaping is insufficient for SOQL identifiers — an allowlist is required).

---

## Medium

### 5. `listClaudeSessions` reads and parses entire transcript JSONL files synchronously on the main process
- **File:** `src/main/claude.ts:98-114` (handler: `index.ts:1483-1487`)
- **Rule/category:** Rule 5 — bound growing reads / perf
- **Impact:** For each `*.jsonl` the resume picker `readFileSync`s the whole file, splits all lines, and scans every line (`messageCount`, `extractFirstUserPrompt`, `extractTitle`) with per-line `JSON.parse` — synchronously on the main loop, with no tail bound. Sibling `transcript-reader.ts` deliberately slices a `tailBytes` window first. Multi-MB transcripts × many sessions block the UI and every pty data flush.
- **Fix:** Reuse the `tailBytes` windowing from `transcript-reader.ts` (read the tail for title/lastMessage; if a true message count is needed, count newlines on a bounded read or cache it), and/or move the work off the main thread.

### 6. Untrusted disk-ext `ctx.storage.set` drives unbounded synchronous full-cache `writeFileSync` on the main loop
- **File:** `src/main/modules/registry.ts:177-182` (`ModuleStorage.set`); reached via `process-host.ts:376-378`, `index.ts:644-647`
- **Rule/category:** Rule 5 — bound unbounded work / sync fs off the main loop
- **Impact:** A disk-extension child's fire-and-forget `ctx.storage.set` reaches the explicitly-ungated `storage.set` broker, which re-serializes the *entire* cache and does `writeFileSync`+`renameSync` synchronously on the main loop with no value-size cap, key-count cap, rate limit, or retention bound. An untrusted out-of-process extension — the whole point of P3-A isolation — can spam `set` in a tight loop to stall the main thread and grow `~/.zcc/modules/<id>.json` without bound.
- **Fix:** Cap value size and key count, debounce/coalesce writes (or write async off the main loop), and add a per-extension retention/size bound on the store file.

### 7. `InboxStore.read()` throws on a single malformed JSONL line, breaking the entire inbox view
- **File:** `src/main/inbox-store.ts:422-425`
- **Rule/category:** Error-handling / robustness (violates the file's own "never let one abort" contract)
- **Impact:** `read()` does raw `.map((l) => JSON.parse(l))` with no try/catch, while every sibling path (compact, coalesce, deleteEntry, deleteMany) wraps `JSON.parse` and preserves/skips bad lines. Appends use raw `appendFile` (non-atomic), so a torn trailing line — or a hand-edit of the documented user-readable `~/.zcc/inbox/entries.jsonl` — makes `read()` reject on every call, hard-failing the whole inbox feed. Because delete/compact preserve the bad line, `read` stays broken indefinitely.
- **Fix:** Wrap the per-line parse in try/catch and skip/log unparseable lines, matching the other paths in the file.

### 8. `validateScheduleFile` does not clamp `history.retain` or cap `status.runs` on load (Rule 5 retention bypass)
- **File:** `src/main/scheduler-store.ts:85-97`
- **Rule/category:** Rule 5 — retention cap must hold on the load path, not only the UI write path / leak
- **Impact:** On load, `history.retain` and `status.runs` are copied verbatim from disk with no clamp/length cap; `clampRetain(MAX_RETAIN=100)` is applied only on create/update. `recordRun` then trims with the unclamped `retain` and persists the full `runs` array on every fire. A hand-/skill-authored schedule JSON with `retain: 1000000` (or a pre-seeded large `runs` array) makes the store accumulate unbounded in memory and rewrite it to disk each fire. Schedules are an intended hand/skill-editable input.
- **Fix:** Apply `clampRetain()` and `.slice(0, MAX_RETAIN)` inside `validateScheduleFile` on the load path.

### 9. Local fs read handlers expose arbitrary on-disk file contents to the untrusted renderer
- **File:** `src/main/index.ts:1489-1490, 1569-1574, 1833`
- **Rule/category:** Rule 1/2 — main authorizes renderer paths / security (info-disclosure)
- **Impact:** `listDir`/`readFile`/`walkFiles`/`searchFiles`/`readDataUrl` pass the raw renderer path to `fs.ts` functions that never confine to a project (the confinement block covers only mutating ops). A compromised renderer can read any uid-readable file (`~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.claude.json` tokens) and exfiltrate via existing inbox/library/module channels, or enumerate the filesystem. (The read-only duplicate filed at low severity is merged here; the read/write asymmetry is the same root issue as findings 1 and 3.)
- **Fix:** Decide explicitly: either anchor reads to a registered project / HOME-base like the mutating ops, or document the absolute-path Explorer as accepted design with the trust boundary stated. At minimum, bring reads under the same anchor as writes so the gate is symmetric.

---

## Low

### 10. Orchestrator-class CLI caller can close any session app-wide (`term.close` not project-confined)
- **File:** `src/main/control-plane.ts:414-420`
- **Rule/category:** Rule 1 + the module's own `ORCHESTRATOR_ALLOWED_OPS` confinement invariant / rule-violation
- **Impact:** `term.close` passes the raw orchestrator-supplied `args.sessionId` straight to `deps.closeTerminal(id)`, which kills any live session regardless of project/cohort — unlike the project-confined `term.close-summary`. An app-attested orchestrator can enumerate peer ids (via `agent.list`/`status`, both allowed) and close arbitrary peers in other cohorts/projects. Lowered to low: impact is DoS only, gated behind host-stamped app attestation (unreachable by renderer or plain agent), and parallels the existing unconfined operator close-by-id path.
- **Fix:** Scope `closeTerminal` in the orchestrator op to the caller's cohort/project, or document the cross-cohort capability and tighten the module's stated invariant wording.

### 11. First CDC poll treats every pre-existing row as a CREATE (startup burst)
- **File:** `plugins/gus/main/gus-main.ts:377, 394`
- **Rule/category:** Correctness — empty initial state
- **Impact:** On the first poll after arming, `lastSeen` is empty, so every in-scope row (up to LIMIT 100) matches as `CREATE`. Lowered to low because matches are queued to `pendingMatches` for explicit user confirmation, not auto-launched — so the effect is a startup burst of up to 100 stale pending-review entries plus semantically-wrong CREATE firing, not autonomous sessions.
- **Fix:** Add a baseline seeding pass that records existing ids into `cdcLastSeen` without emitting CREATE matches on the very first poll.

### 12. `pendingMatches` CDC queue grows unbounded in main-process memory
- **File:** `plugins/gus/main/gus-main.ts:419, 792`
- **Rule/category:** Rule 5 — unbounded accumulating store
- **Impact:** Module-scoped array, only `push`'d and drained per-match by the renderer; teardown clears timers but not this array, and triggers arm at boot regardless of whether a panel ever consumes. Genuine CREATE/UPDATE events accumulate for the session when no panel drains them. Lowered to low: `detectCdcMatches` dedups via persisted `cdcLastSeen`, so growth is bounded by actual change events, not poll count.
- **Fix:** Add a cap/ring-buffer (drop or coalesce oldest) on `pendingMatches`, and clear it on teardown.

### 13. `cdcLastSeen` state grows without eviction
- **File:** `plugins/gus/main/gus-main.ts:778`
- **Rule/category:** Rule 5 — bounded/retention-capped stores
- **Impact:** `nextLastSeen` starts from the prior map and adds an entry per row seen, but never removes ids that aged out of the query window; persisted and re-read+rewritten every poll. Over a long-lived install the per-trigger map only grows. Low: entries are tiny and bounded by distinct ids passing a scoped query, so growth is slow.
- **Fix:** Prune ids not present in the current poll window (or cap the map to the LIMIT window) before persisting.

### 14. Non-unique tmp path in async `ensureMcpConfigForProject` can lose the rename race
- **File:** `src/main/mcp-config.ts:77`
- **Rule/category:** Rule 4 — uniquely-suffixed tmp + rename / race
- **Impact:** Async writer uses `${process.pid}-${Date.now()}` (ms granularity) while the sync twin was deliberately fixed to `${process.pid}-${randomUUID()}` with a comment naming this exact race. Two same-millisecond async calls for the same project collide on one tmp path; the second `rename` throws ENOENT. Low: content is identical (no corruption), every caller wraps in `.catch(logMainError)`, so the worst case is a rare spurious logged error.
- **Fix:** Use `randomUUID()` in the tmp suffix to match the sync twin.

### 15. `settings.local.json` toggle uses non-unique tmp suffix and unserialized read-modify-write
- **File:** `src/main/mcp.ts:202-204`
- **Rule/category:** Rule 4 — atomic + serialized shared-file writes / race
- **Impact:** `setMcpServerEnabled` does an unserialized RMW on `<projectPath>/.claude/settings.local.json` with a `pid+Date.now()` tmp suffix and no mutex; the sibling catalogue writer (`setProjectMcpDisabled`) touches the same file. Concurrent toggles can last-rename-wins drop an update or collide on the tmp path. Operator-triggered and low-probability.
- **Fix:** Use the house `randomBytes(4)` suffix and serialize RMW on this file with a single in-process mutex shared with the catalogue writer.

### 16. `stripOpeningPrompt` mishandles a dash-prefixed prompt with no `--` marker
- **File:** `src/renderer/util/sessionRestore.ts:106-117`
- **Rule/category:** Correctness — untrusted on-disk snapshot shapes
- **Impact:** The bare-positional drop heuristic only fires when guarded by a preceding `--`. The shared main-side seam `resolvePersonaLaunch` (`persona-store.ts:123`) appends the prompt as a bare trailing positional with no `--` marker — and that seam feeds zcc control-plane `term.create` and the scheduler. A scheduled/CLI/MCP-spawned `claude` tab whose prompt begins with `-` is snapshotted verbatim and replayed with `--continue` on restore, forking the conversation. Low: requires a leading-dash prompt (uncommon for NL) and impact is conversation forking, not a security/data issue.
- **Fix:** Have `resolvePersonaLaunch` emit the `--` marker like the renderer launchers do, and/or make `stripOpeningPrompt` recognize the trailing positional independent of the marker.

### 17. Optimistic-assign error on `entry.error` is cleared by a background refresh, hiding the failure
- **File:** `src/renderer/ticketsStore.ts:506-525`
- **Rule/category:** Error-handling — error visibility / silent failure
- **Impact:** A failed deferred assign sets `entry.error` as the sole surfacing channel (no toast). The independent 30s auto-refresh sets `error: null` on success, and since the commit fires at an arbitrary phase of that cycle, a background refresh can erase the assign-error before the user reads it — the board shows the reverted assignee with no explanation. Low: rollback is correct (no data corruption); the error does display until the next tick.
- **Fix:** Track assign errors in a separate, refresh-immune field (or surface via a sticky notice) so a background reload does not clear them.

> Findings 1 and the duplicate main-IPC `fs.writeFile` entry are merged into **#1**; finding 9 absorbs the low-severity read-only-handlers duplicate. All other items are distinct.

---

## Subsystems reviewed clean

No confirmed findings in:
- **Renderer state — Rule 6 seam** (the `ticketsApi` quarantine and B4 source-text guard held; the two renderer-state findings above are correctness/UX, not Rule 6 violations).
- **Slack and zana plugins** (only the `gus` plugin produced confirmed findings).

All other reviewed subsystems — PTY + session lifecycle; Path confinement + filesystem; Extension host + permission broker; MCP server + per-session tools; Stores + atomic writes + scheduler; Main IPC surface + boot wiring; Renderer heavy components — produced at least one confirmed finding above.

**Refuted during verification (not real):** a claimed PTY `expectedClose` race (guarded at `pty.ts:922-923`), a ticketsStore global auto-refresh interval leak (released by `stopAutoRefresh`; not used in production), and a `broker-caps.ts` body-cap bypass via the `!res.body` fallback (only reachable for null-body responses).

---

## Recommended next actions (prioritized)

1. **Close the path/id confinement asymmetry (high, one coherent change).** Bring `fs.writeFile` (#1), the four `git.*` handlers (#3), and the extension by-id helpers (#2) under the same `trustedProjectRoot`/confine gate the create/rename/delete handlers already use, and decide explicitly on the read handlers (#9). This is the single highest-leverage fix — it removes three high-severity items and resolves the read/write inconsistency.
2. **Allowlist the CDC SOQL structural fields (#4, high).** Validate `trigger.object`/`trigger.fields` in `cdcSaveTrigger` before persisting; this is a small, isolated change in the `gus` plugin.
3. **Bound the two main-loop hazards (#5, #6, medium).** Add tail-windowing to `listClaudeSessions` and caps/debounce to `ModuleStorage.set` — both protect the main event loop under realistic load.
4. **Harden the load-path/parse robustness (#7, #8, medium).** Guard `InboxStore.read()` per-line parse and clamp retention in `validateScheduleFile` — both are trust-boundary robustness fixes on hand-editable files.
5. **Sweep the low-severity races and UX gaps (#10–#17) as a cleanup batch.** Several are one-line parity fixes (`randomUUID` in #14, `--` marker in #16) that bring deviating writers in line with their already-correct twins.
