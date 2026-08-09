# Architecture Review — zana-command-center

> Generated 2026-06-26. Multi-agent review executed against the architect council's output-spec contract (`.zcc/library/decisions/arch-review-output-spec.md`). Every `high` finding was adversarially verified (a second agent attempted to prove it already-guarded / unreachable / by-design before inclusion). Findings without a concrete `file:line` and a traced reachability path were dropped to §8 or cut.

---

## 1. Executive summary

**Posture:** Solid trust architecture with one systemic weak seam. The renderer-untrusted / main-authorizes model (Rules 1–2), the deny-by-default extension permission broker (Rules 6–7), and the MCP agent identity binding are all **strong and consistent where they are applied**. The defect is asymmetry: a family of renderer→main IPC handlers reach `fs` / `git` / `.claude/settings` / extension sinks **without** the `trustedProjectRoot`+`confine` gate that their sibling mutation handlers already apply. There are **no remotely-reachable or critical findings** — the renderer is a local, sandboxed bundle (`contextIsolation:true; nodeIntegration:false; sandbox:true`, loading a local file), which caps the worst items at `high`.

**Finding counts by severity (post adversarial verification):**

| Severity | Count | Findings |
|---|---|---|
| **critical** | **0** | — |
| **high** | **3** | SEC-001, SEC-002, SEC-003 |
| **medium** | **14** | SEC-004 (≡EXT-001), SEC-005, SEC-007, EXT-002, EXT-003, EXT-004, PERF-001, PERF-002, API-001, API-002, API-003, API-004, DATA-001, DATA-002 |
| **low** | **11** | SEC-006, EXT-005, EXT-006, EXT-007, PERF-003, API-005, API-006, DATA-003, DATA-004, DATA-005, DATA-006 |
| **TOTAL** | **28** | (29 raw findings − 1 dedupe: SEC-004 ≡ EXT-001) |

**Highest-leverage themes (clusters):**

1. **Confinement asymmetry (the root cause).** Untrusted renderer/agent path or id reaches an fs/git/settings/extension sink with no `trustedProjectRoot`+`confine`, while the sibling op IS gated (`index.ts:1537-1568`). Accounts for all 3 highs (SEC-001/002/003), plus SEC-004/005/006/007. One consolidated gate (CS-1) closes the high members and extends to the tail.
2. **Renderer↔main IPC contract weakness.** `safeHandle` is an error *trap*, not a *normalizer*; the `modules.*` family takes unvalidated, identity-unbound input. The MCP (agent) contract, by contrast, is uniform and identity-bound. (API-001…006, CS-2.)
3. **Rule-5 boundedness on the main loop.** Synchronous, unbounded reads/writes on the main event loop (`listClaudeSessions`, `ModuleStorage.set`, schedule load) and a load-path retention bypass. (PERF-*, EXT-003, DATA-002, CS-3.)
4. **Rule-4 load-path robustness / atomic-write parity.** Writers/loaders that deviate from an already-correct in-repo twin (non-atomic writes, an un-try/catch'd JSONL parse, an unserialized shared-file RMW). (DATA-*, CS-4.)
5. **Residual extension-isolation gaps.** A SOQL identifier-injection path, a JS-level-only sandbox (`process.dlopen`), and read-side `sensitiveRoots` parity. (EXT-*, CS-5.)

No new findings are introduced in this section; all are detailed in §9.

---

## 2. Architecture map / module boundaries

**Posture model:** Electron app — trusted **main** / untrusted **renderer** (Rules 1–2), an out-of-process **disk-extension host** behind a deny-by-default **permission broker** (Rules 6–7), a localhost **MCP server** for agents, and **disk stores** for shared state (Rules 4–5). Every box/edge below cites a real file.

### 2.1 The six trust zones

| # | Zone | Trust | Process | Representative files |
|---|------|-------|---------|----------------------|
| Z1 | **Renderer (UI)** | **Untrusted** | renderer (Chromium) | `src/renderer/App.tsx`, `store.ts` (130KB), `ticketsStore.ts`, `components/**`, `util/*` |
| Z2 | **Preload bridge** | Boundary marshaller (no logic) | renderer (isolated world) | `src/preload/index.ts` (`contextBridge.exposeInMainWorld('cc', api)` @ `:455`) |
| Z3 | **Main (trusted core)** | **Trusted authority** | main | `src/main/index.ts` (142KB — IPC + wiring), `pty.ts`, `fs.ts`, `git.ts`, `remote-fs.ts`, `resolve-project-root.ts` |
| Z4 | **Extension host (disk extensions)** | **Untrusted, sandboxed, out-of-process** | `utilityProcess` child(ren) | `src/main/extensions/process-host.ts`, `host-child.ts`, `host-child-guard.ts`, `spawn-child.ts`, `host-protocol.ts`, `permission-broker.ts`, `broker-caps.ts`, `consent.ts`, `discovery.ts`, `loader.ts`, `module-router.ts`, `modules/registry.ts` |
| Z5 | **MCP server (agent surface)** | Trusted code serving **untrusted agents** | main (HTTP on 127.0.0.1) | `src/main/mcp-server.ts`, `mcp.ts`, `*-mcp-tool*.ts` (12 tool files) |
| Z6 | **Disk stores (shared state)** | Trusted data plane | main (+ `.zana`/`.zcc` on disk) | `src/main/store.ts`, `inbox-store.ts`, `library-store.ts`, `persona-store.ts`, `team-store.ts`, `scheduler-store.ts`, `agent-registry-store.ts`, … |

External plugins (`plugins/{gus,slack,zana}`) and built-in modules (`MAIN_MODULES = [zana, slack]`, `src/main/modules/index.ts:16`) attach to Z4's router; the `zana` data path additionally surfaces in Z1 via the Rule-6 quarantine seam (§2.3).

### 2.2 Diagram

```
                          ┌─────────────────────────────────────────────────────┐
   UNTRUSTED              │  Z1  RENDERER (Chromium, no nodeIntegration)          │
                          │  store.ts · ticketsStore.ts · components/** · util/*  │
                          │  ── ticket/sprint/profile data ONLY via ───────┐      │
                          │     ticketsApi.ts  (Rule-6 quarantine seam)     │      │
                          └───────────────┬─────────────────────────────┬──┴──────┘
                                          │ window.cc.* (typed)          │ getHost('zana').call(cap,payload)
        ══════════════ SEAM A ════════════╪══════════════════════════════╪═════ contextBridge ═══
                          │  Z2  PRELOAD  src/preload/index.ts  (ipcRenderer.invoke wrappers only) │
                          └───────────────┬─────────────────────────────┬─────────┘
                                          │ ipcRenderer.invoke(IPC.*)    │ IPC.modules.call(moduleId,cap,args)
        ══════════════ SEAM B ════════════╪══════════════════════════════╪═════ ipcMain.handle ══
   TRUSTED                │  Z3  MAIN  src/main/index.ts                  │                        │
                          │  registerIpc() @:1219  · safeHandle() @:751   │                        │
                          │                                              │                        │
                          │  TRUST FUNNEL (choke points):                │  moduleRouter.dispatch  │
                          │   • trustedProjectRoot()  :1505  ───┐         │  (module-router.ts:40)  │
                          │   • createTerminalConfined() :773   ├─ realpath│        │              │
                          │   • resolve-project-root.ts (MCP/A3)│  confine  │        ▼              │
                          │   • fs.ts confine()  :149           ┘         │   builtin?  diskExt?   │
                          └──┬─────────────┬──────────────┬───────────────┘     │          │        │
                             │             │              │                     │          │ SEAM D │
        ══ disk fs ══════════╪═══ git ═════╪═══ pty ══════╪════ stores ═════════╪══════════╪═ MessageChannelMain
                             ▼             ▼              ▼          ▼          ▼          ▼  (host-protocol)
                          fs.ts         git.ts        pty.ts   Z6 STORES   in-proc      Z4 EXT HOST
                       (listDir/read   (status/      (terminals) store.ts   builtins   utilityProcess child
                        ⚠ UNCONFINED)  ⚠ UNCONFINED)            inbox-store  (zana,     host-child.ts
                                                               library-store  slack)    + PermissionBroker
                                                                                        deny-by-default
                                                                                        broker-caps: exec/fs/fetch
   AGENTS (untrusted) ──HTTP 127.0.0.1──▶ Z5 MCP SERVER  mcp-server.ts                       │
        ══ SEAM C ══  POST /mcp/:projectId[/:sessionId]  identity from URL, NOT payload      │
                       tools (zod-validated) ──▶ inject callbacks into Z3 main authority ────┘
```

### 2.3 Boundary seams (who enforces each crossing)

- **SEAM A — Renderer → Preload (`contextBridge`).** Enforced by Electron context isolation + `src/preload/index.ts`. The renderer never gets `ipcRenderer`/`require`; only the typed `cc` surface (`preload/index.ts:455`). The preload is a **pure marshaller** — every method is a thin `ipcRenderer.invoke(IPC.x, …)` or an `on/off` wrapper, performing **no validation** (by design). One special edge: `files.pathForFile` uses `webUtils.getPathForFile` (`preload/index.ts:155`).
- **SEAM B — Preload → Main (`ipcMain.handle`).** Enforced by `registerIpc()` (`index.ts:1219`, called once from `app.whenReady`) via `safeHandle()` (`:751`). `safeHandle` provides **error trapping + fallback shaping only** — it is **not** a validation gate; authorization is per-handler and inconsistent (§3, §5). This is the primary renderer→main trust boundary.
- **SEAM C — Agent → Main (MCP, HTTP localhost).** `mcp-server.ts` — `StreamableHTTPServerTransport` bound to `127.0.0.1:0` (`~:540`), **no auth token**; trust = localhost bind + identity-by-URL. `projectId`/`sessionId` are parsed from the URL path (`matchMcpRoute()`, `:392-408`) and closed over in a per-request `McpServer`; agents **cannot** supply identity in the tool payload (a genuinely good unforgeable-identity design). Tool inputs are zod-validated per tool. (`mcp.ts` is the Settings-panel config reader for *external* MCP servers — distinct concern, do not conflate.)
- **SEAM D — Main → Extension host (`MessageChannelMain`).** `module-router.ts:40` routes `(moduleId, capability, args)` → disk-ext (oop) vs built-in (in-proc). The keystone: the **host owns the port↔moduleId binding**; the child **never supplies its own moduleId** (`host-protocol.ts:28-31`, `process-host.ts:52,70,358`). Every capability call is authorized by `PermissionBroker.assert(moduleId, perm, scope)` against the **authenticated** id — the anti-spoof core of Rules 6–7.
- **Rule-6 quarantine seam (intra-renderer, Z1).** `src/renderer/util/ticketsApi.ts` is the **single** place in core renderer logic that names the `zana` module id and calls `getHost('zana').call(...)`. It is a binding seam, not logic, and treats `projectPath`/`useGlobal` as **advisory** — main re-resolves via `resolveProjectRoot` (`ticketsApi.ts:19-22`). Locked by `rule6-zana-literal.guard.test.ts`.

### 2.4 Trust-funnel choke points (where untrusted input becomes authorized)

| Choke point | File:line | Guards | Used by |
|---|---|---|---|
| `trustedProjectRoot(root)` | `index.ts:1505-1532` | realpath(root) must `===` a registered project realpath, OR share a git common-dir (worktree) | fs **mutations** (`:1537-1568`) |
| `confine(root, target)` | `fs.ts:149-182` | resolves nearest existing ancestor's realpath, re-appends tail, asserts `startsWith(realRoot+sep)`; rejects `..`/symlink escape (TOCTOU acknowledged @`:145`) | fs CRUD, after `trustedProjectRoot` |
| `createTerminalConfined()` | `index.ts:773-850` | realpath(cwd) must be `isWithin` realpath(project.path); `sanitizeExtraArgs()` strips denied flags | `terminals.create` IPC (`:1388`) + CLI control-plane (`:3212`) |
| `resolveProjectRoot(opts, deps)` | `resolve-project-root.ts:47-85` | realpath candidate + each registered root, `isWithin`; **throws** on no-match | built-in module ctx, the `zana` data path |
| `assertSafeTicketId(id)` | `resolve-project-root.ts:93-106` | rejects `/`, `\`, `..`, absolute; requires bare v4 UUID | ticket-id → `<root>/.zana/.../<id>.json` |
| `PermissionBroker.decide()` | `permission-broker.ts:151-188` | deny-by-default; built-ins bypass; disk-ext scoped checks (exec basename allowlist, fs lexical+realpath, sensitive-root write block, net per-host) | every Z4 disk-ext capability |
| `remoteFor(projectId)` | `index.ts:1583+` | renderer passes only projectId; host/path from store; confined in `remote-fs.ts` | all `IPC.fs.*Remote` handlers |

**Observation:** the funnel is **strong and consistent** for fs *mutations*, terminals, remote fs, MCP identity, and the extension broker. It is **bypassed** for fs *reads* and git — the single biggest internal inconsistency in the boundary design (→ §3).

### 2.5 Sibling / twin pairs (parity anchors)
- `fs.ts` (local) ↔ `remote-fs.ts` (SSH) — remote is *more* confined than local reads.
- `terminals.create` IPC ↔ CLI control-plane — share `createTerminalConfined` (good reuse).
- built-in `ctx.exec`/`ctx.fetch` (`registry.ts:65-152`) ↔ disk-ext `broker-caps` exec/fetch — Rule-7 promotion pair.
- `resolveProjectRoot` ↔ `trustedProjectRoot` — two implementations of the same realpath-confine idea in different files (→ DEBT-002).

---

## 3. Trust-boundary & security posture

Every untrusted entry point (renderer IPC + agent MCP) traced input → sink; each is "gated by X" or "ungated — finding." Rules 1 (main authorizes), 2 (realpath-confine to a registered project), 6 (no extension-id in core logic outside seams), 7 (bounded builtin-promotion).

### 3.1 Entry-point coverage table

| # | Entry point | Untrusted input | Sink | Gate — or finding |
|---|---|---|---|---|
| 1 | `IPC.fs.listDir` (index.ts:1489) | abs path | `listDir` (fs.ts:31) | **ungated** → SEC-005 |
| 2 | `IPC.fs.readFile` (1490) | abs path | `readFile` (fs.ts:67) | **ungated** → SEC-005 |
| 3 | `IPC.fs.writeFile` (1491-1495) | abs path + content | `writeFile` (fs.ts:108) | **ungated** (only `isFile` + 2MB cap) → SEC-002 |
| 4-7 | `IPC.fs.createFile/createDir/rename/delete` (1537-1568) | root + path | `confine` (fs.ts:185) | gated by `trustedProjectRoot`+`confine` ✓ |
| 8 | `IPC.fs.walkFiles` (1569) | abs path | `walkFiles` (fs.ts:259) | **ungated** → SEC-005 |
| 9 | `IPC.fs.searchFiles` (1570-1574) | abs path + query | `searchFiles` (fs.ts:305) | **ungated** → SEC-005 |
| 10 | `IPC.fs.readDataUrl` (1833) | abs path | `readDataUrl` (fs.ts:391) | **ungated** → SEC-005 |
| 11 | `IPC.fs.*Remote` (1601-1714) | **projectId** | `remote-fs.ts` | gated: host/root from STORE ✓ |
| 12 | `IPC.openers.openIn` (1716-1719) | target + path/URL | `openIn` (openers.ts:43) | path unconfined (array args, no shell-inj); browser http(s)-gated → SEC-006 |
| 13-16 | `IPC.git.status/showHead/discard/listWorktrees` (1721-1724) | abs path | `git.ts` | confined to `findToplevel` only, **not** a registered project → SEC-003 |
| 17-18 | `IPC.claudeSettings.read/write` (2014-2033) | projectPath + scope (+patch) | `claude-settings.ts:127/151` | **ungated** projectPath; write round-trips `_unknown` (hooks/env) → SEC-001 |
| 19-21 | `IPC.extensions.reveal/readRendererEntry/addPermission` (1929-1989) | extension `id` | `extensionDir(id)` (discovery.ts:580) | **ungated** id → SEC-004 (≡EXT-001) |
| 22-23 | `IPC.extensions.grantConsent/relaunch` (1956-1999) | id | `entries.find` / `diskSpecsById.get` | gated — **correct twins** ✓ |
| 24 | `IPC.modules.call` (2458) | moduleId + cap + args | `moduleRouter.dispatch` | builtins trusted by provenance; disk-ext deny-by-default at broker ✓ (contract gap → API-002) |
| 25 | `IPC.terminals.create` (773) | projectId + cwd + args | `PtyManager.create` | gated: cwd realpath-confined, flags stripped ✓ |
| 26-30 | MCP route + session/project tools (mcp-server.ts:276-408) | URL ids / per-tool | per-request `McpServer` | gated: ids from URL, never payload; zod per tool ✓ |
| 31 | MCP `register_project` (register-project-mcp-tool.ts:70-123) | abs/rel `path` | `registerProject` callback | **by-design unconfined** → SEC-007 |
| 32 | MCP loopback transport (mcp-server.ts:540) | any local client | all tools | bound `127.0.0.1:0`, **no auth token** → SEC-007 note |

**Reviewed-clean attestations (traced, no finding):** confined fs mutations (4 entry points, all gated); remote SSH fs surface (10 entry points, projectId-keyed, store-resolved); permission broker / capability gating (deny-by-default, provenance-tiered, lexical+realpath double-check, sensitive-root write block); MCP identity binding (7 tool families + route matcher — identity URL-derived, absent from every schema, forgery structurally impossible); `terminals.create` cwd (the reference gate). **Total: 38 untrusted entry points traced** (28 renderer-IPC + 10 MCP); findings on 7, the remainder gated.

### 3.2 SEC findings narrative (verified severities)

The five core SEC findings (SEC-001…005) share **one root cause**: a renderer-/agent-supplied path or id reaches an fs/git/settings/extension sink without realpath-confinement to a registered project, while the sibling op is correctly gated — the **"confinement asymmetry"** cluster, ranked by SEC-001. SEC-006/007 are adjacent defense-in-depth on the same theme.

Adversarial verification (§4 of the contract) ran a refute pass over the four high candidates: **all four survived as real and reachable**; SEC-001's critical candidacy was **declined** (the renderer is a local sandboxed bundle — not remotely reachable — capping it at `high`), and **SEC-004 was downgraded high → medium** (traversal real and reachable, but impact bounded to Finder-open / attacker-planted-file read / consent-gated manifest tampering — no arbitrary-secret-read, no code-exec). SEC-001/002/003 hold at `high`. SEC-001 is also a QA-review gap — it is **novel to this review** and is the highest-severity item in the dimension. Full schema rows for every SEC finding are in §9.

---

## 4. Concurrency & resource-lifecycle / performance

Rules 3 (subscribe/release lifecycle) & 5 (bound heavy/unbounded work off the main loop). Scope traced: `src/main/**` event-loop hot paths, stores, per-session resources, app lifecycle.

### 4.1 Reviewed-clean attestations

- **transcript-reader.ts** — *the correct windowing twin.* `readLastAssistantText` (256 KB tail) / `readSessionDigest` (2 MB tail) slice the string tail BEFORE `JSON.parse`, bounding parse cost regardless of file size; both swallow errors (`:161-204`). Traced 3 entry points.
- **inbox-store.ts** — *exemplary store.* Append-only JSONL, tiered retention caps (5000/500, `:109-120`), amortized compaction (`:246-299`), single `runExclusive` mutex on RMW (`:211-220`), atomic tmp+unique rename, paginated `read()`.
- **agent-message-log.ts** — in-memory; `prune(maxAgeMs)` wired to a `setInterval` armed once at init (`index.ts:3103-3105`) and cleared in `before-quit` (`:3363-3366`).
- **agent-registry-store.ts** — in-memory Map, session-lifetime-scoped (seeded on `sessionUpdated`, dropped on pty exit `index.ts:1152`); dispose-returning `onChanged`. No unbounded growth.
- **pty.ts** — per-session buffers/timers created lazily, torn down on exit (`clearDataBuffer`, `:302-307`); hard live-session cap fails BEFORE allocating a process/fd (`assertCapacity`, `:338-346`).
- **agent-status.ts** — single-armed debounce per session (`:301-306`), cleared + entry deleted on pty-exit (`:319-323`).
- **scheduler.ts** — per-task `setTimeout` cleared on disarm/stopAll (`:448-456`); per-run `on('exit')` self-removes (`:606`); `stopWatching()`+`stopAll()` in `before-quit`.
- **llm-service.ts** — in-flight de-dupe Map cleared in `.finally` with identity guard (`:73-79`).
- **library-store.ts** — `FSWatcher`s tracked + `.close()`d on `stop()` (`:362-373`), called in `before-quit`; refresh coalesced by 150 ms debounce. *(Minor debt: `list()` does sync `readManifest`+`reconcile` on every call, over bounded user content.)*
- **index.ts app lifecycle** — `wireBridgeListeners()` idempotent, called once at init (`:1128-1131`, with a comment documenting the prior duplicate-send leak when it lived in `createWindow`); `createWindow` binds only window-scoped listeners; `before-quit` releases scheduler, every `*-store.stop()`, `extProcessHost`/`moduleHost.teardownAll()`, the prune interval, `ptys.killAll()`, MCP server, and control plane (`:3307-3373`).

### 4.2 PERF findings

Full schema rows in §9. Summary:

- **PERF-001 (medium):** `listClaudeSessions` reads & fully parses EVERY transcript JSONL synchronously on the main loop (`claude.ts:90-115`); resume-picker open stalls the main event loop on heavy users. Mirror the `transcript-reader.ts` tail-windowing twin.
- **PERF-002 (medium):** `ModuleStorage.set` synchronously rewrites the entire unbounded cache on every key set (`registry.ts:177-182`), reachable from BOTH the untrusted renderer (`modules:storageSet`) and a disk-ext child. Same sink as EXT-003. Async-debounce + caps.
- **PERF-003 (low):** `listAllSchedules` reads every schedule file synchronously across global + all project dirs (`scheduler-store.ts:118-174`); bounded per-file, only an issue at large fan-out.

---

## 5. IPC / MCP API-contract

Two contracts: **(B) renderer↔main IPC** (`ipcMain.handle` via `safeHandle`) and **(C) agent↔main MCP** (`*-mcp-tool*.ts`). This dimension owns **contract shape** — missing/loose schema, non-uniform error envelope, unbound identity — where that is the root cause (pure path-confinement bugs are §3).

### 5.1 Entry-point → contract-property table

| Entry point | Contract | Validates input? | Identity bound server-side? | Uniform error shape? |
|---|---|---|---|---|
| `IPC.fs.listDir/readFile/walkFiles/searchFiles` | B | NO — raw path | n/a | NO — `[]` vs `{ok:false,message}` vs `{hits:[]}` |
| `IPC.fs.writeFile` | B | NO — raw path | n/a | NO — `{ok:false,message}` (no `code`) |
| `IPC.fs.createFile/createDir/rename/delete` | B | YES — `trustedProjectRoot` | n/a | PARTIAL — no `code` |
| `IPC.projects.add/addRemote/clone` | B | partial (store-side) | n/a | YES — `Result<T>` |
| `IPC.modules.call` | B | NO — `args: unknown[]` passthrough | NO — `moduleId` renderer-supplied | NO — **re-throws** |
| `IPC.modules.storageGet/Set` | B | NO | NO — `moduleId` from renderer | NO — returns `undefined` on error |
| `IPC.modules.pushInbox` | B | YES — broker `assert` | PARTIAL — `moduleId` renderer-claimed | NO — re-throws |
| MCP `inbox_push` | C | PARTIAL — `docs[].path` free string | YES — projectId/sessionId from URL | YES — `{isError, content}` |
| MCP `register_project` | C | YES — zod | NO — **by design** any abs path | YES |
| MCP `list_*` | C | YES — empty schema | n/a | YES |
| MCP `schedule_report/agent_send/close_session/launch_team/library_*` | C | YES — zod per-tool | YES — from URL closure | YES |

**Headline:** the **MCP (C) contract is strong and uniform** — identity host-stamped from the URL closure (`mcp-server.ts:700,714-736`), every tool returns `{isError, content:[…]}`, inputs zod-validated per tool. The **IPC (B) contract is the weak side** — `safeHandle` is an error *trap* not a *normalizer*, so each handler invents its own shape, and `modules.*` takes unvalidated, unbound input.

### 5.2 Reviewed-clean attestations
- **MCP identity binding (SEAM C):** all session/project tools — ids from `matchMcpRoute` URL parse, closed over in `buildProjectMcpServer`; no tool schema accepts an identity field; stateless transport (`sessionIdGenerator: undefined`, `:710-712`). Unforgeable.
- **MCP error envelope:** uniform `{isError?, content:[{type:'text',text}]}` across all tools.
- **Hook routes:** strict regex match, method-gated (405 non-POST `:632`), body-capped (64 KiB `:642`) + slow-loris timeout (`:646`).

API-001…006 (all medium/low) are in §9. The cluster: make the IPC (B) side as uniform as the MCP (C) side (CS-2).

---

## 6. Data / store integrity

Rule 4 — atomic + serialized shared-file writes (tmp + uniquely-suffixed rename; single-writer mutex on RMW; or strict append-only) + parse-robustness on load. **Verdict rule:** synchronous `readFileSync`+`writeFileSync`+`renameSync` RMW is implicitly serialized by Node's single-threaded loop (no `await` gap → no explicit mutex needed); **async** RMW is where a mutex is mandatory and a `Date.now()`-ms tmp suffix can collide.

### 6.1 Store-by-store table (selected)

| Store / writer | Atomic? | Serialized? | Load-robust? | Verdict |
|---|---|---|---|---|
| `store.ts` `writeJson` (53-59) | ✅ | ✅ sync | ✅ try/catch fallback | **CANONICAL / clean** |
| `inbox-store.ts` (writers) | ✅ | ✅ `runExclusive` | partial — `read()` (422-425) lacks try/catch | **DEVIATION → DATA-001** (writer side exemplary) |
| `scheduler-store.ts` `writeJsonAtomic` | ✅ | ✅ sync | no clamp on load (85-97) | **DEVIATION → DATA-002** |
| `mcp-config.ts` async writer (77) | ✅ | n/a | — | **DEVIATION → DATA-003** (non-unique tmp vs sync twin) |
| `mcp.ts` `setMcpServerEnabled` (139-205) | ✅ | ❌ async RMW, no mutex | tolerant | **DEVIATION → DATA-004** |
| `mcp-catalogue.ts` `setProjectMcpDisabled` (240-301) | ✅ | ❌ shares DATA-004 gap | ✅ BAD_JSON guard | partial — see DATA-004 |
| `prompt-registry.ts` `saveUser` (310) | ❌ plain `writeFileSync` | ✅ sync | ✅ null fallback | **DEVIATION → DATA-005** |
| `library-store.ts` manifest (138-144) | ✅ | ✅ sync | guarded | clean |
| `library-store.ts` content (451,695,702) | ❌ plain `writeFileSync` | ✅ sync | guarded | **DEVIATION → DATA-006** |
| `saved-store.ts` / `team-store.ts` / `persona-store.ts` / `schedule-groups-store.ts` / `skill-bundles-store.ts` | ✅ | ✅ sync | guarded | clean |
| `zana-db.ts` (better-sqlite3 txn) | ✅ ACID | ✅ WAL write-lock | guarded | clean |
| `plugins/zana/main/zana-main.ts` `writeJsonAtomic` + `runExclusivePerFile` | ✅ | ✅ async mutex | guarded | **GOLD-STANDARD async twin** |
| `plugins/slack/.../thread-store.ts`, `plugins/gus/.../gus-main.ts` CDC | delegated to `ctx.storage` | delegated | `?? []` fallback | clean for Rule 4 |

**Reviewed clean: 16 stores/writers** (atomic+serialized, or read-only, or delegated/SQLite). **Out of disk-write scope (in-memory only):** `agent-registry-store.ts`, `agent-message-log.ts`.

**Note on `Date.now()` tmp suffixes in sync writers:** safe — each `writeFileSync`+`renameSync` completes within one event-loop turn (no `await` gap), so two sync writes cannot interleave on the same ms. The collision hazard applies only to **async** writers (DATA-003), where `randomUUID`/`randomBytes` is required.

DATA-001…006 full rows in §9.

---

## 7. Extension / plugin isolation

Disk-extension sandbox + permission broker (deny-by-default) + consent persistence/widen-reprompt + provenance stamping + builtin-promotion bounds (Rule 7) + the Rule-6 seam, across `src/main/extensions/**`, `src/main/modules/**`, `plugins/{slack,zana,gus}/**`.

### 7.1 Entry points traced (gated-by-X or ungated)

**A. Renderer → `IPC.extensions.*` (`index.ts:1908-2009`):** `list`/`setEnabled` OK (read / map-key only); `reveal`/`readRendererEntry`/`addPermission` **UNGATED → EXT-001 (≡SEC-004)**; `grantConsent` (`entries.find`) and `relaunch` (`diskSpecsById.get`) **gated — correct twins**.

**B. Disk-ext child → host `broker` (`process-host.ts:355-438`, keyed by authenticated `state.moduleId`):** `storage.get`/`log` gated by provenance; `exec` gated (assert + bin-allowlist, shell:false); `fs.*` gated (lexical+realpath, symlink-safe, sensitive-root write block); `fetch` gated (manual redirects, per-hop net assert); `storage.set` **UNGATED on size/rate → EXT-003**; `personas/teams.register` **provenance-gated, capability-UNGATED → EXT-005**.

Sandbox structure: child is a real Electron `utilityProcess`; untrusted `import()` runs in the child (`host-child.ts:193`), never main; denylist installed before import (`:98-104`).

### 7.2 Broker attestations — reviewed clean
- **Out-of-process isolation (P3-A):** disk-ext `import()` in the forked `utilityProcess`; `loader.ts:30-42` confirms `modules:[]` always empty in main. Crash/hang contained — `process-host.ts:440-460` rejects in-flight calls; dispatch/setup/teardown timeout-bounded.
- **Deny-by-default broker:** `permission-broker.ts:151-188` — unknown id / ungranted perm / out-of-scope request all deny. Builtins allowed by provenance only.
- **Capability = declared ∩ consented (P3-D wired):** `index.ts:624` → `effectivePermissions(...)`; no consent → `[]` → all denied; loader refuses to spawn unconsented/widened ext.
- **Consent persistence + widen-reprompt:** `consentStateFor` returns `'widened'` when declared ⊄ consented; `addExtensionPermission` widens *declared* only, never grants → re-prompt before effective.
- **SSRF / redirect rechecks:** `broker-caps.ts:120-158` `redirect:'manual'`, per-hop `net` re-assert incl. first, `FETCH_MAX_REDIRECTS=5`; 30x → 169.254.169.254 re-checked + denied.
- **Provenance stamping:** `persona-team-registry.ts:78-119` stamps `source={extensionId:moduleId}` AFTER sanitize, from host-authenticated `moduleId` (self-declared `source` overwritten); ids namespaced `ext:<moduleId>:<slug>`; cleared on teardown/crash/kill. Rule-6 clean.
- **Builtin-promotion bounds (Rule 7):** `builtinExec` ≡ broker `exec` (shell:false, 16MiB, 60s); `builtinFetch` shares redirect/body caps; builtin is **not weaker** (adds a 30s timeout the broker lacks; only intended diff is the absent per-hop net re-assert — trusted tier).
- **Namespace reconciliation:** discovery rejects `id!==dirName` and `id∈reservedIds` (`discovery.ts:349-378`).
- **Rule-6 B4 source-text guard:** `rule6-zana-literal.guard.test.ts` enforced; only code hit is `ticketsApi.ts:64`. (Scope caveat → EXT-007 / debt: matches only `'zana'`, only renderer.)
- **Slack & zana plugins:** clean for isolation — no value reaches an injection sink; they name only their own ids.

EXT-002 (SOQL, medium — verified-downgraded from high), EXT-003 (medium), EXT-004 (medium, needs-followup), EXT-005/006/007 (low) full rows in §9.

---

## 8. Technical-debt register

Durable debt below the §9 risk-table bar. Each with a one-line "why it will bite."

- **DEBT-001 — Shared `gus-*` CSS couples the live `gus` extension panel to core's Tickets UI.** `src/renderer/styles/global.css` (33 `gus-*` defs) ↔ `src/renderer/components/ProjectTickets/*` (66 usages; `TicketDetailModal.tsx` alone 54). *Bite:* a future restyle of `gus-*` (intended for the disk-ext panel) silently re-skins core's Tickets kanban/modal/chatter with no compile-time signal. Split the shared base out before any restyle (Tickets-only overrides already live under `zana-*` modifiers).
- **DEBT-002 — Two implementations of the realpath-confine idea.** `trustedProjectRoot` (`index.ts:1505-1532`) ↔ `resolveProjectRoot` (`resolve-project-root.ts:47-85`). *Bite:* a hardening fix applied to one twin and not the other creates a confinement asymmetry — a silent bypass. Consolidate (folded into CS-1).
- **DEBT-003 — Ungated fs *reads* vs gated fs *mutations* in the same handler block.** `index.ts:1489-1495,1569-1574` (raw path) vs `:1537-1568` (gated). *Bite:* the asymmetry invites a future handler copy-pasted from the wrong (ungated) twin; root of SEC-005. Add a guard test (CS-1).
- **DEBT-004 — `PersonaTeamRegistry` shares `sanitizePersona`/`sanitizeTeam` with the file-backed stores.** `persona-team-registry.ts:26-27,88,110`. *Bite:* the sanitize functions now have two callers with different trust models (trusted user/project files **and** untrusted ext input); a relaxation for a file-store need silently widens what an extension can inject. Evaluate any edit against both callers.
- **DEBT-005 — IPC error-envelope divergence is untested as a contract (cross-ref API-001).** `safeHandle` (`index.ts:751-764`) + per-handler `onError` thunks. *Bite:* a handler added with yet another error shape passes review and CI; renderer callers assuming `Result` mis-handle at runtime. Add a canonical-shape guard test (CS-2).
- **DEBT-006 — `ticketsApi` retains two dead marshallers (`listSources`, `probeProjects`).** `ticketsApi.ts:33-42`. *Bite:* they enlarge the quarantined Rule-6 seam's surface with no live caller; the "kept on purpose" decision decays into "nobody knows." Confirm-and-delete (with the two B2 tests) or annotate with a tracking ticket.
- **DEBT-007 — `register_project` is a permanently weaker sibling on the MCP contract (cross-ref API-003).** `register-project-mcp-tool.ts:9-17`. *Bite:* until the schema/callback encodes confinement, every new MCP tool author has a precedent for "accept an arbitrary path, it's fine." Pin the rationale to a decision record (CS-2).

---

## 9. Risk-ranked findings

Ordered strictly per the contract §5: severity first (critical→low), then theme-cluster (grouped by shared root cause, ranked by the cluster's top severity), then severity × effort within a tier. **Authoritative severities** are post-verification (verified passes override finder provisional severities). Every finding carries the full §2 schema.

### ▰▰▰ CLUSTER A — "CONFINEMENT ASYMMETRY" (top severity: HIGH) ▰▰▰
*Shared root cause: untrusted renderer/agent path or id → fs/git/settings/extension sink with no `trustedProjectRoot`+`confine`, while the sibling mutation op IS gated (`index.ts:1537-1568`). One fix (CS-1) closes the high members; the same pattern extends to the medium/low tail. SEC-004's medium member is pulled up to sit with its high siblings per §5.2.*

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **SEC-001** | `claudeSettings.write` writes arbitrary `.claude/settings.json` (incl. `hooks`) from an unconfined renderer `projectPath` | §1.3 Trust-boundary (Rule 1/2) | `index.ts:2024-2033` (handler); `claude-settings.ts:151-182`, `:96`, `:161-164` | **high** | Handler calls `writeClaudeProjectSettings(projectPath, scope, patch)` with **no `trustedProjectRoot`** (unlike fs siblings at `:1537-1568`); `mkdir(join(projectPath,'.claude'),{recursive:true})`+atomic `rename` ⇒ create-capable (incl. `~/.claude`); `merged={...current.settings,...patch}` + `out={...(view._unknown??{})}` round-trips renderer `_unknown.hooks` verbatim | Untrusted renderer via `window.cc.claudeSettings.write` (preload:308-310); precondition = in-app XSS / malicious ext renderer (renderer is local sandboxed bundle `index.ts:1106`, not remote) | Persistent host code-exec: crafted `hooks` block runs on next `claude` invocation; create-capable + global-scope reach make it the cluster lead | Gate with `trustedProjectRoot(projectPath)` like `fs.createFile/rename/delete`; AND drop/deny `_unknown.hooks`/`env` on the write path (preserve only keys already on disk) | S | confirmed |
| **SEC-002** | `fs.writeFile` overwrites any existing uid-writable file ≤2MB with no project confinement | §1.3 (Rule 1/2) | `index.ts:1491-1495` (handler); `fs.ts:108-127` | **high** | `safeHandle(IPC.fs.writeFile,(p,content)=>fsWriteFile(p,content))`; sink enforces only 2MB cap + `statSync(absPath).isFile()` (comment: "a sanity check, not a creation API", fs.ts:113-114); the `// Every mutating op below is confined` block (fs.ts:129-136) begins *after* writeFile | Untrusted renderer via `window.cc.fs.writeFile(path,content)` (preload:123) | Overwrite of `~/.zshrc`, project `package.json`, existing `~/.claude/settings.json` → host code-exec on next shell/tool launch (cannot create new files — the only bound) | Add `root` param; route through `trustedProjectRoot(root)`+`confine(root,p)`; move body under fs.ts's confined block | S | confirmed |
| **SEC-003** | `git.discard/status/showHead/listWorktrees` confine to "any git repo", not a registered project (destructive `discard`) | §1.3 (Rule 1/2) | `index.ts:1721-1724`; `git.ts:224-297`, `:130-200`, `:61-80` | **high** | Handlers forward raw `p`; `discardChanges` validates only `isAbsolute`+`findToplevel` (walks to ANY `.git`, git.ts:8-16)+non-`..` rel, then `unlinkSync(absPath)` (untracked) / `git checkout HEAD -- rel` (tracked). No `trustedProjectRoot` | Untrusted renderer via `window.cc.git.discard(path)` (preload:151) | Destructive loss of uncommitted/untracked work in **any** repo on the machine; read ops leak status/HEAD from arbitrary repos | Route all four through `trustedProjectRoot(root)`+confine before calling `git.ts`, mirroring create/rename/delete | S | confirmed |
| **SEC-004 (≡ EXT-001)** | Extension by-id IPC handlers build fs paths from an unvalidated `id` (path traversal) | §1.3 + §1.7 | `index.ts:1929-1938,1945-1949,1977-1989`; `discovery.ts:580-582,491-523,600-646`; `path-util.ts:25-28` | **medium** *(↓ from high)* | `extensionDir(id)=join(getExtensionsDir(),id)` — no validation; `resolveContained(dir,entry)` confines `entry` within `dir` but **never checks `dir⊂root`**, so `id='../../x'` escapes. Bypasses `discoverExtensions` `id===dirName` (discovery.ts:364). Correct twin = `grantConsent` `extensionEntries.find(e=>e.id===id)` (index.ts:1959) / `relaunch` `diskSpecsById.get(id)` | Untrusted renderer via `window.cc.extensions.{reveal,readRendererEntry,addPermission}` (preload:295-299) | Bounded (downgrade basis): `reveal`→Finder-open of arbitrary dir; `readRendererEntry`→read of attacker-*planted* manifest+renderer only (not `~/.ssh`); `addPermission`→consent-gated `permissions`-only rewrite. No arbitrary-secret-read, no code-exec | Validate `id` at top of `extensionDir` (reject `..`/sep/absolute) OR resolve via `extensionEntries.find(...)` like the gated twins | S | confirmed |

### ▰▰ MEDIUM TIER ▰▰

**Confinement-theme mediums** *(same root cause as Cluster A; fixed by extending the same gate):*

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **SEC-005** | Local fs read handlers expose arbitrary on-disk contents to the untrusted renderer | §1.3 (Rule 1/2 — info-disclosure) | `index.ts:1489-1490,1569-1574,1833`; `fs.ts:31,67,259,305,391` | **medium** | The fs.ts confinement block (`:129-136`) covers only mutating ops; `listDir/readFile/walkFiles/searchFiles/readDataUrl` take a raw `absPath` wired directly with no `trustedProjectRoot` | Untrusted renderer | Read of any uid-readable file (`~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.claude.json` tokens) + fs enumeration; exfil via inbox/library/module channels (held at medium pending §4 verification — not adversarially confirmed) | Bring reads under the same anchor as the mutating ops (registered project / HOME-base); make read/write symmetric | M | likely |
| **SEC-007** | MCP `register_project` widens the `trustedProjectRoot` trust anchor | §1.3 (Rule 1/2 — anchor integrity) | `register-project-mcp-tool.ts:70-123` (doc 9-16, 82-100); consumed by `index.ts:1505-1532` | **medium** | Tool resolves `isAbsolute(path)?resolve(path):…` and calls `registerProject(absPath)`; documented intentional. But `trustedProjectRoot` trusts **any** path in `store.listProjects()`, so a registered path becomes a writable root for `fs.createFile/rename/delete` | Spawned agent over loopback MCP (semi-trusted); compounds with no-auth-token loopback (`mcp-server.ts:540`) | Trust-anchor widening — promotes an arbitrary dir to "registered project", after which the otherwise-correct fs-mutation gate confines to (and permits writes under) the attacker-chosen root | Constrain `register_project` to the agent's own project root / clone-root base, OR have `trustedProjectRoot` distinguish user- vs agent-registered projects; document loopback local-trust | M | needs-followup |

**Plugin / isolation mediums:**

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **EXT-002** | CDC trigger `object`/`fields` interpolated raw into SOQL — no identifier validation | §1.7 (+§1.5 overlap) | `gus-main.ts:766` (sink), `:660-677` (`cdcSaveTrigger`, no validation), `:756-757`; renderer `CdcPanel.tsx:103,489-504` | **medium** *(↓ from high)* | `` `SELECT ${uniqueFields.join(', ')} FROM ${trigger.object} ${whereClause} …` `` — object+fields interpolated raw; *value* twins ARE escaped (`:760,:763`). `cdcSaveTrigger` persists renderer trigger with no allowlist/regex; armed at boot (`:439-448`), auto-runs on timer (`:810`) | Untrusted renderer via `host.call('cdcSaveTrigger',…)`; field-list injection through shipped free-text UI (operator self-query), FROM-rewrite needs renderer beyond shipped UI (object hardcoded `ADM_Work__c`, read-only, CdcPanel:88,361) | SOQL read-injection → info-disclosure bounded by the authed org user's own perms, fed into launched persona prompts; **not RCE** (brokered argv `sf` exec, no shell) | Validate in `cdcSaveTrigger` (main) before persist: object ∈ allowlist {`ADM_Work__c`}; each field `^[A-Za-z][A-Za-z0-9_.]*$`. Identifier allowlist, NOT `soqlEscape` | S | confirmed |
| **EXT-003** | Disk-ext `ctx.storage.set` drives unbounded synchronous full-cache `writeFileSync` on the main loop | §1.7 (+§1.4 Rule 5) | `registry.ts:177-182` (`ModuleStorage.set`); via `process-host.ts:376-378`, `host-child.ts:152-155` | **medium** | `set(k,v){this.cache[k]=v; writeFileSync(tmp,JSON.stringify(this.cache,null,2)); renameSync(tmp,this.file);}` — whole-cache re-serialize+sync write, no size/key/retention/debounce; `process-host.ts:376` serves `storage.set` unconditionally (no caps gate), `host-child.ts:154` fires without await ⇒ tight-loop spammable. **Same sink as PERF-002** | Untrusted disk-ext child (no permission required) | Main-loop stall (blocks pty flush + IPC) + unbounded growth of `~/.zcc/modules/<id>.json` | Cap value-size+key-count, debounce/coalesce off main loop, per-ext retention bound; keep atomic tmp+rename | M | likely |
| **EXT-004** | Disk-ext sandbox is JS-level only; `process.dlopen`/native-addon escape leaves the broker bypassable | §1.7 (sandbox completeness) | `host-child-guard.ts:36-57` (honest residual), `:72-90` (`DENIED_BUILTINS` — `dlopen` absent) | **medium** | Three JS-level layers (ESM hook, `Module._load` patch, `process.binding` stub); file documents `process.dlopen` left in place as "an explicitly accepted residual" — a native `.node` addon regains full `fs`/`net`/`child_process`. `utilityProcess` is not OS-sandboxed by default | Malicious disk-ext bundling a native addon; consent gates *declared permissions*, not "may run native code" (a zero-permission ext can still `dlopen`). Precondition: user installs+enables+consents | Complete broker bypass (exec/fs/fetch gating, egress allowlist, sensitive-root block) — full host capability of the child | OS/process sandbox at `utilityProcess` spawn (Node `--permission`, seccomp); interim: stub `process.dlopen` for exts declaring no native need + surface "can run native code" at consent | L | needs-followup |

**Performance / Rule-5 mediums:**

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **PERF-001** | `listClaudeSessions` reads & fully parses EVERY transcript JSONL synchronously on the main loop | §1.4 (Rule 5) | `claude.ts:90-115` (esp. `:100` `readFileSync`, `:104-105` split+filter); via `index.ts:1485` | **medium** | Per `.jsonl`: `raw=readFileSync(full,'utf8')`, `raw.split('\n')`, full-array filter + `extractFirstUserPrompt`/`extractTitle` scan whole array; no tail window/async/cap. Twin `transcript-reader.ts:159-178` reads only `tailBytes` | Untrusted renderer — opening the Claude resume picker invokes the IPC handler | Project with N multi-MB transcripts → synchronous read+split+parse stalls the main event loop (every window's IPC/PTY flush/agent-status) on each picker open; DoS-within-trust | Mirror `transcript-reader.ts`: async `fs/promises.readFile` + slice a tail window before split/parse; derive count from a bounded measure | S | likely |
| **PERF-002** | `ModuleStorage.set` synchronously rewrites the entire unbounded cache on every key set (renderer- AND disk-ext-reachable) | §1.4 (Rule 5) | `registry.ts:177-182` (`set`), `:155-156` (unbounded cache); via `index.ts:2474-2476` (renderer IPC) AND `host-child.ts:154`→`process-host.ts:376-377` (disk-ext) | **medium** | Same sink as EXT-003; PERF lens broadens reachability: directly callable from untrusted renderer `window.cc.modules.storageSet` (preload:379-380)→`modules:storageSet` (index.ts:2474-2476), no rate-limit/bound | BOTH untrusted renderer (direct IPC) and sandboxed disk-ext | Tight-loop `set` ⇒ synchronous full-cache serialize + `writeFileSync` per call on main thread → UI/IPC/PTY freeze worsening as cache grows + unbounded `~/.zcc/modules/<id>.json` | Async debounced/coalesced write (mirror `template-store.ts:468-469`/`persona-store.ts:578-579`); add key-count/size cap (inbox-store retention `:109-120`); rate-limit broker `storage.set` | M | likely |

**IPC API-contract mediums** *(cluster: renderer↔main contract weakness — `safeHandle` is a trap not a normalizer; `modules.*` takes unvalidated/unbound input):*

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **API-003** | `register_project` MCP tool diverges from `inbox_push` sibling — accepts an unbound absolute path | §1.5 IPC/MCP contract | `register-project-mcp-tool.ts:42-49,79-100`; contrast `inbox-mcp-tool.ts:43-70` | **medium** | Header documents the divergence ("the agent may pass any absolute path … register a directory outside the originating project"); schema `path:z.string().min(1)`; handler `if(isAbsolute(path)) absPath=resolve(path)` — no confinement to URL-bound `projectRoot` | Any local agent on the MCP port (SEAM C) | Two sibling tools teach opposite invariants; safety depends on an out-of-band callback, not the schema (contract-shape root of SEC-007) | Document the asymmetry as first-class + have injected `registerProject()` confine to clone-root/HOME, OR constrain schema to a relative path against URL-bound `projectRoot` | S | confirmed |
| **API-004** | `inbox_push` `docs[].path` schema is an unconstrained string; confinement implicit in the store | §1.5 | `inbox-mcp-tool.ts:48-63,125-133` | **medium** | `docs:z.array(z.object({path:z.string().min(1)…}))` — any string passes; handler forwards to `inboxStore.append` with no boundary check; description says "inside this project" but schema lacks `.refine(p=>!isAbsolute(p)&&!p.includes('..'))` | Any local agent (SEAM C); identity bound from URL but path unvalidated at the seam | Seam advertises a constraint it doesn't enforce; no second line of defense if the store loosens | Add `.refine` rejecting absolute/`..` at the schema, mirroring `assertSafeTicketId` (`resolve-project-root.ts:93-106`); verify store confinement in §1.6 | S | likely |
| **API-001** | `safeHandle` does not normalize the error envelope; IPC handlers return three incompatible shapes | §1.5 | `index.ts:751-764` (`safeHandle`); divergent callers `:1489-1495`, `:1533-1568`, `:1220/:1237`, `:2462-2466` | **medium** | `catch(err){logMainError(...); return onError(err,...args);}` — shape is each caller's choice: `[]` vs `{ok:false,message}` (no `code`) vs full `Result{ok,code,message}` vs re-throw. Four siblings, four contracts | Untrusted renderer — every consumer must special-case per channel | A handler that "succeeds" with `[]` is indistinguishable from a real empty result → failures silently swallowed; back-compat hazard (changing `onError` breaks callers with no type error) | Wrap returns in the canonical `Result<T>` envelope (`src/shared/types.ts`) via a `safeResultHandle` twin; mirror `projects.add`; keep re-throw only for `modules.call` as the documented exception | M | confirmed |
| **API-002** | `IPC.modules.call` dispatches unvalidated `args` with a renderer-supplied `moduleId` | §1.5 | `index.ts:2458-2467`; `module-router.ts:40-45` | **medium** | `(moduleId,capability,args:unknown[])=>moduleRouter.dispatch(moduleId,capability,Array.isArray(args)?args:[])`; router checks only *existence*, no per-capability arg schema; `moduleId` is a plain renderer arg (`:2482` concedes "a panel today could claim another id") | Untrusted renderer (SEAM B) — any renderer code can call any capability of any live module with any args, attributing any `moduleId` | Module-capability contract is "trust the renderer blob"; malformed args reach built-ins/disk-ext children unchecked; renderer→router moduleId is unauthenticated (broker re-checks only the disk-ext leg) | Per-module `{capability→zodSchema}` validated in `module-router.dispatch` (mirror MCP per-tool zod); complete P3-C authenticated panel origin so router stamps moduleId from host binding | M | confirmed |

**Data / store-integrity mediums:**

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **DATA-001** | `InboxStore.read()` throws on a single malformed JSONL line, breaking the whole inbox view | §1.6 (Rule 4 / load robustness) | `inbox-store.ts:422-425` | **medium** | `all=raw.split('\n').filter(l=>l.trim()).map(l=>JSON.parse(l) as InboxEntry)` — no try/catch, unlike sibling mutators (compact/coalesce/deleteEntry/deleteMany) which skip bad lines; appends are raw `appendFile` (`:387`), so a torn line / hand-edit breaks every `read()` permanently | Operator / any producer of the documented hand-editable `~/.zcc/inbox/entries.jsonl`; torn append from a crash | Entire inbox feed hard-fails on every load until hand-repaired | Wrap per-line parse in try/catch + skip/log, matching the in-file `compact`/`coalesce` twin | S | likely |
| **DATA-002** | `validateScheduleFile` does not clamp `history.retain` / cap `status.runs` on load (Rule 5 retention bypass) | §1.6 (load-path retention) | `scheduler-store.ts:85-97`; sink `scheduler.ts:696`; clamp twin `scheduler.ts:809-811` | **medium** | `retain` copied verbatim (`:86-88`), `runs` verbatim (`:95-97`); `clampRetain(MAX_RETAIN=100)` applied only on create(`:155`)/update(`:200`); `recordRun` trims with the unclamped on-disk value and rewrites full array every fire | Schedules are hand-/skill-editable (`~/.zcc/schedules/*.json`); a file with `retain:1000000` or pre-seeded large `runs[]` | Unbounded in-memory accumulation + full-array rewrite to disk on every fire — main-loop+disk DoS surviving restart | Apply `clampRetain()`+`.slice(0,MAX_RETAIN)` to `retain`/`runs` inside `validateScheduleFile` on load, mirroring create/update | S | likely |

### ▰ LOW TIER ▰

| id | title | dimension | location | severity | evidence | reachability | impact | remediation | effort | confidence |
|---|---|---|---|---|---|---|---|---|---|---|
| **SEC-006** | `openIn` spawns editors / Finder on an unconfined renderer path | §1.3 (defense-in-depth) | `index.ts:1716-1719`; `openers.ts:43-94` | **low** | `cursor`/`code`/`terminal`/`finder` branches pass the renderer path unconfined (`:49,54,75,82`); mitigated: all spawns use **array args** (no shell-injection); `browser` correctly gated to `http(s)` (`:87-89`) | Untrusted renderer | Opens attacker-chosen path in an editor/Finder window — UX annoyance + minor info-exposure; no command-injection/write | Confine the path to a registered project / HOME-base before spawning, consistent with the fs gate | S | likely |
| **EXT-006** | `sensitiveRoots` blocks writes but not reads → broad `fs:read` grant can read `~/.ssh`/`~/.aws` | §1.7 (broker scope parity) | `permission-broker.ts:176-180` | **low** | `sensitiveRoots()` check is only inside `if(permission==='fs:write')`; an `fs:read` whose realpath lands in a sensitive root is allowed if within a granted `fsRoot` (broad consented `~` covers `~/.ssh`) | Disk-ext that declared `fs:read` with user-consented broad `fsRoots` (operator decision) | Read/exfil of `~/.ssh/id_rsa`, `~/.aws/credentials` within a granted-but-broad scope | Apply the `sensitiveRoots` block to `fs:read` (+readdir/exec cwd), mirroring the write guard | S | likely |
| **EXT-005** | Persona/team contribution requires no declared permission or scoped consent | §1.7 (permission-model completeness) | `process-host.ts:404-431`; `persona-team-registry.ts:78-119` | **low** | `personas.register`/`teams.register`/`*.clear` call `reg.setPersonas/setTeams` with no `broker.assert` (rationale: "inert data; teeth at the launch path"); no `personas`/`teams` token in `ExtensionPermission` | Any enabled+consented disk-ext (empty permission set still runs); bounded by caps + sanitize/namespace/provenance | UI clutter / social-engineering (persona resembling a trusted one); mitigated by namespaced ids, source badge, gated launch | Add a declarable `personas`/`teams` permission gated like the others, OR document as intentional bounded capability | S | likely |
| **EXT-007** | `RESERVED_BUILTIN_IDS` hardcodes concrete extension ids in core discovery (Rule-6 fallback) | §1.7 (Rule 6) | `discovery.ts:93` (`['zana','slack']`) | **low** | Not in `MAIN_MODULES`/`APP_MODULES` nor the `ticketsApi` seam; mitigated — authoritative callers forward the live set (`index.ts:616,2819,2838` pass `MAIN_MODULES.map(m=>m.id)`), so the constant is a documented defensive fallback | N/A (source-structure/maintainability) — drifts if `MAIN_MODULES` changes and a caller relies on the fallback | Future built-in add/remove without updating the constant silently weakens shadow-rejection for fallback callers | Keep in lockstep with `MAIN_MODULES`, or make `reservedIds` non-optional and delete the literal | S | likely |
| **API-005** | MCP tool surface has no version/capability negotiation; tool set varies silently by feature flag | §1.5 | `mcp-server.ts:259` (`version:'0.1.0'`), `:266-384` | **low** | Server version is a hardcoded string never bumped; tool existence depends on injected-dep flags (`if(opts.sessionId&&opts.closeSession)`, `if(opts.launchTeam)`…) — two builds expose different tool sets under the same version | Any agent; affects back-compat for scheduled/external agents that hardcode tool names | An agent can't detect from the version whether `launch_team`/`library_*`/`close_session` exist; removed≈never-present, no deprecation path | Bump `version` on tool-surface changes; optionally advertise active tool set in a discovery response | S | likely |
| **API-006** | Preload `contextBridge` surface exposes no API/contract version, only the build version | §1.5 | `preload/index.ts:404`; coupling in `shared/ipc.ts` | **low** | Single `version` resolves `IPC.app.version` (build version); renderer↔main agreement enforced only by shared `IPC.*` constants at build time | N/A (same-build coupling) — defense-in-depth/future-proofing | If preload were served to a mismatched renderer (hot-reload/partial update) there is no handshake to detect it | None required for single-bundle model; add a contract-version handshake if a split-update path is introduced | S | likely |
| **DATA-003** | Non-unique tmp suffix in async `ensureMcpConfigForProject` can lose the rename race | §1.6 (Rule 4 / unique-suffix) | `mcp-config.ts:77` (sync twin ~`:106`) | **low** | Async writer builds `${target}.tmp-${pid}-${Date.now()}` (ms) while the sync twin uses `${pid}-${randomUUID()}` with a comment naming this race; two same-ms async calls collide, second `rename` throws ENOENT | Operator-triggered config ensure; low-probability same-ms concurrency (content identical; callers `.catch(logMainError)`) | Rare spurious logged error; no data loss | Use `randomUUID()`/`randomBytes(4)` in the tmp suffix to match the sync twin in the same file | S | likely |
| **DATA-004** | `settings.local.json` toggle uses unserialized async RMW (+ non-unique tmp), shared with a second unsynchronized writer | §1.6 (Rule 4 / atomic+serialized) | `mcp.ts:202-204` (RMW `:139-205`); co-writer `mcp-catalogue.ts:240-301` | **low** | `setMcpServerEnabled` async read→mutate→write `tmp-${pid}-${Date.now()}` with **no mutex**; sibling `setProjectMcpDisabled` mutates the **same** file (unique tmp + BAD_JSON guard, but also no shared mutex) → two concurrent toggles last-rename-wins | Operator-triggered MCP toggles; low-probability concurrency between the two writers | Dropped enable/disable update (lost write); rare tmp collision on the `mcp.ts` side | Switch `mcp.ts` to `randomUUID`/`randomBytes(4)` tmp + serialize **both** writers on one shared in-process mutex; mirror `zana-main.ts` `runExclusivePerFile`+`writeJsonAtomic` | S | likely |
| **DATA-005** | `PromptRegistry.saveUser` writes prompt files non-atomically (no tmp+rename) | §1.6 (Rule 4 / atomic) | `prompt-registry.ts:310` | **low** | `writeFileSync(join(dir,fileNameForId(entry.id)),JSON.stringify(clean,null,2))` — direct overwrite, unlike sibling per-id stores (`persona-store.ts:41-46`, `team-store.ts:33-38`, `skill-bundles-store.ts:31-36`) that route through `writeJsonAtomic` | Operator via Settings→Prompts; sync (serialized) | Crash mid-save corrupts one user prompt file; load is robust (`readPromptFile`→null→builtin fallback), so blast radius = one shadow lost | Factor the per-id `writeJsonAtomic` (tmp+unique rename) and call it here | S | likely |
| **DATA-006** | `library-store` writes per-doc content files non-atomically, deviating from its own atomic manifest writer | §1.6 (Rule 4 / atomic) | `library-store.ts:451,695,702` (atomic twin same file `:138-144`) | **low** | Content writes are plain `writeFileSync(absPath,…)` (`:451,695`) + metadata RMW (`:700-706`); the shared manifest in the same file uses tmp+rename (`:138-144`, comment "matches saved-store.ts"). RMW is sync (serialized); only atomicity missing | Operator/agent via library doc create/update (`library_*` MCP + Settings); sync→serialized | Crash mid-write truncates one library doc; manifest is atomic so blast radius = a single torn doc, not the index | Route content writes through the same tmp+rename helper the manifest writer uses (12 lines up); confirm git-tracked verbatim writes aren't intentionally non-atomic | S | needs-followup |
| **PERF-003** | `listAllSchedules` reads every schedule file synchronously across global + all project dirs | §1.4 (Rule 5) | `scheduler-store.ts:118-174` (`:124` readFileSync, `:144` readdirSync, `:169-172` per-dir) | **low** | `readScheduleFile` `JSON.parse(readFileSync)`; `listInDir` readdir+read each `.json`; `listAllSchedules` runs it for global + once per project — all sync. Per-file payload bounded (`retain` default 10); cost scales with (#projects × #schedules) | Operator/local — scheduler reload + project add (`index.ts:1234`), behind a debounced fs-watch | At large fan-out, a brief synchronous stall proportional to total schedule count; bounded per-file | Convert load to async `fs/promises`, read project dirs concurrently (writes already atomic) | S | needs-followup |

> **Note — two rows share one sink:** PERF-002 and EXT-003 both target `registry.ts:177-182` (`ModuleStorage.set`) from two dimensions (renderer-IPC vs disk-ext reachability). Kept as distinct rows per the dedupe scope (only SEC-004≡EXT-001 was directed to merge), but they close with **one** fix — see CS-3.

---

## 10. Prioritized roadmap

Change-sets sequenced per §5.4 so an upstream root-cause fix that subsumes several findings comes before isolated low items. Each is a coherent theme, not a one-by-one list. **Sequence: CS-1 → CS-2 → CS-3 → CS-4 → CS-5.**

### CS-1 — Unify path confinement across every renderer/agent sink *(ROADMAP ITEM #1 — confinement gate first)*
- **Closes:** SEC-001, SEC-002, SEC-003, SEC-004 (≡EXT-001) directly; extends to SEC-005, SEC-006, SEC-007 by applying the same gate to reads/openers/anchor.
- **The one fix:** introduce a single `trustedProjectRoot`+`confine` gate (consolidating the two existing twins `trustedProjectRoot` @`index.ts:1505-1532` and `resolveProjectRoot` @`resolve-project-root.ts:47-85` — **DEBT-002**) and apply it across `claudeSettings.write`, `fs.writeFile`, the four `git.*` handlers, and the extension by-id handlers (`extensionDir`). The fs-mutation siblings (`index.ts:1537-1568`) are the correct twin to mirror — **one gate reuses across 4 findings**.
- **Severity/effort rationale:** the cluster's top severity is **high** and every core member is **S** (localized per handler) → highest-leverage, lowest-risk work; do it first. SEC-005 (reads) is **M** (touches the read API shape); SEC-007 is **M** and folds partly into CS-2.
- **What it closes:** the entire "confinement asymmetry" — root cause of all 3 highs + 4 mediums + 1 low. Add the guard test from **DEBT-003** (lock gated/ungated symmetry) and retire **DEBT-002** by consolidating onto one helper.

### CS-2 — Harden the renderer↔main / agent↔main API contract
- **Closes:** API-001, API-002, API-003, API-004, API-005, API-006; finishes SEC-007's contract-shape half.
- **Theme:** make the IPC (B) side as uniform as the already-strong MCP (C) side. Normalize the error envelope into the canonical `Result<T>` via a `safeResultHandle` twin (API-001); add a per-module `{capability→zodSchema}` validator + authenticated panel-origin moduleId in `module-router.dispatch` (API-002); encode path/identity invariants in the MCP schemas (`.refine` on `inbox_push` path — API-004; confine/declare `register_project` — API-003, which also closes the SEC-007 anchor-widening tail); add MCP/contract versioning levers (API-005/006).
- **Severity/effort rationale:** all **medium**; API-003/API-004 are **S** (lead), API-001/API-002 are **M**, API-005/006 fold in cheaply. Lock with a canonical-error-shape guard test (**DEBT-005**) and a decision record pinning the `register_project` exception (**DEBT-007**).

### CS-3 — Keep heavy/unbounded work off the main loop + enforce retention (Rule 5)
- **Closes:** PERF-001, PERF-002, EXT-003 (PERF-002 ≡ EXT-003 sink — one fix), PERF-003, DATA-002.
- **Theme:** windowed/async reads + debounced bounded writes + retention caps. Mirror `transcript-reader.ts` tail-windowing for `listClaudeSessions` (PERF-001); make `ModuleStorage.set` async-debounced with value/key/retention caps + broker rate-limit (PERF-002/EXT-003); async-fan-out `listAllSchedules` (PERF-003); clamp `retain`/`runs` on the schedule load path (DATA-002).
- **Severity/effort rationale:** **medium** cluster; PERF-001/DATA-002 are **S** (lead), PERF-002/EXT-003 are **M** (shared sink). Cite the inbox-store retention discipline (`:109-120`) and the `*-store` debounced-flush twins as the patterns to mirror.

### CS-4 — Store load-path robustness + atomic-write parity (Rule 4)
- **Closes:** DATA-001, DATA-003, DATA-004, DATA-005, DATA-006.
- **Theme:** every writer/loader mirrors its already-correct twin. Per-line try/catch on `InboxStore.read()` (DATA-001); unique tmp suffix + one shared mutex on the `settings.local.json` co-writers (DATA-003/DATA-004, mirror `zana-main.ts` gold-standard); route prompt + library-content writes through the existing `writeJsonAtomic`/tmp+rename helpers (DATA-005/DATA-006).
- **Severity/effort rationale:** DATA-001 is **medium/S** (a single load can hard-fail the whole inbox — highest of this set, lead); the rest are **low/S** crash-window parity fixes. Low risk, high consistency payoff.

### CS-5 — Deepen extension/plugin isolation
- **Closes:** EXT-002, EXT-004, EXT-005, EXT-006, EXT-007.
- **Theme:** plug the remaining isolation gaps. Identifier-allowlist the gus CDC SOQL path (EXT-002, **medium/S** — lead); apply the `sensitiveRoots` block to `fs:read` (EXT-006); add a declarable `personas`/`teams` permission (EXT-005); keep `RESERVED_BUILTIN_IDS` in lockstep / delete the literal (EXT-007).
- **Large but necessary:** EXT-004 (JS-only sandbox; `process.dlopen` escape) is **medium/L** and `needs-followup` — it requires an OS/process sandbox at `utilityProcess` spawn. Sequence last and treat as an explicit risk decision (the residual is documented/accepted today); interim mitigation: stub `dlopen` for exts declaring no native need + surface "can run native code" at consent.

### Debt backlog (§8 — folded into the change-sets above where noted)
DEBT-001 (shared `gus-*` CSS — split the base before any restyle), DEBT-002 (→CS-1), DEBT-003 (→CS-1 guard test), DEBT-004 (`sanitizePersona`/`sanitizeTeam` dual-trust caller — evaluate edits against both), DEBT-005 (→CS-2 guard test), DEBT-006 (`ticketsApi` dead marshallers — confirm-delete or ticket), DEBT-007 (→CS-2 decision record).

---

## Appendix — Adversarial verification log / refuted-and-downgraded

Per contract §4, every `high`/`critical` candidate ran a refute pass (a second agent re-traced each path independently from the cited `file:line`, attempting to prove it already-guarded / unreachable / by-design). Outcomes:

| Candidate | Pass outcome | Severity (was → now) | One-line reason |
|---|---|---|---|
| **SEC-001** (critical candidate) | survived; **critical DECLINED → high** | critical → **high** | No `trustedProjectRoot`; `mkdir` ⇒ create-capable incl. `~/.claude`; `_unknown.hooks` round-trips → persistent code-exec. But renderer is a **local sandboxed bundle** (`index.ts:1106`, `contextIsolation/sandbox` on) — not remotely reachable, so §2 caps it at `high` (needs a prior renderer compromise to trigger). |
| **SEC-002** | survived | high → **high** | `fsWriteFile` has only a 2MB cap + `isFile` check, no `confine` (fs.ts:108-127); overwrites any existing uid-writable file ≤2MB → code-exec config. Refute ("does `isFile` neutralize it?") rejected — it only blocks new-file creation. |
| **SEC-003** | survived | high → **high** | `discard/status/showHead/listWorktrees` confine via `findToplevel` to *any* repo, no `trustedProjectRoot` (git.ts:224-297); destructive `unlinkSync`/`checkout HEAD`. Refute ("renderer only passes a registered root") rejected by Rule 1 — renderer path selection is advisory. |
| **SEC-004 (≡EXT-001)** | survived as real & reachable; **DOWNGRADE high → medium** | high → **medium** | Traversal real (`extensionDir` unvalidated; `resolveContained` never re-anchors `dir`, path-util.ts:25-28) & renderer-reachable, but impact bounded: Finder-open / read of attacker-*planted* manifests / consent-gated `permissions`-only tampering — no arbitrary-secret-read, no code-exec. Impact axis lands at `medium`. |
| **EXT-002** (SOQL injection) | survived as a real unguarded Rule-1 violation; **DOWNGRADE high → medium** | high → **medium** | `object`/`fields` interpolated raw into SOQL (gus-main.ts:766), persisted unvalidated, boot-armed. But impact is **info-disclosure bounded within the authed org user's own permissions** (brokered argv `sf` exec, no shell — not RCE); the arbitrary-object-read variant additionally needs a renderer beyond the shipped read-only UI. Both clauses map to §2 `medium`. |

**Net refute-pass result:** all high candidates that entered §9 survived as real and reachable (none refuted as false-positive). Two were downgraded on the impact axis (SEC-004, EXT-002); SEC-001's critical candidacy was declined on the reachability axis. The five confinement findings remain one "confinement asymmetry" cluster, ranked by SEC-001.

*This review independently re-verified every overlapping claim against current code with its own citations rather than copying `docs/qa-expert-review-2026-06-26.md`; SEC-001, DATA-005, DATA-006, and PERF-003 are novel findings not present in that QA review.*
