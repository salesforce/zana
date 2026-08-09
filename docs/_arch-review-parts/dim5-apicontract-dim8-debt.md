# Dimensions 5 & 8 — IPC/MCP API-Contract + Technical-Debt Register

**Scope:** §1.5 (IPC / MCP API-contract, api-designer lens — `API-` prefix) and §1.8 (Technical-debt register — `DEBT-` prefix) of the Architecture Review Output Spec (`.zcc/library/decisions/arch-review-output-spec.md`).
**Method:** filesystem-grounded; every entry cites `file:line` read directly. Pure path-confinement bugs are deferred to the security worker (§1.3); this dimension owns **contract shape** — where a missing/loose schema, a non-uniform error envelope, or an unbound identity is the root cause. Built on the seam inventory in `dim2-architecture-map.md` (SEAM B = renderer↔main IPC, SEAM C = agent↔main MCP).

---

# §5 — IPC / MCP API-Contract

## 5.1 Entry-point → contract-property table

Two contracts: **(B) renderer↔main IPC** (`ipcMain.handle` via `safeHandle`, `index.ts`), **(C) agent↔main MCP** (`*-mcp-tool*.ts`, dispatched from `mcp-server.ts`).

| Entry point | Contract | Validates input? | Identity bound server-side? | Uniform error shape? |
|---|---|---|---|---|
| `IPC.fs.listDir/readFile/walkFiles/searchFiles` | B | NO — raw path, no schema | n/a (no identity) | NO — each `onError` differs (`[]` vs `{ok:false,message}` vs `{hits:[],…}`) |
| `IPC.fs.writeFile` | B | NO — raw path | n/a | NO — `{ok:false,message}` (no `code`) |
| `IPC.fs.createFile/createDir/rename/delete` | B | YES — `trustedProjectRoot` gate | n/a | PARTIAL — `{ok:false,message}` (no `code`, unlike `Result`) |
| `IPC.projects.add/addRemote/clone` | B | partial (store-side) | n/a | YES — `Result<T>` `{ok,code,message}` |
| `IPC.modules.call` | B | NO — `args: unknown[]` passed through unvalidated | NO — `moduleId` is a renderer-supplied arg | NO — **re-throws** (rejects the invoke), opposite of siblings |
| `IPC.modules.storageGet/Set` | B | NO | NO — `moduleId` from renderer | NO — returns `undefined` on error |
| `IPC.modules.pushInbox` | B | YES — broker `assert` + projectId existence | PARTIAL — `moduleId` is renderer-claimed (P3-B residual) | NO — re-throws |
| MCP `inbox_push` | C | PARTIAL — shape ok, `docs[].path` is free string | YES — projectId/sessionId from **URL closure** | YES — `{isError, content:[{type:'text',text}]}` |
| MCP `register_project` | C | YES — zod `path.min(1)` | NO — **by design** accepts any absolute path | YES — `{isError, content}` |
| MCP `list_personas/list_teams/list_projects` | C | YES — empty schema (no args) | n/a (read-only) | YES — `{isError, content}` |
| MCP `schedule_report/agent_send/close_session/launch_team/library_*` | C | YES — zod per-tool | YES — sessionId/projectId from URL closure | YES — `{isError, content}` |

**Headline:** the **MCP (C) contract is strong and uniform** — identity is host-stamped from the URL closure (`mcp-server.ts:700,714–736`, agents cannot supply identity in any tool schema), every tool returns the same `{isError, content:[…]}` envelope, and inputs are zod-validated per tool. The **IPC (B) contract is the weak side** — `safeHandle` is an error *trap*, not a *normalizer*, so each handler invents its own success/error shape, and the `modules.*` family takes unvalidated, unbound input.

---

## 5.2 Findings

### API-001 — `safeHandle` does not normalize the error envelope; IPC handlers return three incompatible shapes
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/main/index.ts:751–764` (`safeHandle`), divergent callers `:1489–1495` (`[]` / `{ok:false,message}`), `:1533–1568` (`{ok:false,message}` no `code`), `:1220` / `:1237` (`Result {ok,code,message}`), `:2462–2466` (re-throw)
- **severity:** medium
- **evidence:** `safeHandle` only traps: `catch (err) { logMainError(...); return onError(err, ...args); }` — the *shape* of `onError` is each caller's choice. Compare `safeHandle(IPC.fs.listDir, …, () => [])` (bare array), `IPC.fs.readFile, …, () => ({ ok: false, message: 'Read failed' })` (no `code`), `IPC.projects.add … return { ok: false, code: 'ADD_FAILED', message }` (full `Result`), and `IPC.modules.call … (err) => { throw … }` (rejects). Four sibling handlers, four error contracts.
- **reachability:** untrusted renderer — every IPC consumer must special-case per channel; a generic renderer error handler cannot exist.
- **impact:** renderer code cannot rely on a discriminated `Result`; a handler that "succeeds" with `[]` is indistinguishable from an empty real result, so failures are silently swallowed (e.g. `fs.listDir` failure looks like an empty dir). Back-compat hazard: changing an `onError` shape silently breaks every caller with no type error.
- **remediation:** make `safeHandle` (or a `safeResultHandle` twin) wrap the return in the canonical `Result<T>` envelope used by `IPC.projects.*` (`{ok,code,message}` from `src/shared/types.ts`), so the error shape is structural not per-handler. Mirror the `projects.add` handler as the correct twin. Keep the re-throw variant only for `modules.call` and document it as the single deliberate exception.
- **effort:** M
- **confidence:** confirmed

### API-002 — `IPC.modules.call` dispatches unvalidated `args` with a renderer-supplied `moduleId`
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/main/index.ts:2458–2467`; `src/main/extensions/module-router.ts:40–45`
- **severity:** medium
- **evidence:** `(moduleId, capability, args: unknown[]) => moduleRouter.dispatch(moduleId, capability, Array.isArray(args) ? args : [])`. The only validation is the `Array.isArray` coercion; `dispatch` then routes by `moduleId` and forwards `args` verbatim. `module-router.ts:40–45` checks only *existence* (`diskExts.has(moduleId)` else the in-proc host "rejects an unknown id") — there is **no per-capability argument schema** at the seam. The `moduleId` is a plain renderer arg (the `pushInbox` comment at `:2482` concedes "a panel today could claim another id" — P3-B/P3-C residual).
- **reachability:** untrusted renderer (SEAM B). Any renderer code can call any capability of any live module with any args, attributing itself as any `moduleId`.
- **impact:** the contract for module capabilities is "trust the renderer blob." Malformed args reach in-process built-ins (`zana`, `slack`) and disk-ext children unchecked; identity attribution for capability gating is forgeable from the renderer side. The downstream broker (`PermissionBroker.assert`) re-checks the *disk-ext* leg with an authenticated child id, but the **renderer→router moduleId is unauthenticated**.
- **remediation:** introduce a capability descriptor (per-module `{capability → zodSchema}`) validated in `module-router.dispatch` before forwarding, mirroring the MCP tools' per-tool zod discipline (`registerInboxPushTool` etc.). For identity, complete the P3-C "authenticated panel origin" work so the router stamps the moduleId from the panel's host binding rather than the arg.
- **effort:** M
- **confidence:** confirmed

### API-003 — `register_project` MCP tool diverges from its `inbox_push` sibling: it accepts an unbound absolute path
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/main/register-project-mcp-tool.ts:42–49, 79–100`; contrast `src/main/inbox-mcp-tool.ts:43–70` (identity from closure)
- **severity:** medium
- **evidence:** the tool's own header (`register-project-mcp-tool.ts:9–17`) states the divergence: *"unlike registerInboxPushTool, where the closed-over projectId is a security boundary the agent cannot forge — `projectRoot` here is only a convenience… The agent may pass any absolute path and register a directory outside the originating project."* Schema: `path: z.string().min(1)`; handler: `if (isAbsolute(path)) absPath = resolve(path)`. No confinement to the URL-bound `projectRoot`.
- **reachability:** any local agent on the MCP port (SEAM C). The identity-binding guarantee that holds for every other session-scoped tool is intentionally dropped here.
- **impact:** two sibling tools on the same contract teach opposite invariants — one binds identity, one accepts arbitrary paths. The actual *confinement* of the registered path is the security worker's call (the injected `registerProject` callback is the real gate); the **contract-shape** problem is that the schema advertises an unconstrained `path` with no server-bound anchor, so the tool's safety depends entirely on an out-of-band callback rather than the schema. (Cross-ref dim2 §6 item 3 → §1.3.)
- **remediation:** if arbitrary registration is truly intended, document the asymmetry as a first-class contract note and have the injected `registerProject()` confine to `cloneRoot`/HOME bases (Rule 2). Otherwise constrain the schema to a relative path resolved against the URL-bound `projectRoot`, matching the `inbox_push` identity model.
- **effort:** S
- **confidence:** confirmed

### API-004 — `inbox_push` `docs[].path` schema is an unconstrained string; confinement is implicit in the store
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/main/inbox-mcp-tool.ts:48–63, 125–133`
- **severity:** medium
- **evidence:** `docs: z.array(z.object({ path: z.string().min(1) … }))` — any string passes the schema; the handler forwards `docs` straight to `inboxStore.append({ … docs … })` with no boundary check. The description *says* "Relative path to a file inside this project" but the schema does not enforce relativeness (no `.refine(p => !isAbsolute(p) && !p.includes('..'))`).
- **reachability:** any local agent (SEAM C). Identity (projectId) is correctly bound from the URL, but the *path* within that project is unvalidated at the seam.
- **impact:** the seam advertises a constraint it does not enforce; confinement is delegated to `inbox-store.ts` (verify in §1.6). If that store ever loosens, the contract gives no second line of defense. From the API lens this is a **loose-schema root cause**: the schema should encode the documented invariant.
- **remediation:** add a `.refine` to reject absolute paths and `..` segments at the schema, mirroring `assertSafeTicketId` (`resolve-project-root.ts:93–106`) which encodes its path invariant in code rather than prose. Defer the actual store-confinement verification to §1.6.
- **effort:** S
- **confidence:** likely

### API-005 — MCP tool surface has no version/capability negotiation; tool set varies silently by feature flag
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/main/mcp-server.ts:259` (`new McpServer({ name: 'zcc-inbox', version: '0.1.0' })`), `:266–384` (every `registerXTool` gated on an injected dep being present)
- **severity:** low
- **evidence:** the server version is a hardcoded `'0.1.0'` string, never bumped or negotiated. Which tools exist depends on runtime wiring/flags: `if (opts.sessionId && opts.closeSession)`, `if (opts.launchTeam)`, `if (opts.sessionId && opts.libraryAgentApi)`, etc. — so two app builds (or the same build with different config flags) expose **different tool sets under the same version string**.
- **reachability:** any agent; affects back-compat reasoning for scheduled/external agents that hardcode tool names.
- **impact:** an agent cannot detect, from the advertised version, whether `launch_team`/`library_*`/`close_session` exist; a removed or flag-disabled tool is indistinguishable from a never-present one. No deprecation path.
- **remediation:** bump `version` on tool-surface changes and treat it as a contract version; optionally advertise the active tool set in a discovery response. Low priority for a single-user local app, but it is the only versioning lever the MCP surface has.
- **effort:** S
- **confidence:** likely

### API-006 — Preload `contextBridge` surface exposes no API/contract version, only the build version
- **dimension:** §1.5 IPC/MCP API-contract
- **location:** `src/preload/index.ts:404` (`version: () => ipcRenderer.invoke(IPC.app.version)` — app build version, not a contract version); contract coupling lives only in `src/shared/ipc.ts`
- **severity:** low
- **evidence:** the single `version` on the bridge resolves `IPC.app.version` (the app's build/release version). There is no surface-contract version; renderer↔main agreement is enforced only by the shared `IPC.*` channel constants at build time. For a bundled Electron app renderer and main are always the same build, so drift is impossible in practice.
- **reachability:** n/a (same-build coupling). Defense-in-depth / future-proofing only.
- **impact:** if the preload surface were ever served to a mismatched renderer (hot-reload, partial update), there is no handshake to detect it. Bounded, low.
- **remediation:** none required for the current single-bundle model; note for completeness. If a split-update path is ever introduced, add a contract-version handshake on the bridge.
- **effort:** S
- **confidence:** likely

### Reviewed-clean attestations (contract held under trace)
- **MCP identity binding (SEAM C):** traced all session/project-scoped tools — `projectId`/`sessionId` come from `matchMcpRoute` URL parse (`mcp-server.ts:392–408`) and are closed over in `buildProjectMcpServer`; **no tool schema accepts an identity field**. Stateless transport (`sessionIdGenerator: undefined`, `:710–712`) prevents identity pinning across requests. Unforgeable by the agent.
- **MCP error envelope:** every tool returns `{isError?, content:[{type:'text',text}]}` uniformly (`inbox-mcp-tool.ts:142–153`, `register-project-mcp-tool.ts:110–121`, `register-teams-mcp-tool.ts:50–55`, `register-personas-mcp-tool.ts:62–69`).
- **Hook routes:** strict regex match, method-gated (`firstprompt` 405s non-POST `:632`), body-capped (64 KiB `:642`) + slow-loris timeout (`:646`). Fire-and-forget contract is consistent across all five hook routes.

---

# §8 — Technical-Debt Register

Durable debt below the §9 risk-table bar. Each cites `file:line` and a one-line "why it will bite."

### DEBT-001 — Shared `gus-*` CSS classes couple the live `gus` extension panel to core's per-project Tickets UI
- **location:** `src/renderer/styles/global.css` (33 `gus-*` definitions) ↔ `src/renderer/components/ProjectTickets/*` (66 `gus-*` usages across 6 files; `TicketDetailModal.tsx` alone has 54)
- **verified:** confirmed — CLAUDE.md's coupling note is accurate. The Tickets-only overrides do live under `zana-*` modifier classes (`zana-modal`, `zana-blocker-chip`, `zana-ver-*`) but the **base** `gus-*` classes are genuinely shared.
- **why it will bite:** a future restyle of `gus-*` (intended for the disk-extension panel) will silently re-skin core's Tickets kanban/modal/chatter with no compile-time signal — a CSS edit in one feature visually breaks an unrelated one. Split the shared base out before any `gus-*` restyle.

### DEBT-002 — Two implementations of the realpath-confine idea (`trustedProjectRoot` vs `resolveProjectRoot`)
- **location:** `src/main/index.ts:1505–1532` (`trustedProjectRoot`, IPC fs-mutation auth) ↔ `src/main/resolve-project-root.ts:47–85` (`resolveProjectRoot`, MCP/module path auth)
- **why it will bite:** the same security-critical invariant ("a caller path is trusted only after realpath-matching a registered project") lives in two files with two code paths. A hardening fix (e.g. a new worktree case, a symlink edge) applied to one twin and not the other creates a confinement asymmetry — exactly the kind of drift that produces a silent bypass. Consolidate onto one helper (dim2 §5 flags this twin pair).

### DEBT-003 — Ungated fs *reads* vs gated fs *mutations* — deviating twins in the same handler block
- **location:** `src/main/index.ts:1489–1495, 1569–1574` (reads, raw path) vs `:1537–1568` (mutations, `trustedProjectRoot`-gated)
- **why it will bite:** reads (`listDir/readFile/walkFiles/searchFiles`) and `writeFile` take a raw renderer path two screens above the mutation handlers that confine theirs — a maintainer reading the gated block reasonably assumes the whole `fs.*` family is gated. The asymmetry is the root of dim2 §6 item 1 (→ §1.3 security). As *debt*: the inconsistency invites a future handler to be copy-pasted from the wrong (ungated) twin.

### DEBT-004 — `PersonaTeamRegistry` shares the `sanitizePersona`/`sanitizeTeam` gate with the file-backed stores
- **location:** `src/main/extensions/persona-team-registry.ts:26–27, 88, 110` (imports + calls `sanitizePersona`/`sanitizeTeam` from `persona-store.ts`/`team-store.ts`)
- **why it will bite:** the sanitize functions now have two callers with different trust models — trusted user/project files **and** untrusted extension-contributed input. A change to `sanitizePersona` for a file-store need (e.g. relaxing a field) silently widens what an extension can inject; a tightening for extension safety could reject a previously-valid user persona. The `PersonaSource` narrowing (`source: { extensionId }`, `:90,112`) and the renderer source badge (`'extensionId' in source`) are coupled to this same gate (CLAUDE.md coupling note). Any edit must be evaluated against both callers.

### DEBT-005 — IPC error-envelope divergence is untested as a contract (cross-ref API-001)
- **location:** `src/main/index.ts:751–764` + the per-handler `onError` thunks throughout `registerIpc()`
- **why it will bite:** there is no canonical-shape test for `safeHandle` error returns (unlike the Rule-6 source-text guard that locks `ticketsApi`). A handler added with yet another error shape will pass review and CI; renderer callers that assumed `Result` will mis-handle it at runtime only. A guard test asserting "every fs/`Result` handler's error path is `{ok:false,code,message}`" would lock the contract.

### DEBT-006 — `ticketsApi` retains two dead marshallers (`listSources`, `probeProjects`) with no live core caller
- **location:** `src/renderer/util/ticketsApi.ts:33–42` (documented "Retained-but-unconsumed")
- **why it will bite:** the file itself flags these as having no live caller post zana→core merge, kept only because B2's canonical test contract-locks them. They are harmless stateless marshallers today, but they enlarge the quarantined Rule-6 seam's surface and the next reader must re-derive that they're dead. Either confirm-and-delete (with the two B2 tests) or annotate with a tracking ticket so the "kept on purpose" decision doesn't decay into "nobody knows."

### DEBT-007 — `register_project` is a permanently weaker sibling on the MCP contract (cross-ref API-003)
- **location:** `src/main/register-project-mcp-tool.ts:9–17`
- **why it will bite:** the tool documents its own divergence from the identity-bound `inbox_push` model. Until the schema or callback encodes the confinement, every new MCP tool author has a precedent for "accept an arbitrary path, it's fine" — the divergence normalizes contract weakening. Pin the rationale to a decision record so the exception stays an exception.
