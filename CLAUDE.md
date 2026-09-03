# CLAUDE.md

Guidance for working in this repo (Zana Command Center — an Electron + React + TS multi-project terminal hub).

## Worktrees

Create all git worktrees under `.worktrees/<branch-name>` inside this repository.
Keeps repo instructions and tooling configuration in each worktree ancestor.

## Engineering Rules

Core rules. Rationale: `docs/review-consensus-2026-06.md`.

1. **The renderer is untrusted — main authorizes.** Validate any path / projectId / cwd in main before it grants access; renderer-side checks are advisory.
2. **Confine paths before trusting them.** A renderer- or agent-supplied path is only a trust anchor after `realpath`-matching a registered project (or a HOME/cloneRoot base).
3. **Subscribe long-lived emitters once, at app init** — never inside `createWindow()` (it re-runs). Release every subscription, timer, and per-session resource on its shutdown path.
4. **Shared-file writes are atomic and serialized** — tmp + uniquely-suffixed rename, and one in-process mutex for read-modify-write (or be strictly append-only).
5. **Keep heavy, unbounded work off the main event loop** — bound/`LIMIT`/paginate growing reads; an unbounded accumulating store needs a retention cap.
6. **Core never names a specific extension in logic** — concrete ids appear only in the `MAIN_MODULES` / `APP_MODULES` registration. `MAIN_MODULES` is empty; `APP_MODULES` registers `docs` (compiled library UI). In the RENDERER the `'zana'` module-id literal must appear NOWHERE in `apps/app/src/**` code. The source-text guard (`apps/app/src/__tests__/rule6-zana-literal.guard.test.ts`) scans comment-stripped renderer code and fails on ANY bare `'zana'`/`"zana"` token. The registration site is guarded by `apps/server/src/services/extensions/__tests__/core-extension-separation.guard.test.ts`.
7. **Promotion to a built-in is deliberate and bounded** — only when the broker can't grant the capability even scoped, and the trusted version (`builtinExec`/`builtinFetch`) is no weaker than its broker-gated twin (redirects, body cap, timeout).
8. **New or modified code needs at least 80% test coverage.** Cover meaningful branches and failure paths, not only line count. For Electron main/renderer seams, unit coverage alone is insufficient: add or update the relevant built-Electron E2E test. Before completion, run the focused tests and the production-boundary E2E required by any affected coupling note.
9. **PR monitoring means diagnose and repair, not only report.** After pushing a PR, watch its checks until complete. On failure, fetch job logs with `gh run view <run-id> --job <job-id> --log-failed`; for external checks, query `gh api repos/<owner>/<repo>/commits/<sha>/check-runs` then `gh api repos/<owner>/<repo>/check-runs/<id>/annotations` to get file, line, rule, and remediation. Fix actionable failures, run focused local verification, push, and repeat until every required check passes. Do not stop at an external failure summary when annotations are available.

## Product Design Rules

- **Choose a layout per feature; do not expose the choice as a user preference.** A new panel is either a centered reading/configuration surface or a full-width workbench. Make that decision from the feature's task and information density, encode it in the panel's layout classes, and do not add a global "Centered / Full width" control to Settings.
- **Keep catalogues distinct by ownership.** ZCC-installed extensions are presented as **Plugins** in the ZCC Plugins hub. Claude Code's `~/.claude/plugins` catalogue is an implementation-specific compatibility surface and must not appear as a competing Settings destination unless a user explicitly asks for it.

## Coupling notes (don't regress these)

- **Child-process integrations must be verified at the real Electron production
  boundary, not only through mocks, shell commands, or Node/Vitest.** Electron's
  process runtime can behave differently from equivalent Node and shell execution.
  In one observed failure, piped child stdout truncated at exactly 8192 bytes in
  Electron main while shell and Vitest returned the complete 17-26 KiB payload;
  fake-CLI E2E fixtures also passed because their output was too small. For every
  main-process CLI integration, test realistic output size, environment/HOME,
  cwd, executable resolution, timeout, exit/error behavior, and full IPC-to-UI
  flow in the built Electron app. Captures must be bounded and cleaned up; when
  pipes cannot be proven complete, use uniquely named `0600` temp files with an
  explicit size cap, timeout, concurrency bound, and cleanup on every path. Never
  replace a proven capture mechanism with `execFile` or piped `spawn` based only
  on unit tests or shell reproduction. Mock tests remain useful for malformed
  output and failure paths, but they do not establish production-boundary behavior.
  OpenCode agent discovery is the current regression example:
  `apps/host-daemon/src/harness/opencode/provider.ts` uses bounded temp-file
  capture (`opencode agent list` + `opencode debug agent`). Its LIVE consumer is
  now LAUNCH-TIME preflight, NOT the picker: `discoverRoleTargets`, called from
  `preflightStructuredRouting` in
  `apps/server/src/services/launch/execution-routing.ts`, validates the picked
  `--agent` role and BLOCKS the spawn (`role target unavailable`, surfaced as a
  `Structured execution unavailable: …` error toast) when the role is not a
  directly-launchable (non-subagent, non-hidden) agent. The CLI Agent picker no
  longer runs discovery — it sources native roles from the SAME ACP session-mode
  list the Modern composer uses (`catalogEntry.acpMode`, from the `acp-opencode`
  `session/new` `mode` configOption), so both surfaces show an identical,
  plain-named list. A picked mode that maps to a subagent (surfaced as a mode but
  not directly launchable) is therefore offered in the picker yet rejected at
  preflight — deliberate. **A picked native role and a forced catalog `--model`
  are MUTUALLY EXCLUSIVE — the role wins, carrying NO model.** An OpenCode agent
  pins its OWN model; forcing a catalog model alongside `--agent <role>` overrides
  that pin and dies with `ProviderModelNotFoundError` (a dead session / exit 64) on
  any install whose provider inventory differs from the shipped static snapshot
  (e.g. an `llmgw`-backed setup with a stale `aisuite/*` catalog). This is enforced
  at TWO layers, because a forced model reaches argv from more than the composer:
  (1) the composer (`LegacyAgentHomeComposer` `launch()`) builds `adapterEntry` as
  role-XOR-model, so a PER-TAB model isn't co-sent; and (2) the AUTHORITATIVE gate
  is at argv assembly — a resolved native role suppresses the injected `--model`
  from ANY source (per-tab / persona / project / **global** `harnessRouting`), via
  the `provider.nativeRolePinsModel` capability flag (`BaseLaunchProvider` default
  `false`; `OpenCodeProvider` `true`, Rule-6-clean — no provider literal in core).
  `pty.ts create()` gates both `modelTarget.contribution` splices on
  `suppressModelForRole = roleTarget.targetId && provider.nativeRolePinsModel`; the
  remote paths (`base-provider.ts simpleRemoteExec`, `OpenCodeProvider.buildRemoteCommand`)
  gate identically. The composer fix alone was INSUFFICIENT — the observed exit-64
  came from GLOBAL routing (`~/.zcc/config.json harnessRouting.byAdapter.opencode.modelTargetId`),
  which the composer can't clear. The launch-boundary fixture
  (`e2e/fixtures/bin/opencode`) reproduces the failure: its bare TUI exits 64 when
  `--model` rides with `--agent` (any model id) OR on a bare `aisuite/*` `--model`,
  so the positive `reviewer` launch passing PROVES the model was dropped. The
  OpenCode model catalog (`opencode/provider.ts targets`) is a release-maintained
  snapshot of `opencode models`; it DRIFTS (the gateway renamed `aisuite/*` →
  `llmgw/*` with a `-1M` gpt suffix). Suppression protects role launches from that
  drift; the NO-role path still needs a correct catalog. Any change to discovery,
  filtering, IPC, launcher, or the model catalog MUST run BOTH: (1) the deterministic
  launch-boundary spec `npm run
  build && npx playwright test e2e/opencode-launch-boundary.spec.ts` — proves
  preflight `discoverRoleTargets` resolves a directly-launchable role (spawns) and
  rejects a subagent role (`role target unavailable` toast) at the real Electron
  boundary; and (2) `ZCC_LIVE_OPENCODE=1 npx playwright test
  e2e/opencode-agent-picker.spec.ts -g 'actual project agents'` against this actual
  project + HOME config — proves the live ACP mode list reaches the picker with
  plain names.

- **Feed category registry — every inbox event type declares its feed impact
  in ONE place, and reports/ideas are pinned SIGNAL.** The Inbox feed splits
  SIGNAL (surfaced inline as solo rows) from NOISE (folded into collapsible
  per-project sections so high-volume recurring events — agent-closed,
  scheduled runs, heartbeat pauses — can't bury what matters). That decision is
  the `FEED_CATEGORIES` registry in `packages/domain/src/feed-categories.ts`:
  `classifyEntry(entry)` maps an entry → a `FeedCategoryId` from the same
  implicit signals the store already carries (`dedupeKey` prefix —
  `auto-close:`/`heartbeat:`/`goal:` —, the `scheduled`+`notify` pair, and
  `question` presence), and each category's `grouped` boolean decides fold vs.
  inline. `inboxGrouping.ts` (`groupByBucketThenProject`) is now a PURE LAYOUT
  engine over that decision — it emits `groupedSections[]` in
  `GROUPED_CATEGORY_ORDER`, and `InboxSidebar.tsx`'s generic `FoldedSection`
  renders each with no per-category markup. **The registry is the module you
  MUST touch when you add a new inbox concept** (new `dedupeKey` prefix, new push
  shape): declare a `FeedCategory` with a deliberate `grouped` value AND teach
  `classifyEntry` to recognise it, or your entries fall through to the `report`
  default. Three load-bearing invariants, guarded by
  `feedCategories.test.ts` + `inboxGrouping.test.ts`: (1) **`report`/`idea`/
  `question`/`goal` are `grouped: false` and MUST stay so** — they are the
  high-value artifacts the feed exists to surface (reports and ideas were the
  explicit product ask), so they are never eligible for auto-scheduler /
  auto-close style folding, nor for the LLM noise classifier (below).
  (2) **The default is SIGNAL on purpose** — an unclassified/new entry surfaces
  loudly as a `report` rather than being silently swallowed as noise, so a
  missing registry entry is a visible over-surface, never a silent drop.
  (3) **`classifyEntry` precedence is fixed**: question → auto-close → heartbeat
  → goal → quiet-scheduled → report; the `auto-close:` prefix wins over
  `scheduled` (a scheduled run that also auto-closed folds as agent-closed). The
  folded sections reuse the historically-named `inbox-scheduled-*` CSS classes
  in `global.css` as ONE shared visual treatment (don't rename without updating
  `FoldedSection`). The Activity Feed (`apps/server/src/services/feed/feed-service.ts`,
  `FeedEventKind`) is a SEPARATE per-project history timeline with its own
  taxonomy — it re-imports `AUTO_CLOSE_KEY_PREFIX`/`isAutoCloseEntry` from the
  registry but keeps its own `deriveFromInbox` mapping; don't conflate the two.
  **The OPTIONAL feed-noise classifier — `builtin:feed-noise-classifier` — is now
  WIRED (default OFF, `feedNoiseClassifierEnabled` in `AppConfig` + the Settings
  "Feed-noise classifier" toggle).** It's a haiku micro-call
  (`apps/server/src/services/feed/feed-noise-classifier.ts`, `FeedNoiseClassifier`, mirroring
  `inbox-summary.ts`: DI'd `readEntries`/`runClassify` deps, reads main's own
  store — Rule 1 — capped at `FEED_NOISE_MAX_ENTRIES = 60`, never throws → empty
  set on failure) that background-DEMOTES an ambiguous routine `report` into a
  folded "Routine" section. Two load-bearing constraints keep it from eroding the
  invariants above: (1) **it is an ADVISORY OVERLAY, never a mutation** —
  `classifyEntry` stays PURE and NEVER returns `routine`; the LLM verdict is a
  non-persisted `ReadonlySet<string>` of entry ids passed as the 3rd arg to
  `groupByBucketThenProject(entries, now, routineIds)`, which re-buckets an id
  `report`→`routine` ONLY (any other category is left untouched). So a missing/
  failed verdict just leaves everything inline — the classifier can only ever
  DEMOTE a report, never promote or hide anything else. (2) **A DETERMINISTIC gate
  precedes the LLM** — `isDemotionCandidate` (main-side) only ever feeds the
  micro-call comment-only reports (rejects `question`, docs-bearing,
  `auto-close:`/`heartbeat:`/`goal:` dedupeKeys, and `scheduled`), so the model
  physically cannot see a docs/idea/question/goal entry to demote it. Wire path:
  IPC `inbox:classifyNoise` (gated on the config flag in `index.ts`, returns an
  empty result when off) → preload `window.cc.inbox.classifyNoise` → renderer's
  throttled `useFeedNoise`/`maybeRefreshFeedNoise` store hook (twin of
  `useInboxSummary`, keyed by `inboxContentSignature` + `INBOX_SUMMARY_AUTO_MIN_MS`
  floor) → `InboxSidebar` passes the cached `routineIds` into
  `groupByBucketThenProject`. The `routine` `FeedCategory` (`grouped: true`) is
  declared in the registry but explicitly documented as overlay-only (never
  emitted by `classifyEntry`), guarded by `feedCategories.test.ts` +
  `inboxGrouping.test.ts` + `feed-noise-classifier.test.ts`.

- **Scope-allowlist `"*"` wildcard (exec / net only).** The permission TOKENS
  (`EXTENSION_PERMISSIONS`) stay a closed, exact-matched enum — no `xxx:*` token
  wildcard (it'd hide breadth from the consent screen and defeat least-privilege).
  The wildcard lives one level down, in the two OPAQUE scope allowlists:
  `execAllowlist: ["*"]` (any bin) and `egressAllowlist: ["*"]` (any host), honored
  in `PermissionBroker.decide` (`apps/desktop/src/extensions/permission-broker.ts`) via
  `grant.<list>.has('*') || grant.<list>.has(concrete)`. Two invariants that MUST
  hold: (1) the exec basename guard (`scope.bin === basename(scope.bin)`) is
  checked BEFORE the wildcard, so `"*"` widens WHICH bins, never HOW they're named
  — a `/bin/rm` / `../rm` / shell string is still rejected (no `sh -c` injection
  via the wildcard). (2) **`fsRoots` deliberately has NO wildcard** — a filesystem
  "anywhere" grant defeats path confinement (Rule 2) + the sensitive-root
  blocklist (`~/.ssh`, `~/.aws`, `~/.zcc`), so fs access is always an enumerated,
  canonical-prefix list. The consent screen (`ExtensionConsent.tsx` `scopeLines`)
  renders a `"*"` list as "⚠ ANY tool/host (unrestricted)", never the literal `*`,
  so the breadth is loud. `broker-caps.ts` delegates entirely to `broker.assert`
  (no independent allowlist check), so the two `decide` gates are the ONLY
  enforcement sites — keep it that way.

- **Shared `gus-*` / `zana-*` CSS classes live in core `global.css`, but their
  consumers are now DISK EXTENSIONS.** The Tickets kanban / modal / chatter
  styles (`gus-modal`, `gus-card-type`, `gus-chatter-*`, `gus-spin`, `gus-facts`,
  and the Tickets-only `zana-*` overrides `zana-modal`, `zana-blocker-chip`,
  `zana-timeline-spinner`, `zana-ver-*`) are defined in
  `apps/app/src/styles/global.css` (~514 refs) yet are consumed by BOTH the live
  `gus` disk extension AND the `zana` disk extension (`extensions/zana/src/renderer/*`
  — `ProjectTicketsView`, `TicketDetailModal`, `VersionSettings`). Neither
  extension bundles its own CSS: their panels mount into the HOST document
  (`.module-panel-slot`), so core's `global.css` cascades into them. This is a
  deliberate, load-bearing coupling with two consequences: (1) **a restyle of
  `gus-*`/`zana-*` in core silently restyles both extensions' panels** — scope
  changes under the `zana-*` modifiers, or split the shared base out first; and
  (2) **do NOT delete these class definitions from `global.css` as "unused"** — a
  source-only search of `apps/app/src` will show no consumers now that the Tickets
  UI moved out, but the extensions depend on them at runtime. The classes were
  deliberately NOT renamed in the zana→core merge (a risky global rename) and stay
  put after the zana extension extraction for the same reason.

- **The host owns extension-panel placement, not the extension
  (`.module-panel-slot`).** Every extension panel is mounted by
  `ModulePanelHost` (`apps/app/src/modules/ModulePanelHost.tsx`) inside a
  `.module-panel-slot` wrapper (defined in `apps/app/src/styles/global.css`) that
  spans the shell grid's content columns (`grid-column: 2 / -1`, full height,
  own scroll) and stretches its child (`flex: 1 1 auto; min-height/min-width: 0`).
  This exists because `ListPane` returns `null` for a module nav — so a bare panel
  would auto-place into the narrow **list track (col 2)** and leave col 3 empty
  (the "extension squished into a narrow column" bug). The slot fix means an
  extension's own root just needs to fill 100%; it never has to know the
  app-shell's grid. Two couplings: (1) built-in panels that self-set
  `grid-column: 2 / -1` (`.gus-panel`, `.cu-panel`) still work — that rule is now a
  harmless no-op inside the flex slot — but do NOT rely on it for new panels; fill
  the slot instead. (2) The **plugin starter teaches this**:
  `packages/plugin-templates/src/files.ts` (panel root `height: '100%'`), the
  generated starter `CLAUDE.md`, and the `extension-creator` /
  `zcc-plugin-authoring` skills all instruct a full-slot root (`height:'100%'` /
  `flex:1` + own `overflow`, `max-width` only on an inner reading-width wrapper).
  Changing the slot contract means updating those teaching artifacts too, or new
  plugins regress the bug.

- **Extension-contributed personas/teams (`PersonaTeamRegistry`).** `apps/desktop/src/extensions/persona-team-registry.ts` lets a live extension contribute personas/teams in-memory via `ctx.personas`/`ctx.teams`. Provenance is **host-stamped** (`source: { extensionId }` from the authenticated `moduleId`, never a literal — a Rule-6-clean pattern; ids namespaced `ext:<moduleId>:<slug>`), cleared on teardown/crash. Coupling: changes to the shared `sanitizePersona`/`sanitizeTeam` gate or to `PersonaSource` narrowing now also affect extension-contributed entries, and the renderer source badge narrows on `'extensionId' in source`.

- **Plugin-contributed agent capabilities — skills + MCP servers.** New plugins
  declare these in `package.json` → `zcc.skills` / `zcc.mcpServers` (see
  `PluginManifest`). Leftover disk extensions still declare them on
  `ExtensionManifest.skills`/`mcpServers` in `extension.json` (`docs/extension-agent-capabilities-plan.md`).
  Unlike personas/teams (pure in-memory data ZCC fully owns), a skill (`SKILL.md`)
  and an MCP server definition are filesystem/static-config artifacts consumed by
  `claude` CLI processes outside ZCC's control — so they are declared in the
  manifest, not registered live. Two parallel sync functions, both gated
  identically (enabled ∧ consented ∧ `agent:contribute` declared) and called from
  the SAME finite choke-point set
  `redeployBundledSkills`/`ensureMcpConfigForProject` already used (boot,
  install/uninstall/enable/disable, the disk-sync reconcile, the "Reload
  skills & MCP" button — the button's name stops being aspirational here):
  (1) `rebuildExtensionServers` (`apps/host-daemon/src/mcp-config.ts`) declaratively
  REPLACES a module-scoped `ext:<id>:<name>`-namespaced slice of the MCP
  server registry every call (mirrors `PersonaTeamRegistry.setPersonas`); an
  `alwaysOn: true` server merges into every project's `.mcp.json`
  unconditionally, others resolve only when a persona names them via
  `extraServerNames`. `command` is basename-only — the identical guard
  `execAllowlist` already enforces. (2) `syncExtensionSkills`
  (`apps/server/src/services/skills/skill-installer.ts`) deploys each contributor's declared skills to
  `~/.claude/skills/ext-<id>-<slug>/SKILL.md` (reusing the bundled-skill
  installer's idempotent tmp+rename write) after first PRUNING any
  previously-deployed `ext-<id>-*` dirs (so a renamed/dropped slug or a
  since-revoked grant is cleaned up, not just added-to) — `path` is confined
  against the extension's OWN dir via `resolveContainedReal` (Rule 2, symlink-
  escape-safe). Uninstall additionally calls `removeSkillsForExtension`
  directly (not via the sync fn) because an uninstalled extension is absent
  from the next `extensionEntries` and would otherwise never be pruned again.
  Both functions are best-effort + never throw (one malformed contributor
  never blocks the rest). The consent screen (`ConsentBody.tsx`
  `agentCapabilityLines`) names the CONCRETE skill slugs/server names+alwaysOn
  a grant would add — never a bare permission token, and never env VALUES
  (`ExtensionMcpServerContributionView` strips those to `envKeys` before the
  projection ever reaches the renderer, Rule 1).

- **Inbox read/write split (`inbox_push` vs `inbox_search`).** The inbox now has
  a read tool (`apps/server/src/services/inbox/inbox-search-mcp-tool.ts`, registered on both route
  shapes in `mcp-server.ts`). Like `inbox_push`, its default scope is the
  **route's** `projectId` (closed over from the MCP URL, never agent free-text —
  rule 1); `allProjects: true` is the only opt-in cross-project read. It's
  read-only and bounded (scans newest `INBOX_SEARCH_SCAN_CAP = 500`, filters
  in-process, paginates via `before` — rule 5), so it's pre-approved alongside
  `inbox_push` in `pty.ts`. The agent-facing contract lives in
  the `zcc-inbox` skill (`apps/server/src/plugins/builtin-skills/zcc-inbox/SKILL.md`); keep the two in sync.

- **Inbox AI Summary reads main's store, not the renderer view.** `inbox:summarize`
  (`apps/server/src/services/inbox/inbox-summary.ts`) summarizes from main's own inbox store — the
  source of truth — never from a renderer-supplied list (rule 1). It's capped at
  `INBOX_SUMMARY_MAX_ENTRIES = 60`, runs the `builtin:inbox-summary` micro-call,
  and never throws (failures resolve to `{ ok:false, reason }`). The renderer
  (`useInboxSummary` in `store.ts`) throttles *automatic* regeneration (~10 min
  floor) and only refetches when the inbox content signature changes — preserve
  that discipline so a view-driven card doesn't turn into per-render LLM spend.

- **`projectTab.global` (extension surface opt-out).** An extension manifest's
  `projectTab.global: false` suppresses its top-level sidebar entry, making it a
  project-tab-only contribution; absent/`true` keeps the default dual surface
  (global sidebar entry + per-project tab). Parsed in
  `apps/desktop/src/extensions/discovery.ts` (`parseProjectTab` → `toManifestView`),
  typed on `ExtensionManifestView.projectTab` and the SDK's
  `ProjectTabContribution`. Docs uses `true` (global Docs rail + per-project Library).
  Coupling: a project-tab-only extension must still branch on
  `host.getScopedProjectId()` for its data scope — `global:false` only hides the
  sidebar entry, it doesn't scope the data.

- **Extension install/uninstall lifecycle hooks (`onInstall`/`onUninstall`).**
  `MainModule` (SDK `packages/extension-sdk/src/main.ts`) has four lifecycle
  verbs now: `setup`/`teardown` (activation, fire on every spawn/teardown incl.
  boot + hot-reload) and the install-scoped `onInstall`/`onUninstall`. These are
  **sandboxed callbacks, NOT npm-style shell scripts** — they run in the same
  per-extension `utilityProcess` with the same brokered `ctx`, so they're
  permission-gated and can't run arbitrary host commands. Wire path:
  `LifecycleMessage` (`host-protocol.ts`) → `ExtensionProcessHost.dispatchLifecycle`
  → `host-child.ts` `handleLifecycle` → `module[hook](ctx)`. Two couplings to
  respect: (1) **`onInstall` fires exactly once, on an explicit install, via a
  pending-mark**: the `extensions:install` handler calls
  `extProcessHost.markPendingInstall(id)` **before** `runDiskSync()`, and the
  child's next `ready` consumes the mark and fires the hook. An ordinary
  boot/reload spawn never marks the id, so it never fires — do NOT move the fire
  onto plain `ready` or it becomes per-activation. The mark is deliberately NOT
  cleared on teardown (a reinstall-over-running respawn tears down first, and the
  mark must survive to the fresh child's `ready`). (2) **`onUninstall` fires
  while the child is still alive, before teardown**, from the
  `extensions:uninstall` handler; `dispatchLifecycle` **never rejects** (dead
  child / hook throw / deadline all resolve) so a misbehaving hook can't wedge an
  uninstall. Both hooks are best-effort + isolated: throwing does NOT roll back
  the install/uninstall.

- **Uninstall purges the extension's `ctx.storage` KV.** The `extensions:uninstall`
  handler calls `moduleRouter.storageClear(id)` → `MainModuleHost.storageClear`
  → `ModuleStorage.clear()` (drops the in-memory cache AND `~/.zcc/modules/<id>.json`)
  after removing the install dir. This is the storage twin of removing the dir: a
  disk ext's KV would otherwise **outlive its dir** and a reinstall of the same id
  would silently inherit stale state. Coupling: storage for BOTH tiers (built-in +
  disk) is one on-disk KV owned by `MainModuleHost`, so `storageClear` routes
  through the built-in host regardless of tier (same split as `storageGet/Set`).
  It's called on **uninstall only** — `teardown`/disable deliberately preserve
  state for a later re-enable.

- **Local (in-app authored) plugins are ordinary PluginService installs + a
  pointer, NOT a trust tier.** The "create your own plugin" feature
  (`CreateExtensionDialog` → `extensions:createLocal`) mints a unique id
  (`apps/server/src/services/extensions/local-extension.ts` `mintLocalId`),
  scaffolds a `package.json` `zcc` starter into a scratch working dir
  (`workingDirFor(scratchWorkspaceRoot(), id)` =
  `~/zcc-workspace/extensions/<id>` — never HOME, a project, or `~/.zcc`)
  **including a `CLAUDE.md`** the Creator auto-loads as project instructions
  (orient + trust boundary + `zcc plugin dev` loop; the deeper reference stays
  the bundled `extension-creator` / `zcc-plugin-authoring` skills). The starter
  is generated from `@zana-ai/zcc-plugin-templates` (see the starter coupling
  note below). It then registers a **dedicated project** rooted at that working
  dir under the `category: 'Extensions'` group (`store.ensureExtensionProject`
  → `EXTENSION_PROJECT_CATEGORY`, named `Ext: <title>`, idempotent-by-path +
  self-healing) and opens the Creator agent (persona `builtin:ext-creator`,
  baseProfile `claude`, `permissionMode: 'acceptEdits'`) with its cwd bounded
  to that project root. The agent's file output is **INERT** until main
  path-installs the working dir through PluginService (`installPlugin` /
  `reloadPlugin`). **There is NO "trust local" fast-path** — local plugins go
  through the same install/enable confirm as any other plugin. Three couplings:
  (1) **"local" is stored BESIDE the install, in `local.json`**
  (`discovery.markLocal`/`getLocalRecord`/`clearLocal`, keyed by id →
  `{ workingDir }`), never inside the plugin dir — so publishing the source
  carries none of it. The hub reads `entry.source === 'local'` for the badge +
  local actions. (2) **Reload/Continue re-derive the working dir from main's
  own `local.json`, never from renderer/agent free-text** (Rule 1):
  `reinstallLocal(id)` reads the record, sanity-checks the source plugin id
  still matches the registry key (ID_MISMATCH), reloads via PluginService;
  `localInfo(id)`/`createLocal` return the working dir **plus the dedicated
  Extensions-category project id** (re-derived/self-healed via
  `ensureExtensionProject`, Rule 1) so the renderer can re-open the Creator
  agent against a stable home — the renderer only ever passes an id. The
  `'Extensions'` category string is shared: `store.EXTENSION_PROJECT_CATEGORY`
  and the ListPane rail's `projects:extensions` group compare against the same
  literal, so renaming the group means changing both. (3) **Uninstall calls
  `clearLocal(id)` but
  deliberately LEAVES the source working dir on disk** (the user's in-progress
  work), so a source dir can outlive its `local.json` entry — a re-create mints a
  fresh id rather than reclaiming the orphaned dir. Leftover `extension.json`
  working dirs still pack through `installFromDir`; that seam is guarded by
  `apps/server/src/services/extensions/__tests__/local-extension-install-seam.guard.test.ts`.

- **The local-plugin starter is generated from `@zana-ai/zcc-plugin-templates`,
  not an `extension.json` disk template.** `scaffoldLocalExtension`
  (`local-extension.ts`) calls `scaffoldPlugin()` which writes a `package.json`
  `zcc` plugin (`panel` / `main-panel` / `mcp-consumer` / `agent-preset`) using
  `pluginScaffoldFileMap` in `packages/plugin-templates/src/files.ts`. Enhance
  the starter by editing that file map — kinds, `definePluginApp` panel, server
  factory, skills, MCP. Tokens are the scaffold args (`id`, `name`,
  `description`), not `__EXT_ID__` substitution. The install-seam guard scans
  `local-extension.ts` source for `~/.zcc`; its naive backtick-pairing desyncs
  on a lone `` ` `` in code, so avoid stray backtick chars in that file's
  non-template-literal code (the guard test documents this).

- **Bundled skills + per-project MCP config are the app's runtime capability
  artifacts — one roster, two triggers.** Product skills live in
  `apps/server/src/plugins/builtin-skills/` and are injected at thread spawn
  (project > plugin > builtin). Only `zcc-cli` is also copied into
  `~/.claude/skills` at boot and via the "Reload skills & MCP" button
  (`extensions:redeployCapabilities`). The roster lives in ONE place —
  `skill-installer.ts` `BUNDLED_SKILLS` — which both `redeployBundledSkills()`
  (boot fan-out + the button) iterate, so a new *global* CLI skill is added there
  once (not in index.ts's boot block, which now just calls the aggregate). Deploys are
  idempotent + edit-respecting (only rewrites when shipped content differs, so a
  user's local skill tweak survives until a version bump). The `redeployCapabilities`
  handler also re-runs `ensureMcpConfigForProject` for every project and fires
  `skills:onChanged` so the catalogue refreshes. Plugin-contributed skills/MCP sync
  through the same choke points (`syncExtensionSkills` / `rebuildExtensionServers`).
  `harness-authoring` stays in `resources/` for maintainers and is not injected into
  user threads. Keep `zcc-cli`, `zcc guide` chapters, and CLI `--help` in lockstep
  (`docs/cli-guide-and-skill.md`). Covered by
  `apps/server/src/services/skills/__tests__/redeploy-bundled-skills.test.ts`.

- **Auto-close-idle depends on the human-vs-agent write split + a triage cache.**
  `apps/server/src/services/followups/auto-close-idle.ts` (OFF by default; `autoCloseIdleEnabled` master
  switch, sidebar + Settings toggle) closes a non-background, non-delegating
  agent after it sits idle for `autoCloseIdleMinutes` (default 15, clamp [1,240]).
  It's a `HeartbeatService`-shaped timer service — every eligibility gate is
  re-checked at fire time because the long dwell lets state drift. Two couplings:
  (1) the two-clock spare reads `TerminalSession.lastInputAt`, which is stamped
  **only** in `PtyManager.write` (human keystrokes) and never in `reply()` (agent
  injection) — if a future change routes agent text through `write()`, idle
  agents stop auto-closing. (2) `preserveParkedQuestion` reuses the SAME
  `followups.createFromIdle` bridge as the live idle→follow-up path, fed from the
  `lastTriageBySession` cache in `index.ts` (filled on the `idleTriage` `triage`
  edge, capped at 200, dropped on pty exit) — so a parked question survives the
  silent close at zero token cost. The foreground-spare reads
  `activeForegroundSessionId`, set by the advisory `terminals.setActiveSession`
  IPC (renderer-reported, spare-only — it can never authorize a close, Rule 1).
  The **favorite-spare** is the same shape: `favoriteAgentKeys` (set by the
  advisory `terminals.setFavorites` IPC from the renderer's persisted
  `useFavoriteAgents` star set) — a starred agent is pinned by the user, so the
  idle timer never reclaims it; only an explicit close (a person, or the
  agent-driven `close_idle_agents` tool, which deliberately does NOT consult
  favorites) may. `isFavorite` resolves a session's key as `claudeSessionId ?? id`
  to match the renderer's `favoriteKey`, so the spare reattaches across a restore;
  `setFavorites` calls `armAllIdle()` so un-starring an already-idle agent re-arms
  it without waiting for a working→idle cycle. Spare-only — like the foreground
  spare it can never authorize a close (Rule 1).

- **Sidebar automation toggles own their config round-trip.** The two switches
  under the Agents rail entry (`AutomationToggles` in
  `apps/app/src/components/Sidebar.tsx` — auto-close-idle + Overseer) call
  `useData.setAutoCloseIdleEnabled` / `setOverseerMode`, which — UNLIKE the
  pure-local Settings mirrors (`setCloseIdleEnabled` et al., driven after the
  panel's own `config.set`) — write `AppConfig` themselves (optimistic flip →
  persist → roll back on failure). Both mirrors hydrate in `useData.init`. The
  Overseer rail toggle only flips `off`↔`on`; the full `off/dryRun/on` range
  stays in Settings, so keep the store field a tri-state, not a boolean.

- **Core is portable; integrations are extensions.** Do not add environment- or
  vendor-specific behavior to core files. The generic SSH parser
  (`apps/server/src/services/projects/ssh-config.ts`) and extension SSH-host-provider seam are the public
  integration points. An environment-specific integration belongs in a separately
  distributed extension, never in the app source tree.

- **Release artifacts are published to the configured public GitHub release feed.**
  The auto-updater reads that feed anonymously. When cutting a release, push a
  `vx.y.z` tag so `.github/workflows/release.yml` builds Apple Silicon + Intel
  and creates a **draft** release on `salesforce/zana`. A human then publishes
  that draft. Local `pnpm run release:mac` packages the host arch only
  (`--publish never`) and must not upload.

- **The local-spawn argv/env assembly lives in `PtyManager.create()` and
  dispatches through the per-profile `LaunchProvider`; `@zana-ai/zcc-spawn-plan` is now the
  PURE HELPER library it draws on.** HISTORY: a monolithic
  `buildSpawnPlan(SpawnRequest): SpawnPlan` used to own the whole one-pass
  assembly; it was RETIRED (Decision D3 / T5.3, codex-parity plan 2026-07-22) once
  `create()` began dispatching launch identity + arg layers through
  `provider.resolveLaunch(...)` + the other `LaunchProvider` methods — the one-pass
  builder had become a dead duplicate that re-inlined `isClaudeProfile` gates the
  providers already own. `create()` still performs the genuine side effects —
  `randomUUID()` (session-id mint), `safeEnsureMcpConfig()` (the synchronous
  `.mcp.json` write), `isTmuxAvailable()` — then layers the argv through the
  provider and assembles the env inline. Four load-bearing invariants: (1) **the
  assembly precedence ORDER is exact and observable** — `base profile args →
  AppConfig globals (in args) → sessionIdArgs → claudeMcpArgs → projectSettings →
  PERSONA → hookArgs → per-tab extraArgs`, then `mergeAllowedTools(argv,
  inboxAllow)` (from `argv-utils.ts`) folds every `--allowedTools` into ONE
  last-wins flag; reordering any layer changes spawned argv. (2) **The golden-argv
  net is the regression contract** — `apps/host-daemon/src/__tests__/pty-golden-argv.test.ts`
  snapshots `create()`'s `{command,args,env}` (UUIDs normalized to `<SID>`) across
  the profile × persona × projectSettings × scheduled × overseer × pinned-session ×
  heap-ceiling matrix; a diff in that `.snap` means you changed launch behavior —
  regenerate ONLY if that was intended. (3) **The historical import surface is
  preserved via re-exports** — `pty.ts` re-exports
  `personaArgs_build`/`cleanExtraArgs`/`extractPinnedSessionId`/`applyHeapCeiling`/
  `buildAutoModeSettings` so the ~17 test files +
  `chat-runner.ts` that import them from `../pty.js` keep working; new code should
  import spawn-plan helpers from `@zana-ai/zcc-spawn-plan` directly. (4) **`buildRemoteCmd` shares the
  same pure helpers** (`resolveLaunch`, `computeAutoModeActive`,
  `resolveEffectiveModel`, `personaArgs_build`, `projectSettingsArgs`,
  `cleanExtraArgs`, `buildHookSettings`) but assembles its own remote precedence —
  so a change to a shared helper touches BOTH the local and remote spawn paths;
  keep them in lockstep (see the `pty.ts createRemote()` remote-parity hot-zone note).

- **Launch IDENTITY is registry-dispatched (`apps/host-daemon/src/harness/registry.ts`), the
  `MAIN_MODULES` analogue for interactive harnesses (Rule 6).** Per-profile launch
  *identity* — the concrete provider id, tab title, capability descriptor, and base
  command/args — lives ONLY in the provider files (`harness/launch-provider.ts`:
  `claudeCodeProvider` serves the whole claude family, `shellProvider` serves
  `shell`) + the registry, NEVER re-inlined in core launch logic. Core resolves a
  profile via `providerForProfile(profile)` and reads `.title(...)` /
  `.capabilities(...)` / `.resolveBaseLaunch(...)`. This is DELIBERATELY BOUNDED
  (per `designs/harness-extraction-refreshed-strategy-2026-07-10.md`): the seam owns
  only identity;   the byte-sensitive argv/env/hook ASSEMBLY stays in
  `PtyManager.create()` (drawing on `@zana-ai/zcc-spawn-plan`'s pure helpers — see the
  spawn-assembly note above), and `capabilities()` just re-wraps the existing
  `providerCapabilities` accessor — the rich `{hooks:{events}, mcp:{transports}}`
  shape is NOT built until a second real provider (Codex/Gemini) lands. Four
  couplings: (1) **`providerForProfile` is total over `VALID_PROFILES`** — every
  valid profile is served by exactly one provider; the `?? shellProvider` fallback is
  a defensive floor for a future unregistered profile (degrades to a plain shell,
  never crashes the spawn). Adding a provider = one new file + one `LAUNCH_PROVIDERS`
  entry, zero caller edits. (2) **Providers are stateless value objects** — the
  registry is a boot-time constant, NOT rebuilt per `createWindow` (Rule 3: nothing
  to subscribe/dispose). (3) **`titleFor` in `pty.ts` now delegates** to
  `providerForProfile(profile).title(profile)` — byte-identical to the old inline map,
  asserted by the golden-argv net (which snapshots `create()`'s title). (4) **Two
  source-text guards protect the seam**: `apps/host-daemon/src/__tests__/rule6-launch-provider.guard.test.ts`
  fails if the `'claude-code'` id reappears in `pty.ts`, and the existing
  `packages/domain/src/launch-provider.guard.test.ts` still forbids a re-rolled
  `isClaudeProfile` triplet — so keep the two `-suffix` claude profile literals on
  SEPARATE lines in provider code (a one-line pair trips the dedup guard).

Plugins are full-trust in-process after install and never receive host-daemon tokens.
