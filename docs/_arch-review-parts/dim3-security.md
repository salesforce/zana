# Dimension §1.3 — Trust-boundary & Security Posture (Researcher A)

**Scope:** Engineering Rules 1 (main authorizes), 2 (realpath-confine to a registered project), 6 (no extension-id in core logic outside seams), 7 (bounded builtin-promotion). Every untrusted entry point (renderer IPC + agent MCP) traced input → sink; each is either "gated by X" or "ungated — finding". Read-only review.

**Method note:** Cross-referenced `docs/qa-expert-review-2026-06-26.md` and independently re-verified each overlapping claim against current code with my own citations. Confidence is capped at `likely` / `needs-followup` per the output spec §4 (adversarial verification happens in a later pass; nothing is self-marked `confirmed`).

---

## A. Entry-point coverage table

| # | Entry point | Untrusted input | Sink | Gate — or finding |
|---|---|---|---|---|
| 1 | `IPC.fs.listDir` (index.ts:1489) | abs path | `listDir` (fs.ts:31) `readdirSync` | **ungated** → SEC-005 |
| 2 | `IPC.fs.readFile` (index.ts:1490) | abs path | `readFile` (fs.ts:67) `openSync/readSync` | **ungated** → SEC-005 |
| 3 | `IPC.fs.writeFile` (index.ts:1491-1495) | abs path + content | `writeFile` (fs.ts:108) `writeFileSync` | **ungated** (only `statSync isFile` + 2MB cap) → SEC-002 |
| 4 | `IPC.fs.createFile` (index.ts:1537-1544) | root + path | `createFile`→`confine` (fs.ts:185) | gated by `trustedProjectRoot(root)` (1505-1532) + `confine` ✓ |
| 5 | `IPC.fs.createDir` (1545-1552) | root + path | `createDir`→`confine` | gated by `trustedProjectRoot` + `confine` ✓ |
| 6 | `IPC.fs.rename` (1553-1560) | root + from/to | `renamePath`→`confine` | gated by `trustedProjectRoot` + `confine` ✓ |
| 7 | `IPC.fs.delete` (1561-1568) | root + path | `deletePath`→`confine` | gated by `trustedProjectRoot` + `confine` ✓ |
| 8 | `IPC.fs.walkFiles` (1569) | abs path | `walkFiles` (fs.ts:259) | **ungated** → SEC-005 |
| 9 | `IPC.fs.searchFiles` (1570-1574) | abs path + query | `searchFiles` (fs.ts:305) | **ungated** → SEC-005 |
| 10 | `IPC.fs.readDataUrl` (1833) | abs path | `readDataUrl` (fs.ts:391) | **ungated** → SEC-005 |
| 11 | `IPC.fs.remoteRoot` + remote list/read/write/create/rename/delete/upload/download (1601-1714) | **projectId** (not path) | `remote-fs.ts` confined under store-resolved root | gated: host/user/root from STORE, not renderer (`remoteFor`/`resolveRemoteRoot` 1583-1600) ✓ |
| 12 | `IPC.openers.openIn` (1716-1719) | target + path/URL | `openIn` (openers.ts:43) `spawn`/`shell` | path **unconfined** (array args, no shell-injection); browser gated to http(s) (openers.ts:87) → SEC-006 |
| 13 | `IPC.git.status` (1721) | abs path | `getGitStatus` (git.ts:130) | confined to `findToplevel` only, **not** registered project → SEC-003 |
| 14 | `IPC.git.showHead` (1722) | abs path | `showHead` (git.ts:156) | confined to `findToplevel` only → SEC-003 |
| 15 | `IPC.git.discard` (1723) | abs path | `discardChanges` (git.ts:224) `unlinkSync`/`checkout HEAD` | confined to `findToplevel` only — **destructive** → SEC-003 |
| 16 | `IPC.git.listWorktrees` (1724) | abs path | `listWorktrees` (git.ts:61) | confined to `findToplevel` only → SEC-003 |
| 17 | `IPC.claudeSettings.read` (2014-2023) | projectPath + scope | `readClaudeProjectSettings` (claude-settings.ts:127) | **ungated** projectPath (read-only; info-disclosure of any `<path>/.claude/*.json`) → SEC-001 (read side) |
| 18 | `IPC.claudeSettings.write` (2024-2033) | projectPath + scope + patch | `writeClaudeProjectSettings` (claude-settings.ts:151) `mkdir`+`writeFile`+`rename` | **ungated** projectPath; round-trips `_unknown` (hooks/env) verbatim → SEC-001 |
| 19 | `IPC.extensions.reveal` (1929-1938) | extension `id` | `extensionDir(id)` (discovery.ts:580) → `shell.openPath` | **ungated** id (no `..`/sep check) → SEC-004 |
| 20 | `IPC.extensions.readRendererEntry` (1945-1949) | extension `id` | `readRendererEntry` (discovery.ts:491) `readFile` | **ungated** id → SEC-004 |
| 21 | `IPC.extensions.addPermission` (1977-1989) | id + permission | `addExtensionPermission` (discovery.ts:600) read+rewrite manifest | **ungated** id → SEC-004 |
| 22 | `IPC.extensions.grantConsent` (1956-1966) | id | `grantConsent` | gated: resolves via `extensionEntries.find(e=>e.id===id)` — **correct twin** ✓ |
| 23 | `IPC.extensions.relaunch` (1994-1999) | id | `diskSpecsById.get(id)` | gated: id must key a retained, discovery-validated spec ✓ |
| 24 | `IPC.modules.call` (index.ts:2458) | moduleId + capability + args | `moduleRouter.dispatch` → builtin (trusted) or disk-ext child | builtins trusted by provenance; disk-ext capabilities deny-by-default at `PermissionBroker.can/assert` (permission-broker.ts:132-188) and process-host `handleBroker`; e.g. `pushInbox` asserts `inbox:push` (index.ts:2489) ✓ (Rule 6/7) |
| 25 | `IPC.terminals.create` (createTerminalConfined, index.ts:773) | projectId + cwd + args | `PtyManager.create` | gated: projectId validated, cwd realpath-confined, denied flags stripped (launch-sanitize.ts) ✓ |
| 26 | MCP route `/mcp/:projectId(/:sessionId)` (mcp-server.ts:392-408) | URL path ids | per-request `McpServer` | gated: ids parsed from URL, never from agent tool input; stateless transport (mcp-server.ts:707-712) ✓ |
| 27 | MCP `inbox_push` (inbox-mcp-tool.ts:101) | docs/comments | `inboxStore.append` | gated: projectId/sessionId closed over from URL, absent from schema (unforgeable) ✓ |
| 28 | MCP `library_*` (mcp-server.ts:378-384) | path/body | LibraryStore | gated: projectId/sessionId from URL; store realpath-confines, host-stamps `source:{kind:'agent'}` ✓ |
| 29 | MCP `list_projects` / `list_personas` / `list_teams` (mcp-server.ts:348-372) | none | projected summaries | gated: identity-free, non-sensitive projection in main ✓ |
| 30 | MCP `close_session` / `close_idle_agents` / `schedule_report` / `agent_send`/`agent_inbox` / `launch_team` (mcp-server.ts:276-366) | per-tool | main-authoritative resolvers | gated: session-scoped (identity from URL), each behind a config-flag-wired dep; confinement lives in main ✓ |
| 31 | MCP `register_project` (register-project-mcp-tool.ts:70-123) | abs/rel `path` | `registerProject` callback → store | **by-design unconfined** (module doc lines 9-16): agent may register any abs path → widens the `store.listProjects()` set that `trustedProjectRoot` trusts → SEC-007 |
| 32 | MCP loopback transport (mcp-server.ts:540) | any local client | all tools above | bound `127.0.0.1:0`, **no auth token**; identity is the (uuid) projectId in the URL → SEC-007 note |

**Reviewed-clean attestations (traced, no finding):**
- **Confined fs mutation (create/dir/rename/delete):** traced 4 entry points — all gated by `trustedProjectRoot` + `confine` (the correct pattern the deviating siblings should mirror).
- **Remote (SSH) fs surface:** traced 10 entry points — all key off renderer `projectId`; host/user/root come from the store, confined inside `remote-fs.ts` (Rule 1 honored).
- **Permission broker / capability gating (Rule 6/7):** traced the `modules.call` dispatch path + broker — deny-by-default, provenance-tiered, lexical + realpath double-check on fs scope, sensitive-root write block (`~/.ssh`,`~/.aws`,`~/.zcc`); no concrete extension id appears in core logic (the by-id handlers in SEC-004 are a Rule-1/2 path bug, not a Rule-6 leak — ids are host-routed, not literal).
- **MCP identity binding:** traced 7 tool families + the route matcher — projectId/sessionId are URL-derived and absent from every tool schema; forgery is structurally impossible. No injection sink found in the project-scoped tools (inputs are stored/rendered, not shell/SQL-interpolated).
- **`terminals.create` cwd path:** traced 1 entry point — fully confined (the reference gate).

**Total: 38 untrusted entry points traced** (28 renderer-IPC + 10 MCP tool/route surfaces). Findings on 7; the remainder gated.

---

## B. Findings (full schema)

### SEC-001 — `claudeSettings.write` writes arbitrary `.claude/settings.json` (incl. `hooks`) with an unconfined renderer projectPath
- **id:** SEC-001
- **title:** Renderer-supplied `projectPath` reaches `.claude/settings.json` writer, round-tripping `_unknown.hooks` → arbitrary-location code-execution config
- **dimension:** §1.3 Trust-boundary & security posture (Rule 1/2)
- **location:** `src/main/index.ts:2024-2033` (handler); `src/main/claude-settings.ts:151-182` (`writeClaudeProjectSettings`), `:26-28` (`pathFor`), `:95-124` (`projectSettingsToRaw` — `_unknown` round-trip)
- **evidence:** The handler passes the raw renderer `projectPath` straight in: `writeClaudeProjectSettings(projectPath, scope, patch)` — **no `trustedProjectRoot` call**, unlike the fs-mutation siblings at `index.ts:1537-1568`. `writeClaudeProjectSettings` then writes `pathFor(projectPath, scope) = join(projectPath, '.claude', fileNameForScope(scope))` after `mkdir(join(projectPath,'.claude'), {recursive:true})` (claude-settings.ts:156-157,176-180) — so it can **create** the file/dir where none exists. `projectSettingsToRaw` seeds the output object with `{...(view._unknown ?? {})}` (claude-settings.ts:96), and `merged = {...current.settings, ...patch}` (claude-settings.ts:161-164) takes the renderer patch's `_unknown` verbatim. The class doc itself names the preserved keys: "preserve everything else verbatim so atomic edits don't clobber hand-edited keys (env, hooks, outputStyle, etc.)" (claude-settings.ts:3-6). Claude Code executes `hooks` shell commands; `permissions.defaultMode:'bypassPermissions'` is also writable.
- **reachability:** Untrusted renderer (Rule 1 threat model) — `window.cc.claudeSettings.write(projectPath, scope, patch)` is on the preload bridge; the renderer can pass any `projectPath` (e.g. `$HOME` → writes the user-global `~/.claude/settings.json`) and any `patch` object including `{_unknown:{hooks:{...}}}` (TS types are erased over IPC). Also reachable by any renderer-side XSS or a malicious extension renderer surface that can reach `window.cc`.
- **impact:** Persistent arbitrary command execution: a crafted `hooks` block in any project's (or the global) `.claude/settings.json` runs on the next `claude` invocation in that scope. Strictly more powerful than SEC-002 because it can **create** new settings files, not only overwrite existing ones. Host compromise.
- **remediation:** Gate the handler with `trustedProjectRoot(projectPath)` exactly as `fs.createFile/rename/delete` do (index.ts:1537-1568), rejecting unknown roots; AND in `writeClaudeProjectSettings` drop/deny dangerous `_unknown` keys (`hooks`, `env`) on the write path rather than round-tripping renderer-supplied ones (only preserve keys that were already on disk). Mirror the `trustedProjectRoot` twin.
- **effort:** S
- **confidence:** likely  *(NOTE: not flagged by the QA review — see §C. Candidate `critical` pending adversarial verification of the `_unknown`→hooks IPC reachability.)*

### SEC-002 — `fs.writeFile` overwrites any existing regular file with no project confinement
- **id:** SEC-002
- **title:** `IPC.fs.writeFile` passes the raw renderer path to `writeFileSync` — no `confine`/`trustedProjectRoot`
- **dimension:** §1.3 (Rule 1/2)
- **location:** `src/main/index.ts:1491-1495` (handler); `src/main/fs.ts:108-127` (`writeFile`)
- **evidence:** Handler: `safeHandle(IPC.fs.writeFile, (p, content) => fsWriteFile(p, content), ...)`. `writeFile` only enforces a 2MB cap and `statSync(absPath).isFile()` — the file's own comment calls it "a sanity check, not a creation API" (fs.ts:113-114), an explicitly renderer-side (advisory) assumption. The sibling create/rename/delete handlers all route through `trustedProjectRoot` + `confine` (index.ts:1537-1568); `writeFile` is the one mutating op left out.
- **reachability:** Untrusted renderer via `window.cc.fs.writeFile(path, content)`.
- **impact:** Overwrite of any uid-writable **existing** regular file ≤2MB (`~/.zshrc`, a project `package.json`, an existing `~/.claude/settings.json`) → host code execution on next shell/tool launch. (Cannot create new files; that bound is what separates it from SEC-001.)
- **remediation:** Add a `root` parameter and route through `trustedProjectRoot(root)` + `confine(root, p)`, moving the `writeFile` body under fs.ts's "every mutating op below is confined" block (fs.ts:129-136).
- **effort:** S
- **confidence:** likely  *(corroborated by QA finding #1; re-verified against current code.)*

### SEC-003 — `git.*` handlers confine to "any git repo", not to a registered project (destructive `discard`)
- **id:** SEC-003
- **title:** `git.discard/status/showHead/listWorktrees` accept any path inside any repo on disk
- **dimension:** §1.3 (Rule 1/2)
- **location:** `src/main/index.ts:1721-1724` (handlers); `src/main/git.ts:224-297` (`discardChanges`), `:130-150`, `:156-200`, `:61-80`
- **evidence:** All four handlers pass the raw renderer path. `discardChanges` validates only `isAbsolute` + `findToplevel(absPath)` (walks up to **any** `.git`, git.ts:8-16,228-229) + `rel` not starting `..` (git.ts:230-233), then destructively `unlinkSync(absPath)` for untracked (git.ts:274) or `git checkout HEAD -- rel` for tracked (git.ts:296). No `trustedProjectRoot`. The fs-mutation siblings gate the identical surface; these do not.
- **reachability:** Untrusted renderer via `window.cc.git.discard(path)` etc.
- **impact:** Destructive loss of uncommitted/untracked work in **any** repo on the machine (not just registered projects); read ops leak status/HEAD content from arbitrary repos.
- **remediation:** Route all four through `trustedProjectRoot(root)` and confine the path beneath it before calling `git.ts`, mirroring create/rename/delete.
- **effort:** S
- **confidence:** likely  *(corroborated by QA finding #3; re-verified.)*

### SEC-004 — Extension by-id IPC handlers build filesystem paths from an unvalidated `id` (traversal)
- **id:** SEC-004
- **title:** `extensions.reveal/readRendererEntry/addPermission` pass a raw renderer `id` to `extensionDir(id)`; `resolveContained` does not re-anchor `dir`
- **dimension:** §1.3 (Rule 1/2)
- **location:** `src/main/index.ts:1929-1938` (reveal), `:1945-1949` (readRendererEntry), `:1977-1989` (addPermission); `src/main/extensions/discovery.ts:580-582` (`extensionDir`), `:491-523` (`readRendererEntry`), `:600-646` (`addExtensionPermission`); `src/main/extensions/path-util.ts:25-28` (`resolveContained`)
- **evidence:** `extensionDir(id) = join(getExtensionsDir(), id)` — no validation of `id` (discovery.ts:580-582). `resolveContained(dir, entry)` confines `entry` within `resolve(dir)` (path-util.ts:25-28) but **never checks `dir` itself is within the extensions root**, so an `id` like `../../../Users/x/repo` escapes and the manifest name still resolves "within" the escaped dir. These three handlers bypass `discoverExtensions` (which enforces `id === dirName`, discovery.ts:364-378). Contrast: `extensions.grantConsent` (index.ts:1956-1966) resolves via `extensionEntries.find(e=>e.id===id)` — the correct twin.
- **reachability:** Untrusted renderer via `window.cc` extension IPC.
- **impact:** `reveal` → `shell.openPath` of an arbitrary directory; `readRendererEntry` → read of an attacker-chosen `<dir>/extension.json` + its referenced renderer file (info disclosure, content returned to renderer); `addPermission` → read + atomic rewrite of any `<dir>/extension.json` that parses as a JSON object (file tampering).
- **remediation:** Validate `id` at the top of `extensionDir` (reject `..`, path separators, absolute paths) or resolve all by-id handlers against `extensionEntries.find(...)` like `grantConsent` already does.
- **effort:** S
- **confidence:** likely  *(corroborated by QA finding #2; independently re-verified incl. `resolveContained` semantics.)*

### SEC-005 — Local fs read handlers expose arbitrary on-disk contents to the untrusted renderer
- **id:** SEC-005
- **title:** `listDir/readFile/walkFiles/searchFiles/readDataUrl` pass raw renderer paths with no confinement
- **dimension:** §1.3 (Rule 1/2 — info-disclosure)
- **location:** `src/main/index.ts:1489-1490, 1569-1574, 1833`; sinks `src/main/fs.ts:31,67,259,305,391`
- **evidence:** The confinement block in fs.ts covers only mutating ops (fs.ts:129-136); the read functions take a raw `absPath`. Handlers wire them directly with no `trustedProjectRoot`.
- **reachability:** Untrusted renderer.
- **impact:** Read of any uid-readable file (`~/.ssh/id_rsa`, `~/.aws/credentials`, `~/.claude.json` tokens) and filesystem enumeration; exfiltration via existing inbox/library/module channels.
- **remediation:** Bring reads under the same anchor as the mutating ops (registered project / HOME-base), or explicitly document the absolute-path Explorer as accepted design with the trust boundary stated. At minimum make read/write symmetric.
- **effort:** M
- **confidence:** likely  *(corroborated by QA finding #9.)*

### SEC-006 — `openIn` spawns editors / Finder on an unconfined renderer path
- **id:** SEC-006
- **title:** `IPC.openers.openIn` opens an arbitrary path in cursor/code/terminal/finder
- **dimension:** §1.3 (Rule 1/2 — defense-in-depth)
- **location:** `src/main/index.ts:1716-1719`; `src/main/openers.ts:43-94`
- **evidence:** The `cursor`/`code`/`terminal`/`finder` branches pass the renderer path unconfined (openers.ts:49,54,75,82). Mitigating: all spawns use **array args** (`spawnDetached(cmd, ['-n', path])`), so there is no shell-injection; the `browser` branch is correctly gated to `http(s)` (openers.ts:87-89).
- **reachability:** Untrusted renderer.
- **impact:** Low — opens an attacker-chosen path in an editor/Finder window (no command injection, no write). UX/annoyance and minor info-exposure, not a code-exec primitive on its own.
- **remediation:** Confine the path to a registered project / HOME-base before spawning, consistent with the fs gate.
- **effort:** S
- **confidence:** likely

### SEC-007 — MCP `register_project` widens the `trustedProjectRoot` trust anchor
- **id:** SEC-007
- **title:** An agent can register any absolute path as a project, expanding the set the renderer fs-mutation gate trusts
- **dimension:** §1.3 (Rule 1/2 — trust-anchor integrity)
- **location:** `src/main/register-project-mcp-tool.ts:70-123` (esp. lines 9-16 doc + 82-100); consumed by `src/main/index.ts:1505-1532` (`trustedProjectRoot` iterates `store.listProjects()`)
- **evidence:** The tool resolves `isAbsolute(path) ? resolve(path) : resolve(projectRoot, path)` and calls `registerProject(absPath)` (register-project-mcp-tool.ts:82-100). The module documents this as intentional: "the agent may pass any absolute path and register a directory outside the originating project; that is no more than its shell can already touch" (lines 9-16). However `trustedProjectRoot` (index.ts:1512-1519) grants confinement trust to **any** path in `store.listProjects()` — so a registered path becomes a writable root for `fs.createFile/rename/delete`.
- **reachability:** A spawned agent over the loopback MCP server (semi-trusted; already has shell in its workspace). Compounds with the loopback server having no auth token (mcp-server.ts:540, bound `127.0.0.1:0`) — any local process that learns the port + a projectId UUID could call it.
- **impact:** Trust-anchor widening: an agent (or local process) can promote an arbitrary directory to "registered project" status, after which the otherwise-correct renderer fs-mutation gate (SEC-004's correct twin) will confine to — and thus permit writes under — that attacker-chosen root. Bounded by the agent already having shell access; primary value is defense-in-depth / clarifying the trust model.
- **remediation:** Either constrain `register_project` to paths under the agent's own project root / a known clone-root base, or have `trustedProjectRoot` distinguish user-registered from agent-registered projects (only the former anchors renderer write-confinement). Document the loopback MCP server's local-trust assumption explicitly.
- **effort:** M
- **confidence:** needs-followup

---

## C. QA cross-reference (independent verification)

- **Agrees & re-verified:** SEC-002 ≡ QA #1 (fs.writeFile); SEC-003 ≡ QA #3 (git handlers); SEC-004 ≡ QA #2 (extension-id traversal — I additionally confirmed `resolveContained` never re-anchors `dir`, path-util.ts:25-28); SEC-005 ≡ QA #9 (read handlers). All four hold against current code at the cited lines.
- **QA gap (novel here):** **SEC-001** (`claudeSettings.write` unconfined `projectPath` + `_unknown.hooks` round-trip → code-exec config) is **not** in the QA review. QA's nearest item (#15) is a *Rule-4 atomicity race* on a **different** writer — `setMcpServerEnabled` in `mcp.ts:202-204` touching `settings.local.json` — and does not address the `IPC.claudeSettings.write` handler, the unconfined `projectPath`, or the hooks code-exec vector. This is the highest-severity item in this dimension and should anchor the §9 high/critical cluster pending adversarial verification.
- **Theme:** SEC-001/002/003/004/005 share one root cause — *renderer-/agent-supplied path or id reaching an fs/git/settings/extension sink without realpath-confinement to a registered project, while the sibling op is correctly gated*. They should be one roadmap cluster (the "confinement asymmetry"), ranked by SEC-001's severity. SEC-006/007 are adjacent defense-in-depth on the same theme.
