# Extension-Contributed Agent Capabilities — Skills, MCP Servers, CLI Discovery

> **Status: Implemented (2026-08-02).** All 5 phases below shipped — an
> extension can now declare `skills`/`mcpServers` in its manifest, gated on the
> new `agent:contribute` permission. See the CLAUDE.md coupling note
> "Extension-contributed agent capabilities" for the shipped-mechanism summary.
> The Ground truth / Executive summary sections below describe the PRE-existing
> gap this doc closed — read them as history, not current state.

> Design doc, 2026-08-01. Answers a direct question: **"can an installed extension
> make its own skills / MCP servers / CLI tools available to an agent running
> inside ZCC?"** Ground-truthed against `src/` and `packages/extension-sdk/` as of
> this date, not aspirational. Proposes the closing design for the two gaps found.
> Companion to [`extension-personas-teams-plan.md`](./extension-personas-teams-plan.md)
> (shipped — the precedent this doc reuses almost every mechanism from) and
> [`extensions-authoring.md`](./extensions-authoring.md) (the author-facing doc to
> update once this ships).

---

## 0. Executive summary

**Short answer: no, not today — with one important asterisk.**

| Capability | Extension-contributable today? |
|---|---|
| Skills (`SKILL.md` → `~/.claude/skills/`) | **No.** Closed, hardcoded, app-only. |
| A brand-new, extension-owned MCP server | **No.** No manifest field, no `ctx` API. |
| MCP server *by name*, via a persona's `mcpServers: string[]` | **Wired but pointing at nothing.** The plumbing is real and reaches the spawned `claude` CLI's `--mcp-config`, but the registry it resolves names against is a hardcoded, currently-empty object. |
| CLI tool exposed for agent discovery | **No.** No concept of this exists anywhere in the SDK. |

Nothing here is a bug — it's unbuilt. `docs/extension-personas-teams-plan.md`
(2026-06-18) deliberately scoped itself to personas/teams only. This doc scopes
the two remaining pieces: **extension-contributed skills** and **extension-owned
MCP servers**, and explains why "CLI tool discovery" isn't actually a separate
primitive once those two exist (§6).

The design leans hard on precedent already shipped for personas/teams:
same provenance-stamping trick (Rule 6), same lifecycle-bound in-memory registry
pattern, same P3-D consent posture, same namespacing convention. Where it departs
(skills touch the *filesystem*, not just memory) it borrows from
`skill-installer.ts`'s existing idempotent-write discipline instead.

---

## 1. Ground truth — what exists today (verified against code)

### 1a. Skills — closed, app-only

`src/main/skill-installer.ts`:
- `BUNDLED_SKILLS` (lines 162–171) is a **hardcoded literal array** of 5 entries
  (`zcc-center`, `saved-reports`, `brainstorm`, `zcc-cli`, `extension-creator`).
  Each has a `name` and an `install` closure.
- Every installer resolves its source file via `resolveShippedPath()` (lines
  49–58): `process.resourcesPath/<file>` (packaged) or
  `__dirname/../../resources/<file>` (dev) — **exclusively the app's own bundled
  `resources/` directory.** Nothing reads from an extension's install directory.
- Deploy target is always `~/.claude/skills/<name>/SKILL.md` (module-level
  consts, lines 28–41) — one flat namespace, no per-source subdirectory.
- `redeployBundledSkills()` (lines 187–196) just re-runs the same hardcoded array.
  This is what the "Reload skills & MCP" button in the Extensions hub calls
  (`src/main/index.ts:4953–4969`, the `extensions:redeployCapabilities` IPC
  handler) — so the button's name is slightly aspirational today: it reloads the
  **app's** artifacts, never an extension's.
- Write discipline worth preserving: idempotent + edit-respecting (only rewrites
  when shipped content differs from on-disk, comment at lines 12–17), tmp +
  rename (Rule 4), never throws (best-effort, boot must not block).

### 1b. MCP servers — registry exists, is empty, and nothing can populate it

`src/main/mcp-config.ts`:
- `ensureMcpConfigForProject(projectId, extraServerNames?)` / its sync twin
  `ensureMcpConfigForProjectSync` write `~/.zcc/mcp/<projectId>.json` (Rule-4
  atomic: tmp + unique-suffix rename, lines 71–113).
- `configBody()` (lines 47–62) always includes the app's own `zcc-inbox` server,
  then merges any name in `extraServerNames` **that resolves against
  `MCP_SERVER_REGISTRY`** (lines 54–59) — unresolved names are silently dropped.
- `MCP_SERVER_REGISTRY` (lines 35–38) is a **private, hardcoded, currently EMPTY
  object.** Its own comment: *"Add known servers here as they become useful for
  personas."* There is no runtime API — not from the SDK, not from anywhere — that
  adds an entry to it. It is dead weight until someone hand-edits this file.
- Consumer: `PtyManager.create()` (`src/main/pty.ts:927`) calls
  `this.safeEnsureMcpConfig(opts.projectId, opts.persona?.mcpServers)`, which
  calls `ensureMcpConfigForProjectSync` synchronously right before spawn, gated by
  `caps.injectsClaudeMcpConfig` (line 926) which decides whether `--mcp-config
  <path>` gets added to the launched `claude` argv.
- Persona-side: `Persona.mcpServers?: string[]` (`src/shared/types.ts:3077`,
  mirrored in the SDK at `packages/extension-sdk/src/main.ts:495`) is a real,
  typed field. `sanitizePersona` (`src/main/persona-store.ts:96`) copies it
  through (`mcpServers: strArray(r.mcpServers)`), and **`ctx.personas.register()`
  from an extension DOES survive with this field intact** — `PersonaTeamRegistry`
  doesn't strip it.

**The asterisk**: an extension can *today* register a persona whose
`mcpServers: ['foo']` will be threaded, unmodified, all the way to
`--mcp-config`'s `mcpServers` block at spawn time — but `'foo'` will never
resolve to anything, because `MCP_SERVER_REGISTRY` has no entries and no
extension can add one. It's a loaded gun with no bullets. This is the shortest
path to close (§3).

### 1c. Extension SDK surface — full capability enumeration

`packages/extension-sdk/src/main.ts`, `MainModuleContext`:

| Member | What it does | Registers something new? |
|---|---|---|
| `storage` | KV get/set | No — consumes host storage |
| `log` | logging | — |
| `register(disposable)` | teardown cleanup | — |
| `exec?` | brokered no-shell process exec | No — calls an allowlisted bin |
| `fs?` | brokered fs read/write, root-confined | No |
| `fetch?` | brokered HTTP, host-allowlisted | No |
| `mcp?(serverId, tool, args)` | brokered call to a **pre-existing, host-managed** MCP server | **No — consumption only.** No `ctx.mcp.register`. |
| `resolveProjectRoot?` | path resolution | — |
| `personas?.register/clear` | contribute Personas | **Yes** — shipped (§ precedent) |
| `teams?.register/clear` | contribute Teams | **Yes** — shipped |
| `summarizeSession?` | — | — |
| `stream?(endpoint, opts)` | subscribe to a **pre-existing** host-managed push source | No — consumption only |
| `emit?(topic, payload)` | main→renderer event push | — |
| `llm?(req)` | brokered LLM micro-call | — |
| `host?.{toast,navigate,...}` | UI affordances | — |
| Lifecycle: `setup/teardown/onInstall/onUninstall` | — | — |

**Conclusion**: `personas`/`teams` are the *only* precedent for "extension
registers a new first-class thing into a core registry." Everything else is
either pure consumption of a host-managed resource, or a one-shot brokered
action. **Skills and MCP-server-definitions have zero SDK surface today** — not
even a stub.

### 1d. Manifest schema — no field for any of this

`packages/extension-sdk/src/index.ts:194–251`, `ExtensionManifest`: `id`,
`version`, `build`, `title`, `icon`, `titleLabel`, `entry`, `engines`,
`permissions?`, `permissionScopes?`, `projectTab?`, `agentPreset?`. No `skills`,
no `mcpServers`, no `cli`. `discovery.ts` (`parseProjectTab`/`parseAgentPreset`
→ `toManifestView`, lines 438–587) mirrors exactly this set — confirms the
manifest schema is closed to all three concepts as of today.

### 1e. Prior design docs — genuinely unscoped territory

Searched `docs/extensions*.md`, `docs/extension-personas-teams-plan.md`,
`docs/ROADMAP.md` for "skill" + "contribute" / "MCP server" + "extension." The
personas/teams doc explicitly scoped itself to personas/teams (Key Decision 4 in
that doc: registration is inert data, no new permission). No doc anywhere
proposes extension-contributed skills, standalone MCP servers, or CLI discovery.
This is new ground, not a rediscovery of shelved work.

---

## 2. Design thesis

Two closing moves, modeled on the **exact same trick** that made personas/teams
work cleanly:

1. **MCP servers**: extend the manifest with a declarative `mcpServers` block.
   Discovery parses + sanitizes it into `ExtensionManifestView` (same shape as
   `agentPreset`). A new **per-extension slice** of `MCP_SERVER_REGISTRY`,
   namespaced `ext:<id>:<name>`, is populated from installed manifests at
   discovery time (not via a live `ctx` call — see §3 for why declarative beats
   runtime-registered here). `ensureMcpConfigForProject` folds in every
   currently-installed extension's servers whose ids appear in `persona.mcpServers`
   or (new) the extension's *own* always-on server list. This reuses 100% of the
   existing atomic-write, sync-spawn-time plumbing in `mcp-config.ts` — zero new
   IPC, zero new brokered capability class.

2. **Skills**: extend the manifest with a `skills` block (paths relative to the
   extension's install dir). A new `deploySkillsForExtension(manifest, extDir)` in
   `skill-installer.ts`, run at the same three trigger points bundled skills
   already use (boot, "Reload skills & MCP" button, extension install/enable),
   copies each declared `SKILL.md` into a **namespaced** directory
   (`~/.claude/skills/ext-<id>-<slug>/`) using the exact same idempotent
   tmp+rename write helper already in that file. On uninstall/disable, the
   namespaced directories are removed (mirrors the storage-clear-on-uninstall
   precedent).

Both are **manifest-declared, not `ctx`-registered at runtime** — a deliberate
divergence from the personas/teams precedent, justified in §3a. Both go through
a **new, single `ExtensionPermission` token** (`agent:contribute`, §4) — because
unlike personas (inert data gated at *launch*), a skill file lands on disk where
*every* Claude Code session on the machine can load it, and an MCP server
definition can point at an arbitrary command/URL — this is meaningfully
different blast radius from "an extension can suggest a persona."

---

## 3. Why declarative-manifest, not `ctx.skills.register()` / `ctx.mcp.registerServer()`

This is the one real design fork, so it's worth writing out why the answer
differs from personas/teams.

**Personas/teams are in-memory and lifecycle-bound** (cleared on teardown/crash)
because they're pure data consumed by ZCC's own launch path — nothing external
depends on their existence outside a live ZCC process. A `ctx.personas.register()`
call disappearing on crash is exactly correct.

**Skills are filesystem artifacts consumed by a process ZCC doesn't control** —
the `claude` CLI reads `~/.claude/skills/*` independently, at its own start,
possibly outside any ZCC-launched terminal (a user's own `claude` in a random
shell). If skill availability were tied to "extension's main-process child is
currently alive" (the personas/teams model), a skill would flicker in and out of
existence on every hot-reload, and would vanish the moment the extension is
merely *disabled* rather than actively torn down mid-session — surprising and
hard to reason about for the user's already-running agents.

**MCP servers, similarly, are named in a static `.mcp.json` file** written
*before* the `claude` CLI spawns (`ensureMcpConfigForProjectSync` runs
synchronously at `pty.ts:927`, before argv assembly finishes). A per-spawn
runtime registration API would need to race that write on every terminal open —
solvable, but pure complexity for no behavioral gain over "read installed
manifests at config-build time."

So: **declare in the manifest** (parsed once at discovery, like `agentPreset`),
**derive the registry/skill-directory state from "what's currently installed and
enabled"** (recomputed on install/uninstall/enable/disable/reload — the same
triggers `redeployBundledSkills`/`ensureMcpConfigForProject` already fire on),
rather than a live per-process `ctx` call. This is simpler, matches how the
consuming process (`claude` CLI) actually reads state (static files, not an
IPC handshake), and sidesteps a whole class of hot-reload/crash-window bugs the
personas/teams design had to solve carefully (§2e of that doc, teardown-clears
lifecycle hooks) — none of which apply if the source of truth is "read the
manifest of every enabled extension," recomputed idempotently.

---

## 4. Permission model

**New token: `agent:contribute`** — added to `ExtensionPermission` /
`EXTENSION_PERMISSIONS` in `packages/extension-sdk/src/index.ts`. Deliberately
**one token covering both skills and MCP-server declaration**, not two, because:
- They're both "this extension adds something a Claude Code agent will
  autonomously load and act on, without a human approving each invocation" — the
  same trust question, asked once.
- Splitting them (`skills:contribute` / `mcp:contribute-server`) buys precision
  the consent screen doesn't need — a user deciding to trust an extension's
  *agent-facing* footprint wants one clear yes/no, not two similar-sounding
  toggles they'd have to understand the difference between.

This does **not** reuse the existing `mcp` permission token, because `mcp` today
means "call a HOST-MANAGED server the extension doesn't own" (`ctx.mcp`,
consumption). `agent:contribute` means "this extension's OWN definitions become
things agents load" — a different, larger claim (an MCP server the extension
*defines* can point at an arbitrary `command`/`args`/`url`, which is closer in
shape to `exec`+`net` combined than to the narrow `mcp` consumption token).

**Scoping** (`ExtensionPermissionScopes`, new optional field): none needed beyond
the manifest declaration itself — unlike `exec`/`fs`/`net`/`mcp`/`stream`, there's
no separate "scope" dimension because the manifest's `skills`/`mcpServers` block
**is** the scope (a fixed, versioned, install-time-reviewed list — not an opaque
runtime string like a bin name or host). The consent screen renders the actual
skill names + MCP server command/args/url up front (§5), which is strictly more
informative than a scope-list summary line.

**Consent screen** (`ExtensionConsent.tsx`): render a new section, "Agent
capabilities," listing:
- Each declared skill: name + first line of its description.
- Each declared MCP server: name + `type` + (`command`+`args`, redacted past
  the binary name if long) or `url` host — never the full opaque string
  unredacted if it looks like it could carry a token, mirroring the `"*"`
  loud-rendering convention already used for `execAllowlist`/`egressAllowlist`.

This is a **new, distinct trust prompt** even for an extension a user already
has installed with other permissions — granting `agent:contribute` later (e.g. a
version bump that adds a skill) must re-trigger consent, exactly like the existing
rule that "adding a permission later re-prompts" (documented for local
extensions in CLAUDE.md's local-extension note).

---

## 5. Manifest schema additions

`packages/extension-sdk/src/index.ts`, on `ExtensionManifest`:

```ts
/**
 * Skills contributed to Claude Code's skill catalogue. Each entry names a
 * SKILL.md file relative to the extension's install dir. Deployed into a
 * NAMESPACED directory under ~/.claude/skills/ — never the bare skill name —
 * so two extensions can't collide or shadow a bundled/user skill. Requires the
 * `agent:contribute` permission; absent ⇒ no skills contributed.
 */
skills?: ExtensionSkillContribution[];

/**
 * MCP server DEFINITIONS this extension owns (as opposed to `mcp`/`mcpAllowlist`,
 * which only lets ctx.mcp CALL a server core already manages). Each becomes a
 * candidate entry mergeable into a project's `.mcp.json`, namespaced
 * `ext:<id>:<name>` so it can never collide with a core-managed server id.
 * Requires `agent:contribute`; absent ⇒ no servers contributed.
 */
mcpServers?: ExtensionMcpServerContribution[];
```

```ts
export interface ExtensionSkillContribution {
  /** Path to the SKILL.md, relative to the extension's install root. */
  path: string;
  /**
   * Slug for the deployed directory name (ext-<id>-<slug>). Defaults to a
   * kebab-cased basename of `path` when omitted. Keep stable across versions —
   * renaming orphans the old deployed directory (a stale skill lingering on
   * disk); the installer prunes only slugs it currently knows about (§7).
   */
  slug?: string;
}

export interface ExtensionMcpServerContribution {
  /** Name agents/personas reference (namespaced ext:<id>:<name> at registration). */
  name: string;
  /** Same shape .mcp.json already accepts. */
  type: 'stdio' | 'streamable-http' | 'sse';
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  /**
   * When true, this server is added to EVERY spawn in a project where the
   * extension is enabled (no persona opt-in needed). Default false — most
   * servers should be opt-in per persona via `Persona.mcpServers`, keeping the
   * "agent gets more tools" surface deliberate rather than ambient.
   */
  alwaysOn?: boolean;
}
```

Discovery parsing (`discovery.ts`), mirroring `parseAgentPreset`'s
drop-if-malformed discipline exactly:
- `parseSkillContributions(raw)`: array of `{path, slug?}`; drop any entry whose
  `path` isn't a non-empty string or resolves (via the extension's `extDir` +
  the existing path-confinement helper used for `fsRoots`) outside the
  extension's own install directory — **Rule 2 applies even to a manifest-declared
  path**, a compromised/malicious `extension.json` doesn't get to reference
  `../../../.ssh/id_rsa` as a "skill."
- `parseMcpServerContributions(raw)`: array of the shape above; drop entries
  missing `name`/`type`, or where `type: 'stdio'` lacks `command`, or
  `type !== 'stdio'` lacks `url`. `command` is **basename-only**, reusing the
  identical guard `broker-caps.ts`'s exec cap already applies — an extension
  cannot smuggle a shell string or path traversal into its own server definition
  any more than it could via `execAllowlist`.
- Both require `agent:contribute` in `permissions` to take effect at all — parse
  the block regardless (so the consent screen can show what *would* be granted),
  but `toManifestView`/discovery's "effective" projection drops it when the
  permission is absent, same as any other gated capability.

---

## 6. Why "CLI tool discovery" isn't a third primitive

The ask mentioned "skills, MCP, or even some CLI... to make our agent aware."
Worth being explicit that **CLI-tool-discoverability collapses into the skill
primitive** rather than needing its own manifest field:

- A skill IS the mechanism Claude Code uses to make an agent aware of a CLI —
  every existing bundled skill (`zcc-cli-skill.md`, `extension-creator-skill.md`)
  is exactly "a markdown doc teaching the agent to invoke a CLI it can already
  reach on `$PATH` or via `Bash`." An extension that ships a CLI binary and wants
  an agent to know about it should ship a `SKILL.md` describing that CLI's
  invocation — using the `skills` contribution above, no new primitive needed.
- The one thing a bespoke "CLI capability" *could* add beyond a skill is
  **making the binary itself reachable** (on `$PATH`, or resolvable by name) if
  the extension's install dir isn't already somewhere the shell would find it.
  That's a packaging/PATH question, not an agent-awareness question — out of
  scope here, and arguably solved already by an extension declaring an `exec`
  permission with `execAllowlist` naming its own bundled binary's basename (the
  extension's own dir is already implicitly on the fs allowlist per
  `grantFromManifest`, `permission-broker.ts` — the same mechanism could extend a
  `PATH`-splice at spawn time as a small follow-up, but that's orthogonal to
  "agent awareness" and not needed to answer the original question).

So: **skills + MCP servers are the complete set.** No third primitive.

---

## 7. Lifecycle — install / update / disable / uninstall

Mirrors the existing storage-clear-on-uninstall precedent
(`moduleRouter.storageClear(id)` on uninstall) and the boot/redeploy fan-out
skill-installer already has:

| Event | Skills | MCP servers |
|---|---|---|
| **Install** | Deploy each declared skill to `~/.claude/skills/ext-<id>-<slug>/` (same idempotent tmp+rename write as bundled skills) | Register `ext:<id>:<name>` entries into the per-extension registry slice; re-run `ensureMcpConfigForProject` for every project |
| **App boot** (extension already installed+enabled) | Same deploy fan-out as `redeployBundledSkills`, extended to iterate installed extensions' `skills` blocks too — literally the same function, roster extended from "hardcoded array" to "hardcoded array ⊕ installed-extension manifests" | Same — registry rebuilt from currently-installed+enabled manifests at boot, before any project's `.mcp.json` is (re)written |
| **"Reload skills & MCP" button** | Same fan-out — this is the point where the button's name stops being aspirational and starts being literally true | Same |
| **Version bump (update)** | Re-deploy (idempotent — only rewrites if content changed, exactly like bundled skills); if `slug` changed, deploy the new slug AND prune the old one (bounded: only prune slugs this extension is on record as having deployed previously — persisted in `local.json`-style side-record, mirroring how local-extension provenance is tracked outside the install dir) | Registry entries rebuilt wholesale from the new manifest (replace, not merge — same "declarative replace" semantics `PersonaTeamRegistry.setPersonas` already uses) |
| **Disable** (not uninstalled) | **Remove** the deployed skill directories — a disabled extension's skill should stop being agent-visible immediately, same spirit as "disabled ⇒ ctx calls stop" for personas/teams | Registry entries removed; **existing** `.mcp.json` files are NOT rewritten proactively (next spawn's sync `ensureMcpConfigForProjectSync` call naturally omits the now-unregistered name) |
| **Enable** (was disabled) | Re-deploy (same as install) | Re-register (same as install) |
| **Uninstall** | Remove deployed skill directories (mirrors `storageClear` — the KV-purge precedent) | Registry entries removed |

Key invariant carried over from personas/teams §2e: **every one of these is
best-effort and never throws** — a failed skill-file write or a malformed MCP
server definition degrades to "that one contribution silently doesn't apply,"
never a blocked install/boot/reload (Rule from `installSkill`'s existing
try/catch discipline, extended verbatim).

---

## 8. Security / trust review (CLAUDE.md Rules 1–7)

- **Rule 1 (main authorizes):** all parsing, path confinement, and file writes
  happen in main; the manifest is read from disk by main's own discovery pass,
  never trusted from renderer/agent input. ✅
- **Rule 2 (confine paths):** skill `path` is resolved against the extension's
  own `extDir` and rejected if it escapes (reusing the existing canonicalize +
  `isWithin` helpers `grantFromManifest`/`fsRoots` already use) — Rule 2 applies
  to manifest-declared paths exactly as it does to runtime ones. MCP server
  `command` is basename-only (same guard as `execAllowlist`). ✅
- **Rule 3 (subscribe once, release):** the "recompute at boot/install/
  enable/disable/uninstall/reload" trigger set is a **finite, already-existing**
  list of choke points (mirrors `redeployBundledSkills`'s call sites) — no new
  long-lived subscription is introduced. ✅
- **Rule 4 (atomic writes):** skill deploy reuses `installSkill`'s tmp+rename;
  MCP registry mutation is in-memory (like `PersonaTeamRegistry`); `.mcp.json`
  writes reuse the existing atomic writer unchanged. ✅
- **Rule 5 (bounded):** cap skills-per-extension and mcpServers-per-extension
  (e.g. 20 and 10, mirroring `PERSONAS_PER_EXTENSION_MAX`/`TEAMS_PER_EXTENSION_MAX`
  order of magnitude) — `slice` before processing. ✅
- **Rule 6 (no extension id in core logic):** namespacing (`ext:<id>:<name>`,
  `ext-<id>-<slug>`) is built from the **host-authenticated** manifest id at
  discovery time, same provenance-stamping trick as personas/teams — zero
  hardcoded extension-id literals in the generic deploy/registry code. ✅
- **Rule 7 (promotion bounded):** nothing here promotes to a built-in; this is
  entirely a disk-extension-tier feature gated by a new permission token, same
  posture as `exec`/`fs`/`net`/`mcp`/`stream`. ✅

**New risk surface this doc introduces, called out explicitly** (deserves its
own line beyond the Rule checklist): a skill file is **global filesystem state**
(`~/.claude/skills/`) that outlives the extension's process and affects *every*
Claude Code session on the machine, not just ones launched through ZCC — this is
qualitatively different from personas/teams (in-memory, ZCC-launch-only). That's
precisely why §4 puts it behind its own permission token with an explicit,
itemized consent screen, rather than folding it into an existing broad token.

---

## 9. Test plan

1. **`skill-installer.test.ts` (extend)** — extension skill deploy: namespacing
   (`ext-<id>-<slug>`), idempotent rewrite, path-confinement rejection
   (`../../etc/passwot`-style traversal attempt dropped), prune-on-slug-rename,
   removal on disable/uninstall, cap enforcement, never-throws on malformed input.
2. **`mcp-config.test.ts` (extend)** — per-extension registry slice: namespaced
   `ext:<id>:<name>` entries resolve in `configBody`; `alwaysOn` servers appear
   without a persona opt-in; disabled/uninstalled extension's entries stop
   resolving (silently dropped, not an error); basename-only `command` guard.
3. **`discovery.test.ts` (extend)** — `parseSkillContributions`/
   `parseMcpServerContributions`: malformed entries dropped individually
   (one bad entry doesn't drop the whole array), path-escape rejection,
   `agent:contribute` gating in the effective/manifest-view projection.
4. **Permission-broker / consent** — new `agent:contribute` token renders in
   `ExtensionConsent.tsx` with itemized skill/server list; granting later (version
   bump adds a skill) re-triggers consent, mirroring the existing rule for a new
   permission on an already-installed extension.
5. **Lifecycle integration** — install → skill file exists + registry populated;
   disable → skill file removed + registry entry gone, `.mcp.json` unaffected
   until next spawn; uninstall → both purged; re-enable → both restored.
6. **Golden-argv net (extend existing `pty-golden-argv.test.ts`)** — a persona
   from an extension with an `alwaysOn` MCP server contribution produces the
   expected `--mcp-config` file contents at spawn — this is the one place this
   feature touches the byte-sensitive spawn-assembly contract, so it must be
   covered by the existing regression net rather than a bespoke test only.
7. **Rule-6 guard** — run unchanged; no new extension-id literals should appear
   in `skill-installer.ts`/`mcp-config.ts`/`discovery.ts` outside data flow.

---

## 10. File-by-file task list (phased)

### Phase 0 — Data model + manifest
- `packages/extension-sdk/src/index.ts`: `ExtensionSkillContribution`,
  `ExtensionMcpServerContribution`, `ExtensionManifest.skills`/`.mcpServers`,
  new `'agent:contribute'` token in `ExtensionPermission`/`EXTENSION_PERMISSIONS`.
- `src/shared/types.ts`: mirror the view-projected shape on
  `ExtensionManifestView` (parallel to `agentPreset`/`projectTab`).

### Phase 1 — Discovery parsing (read-only, no side effects yet)
1. `src/main/extensions/discovery.ts`: `parseSkillContributions`,
   `parseMcpServerContributions` (path/command confinement, drop-malformed,
   mirroring `parseAgentPreset`'s discipline); wire into `toManifestView`.
2. Tests: discovery parsing (item 3 above).

### Phase 2 — MCP-server contribution (smaller, reuses more existing code)
3. `src/main/mcp-config.ts`: replace the single hardcoded `MCP_SERVER_REGISTRY`
   const with a mutable-but-host-owned registry that's rebuilt from (a) the
   original hardcoded seed entries (kept, for backward compat) and (b) every
   currently-installed+enabled extension's `mcpServers` contributions, namespaced
   `ext:<id>:<name>`. Add a `rebuildExtensionServers(manifests)` entry point.
4. `src/main/index.ts`: call `rebuildExtensionServers` at boot and on every
   install/uninstall/enable/disable/reload — same trigger set as
   `redeployBundledSkills`'s existing call sites; extend the
   `extensions:redeployCapabilities` handler to also pass extension-contributed
   server names through to `ensureMcpConfigForProject` (currently it calls this
   with zero args — closing the literal gap CLAUDE.md's note calls out).
5. Support `alwaysOn` servers merging into every spawn for an enabled extension
   (not just persona-opted-in ones) — likely a small addition to
   `configBody`'s extra-names resolution, sourced from the enabled-extensions list
   rather than only `persona.mcpServers`.
6. Tests: item 2, item 6 (golden-argv extension).

### Phase 3 — Skill contribution (touches real filesystem state)
7. `src/main/skill-installer.ts`: `deploySkillsForExtension(manifest, extDir,
   log?)` — namespaced deploy dir, reuse `installSkill`'s write helper verbatim;
   `removeSkillsForExtension(manifest)` for disable/uninstall; a small
   side-record (mirrors the `local.json` pattern) tracking previously-deployed
   slugs per extension id, so a slug rename prunes the stale directory.
8. `src/main/index.ts`: wire `deploySkillsForExtension`/`removeSkillsForExtension`
   into install/uninstall/enable/disable handlers and the boot fan-out
   (`redeployBundledSkills`'s call sites, extended).
9. Tests: item 1, item 5 (lifecycle integration).

### Phase 4 — Consent UX + permission gating
10. `packages/extension-sdk/src/index.ts` / `permission-broker.ts`: gate the
    *effective* application of `skills`/`mcpServers` contributions on
    `agent:contribute` being present in the granted permission set (parse always,
    apply only if granted — mirrors how other gated capabilities already work).
11. `src/renderer/components/ExtensionConsent.tsx`: new "Agent capabilities"
    section rendering itemized skill names + MCP server command/url (redacted
    past the binary name / host if it looks token-bearing, mirroring the `"*"`
    loud-render convention).
12. Tests: item 4.

### Phase 5 — Docs
13. `docs/extensions-authoring.md`: new section documenting `skills`/`mcpServers`
    manifest fields for extension authors, alongside the existing
    `agentPreset`/`projectTab` sections.
14. CLAUDE.md coupling note: update once shipped — the current note's claim
    ("extensions cannot yet contribute skills/MCP directly...") becomes stale
    and should be replaced with a pointer to this doc + a summary of the shipped
    mechanism, same as how the persona/team note reads today.

---

## Key decisions

1. **Manifest-declared, not `ctx`-registered at runtime** (§3) — skills/MCP
   servers are filesystem/static-config artifacts consumed by a process ZCC
   doesn't control, unlike personas/teams' pure in-memory data. Recomputed at a
   finite set of lifecycle triggers (boot, install, enable, disable, uninstall,
   reload-button) rather than live per-process IPC.
2. **One new permission token, `agent:contribute`, covering both** — same trust
   question ("does this extension get to hand an agent new autonomous
   capabilities"), not two similar toggles.
3. **Skills namespaced `ext-<id>-<slug>` on disk; MCP servers namespaced
   `ext:<id>:<name>` in the registry** — collision-proof by construction, same
   convention as `ext:<moduleId>:<slug>` persona ids.
4. **"CLI discovery" is not a third primitive** — it collapses into the skill
   contribution (a skill IS how Claude Code learns to invoke a CLI); no new
   manifest field needed (§6).
5. **`alwaysOn` MCP servers are extension-wide, not persona-gated** — a
   deliberate opt-in a manifest author sets explicitly, kept separate from the
   default (persona-opted-in) path so ambient tool-surface growth stays visible
   and deliberate rather than automatic.
6. **Rule 2 (path confinement) and the exec basename guard apply to
   manifest-declared paths/commands exactly as they do to runtime-declared
   scopes** — a manifest is still untrusted input from main's perspective.
7. **Reuses `installSkill`'s idempotent tmp+rename writer and
   `ensureMcpConfigForProject`'s atomic writer unchanged** — no new write
   primitive, only new callers/roster sources for existing ones.
