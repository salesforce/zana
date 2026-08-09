# Dimension 2 — Architecture Map / Module Boundaries

**Scope:** §1.2 of the Architecture Review Output Spec (`.zcc/library/decisions/arch-review-output-spec.md`).
**Posture model:** Electron app — **trusted main** / **untrusted renderer** (Rules 1–2), an **out-of-process disk-extension host** behind a **deny-by-default permission broker** (Rules 6–7), a **localhost MCP server** for agents, and **disk stores** for shared state (Rules 4–5).
**Method:** filesystem-grounded; every box/edge cites a real file. Trust-funnel claims verified by direct read of `src/main/index.ts:1489–1574, 1721–1724`, `src/main/fs.ts`, `src/main/resolve-project-root.ts`, `src/preload/index.ts`, `src/renderer/util/ticketsApi.ts`.

> NOTE for downstream workers: this dimension produces the **module graph + boundary seams + a preliminary risk frame**. It does **not** emit full §2-schema findings — the ungated boundaries flagged in §6 are handed to the **security worker (§1.3)** and **API-contract worker (§1.5)** to trace input→sink and assign severity. They are marked `⚠ FLAG → security` below.

---

## 1. The six trust zones (boxes)

| # | Zone | Trust | Process | Representative files |
|---|------|-------|---------|----------------------|
| Z1 | **Renderer (UI)** | **Untrusted** | renderer (Chromium) | `src/renderer/App.tsx`, `src/renderer/store.ts` (130KB), `src/renderer/ticketsStore.ts`, `src/renderer/components/**`, `src/renderer/util/*` |
| Z2 | **Preload bridge** | Boundary marshaller (no logic) | renderer (isolated world) | `src/preload/index.ts` (single file, `contextBridge.exposeInMainWorld('cc', api)` @ `:455`) |
| Z3 | **Main (trusted core)** | **Trusted authority** | main | `src/main/index.ts` (142KB — IPC + wiring), `src/main/pty.ts`, `src/main/fs.ts`, `src/main/git.ts`, `src/main/remote-fs.ts`, `src/main/resolve-project-root.ts` |
| Z4 | **Extension host (disk extensions)** | **Untrusted, sandboxed, out-of-process** | `utilityProcess` child(ren) | `src/main/extensions/process-host.ts`, `host-child.ts`, `host-child-guard.ts`, `spawn-child.ts`, `host-protocol.ts`, `permission-broker.ts`, `broker-caps.ts`, `consent.ts`, `discovery.ts`, `loader.ts`, `module-router.ts`, `modules/registry.ts` |
| Z5 | **MCP server (agent surface)** | Trusted code serving **untrusted agents** | main (HTTP on 127.0.0.1) | `src/main/mcp-server.ts`, `mcp.ts`, `*-mcp-tool*.ts` (12 tool files) |
| Z6 | **Disk stores (shared state)** | Trusted data plane | main (+ `.zana`/`.zcc` on disk) | `src/main/store.ts`, `inbox-store.ts`, `library-store.ts`, `persona-store.ts`, `team-store.ts`, `scheduler-store.ts`, `agent-registry-store.ts`, … |

External plugins (`plugins/{gus,slack,zana}`) and built-in modules (`MAIN_MODULES = [zana, slack]`, `src/main/modules/index.ts:16`) attach to Z4's router; the `zana` data path additionally surfaces in Z1 via the Rule-6 quarantine seam (§4).

---

## 2. Diagram

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

---

## 3. Boundary seams (who enforces each crossing)

### SEAM A — Renderer → Preload (`contextBridge`)
- **Enforcer:** Electron context isolation + `src/preload/index.ts`. The renderer never gets `ipcRenderer`/`require`; it gets only the typed `cc` surface (`contextBridge.exposeInMainWorld('cc', api)`, `preload/index.ts:455`).
- **Responsibility crossing:** the preload is a **pure marshaller** — every method is a thin `ipcRenderer.invoke(IPC.x, …args)` or an `on/off` subscription wrapper. It performs **no validation** (by design — validation is main's job). `IPC.*` channel names come from the shared contract `src/shared/ipc.ts`.
- **One special edge:** `files.pathForFile` uses `webUtils.getPathForFile` (`preload/index.ts:155`) — the only non-IPC capability.

### SEAM B — Preload → Main (`ipcMain.handle`)
- **Enforcer:** `registerIpc()` in `src/main/index.ts:1219` (called **once** from `app.whenReady`), via the `safeHandle()` wrapper at `:751`.
- **Responsibility crossing:** `safeHandle` provides **error trapping + fallback shaping only** — it is **not** a validation gate. Input authorization is **per-handler** and inconsistent (see §6). This is the primary renderer→main trust boundary.

### SEAM C — Agent → Main (MCP, HTTP localhost)
- **Enforcer:** `src/main/mcp-server.ts` — `StreamableHTTPServerTransport` bound to `127.0.0.1:0` (`mcp-server.ts:~540`), **no auth token**; trust = localhost bind + identity-by-URL.
- **Responsibility crossing:** `projectId`/`sessionId` are parsed from the **URL path** (`matchMcpRoute()`, `mcp-server.ts:392–408`) and **closed over** in a freshly-built per-request `McpServer` (`buildProjectMcpServer()`). Agents **cannot** supply identity in the tool payload — a genuinely good unforgeable-identity design. Tool inputs are **zod-validated per tool**; there is no central validator.
- `mcp.ts` is **not** this server — it is the Settings-panel config reader/writer for *external* MCP servers (`~/.claude.json`, `<proj>/.mcp.json`). Distinct concern; don't conflate.

### SEAM D — Main → Extension host (`MessageChannelMain` / host-protocol)
- **Enforcer:** `module-router.ts:40` routes `(moduleId, capability, args)` → disk-ext (out-of-process) vs built-in (in-process). The out-of-process leg crosses `src/main/extensions/process-host.ts` over a dedicated `MessageChannelMain` port (`spawn-child.ts:102–107`), protocol in `host-protocol.ts`.
- **Responsibility crossing (the keystone):** the **host owns the port↔moduleId binding**; the child **never supplies its own moduleId** on broker requests (`host-protocol.ts:28–31`, `process-host.ts:52,70,358`). Every capability call is authorized by `PermissionBroker.assert(moduleId, perm, scope)` against the **authenticated** id. This is the anti-spoof core of Rules 6–7.

### The Rule-6 quarantine seam (intra-renderer, Z1)
- `src/renderer/util/ticketsApi.ts` is the **single** place in core renderer logic that names the `zana` module id and calls `getHost('zana').call(...)`. Every Tickets-view consumer imports `ticketsApi.*`, never `window.cc.modules` / `getHost` directly (CLAUDE.md Rule 6; guard test `rule6-zana-literal.guard.test.ts`). It is a **binding seam, not logic**, and explicitly treats `projectPath`/`useGlobal` as **advisory** — main re-resolves via `resolveProjectRoot` (`ticketsApi.ts:19–22`).

---

## 4. Trust-funnel choke points (where untrusted input becomes authorized)

These are the places a renderer/agent-supplied **path / projectId / cwd / ticketId** is converted into a trusted, confined value. All share the same realpath-both-sides discipline.

| Choke point | File:line | Guards | Used by |
|---|---|---|---|
| `trustedProjectRoot(root)` | `index.ts:1505–1532` | realpath(root) must `===` a registered project realpath, OR share a git common-dir with one (worktree extension) | fs **mutations** create/dir/rename/delete (`:1537–1568`) |
| `confine(root, target)` | `fs.ts:149–182` | resolves nearest existing ancestor's realpath, re-appends tail, asserts `startsWith(realRoot+sep)`; rejects `..`/symlink escape (TOCTOU acknowledged @ `:145`) | the fs CRUD ops, after `trustedProjectRoot` |
| `createTerminalConfined()` | `index.ts:773–850` | realpath(cwd) must be `isWithin` realpath(project.path); falls back to project root; `sanitizeExtraArgs()` strips denied launch flags | `terminals.create` IPC (`:1388`) **and** CLI control-plane (`:3212`) |
| `resolveProjectRoot(opts, deps)` | `resolve-project-root.ts:47–85` | realpath candidate + each registered root, `isWithin`; **throws** on no-match (never silent fallback to global anchor) | built-in module ctx (A3), the `zana` data path; the executable form of Rules 1–2 |
| `assertSafeTicketId(id)` | `resolve-project-root.ts:93–106` | rejects `/`, `\`, `..`, absolute; requires bare v4 UUID | ticket-id → `<root>/.zana/.../<id>.json` paths |
| `PermissionBroker.decide()` | `permission-broker.ts:151–188` | deny-by-default; built-ins bypass; disk-ext scoped checks (exec basename allowlist, fs lexical+realpath, sensitive-root write block, net per-host) | every Z4 disk-ext capability |
| `remoteFor(projectId)` | `index.ts:1583+` | renderer passes **only** projectId; host/path come from the store; confined inside `remote-fs.ts` | all `IPC.fs.*Remote` handlers (`:1601–1715`) |

**Observation:** the funnel is **strong and consistent for fs *mutations*, terminals, remote fs, MCP identity, and the extension broker**. It is **bypassed** for fs *reads* and git (§6) — the single biggest internal inconsistency in the boundary design.

---

## 5. Structured module graph (edges)

```
Z1 renderer
  ├─(window.cc.*)──────────────▶ Z2 preload ──(ipcRenderer.invoke)──▶ Z3 main [SEAM B]
  └─(getHost('zana').call)──via ticketsApi.ts [Rule-6 seam]──▶ Z2 ──(IPC.modules.call)──▶ Z3 moduleRouter
Z3 main
  ├─ fs IPC ─────────▶ fs.ts            (mutations gated by trustedProjectRoot+confine; reads UNGATED ⚠)
  ├─ git IPC ────────▶ git.ts           (UNGATED ⚠)
  ├─ terminals IPC ──▶ pty.ts           (gated by createTerminalConfined)
  ├─ remote fs IPC ──▶ remote-fs.ts     (gated: projectId→store→confine)
  ├─ store IPC ──────▶ store.ts + *-store.ts (Z6; atomic-write discipline = Rule 4, data-integrity worker)
  ├─ moduleRouter ───┬─ builtin (in-proc) ─▶ modules/registry.ts ─▶ MAIN_MODULES [zana, slack]
  │                  └─ diskExt (oop) ─────▶ process-host.ts ═(MessageChannelMain)═▶ Z4 host-child.ts [SEAM D]
  └─ control-plane ──▶ control-plane.ts (CLI twin of terminals; shares createTerminalConfined)
Z4 ext host
  └─ broker requests ─▶ PermissionBroker.assert(authModuleId,…) ─▶ broker-caps {exec,fs,fetch}
Z5 mcp-server (agents, 127.0.0.1)
  └─ POST /mcp/:projectId[/:sessionId] ─▶ tool (zod) ─▶ injected main callbacks (registerProject, inboxStore.append, libraryAgentApi, launchTeam, …) ─▶ Z3/Z6
```

**Sibling/twin pairs worth noting** (for parity review by other dims):
- `fs.ts` (local) ↔ `remote-fs.ts` (SSH) — remote is *more* confined than local reads.
- `terminals.create` IPC ↔ CLI control-plane — share `createTerminalConfined` (good reuse).
- built-in `ctx.exec`/`ctx.fetch` (`registry.ts:65–152`, ungated) ↔ disk-ext `broker-caps` exec/fetch (gated) — Rule-7 promotion pair.
- `resolveProjectRoot` (MCP/module path auth) ↔ `trustedProjectRoot` (IPC fs-mutation auth) — two implementations of the same realpath-confine idea living in different files.

---

## 6. Preliminary RISK-RANKING FRAME (boundary annotation)

Ranked by **untrusted surface × absence of a gate**. These seed the §9 risk table; severity is for the security/API workers to finalize.

### 🔴 Highest-risk boundaries (ungated untrusted input → sink) — `⚠ FLAG → security`
1. **`IPC.fs.listDir / readFile / writeFile / walkFiles / searchFiles` take a RAW renderer path** — `index.ts:1489–1495, 1569–1574` pass `p` straight to `fs.ts` with **no `trustedProjectRoot`/`confine`**. Confirmed by read. `fs.ts:writeFile` only checks "is an existing regular file" (`fs.ts:108–127`) — **no project confinement**. A compromised/buggy renderer can read (and overwrite existing) files anywhere the app can. *Reachability: untrusted renderer (Rule 1). Trace input→sink for §1.3.* The correct twin to mirror is the **mutation** path's `trustedProjectRoot` gate two screens up in the same file.
2. **`IPC.git.status / showHead / discard / listWorktrees` take a RAW path** — `index.ts:1721–1724` → `git.ts` with no confine. `git.discard` is **destructive** (`git checkout/clean`). *Reachability: untrusted renderer. → §1.3.*
3. **MCP `register_project` trusts an agent-supplied absolute path** — `register-project-mcp-tool.ts:~79–123` resolves an absolute `path` directly; confinement depends entirely on the injected `registerProject()` callback. *Reachability: any local agent on the MCP port. → §1.3/§1.5 — confirm the main-side callback confines.*
4. **MCP `inbox_push` docs paths not confined at the tool boundary** — `inbox-mcp-tool.ts:~101–156` forwards agent `docs[].path` to `inboxStore.append()`; confinement is implicit in the store, not enforced at the seam. *→ §1.3/§1.6 — verify `inbox-store.ts` confines relPath.*

### 🟠 Elevated surface, gated but worth tracing
5. **MCP server has no auth, only localhost bind** — `mcp-server.ts:~540`. Identity-by-URL is unforgeable *by the agent*, but any local process can hit `127.0.0.1:<port>`. Acceptable for a local single-user app; note for threat-model completeness. *→ §1.5.*
6. **`IPC.modules.call` dispatches unvalidated `args`** — `index.ts:2458–2467` → `moduleRouter.dispatch`; rejects unknown moduleId/capability but does **no arg-schema validation** (per-capability only). *→ §1.5 API-contract.*
7. **`process.dlopen` not blocked in the host-child denylist** — `host-child-guard.ts` blocks `require`/import of node builtins but native-addon load is a JS-level-only guard (documented residual). Disk-ext sandbox is **not** an OS sandbox. *→ §1.7 isolation.*

### 🟢 Reviewed-clean attestations (boundary held under trace)
- **fs *mutations* (create/dir/rename/delete):** gated by `trustedProjectRoot` + `confine` (realpath both sides). 4 entry points traced, all gated.
- **Terminal spawn (IPC + CLI):** gated by `createTerminalConfined`; extraArgs sanitized. 2 entry points, both gated.
- **Remote fs (9 handlers):** renderer supplies only `projectId`; host/path from store; confined in `remote-fs.ts`. Gated.
- **Extension capability broker:** deny-by-default; effective grant = `declared ∩ consented`; symlink double-check; sensitive-root write block; per-hop SSRF re-check; authenticated moduleId. The strongest boundary in the system.
- **MCP identity binding:** `projectId/sessionId` from URL closure, never payload. Gated.
- **Rule-6 renderer seam:** `ticketsApi.ts` is the sole zana-id site; advisory paths re-resolved in main.

---

## 7. Handoff notes
- **Security worker (§1.3):** start from §6 items 1–4 — trace each from the IPC/MCP entry to the fs/git sink and assign severity by reachability × impact. The "correct twin" for fs reads is the mutation path's `trustedProjectRoot`.
- **API-contract worker (§1.5):** §6 items 5–6 — MCP auth model, and `IPC.modules.call` arg-validation gap; also assess error-shape uniformity of `safeHandle` fallbacks.
- **Data-integrity worker (§1.6):** Z6 stores — verify `inbox-store.ts` path confinement (item 4) and atomic-write discipline across the `*-store.ts` twins.
- **Isolation worker (§1.7):** §6 item 7 (`dlopen`) and the built-in vs disk-ext exec/fetch Rule-7 promotion pair.
