# CLAUDE.md

Guidance for working in this repo (Zana Command Center — an Electron + React + TS multi-project terminal hub).

## Engineering Rules

The few that matter. (Fuller rationale: `docs/review-consensus-2026-06.md`.)

1. **The renderer is untrusted — main authorizes.** Validate any path / projectId / cwd in main before it grants access; renderer-side checks are advisory.
2. **Confine paths before trusting them.** A renderer- or agent-supplied path is only a trust anchor after `realpath`-matching a registered project (or a HOME/cloneRoot base).
3. **Subscribe long-lived emitters once, at app init** — never inside `createWindow()` (it re-runs). Release every subscription, timer, and per-session resource on its shutdown path.
4. **Shared-file writes are atomic and serialized** — tmp + uniquely-suffixed rename, and one in-process mutex for read-modify-write (or be strictly append-only).
5. **Keep heavy, unbounded work off the main event loop** — bound/`LIMIT`/paginate growing reads; an unbounded accumulating store needs a retention cap.
6. **Core never names a specific extension in logic** — concrete ids appear only in the `MAIN_MODULES` / `APP_MODULES` registration. In the RENDERER the invariant is now absolute: the `'zana'` module-id literal must appear NOWHERE in `src/renderer/**` code (the whole Zana feature — main + renderer — is now a disk extension, see the zana note below, so there is no longer any core quarantine seam). The source-text guard (`src/renderer/__tests__/rule6-zana-literal.guard.test.ts`) scans comment-stripped renderer code and fails on ANY bare `'zana'`/`"zana"` token. NOTE: `MAIN_MODULES` now registers ONLY `slack` (the sole compiled-in built-in) — `zana` is no longer a built-in main module (it left core when its data moved off native better-sqlite3 onto the host MCP pool over the brokered `mcp` cap); the registration site is guarded by `src/main/__tests__/core-extension-separation.guard.test.ts`.
7. **Promotion to a built-in is deliberate and bounded** — only when the broker can't grant the capability even scoped, and the trusted version (`builtinExec`/`builtinFetch`) is no weaker than its broker-gated twin (redirects, body cap, timeout).

## Coupling notes (don't regress these)

- **Feed category registry — every inbox event type declares its feed impact
  in ONE place, and reports/ideas are pinned SIGNAL.** The Inbox feed splits
  SIGNAL (surfaced inline as solo rows) from NOISE (folded into collapsible
  per-project sections so high-volume recurring events — agent-closed,
  scheduled runs, heartbeat pauses — can't bury what matters). That decision is
  the `FEED_CATEGORIES` registry in `src/renderer/util/feedCategories.ts`:
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
  `FoldedSection`). The Activity Feed (`src/main/feed-service.ts`,
  `FeedEventKind`) is a SEPARATE per-project history timeline with its own
  taxonomy — it re-imports `AUTO_CLOSE_KEY_PREFIX`/`isAutoCloseEntry` from the
  registry but keeps its own `deriveFromInbox` mapping; don't conflate the two.
  **The OPTIONAL feed-noise classifier — `builtin:feed-noise-classifier` — is now
  WIRED (default OFF, `feedNoiseClassifierEnabled` in `AppConfig` + the Settings
  "Feed-noise classifier" toggle).** It's a haiku micro-call
  (`src/main/feed-noise-classifier.ts`, `FeedNoiseClassifier`, mirroring
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
  in `PermissionBroker.decide` (`src/main/extensions/permission-broker.ts`) via
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
  `src/renderer/styles/global.css` (~514 refs) yet are consumed by BOTH the live
  `gus` disk extension AND the `zana` disk extension (`extensions/zana/src/renderer/*`
  — `ProjectTicketsView`, `TicketDetailModal`, `VersionSettings`). Neither
  extension bundles its own CSS: their panels mount into the HOST document
  (`.module-panel-slot`), so core's `global.css` cascades into them. This is a
  deliberate, load-bearing coupling with two consequences: (1) **a restyle of
  `gus-*`/`zana-*` in core silently restyles both extensions' panels** — scope
  changes under the `zana-*` modifiers, or split the shared base out first; and
  (2) **do NOT delete these class definitions from `global.css` as "unused"** — a
  source-only search of `src/renderer` will show no consumers now that the Tickets
  UI moved out, but the extensions depend on them at runtime. The classes were
  deliberately NOT renamed in the zana→core merge (a risky global rename) and stay
  put after the zana extension extraction for the same reason.

- **The host owns extension-panel placement, not the extension
  (`.module-panel-slot`).** Every extension panel is mounted by
  `ModulePanelHost` (`src/renderer/modules/ModulePanelHost.tsx`) inside a
  `.module-panel-slot` wrapper (defined in `src/renderer/styles/global.css`) that
  spans the shell grid's content columns (`grid-column: 2 / -1`, full height,
  own scroll) and stretches its child (`flex: 1 1 auto; min-height/min-width: 0`).
  This exists because `ListPane` returns `null` for a module nav — so a bare panel
  would auto-place into the narrow **list track (col 2)** and leave col 3 empty
  (the "extension squished into a narrow column" bug). The slot fix means an
  extension's own root just needs to fill 100%; it never has to know the
  app-shell's grid. Two couplings: (1) built-in panels that self-set
  `grid-column: 2 / -1` (`.gus-panel`, `.cu-panel`) still work — that rule is now a
  harmless no-op inside the flex slot — but do NOT rely on it for new panels; fill
  the slot instead. (2) The **starter template teaches this**: the local-extension
  starter (`templates/extension-starter/dist/renderer.js` root style + LAYOUT
  comment, its `CLAUDE.md` "Layout — fill the panel" section) and the
  `extension-creator` skill (`resources/extension-creator-skill.md`) all instruct a
  full-slot root (`height:'100%'`/`flex:1` + own `overflow`, `max-width` only on an
  inner reading-width wrapper). Changing the slot contract means updating those
  three teaching artifacts too, or new extensions regress the bug.

- **Extension-contributed personas/teams (`PersonaTeamRegistry`).** `src/main/extensions/persona-team-registry.ts` lets a live extension contribute personas/teams in-memory via `ctx.personas`/`ctx.teams`. Provenance is **host-stamped** (`source: { extensionId }` from the authenticated `moduleId`, never a literal — a Rule-6-clean pattern; ids namespaced `ext:<moduleId>:<slug>`), cleared on teardown/crash. Coupling: changes to the shared `sanitizePersona`/`sanitizeTeam` gate or to `PersonaSource` narrowing now also affect extension-contributed entries, and the renderer source badge narrows on `'extensionId' in source`.

- **Extension-contributed agent capabilities — skills + MCP servers, one
  permission token (`agent:contribute`), MANIFEST-declared not `ctx`-registered
  (`docs/extension-agent-capabilities-plan.md`).** Unlike personas/teams (pure
  in-memory data ZCC fully owns), a skill (`SKILL.md`) and an MCP server
  definition are filesystem/static-config artifacts consumed by `claude` CLI
  processes outside ZCC's control — so `ExtensionManifest.skills`/`mcpServers`
  (SDK) are declared once in `extension.json`, not registered live. Two
  parallel sync functions, both gated identically (enabled ∧ consented ∧
  `agent:contribute` declared) and called from the SAME finite choke-point set
  `redeployBundledSkills`/`ensureMcpConfigForProject` already used (boot,
  install/uninstall/enable/disable, the disk-sync reconcile, the "Reload
  skills & MCP" button — the button's name stops being aspirational here):
  (1) `rebuildExtensionServers` (`src/main/mcp-config.ts`) declaratively
  REPLACES a module-scoped `ext:<id>:<name>`-namespaced slice of the MCP
  server registry every call (mirrors `PersonaTeamRegistry.setPersonas`); an
  `alwaysOn: true` server merges into every project's `.mcp.json`
  unconditionally, others resolve only when a persona names them via
  `extraServerNames`. `command` is basename-only — the identical guard
  `execAllowlist` already enforces. (2) `syncExtensionSkills`
  (`src/main/skill-installer.ts`) deploys each contributor's declared skills to
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
  a read tool (`src/main/inbox-search-mcp-tool.ts`, registered on both route
  shapes in `mcp-server.ts`). Like `inbox_push`, its default scope is the
  **route's** `projectId` (closed over from the MCP URL, never agent free-text —
  rule 1); `allProjects: true` is the only opt-in cross-project read. It's
  read-only and bounded (scans newest `INBOX_SEARCH_SCAN_CAP = 500`, filters
  in-process, paginates via `before` — rule 5), so it's pre-approved alongside
  `inbox_push` in `pty.ts`. The agent-facing contract lives in
  `resources/inbox-skill.md`; keep the two in sync.

- **Inbox AI Summary reads main's store, not the renderer view.** `inbox:summarize`
  (`src/main/inbox-summary.ts`) summarizes from main's own inbox store — the
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
  `src/main/extensions/discovery.ts` (`parseProjectTab` → `toManifestView`),
  typed on `ExtensionManifestView.projectTab` and the SDK's
  `ProjectTabContribution`. Consensus uses `false` (project-scoped decisions).
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

- **Local (in-app authored) extensions are ordinary disk extensions + a pointer,
  NOT a trust tier.** The "create your own extension" feature
  (`CreateExtensionDialog` → `extensions:createLocal`) mints a unique id
  (`src/main/local-extension.ts` `mintLocalId`), scaffolds a renderer-only starter
  into a scratch working dir (`workingDirFor(scratchWorkspaceRoot(), id)` =
  `~/zcc-workspace/extensions/<id>` — never HOME, a project, or `~/.zcc`)
  **including a `CLAUDE.md` "template"** the Creator auto-loads as project
  instructions (orient + trust boundary + build/reload loop; the deeper reference
  stays the bundled `extension-creator` skill). The starter is copied from an
  **editable repo dir** (see the template-dir coupling note below), not emitted as
  inline strings. It then registers a **dedicated project** rooted at that working dir under
  the `category: 'Extensions'` group (`store.ensureExtensionProject` →
  `EXTENSION_PROJECT_CATEGORY`, named `Ext: <title>`, idempotent-by-path +
  self-healing) and opens the Creator agent (persona `builtin:ext-creator`,
  baseProfile `claude`, `permissionMode: 'acceptEdits'`) with its cwd bounded to
  that project root. The
  agent's file output is **INERT** until main **packs** it (manifest + `dist/`
  ONLY — a curated allowlist, so a stray secret in the working dir never rides
  into the install root) and crosses the single trusted seam `installFromDir`,
  which re-runs every manifest/id/api/reserved/containment gate. **There is NO
  "trust local" fast-path** — local extensions go through P3-D consent + the
  broker unconditionally (the template declares `permissions: []`, so a bare panel
  installs consent-free; adding a permission later re-prompts). Three couplings:
  (1) **"local" is stored BESIDE the extension dirs, in `local.json`**
  (`discovery.markLocal`/`getLocalRecord`/`clearLocal`, keyed by id →
  `{ workingDir }`), never inside the ext dir — so publishing the packed dir
  carries none of it (Rule-6 clean, publish-safe). `discoverExtensions` stamps
  `source: 'local'` from that map; the hub reads `entry.source === 'local'` for
  the badge + local actions. (2) **Reload/Continue re-derive the working dir from
  main's own `local.json`, never from renderer/agent free-text** (Rule 1):
  `reinstallLocal(id)` reads the record, sanity-checks the source manifest id
  still matches the registry key (ID_MISMATCH), re-packs, re-installs;
  `localInfo(id)`/`createLocal` return the working dir **plus the dedicated
  Extensions-category project id** (re-derived/self-healed via
  `ensureExtensionProject`, Rule 1) so the renderer can re-open the Creator agent
  against a stable home — the renderer only ever passes an id. The
  `'Extensions'` category string is shared: `store.EXTENSION_PROJECT_CATEGORY`
  and the ListPane rail's `projects:extensions` group compare against the same
  literal, so renaming the group means changing both. (3) **Uninstall calls
  `clearLocal(id)` but
  deliberately LEAVES the source working dir on disk** (the user's in-progress
  work), so a source dir can outlive its `local.json` entry — a re-create mints a
  fresh id rather than reclaiming the orphaned dir. The install-seam invariant
  (`local-extension.ts` never touches the install root; only `installFromDir`
  writes there) is guarded by
  `src/main/__tests__/local-extension-install-seam.guard.test.ts`.

- **The local-extension starter is an EDITABLE repo template, not inline strings.**
  `templates/extension-starter/` holds the real starter files (`extension.json`
  with BOTH a global entry + a `projectTab`, `dist/renderer.js`, `README.md`,
  `CLAUDE.md`). `scaffoldLocalExtension` (`local-extension.ts`) resolves the dir
  via `templateRoot()` — override `ZCC_EXTENSION_TEMPLATE_DIR` → packaged
  `process.resourcesPath/extension-template` (electron-builder `extraResources`)
  → dev `__dirname/../../templates/extension-starter`, mirroring
  `extension-installer.ts` `bundledRoot()` — then copies each file, substituting
  literal `__EXT_ID__` / `__EXT_TITLE__` / `__EXT_DESCRIPTION__` / `__EXT_API_MAJOR__`
  tokens (`applyTokens`), never clobbering an already-edited file. Enhance the
  starter by editing the template files — no code change. Two couplings: (1) a new
  token means adding it to BOTH the template files AND `templateTokens()`; an
  orphaned `__X__` ships verbatim. (2) An inline `scaffoldMinimal` fallback runs
  only when the dir is absent (stripped build) — keep it deliberately minimal (no
  projectTab/CLAUDE.md) so it can't masquerade as the maintained template. The
  install-seam guard scans `local-extension.ts` source for `~/.zcc`; its naive
  backtick-pairing desyncs on a lone `` ` `` in code, so avoid stray backtick
  chars in that file's non-template-literal code (the guard test documents this).

- **Bundled skills + per-project MCP config are the app's runtime capability
  artifacts — one roster, two triggers.** The five shipped SKILL.md files deploy
  into `~/.claude/skills/<name>` at boot AND on demand via the "Reload skills &
  MCP" button (`extensions:redeployCapabilities`). The roster lives in ONE place —
  `skill-installer.ts` `BUNDLED_SKILLS` — which both `redeployBundledSkills()`
  (boot fan-out + the button) iterate, so a new bundled skill is added there once
  (not in index.ts's boot block, which now just calls the aggregate). Deploys are
  idempotent + edit-respecting (only rewrites when shipped content differs, so a
  user's local skill tweak survives until a version bump). The `redeployCapabilities`
  handler also re-runs `ensureMcpConfigForProject` for every project and fires
  `skills:onChanged` so the catalogue refreshes. NOTE: extensions cannot yet
  *contribute* skills/MCP directly (only personas/teams via `ctx.personas`/`ctx.teams`,
  plus `mcpServers` string refs on a persona) — the button reloads the APP's
  bundled artifacts, not extension-contributed ones. Covered by
  `src/main/__tests__/redeploy-bundled-skills.test.ts`.

- **Auto-close-idle depends on the human-vs-agent write split + a triage cache.**
  `src/main/auto-close-idle.ts` (OFF by default; `autoCloseIdleEnabled` master
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
  `src/renderer/components/Sidebar.tsx` — auto-close-idle + Overseer) call
  `useData.setAutoCloseIdleEnabled` / `setOverseerMode`, which — UNLIKE the
  pure-local Settings mirrors (`setCloseIdleEnabled` et al., driven after the
  panel's own `config.set`) — write `AppConfig` themselves (optimistic flip →
  persist → roll back on failure). Both mirrors hydrate in `useData.init`. The
  Overseer rail toggle only flips `off`↔`on`; the full `off/dryRun/on` range
  stays in Settings, so keep the store field a tri-state, not a boolean.

- **Zana is a FULL DISK EXTENSION (`extensions/zana/`, main + renderer) whose data
  flows over MCP — no more native better-sqlite3.** The whole Zana feature is now
  ONE disk extension: `entry.main` (`main.mjs`, from `src/main-entry.ts` →
  `src/main/zana-main.ts`) and `entry.renderer` (`renderer.js`, from
  `src/renderer-entry.tsx`), dual-built by `vite.config.ts` (`BUILD_TARGET`
  main/renderer). It contributes a **project-tab-only** surface
  (`projectTab.global: false`) — no top-level sidebar entry — and scopes to
  `host.getActiveProject()`. The renderer source
  (`extensions/zana/src/renderer/*` — `ProjectTicketsView`, `TicketDetailModal`,
  `VersionSettings`, `ticketsStore`, `ticketsApi`, `zanaPrefs`, `ticketColumns`, …)
  moved verbatim out of the old `plugins/zana/renderer/*` (both `plugins/zana/`
  and the interim `extensions/zana-tickets/` are DELETED). Four load-bearing
  couplings: (1) **The 7 renderer-facing capabilities are mapped onto zana's MCP
  server, not SQLite.** `zana-main.ts` implements `getSnapshot` / `getTicket` /
  `getArtifact` / `listProfiles` / `getProfile` / `assignTicket` (the only write)
  / `getVersionInfo`, each calling the brokered `ctx.mcp('zana', <tool>, args, {
  projectPath | useGlobal })` capability — which forwards over the broker port to
  the host-managed MCP child pool (`src/main/zana/mcp-pool.ts`, see its own note).
  `getVersionInfo` additionally uses the brokered `ctx.exec`/`ctx.fetch` caps
  (npm query + registry fetch). The extension fails CLOSED if `ctx.mcp` is absent
  (throws at setup), and every read degrades to an empty/`null` result rather than
  throwing. (2) **The renderer reaches its OWN main child, not a core built-in.**
  The data seam `extensions/zana/src/renderer/ticketsApi.ts` calls
  `getHost().call(cap, arg)` (→ `window.cc.modules.call('<ext-id>', cap, [arg])`);
  the host bridge lives in the module-level `host-holder.ts` (twin of
  `host-react.ts`) primed by `activate({ host })`, because the `useTickets` zustand
  store is a module singleton and can't take `host` as a prop. `projectPath`/
  `useGlobal` remain ADVISORY hints — main (and the MCP pool's `resolveWorkspace`)
  re-authorizes every path (Rule 1/2). The dead `listSources`/`probeProjects`
  capabilities were dropped. (3) **Core is fully zana-free** — no `zana` in
  `MAIN_MODULES`/`APP_MODULES`, no Overview KPI line, no `zana-status` palette
  command, no `SettingsPanel` version section (the `@zana-ai/mcp` version check is
  the extension's own `settingsPanel`, `VersionSettings`). `RESERVED_BUILTIN_IDS`
  is now `['slack']`; the Rule-6 guard forbids the `'zana'` literal anywhere in
  `src/renderer` (see Rule 6). (4) **The extension bundles no CSS** — it styles via
  core's shared `gus-*`/`zana-*` classes (see the shared-CSS coupling note above);
  those class defs must NOT be deleted as "unused."

- **The host MCP child pool (`src/main/zana/mcp-pool.ts`) is a TRUSTED core
  subsystem — the transport zana's data rides on.** MCP-over-stdio is a persistent
  JSON-RPC session; the brokered one-shot process cap has no stdin stream, so the
  child pool CANNOT be owned by the sandboxed extension — it lives in core and the
  extension reaches it only through the narrow brokered `mcp` capability
  (permission token `mcp` + scope `mcpAllowlist`, gated in `PermissionBroker.decide`
  and forwarded by `broker-caps.ts`'s `mcp` cap → `McpPool.call`). The pool keeps
  per-workspace `zana-mcp-server` stdio children keyed by `(serverId, workspace)`,
  spawned with `env.ZANA_WORKSPACE = realpath(project root)` — the workspace hint is
  realpath-confined against a registered project BEFORE spawn (Rule 1/2), so a
  renderer/agent-supplied `projectPath` can't escape. It is bounded (`MAX_CHILDREN`,
  idle-TTL teardown, per-request timeout) and subscribed/disposed once at app init
  (wired in `index.ts`, disposed on shutdown — Rule 3). Bin resolution is robust
  (`ZANA_MCP_BIN` override → volta shim) and degrades gracefully: bin absent /
  handshake failure → `McpUnavailableError`, surfaced as an honest empty state, never
  a crash. This is the load-bearing architectural decision of the plugins→extensions
  migration: the feature module is a disk extension, the long-lived process
  management stays trusted in core.

- **Core is portable; integrations are extensions.** Do not add environment- or
  vendor-specific behavior to core files. The generic SSH parser
  (`src/main/ssh-config.ts`) and extension SSH-host-provider seam are the public
  integration points. An environment-specific integration belongs in a separately
  distributed extension, never in the app source tree.

- **Release artifacts are published to the PUBLIC repo github.com/salesforce/zana.**
  The auto-updater reads that public feed anonymously (no token, no VPN). When
  cutting a release, publish the new build there (`npm run release:mac` builds,
  notarizes, and publishes) so the auto-updater can offer it. See
  `docs/release-hosting.md` for the full release-hosting runbook.

- **The local-spawn argv/env assembly lives in `PtyManager.create()` and
  dispatches through the per-profile `LaunchProvider`; `spawn-plan.ts` is now the
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
  net is the regression contract** — `src/main/__tests__/pty-golden-argv.test.ts`
  snapshots `create()`'s `{command,args,env}` (UUIDs normalized to `<SID>`) across
  the profile × persona × projectSettings × scheduled × overseer × pinned-session ×
  heap-ceiling matrix; a diff in that `.snap` means you changed launch behavior —
  regenerate ONLY if that was intended. (3) **The historical import surface is
  preserved via re-exports** — `pty.ts` re-exports
  `personaArgs_build`/`cleanExtraArgs`/`extractPinnedSessionId`/`applyHeapCeiling`/
  `buildAutoModeSettings` from `./harness/spawn-plan.js` so the ~17 test files +
  `chat-runner.ts` that import them from `../pty.js` keep working; new code should
  import from `./harness/spawn-plan.js` directly. (4) **`buildRemoteCmd` shares the
  same pure helpers** (`resolveLaunch`, `computeAutoModeActive`,
  `resolveEffectiveModel`, `personaArgs_build`, `projectSettingsArgs`,
  `cleanExtraArgs`, `buildHookSettings`) but assembles its own remote precedence —
  so a change to a shared helper touches BOTH the local and remote spawn paths;
  keep them in lockstep (see the `pty.ts createRemote()` remote-parity hot-zone note).

- **Launch IDENTITY is registry-dispatched (`src/main/harness/registry.ts`), the
  `MAIN_MODULES` analogue for interactive harnesses (Rule 6).** Per-profile launch
  *identity* — the concrete provider id, tab title, capability descriptor, and base
  command/args — lives ONLY in the provider files (`harness/launch-provider.ts`:
  `claudeCodeProvider` serves the whole claude family, `shellProvider` serves
  `shell`) + the registry, NEVER re-inlined in core launch logic. Core resolves a
  profile via `providerForProfile(profile)` and reads `.title(...)` /
  `.capabilities(...)` / `.resolveBaseLaunch(...)`. This is DELIBERATELY BOUNDED
  (per `designs/harness-extraction-refreshed-strategy-2026-07-10.md`): the seam owns
  only identity; the byte-sensitive argv/env/hook ASSEMBLY stays in
  `PtyManager.create()` (drawing on `spawn-plan.ts`'s pure helpers — see the
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
  source-text guards protect the seam**: the new
  `harness-provider-registry.guard.test.ts` fails if the `'claude-code'` id or the
  `'claude --resume'` title literal reappears outside `harness/`, and the existing
  `src/shared/__tests__/launch-provider.guard.test.ts` still forbids a re-rolled
  `isClaudeProfile` triplet — so keep the two `-suffix` claude profile literals on
  SEPARATE lines in provider code (a one-line pair trips the dedup guard).

See [`docs/zana-core-merge.md`](docs/zana-core-merge.md) for the zana→core merge
migration + rollback notes **and the later re-extraction into the full
`extensions/zana/` disk extension (data over the host MCP pool)**, and
[`docs/releases/1.0.0.md`](docs/releases/1.0.0.md) for the current release's
change inventory (earlier: [`docs/releases/0.8.7.md`](docs/releases/0.8.7.md)).
