export const IPC = {
  startup: {
    state: 'startup:state',
    retry: 'startup:retry',
    diagnostics: 'startup:diagnostics',
    quit: 'startup:quit'
  },
  projects: {
    list: 'projects:list',
    add: 'projects:add',
    remove: 'projects:remove',
    update: 'projects:update',
    touch: 'projects:touch',
    reorder: 'projects:reorder',
    pickDirectory: 'projects:pickDirectory',
    addRemote: 'projects:addRemote',
    clone: 'projects:clone',
    cloneProgress: 'projects:cloneProgress',
    cloneRoot: 'projects:cloneRoot',
    ensureQuickAgent: 'projects:ensureQuickAgent',
    onChanged: 'projects:onChanged'
  },
  executionConsent: {
    listProject: 'executionConsent:listProject',
    revokeProject: 'executionConsent:revokeProject'
  },
  executionBoard: {
    listProject: 'executionBoard:listProject',
    snapshot: 'executionBoard:snapshot',
    readArtifact: 'executionBoard:readArtifact',
    dismiss: 'executionBoard:dismiss',
    stop: 'executionBoard:stop',
    retry: 'executionBoard:retry',
    retryWork: 'executionBoard:retryWork',
    releaseWork: 'executionBoard:releaseWork',
    reassignWork: 'executionBoard:reassignWork',
    respond: 'executionBoard:respond',
    resume: 'executionBoard:resume',
    retryDelivery: 'executionBoard:retryDelivery',
    clearResumeToken: 'executionBoard:clearResumeToken',
    relaunchMonitor: 'executionBoard:relaunchMonitor'
  },
  ssh: {
    listHosts: 'ssh:listHosts',
    syncHosts: 'ssh:syncHosts'
  },
  terminals: {
    list: 'terminals:list',
    verifyTmux: 'terminals:verifyTmux',
    listTmuxRestoreCandidates: 'terminals:listTmuxRestoreCandidates',
    create: 'terminals:create',
    restore: 'terminals:restore',
    /** Re-attach a remote tab whose local `ssh` proxy died during machine sleep.
     *  Main re-authorizes the (remote) project and spawns a fresh local pty that
     *  re-attaches the still-live `cc-<oldSessionId>` tmux session on the box. */
    reconnectRemote: 'terminals:reconnectRemote',
    write: 'terminals:write',
    reply: 'terminals:reply',
    resize: 'terminals:resize',
    close: 'terminals:close',
    /** One-shot fetch of a session's retained output tail, so a late-subscribing
     *  TerminalView (agent launched into the inspector modal / List-view monitor,
     *  which mounts after the pty already printed) can replay it into a fresh
     *  xterm instead of showing a blank buffer. */
    backlog: 'terminals:backlog',
    /** Summarize idle agents' work into ONE inbox entry before a bulk close
     *  (the Close-idle action's optional "leave a summary" step). */
    summarizeIdle: 'terminals:summarizeIdle',
    /** Summarize ONE live agent's work into an inbox entry on demand (the
     *  terminal modal's "Summarize to inbox" button). */
    summarizeSession: 'terminals:summarizeSession',
    /** Summarize agents' work into ONE folded inbox digest AND file a per-agent
     *  follow-up for any that left unfinished work, before the renderer closes
     *  them (the Agents view's "Close" button with "summarise first" + modal item). */
    closeFollowup: 'terminals:closeFollowup',
    /** Read-only, display-only stats distilled from a session's transcript
     *  (model, context tokens, cost, files touched, todo queue) for the Agent
     *  Monitor's status pane. Main authorizes via its own session record. */
    sessionStats: 'terminals:sessionStats',
    setHeadless: 'terminals:setHeadless',
    /** Toggle the per-agent Heartbeat opt-in (idle-nudge). Off for background
     *  agents; gated overall by the `heartbeatEnabled` master switch. */
    setHeartbeat: 'terminals:setHeartbeat',
    /** Advisory: the session id of the foreground/active tab (or null). Fire-and-
     *  forget renderer→main. Lets auto-close-idle spare the tab the user is
     *  actively viewing. Advisory only — it can spare, never authorize a close. */
    setActiveSession: 'terminals:setActiveSession',
    /** Advisory: the set of favorite (starred) agent keys. Fire-and-forget
     *  renderer→main. Lets auto-close-idle spare an agent the user pinned; it can
     *  spare, never authorize a close. */
    setFavorites: 'terminals:setFavorites',
    /** One-shot snapshot of every live session's agent state, to seed a freshly
     *  opened window (onAgentStatus is edge-triggered and would miss the last
     *  transition). */
    agentStatusSnapshot: 'terminals:agentStatusSnapshot',
    /** Cursor-based replay of agent-status transitions after `sinceSeq`. Returns
     *  either a replay of missed events (when no buffer gap) or a snapshot fallback
     *  (when the cursor is too old and the ring overflowed past it). Main validates
     *  and decides replay vs snapshot (Rule 1). */
    agentStatusSince: 'terminals:agentStatusSince',
    /** One-shot snapshot of every session with a live sub-agent (Task tool)
     *  count > 0, to seed a freshly opened window — `onSubagents` is
     *  edge-triggered and would otherwise miss a mid-flight count. */
    subagentSnapshot: 'terminals:subagentSnapshot',
    /** One-shot snapshot of every session with ≥1 captured sub-agent child
     *  record, as `[sessionId, SubagentChild[]]` pairs — seeds a freshly opened
     *  window; `onSubagentChildren` is edge-triggered like `onSubagents`. */
    subagentChildrenSnapshot: 'terminals:subagentChildrenSnapshot',
    onData: 'terminals:onData',
    onExit: 'terminals:onExit',
    /** Fired on machine wake (powerMonitor 'resume'). The renderer uses it to
     *  re-attach remote tabs whose `ssh` proxy died during sleep. No payload. */
    onWake: 'terminals:onWake',
    onTitle: 'terminals:onTitle',
    onUpdated: 'terminals:onUpdated',
    /** Live agent-state pushes (working/blocked/done/idle). Dedicated channel —
     *  kept off `onUpdated` so status ticks don't rebuild the session list. */
    onAgentStatus: 'terminals:onAgentStatus',
    /** Live sub-agent (Task tool) spawn count per session. Dedicated channel,
     *  kept off `onAgentStatus` so a sub-agent start/stop never rebuilds the
     *  status rollup — it only drives the parent session's sub-agent badge. */
    onSubagents: 'terminals:onSubagents',
    /** Live per-child sub-agent records per session (name/type + running/done).
     *  Dedicated channel like `onSubagents`; pushes the full child array on each
     *  change so the renderer slice is a trivial replace. */
    onSubagentChildren: 'terminals:onSubagentChildren',
    /** Idle-triage classifications (idle-agent add-on; off by default). Its own
     *  channel + store slice so it never rebuilds the status/session lists. */
    onIdleTriage: 'terminals:onIdleTriage',
    /** Catch-up summary pushes (catch-up-summary add-on; EXPERIMENTAL, off by
     *  default). Its own channel + store slice so a summary never rebuilds the
     *  status/session lists (same render-storm guard as onIdleTriage). */
    onCatchUpSummary: 'terminals:onCatchUpSummary',
    /** Generate a catch-up summary on demand for a live session (renderer-
     *  initiated "Refresh summary" gesture). Returns a CatchUpSummaryResult. */
    generateCatchUpSummary: 'terminals:generateCatchUpSummary',
    /** Clear a session's sticky "blocked / Needs you" overlay — a user gesture
     *  that re-tags a waiting agent as Idle. Main re-validates ownership then
     *  calls AgentStatusTracker.clearBlocked (the same drop the Stop hook uses). */
    clearAgentBlocked: 'terminals:clearAgentBlocked',
    /** Per-session Overseer activity rollup (auto-approve cascade; experimental,
     *  off by default). Its own channel + store slice so an auto-approval can't
     *  rebuild the status/session lists (same render-storm guard as onIdleTriage). */
    onOverseerActivity: 'terminals:onOverseerActivity'
  },
  overseer: {
    /** Recent Overseer decisions for the dry-run review pane (bounded by the
     *  audit ring's cap). Read-only diagnostic surface. */
    recent: 'overseer:recent'
  },
  config: {
    get: 'config:get',
    set: 'config:set',
    /** Broadcast to EVERY window after a `config:set` so other windows
     *  (per-project windows, the focus window) refresh their mirrored config
     *  flags live — without it a feature toggled off in one window keeps
     *  showing in the others until they reload. */
    onChanged: 'config:onChanged'
  },
  projectSettings: {
    get: 'projectSettings:get',
    set: 'projectSettings:set'
  },
  /**
   * Per-harness auth (Settings → Harness): a base URL + API token for each agent
   * CLI family (claude/codex/cursor), injected at spawn so a harness can auth
   * against a gateway/proxy WITHOUT running its own `login`. `status` returns the
   * (non-secret) base URL + a `hasToken` boolean per family — NEVER the token
   * (Rule 1: the secret never crosses back to the renderer). `set` stores/clears
   * a family's base URL and/or token (token encrypted at rest via safeStorage).
   */
  harnessAuth: {
    status: 'harnessAuth:status',
    set: 'harnessAuth:set'
  },
  /**
   * Code-harness verification (Settings → Code Harness): probe each harness
   * family's `<binary> --version` on demand. Read-only detection; main owns the
   * truth (resolves the binary, runs the probe best-effort), the renderer just
   * displays the enabled × installed matrix and gates the profile picker on it.
   */
  harness: {
    verify: 'harness:verify',
    descriptors: 'harness:descriptors',
    agentDescriptors: 'harness:agentDescriptors',
    effectiveDefault: 'harness:effectiveDefault'
  },
  /**
   * External-editor verification (Settings → Editor): probe each editor's
   * `<shim> --version` on demand. Read-only detection twin of `harness.verify`;
   * main owns the truth, the renderer displays the install matrix.
   */
  editor: {
    verify: 'editor:verify'
  },
  claude: {
    listSessions: 'claude:listSessions'
  },
  opencode: {
    listSessions: 'opencode:listSessions'
  },
  history: {
    start: 'history:start',
    refresh: 'history:refresh',
    page: 'history:page',
    release: 'history:release',
    resume: 'history:resume'
  },
  fs: {
    /** Opens the native OS file chooser in main; the renderer never supplies a path. */
    pickFiles: 'fs:pickFiles',
    listDir: 'fs:listDir',
    readFile: 'fs:readFile',
    resolveDoc: 'fs:resolveDoc',
    writeFile: 'fs:writeFile',
    walkFiles: 'fs:walkFiles',
    searchFiles: 'fs:searchFiles',
    readDataUrl: 'fs:readDataUrl',
    createFile: 'fs:createFile',
    createDir: 'fs:createDir',
    rename: 'fs:rename',
    delete: 'fs:delete',
    remoteRoot: 'fs:remoteRoot',
    listDirRemote: 'fs:listDirRemote',
    readFileRemote: 'fs:readFileRemote',
    writeFileRemote: 'fs:writeFileRemote',
    createFileRemote: 'fs:createFileRemote',
    createDirRemote: 'fs:createDirRemote',
    renameRemote: 'fs:renameRemote',
    deleteRemote: 'fs:deleteRemote',
    uploadToRemote: 'fs:uploadToRemote',
    downloadFromRemote: 'fs:downloadFromRemote'
  },
  executionSources: {
    pick: 'executionSources:pick'
  },
  openers: {
    openIn: 'openers:openIn'
  },
  clipboard: {
    writeText: 'clipboard:writeText'
  },
  git: {
    status: 'git:status',
    showHead: 'git:showHead',
    discard: 'git:discard',
    previewCommit: 'git:previewCommit',
    commitProject: 'git:commitProject',
    pushProject: 'git:pushProject',
    isRepo: 'git:isRepo',
    listWorktrees: 'git:listWorktrees',
    listBranches: 'git:listBranches',
    removeWorktree: 'git:removeWorktree'
  },
  inbox: {
    history: 'inbox:history',
    delete: 'inbox:delete',
    deleteMany: 'inbox:deleteMany',
    exportPdf: 'inbox:exportPdf',
    summarize: 'inbox:summarize',
    summarizeDetailed: 'inbox:summarizeDetailed',
    classifyNoise: 'inbox:classifyNoise',
    onAppended: 'inbox:onAppended',
    onRemoved: 'inbox:onRemoved',
    onUpdated: 'inbox:onUpdated',
    onPruned: 'inbox:onPruned'
  },
  /**
   * Usage / cost rollup (WARP R2 B7). `getSummary` computes a privacy-safe
   * {@link UsageSummary} across all registered projects from their Claude
   * transcripts (main-only read, bounded). Data layer only — the dashboard view
   * lands in a follow-up PR.
   */
  usage: {
    getSummary: 'usage:getSummary'
  },
  /**
   * Suggested Actions launcher (afl-03). `list` reads the store scoped to a
   * project; `dismiss` removes one; `run` executes the (main-re-authorized)
   * action and returns any renderer nav directive. The `on*` pushes mirror the
   * inbox's live-update channels.
   */
  suggestions: {
    list: 'suggestions:list',
    dismiss: 'suggestions:dismiss',
    run: 'suggestions:run',
    onAppended: 'suggestions:onAppended',
    onRemoved: 'suggestions:onRemoved',
    onUpdated: 'suggestions:onUpdated',
    onPruned: 'suggestions:onPruned'
  },
  saved: {
    save: 'saved:save',
    list: 'saved:list',
    delete: 'saved:delete',
    onChanged: 'saved:onChanged'
  },
  /**
   * Inter-agent mesh (registry + message activity), read-only for the renderer.
   * `list` returns the live registry; `messages` returns the agent↔agent audit
   * history (NOT the user inbox). `onRegistryChanged` fires on any
   * register/seed/drop; `onMessage` fires per agent→agent send. Kept distinct
   * from `inbox:` — that channel is agent→User; this one is agent↔agent.
   */
  agents: {
    list: 'agents:list',
    messages: 'agents:messages',
    onRegistryChanged: 'agents:onRegistryChanged',
    onMessage: 'agents:onMessage',
    onMessagesPruned: 'agents:onMessagesPruned'
  },
  library: {
    list: 'library:list',
    add: 'library:add',
    update: 'library:update',
    remove: 'library:remove',
    reveal: 'library:reveal',
    search: 'library:search',
    read: 'library:read',
    write: 'library:write',
    createFolder: 'library:createFolder',
    move: 'library:move',
    deleteEntry: 'library:deleteEntry',
    onChanged: 'library:onChanged'
  },
  mcp: {
    list: 'mcp:list',
    setEnabled: 'mcp:setEnabled',
    listAll: 'mcp:listAll',
    setEnabledById: 'mcp:setEnabledById',
    reveal: 'mcp:reveal',
    onChanged: 'mcp:onChanged'
  },
  plugins: {
    list: 'plugins:list',
    setEnabled: 'plugins:setEnabled',
    reveal: 'plugins:reveal',
    onChanged: 'plugins:onChanged'
  },
  /**
   * Runtime extensions under `~/.zcc/extensions/<id>/`. Mirrors the
   * `plugins:` shape. `readRendererEntry` returns the extension's renderer
   * bundle JS as a string for the renderer to blob-import (P1-C).
   */
  extensions: {
    list: 'extensions:list',
    setEnabled: 'extensions:setEnabled',
    reveal: 'extensions:reveal',
    readRendererEntry: 'extensions:readRendererEntry',
    onChanged: 'extensions:onChanged',
    // P3-D: persist the user's consent to an extension's CURRENT declared
    // permissions, then re-discover (which spawns/mounts it). The renderer reads
    // `consented`/`needsConsent` on each ExtensionEntry to decide when to prompt.
    grantConsent: 'extensions:grantConsent',
    // Declare an extra permission in the extension's manifest (user "add
    // permission" / Doctor repair). WIDENS only — re-discovery then re-prompts
    // consent; it is never auto-granted.
    addPermission: 'extensions:addPermission',
    // Remove a declared permission from the extension's manifest AND prune it
    // from the consent record. NARROWING is silent (no re-prompt); pruning the
    // approved snapshot preserves the re-prompt-on-readd guarantee.
    removePermission: 'extensions:removePermission',
    // Tear down a disk extension's child and spawn a fresh one — recovery from a
    // crashed/hung backend without an app restart. Backs ModuleHost.relaunchSelf
    // (scoped to the caller) and the Extensions panel's per-extension restart.
    relaunch: 'extensions:relaunch',
    // Re-scan `~/.zcc/extensions` and reconcile live children WITHOUT an app
    // restart — spawn newly-appeared/consented exts, respawn changed ones,
    // tear down removed ones. The explicit "Reload" button + the file-watcher's
    // debounced trigger both invoke this. Takes no renderer data (re-reads disk).
    rescan: 'extensions:rescan',
    // Install an extension on demand without rebuilding the app: from a
    // user-picked local dir / archive (main opens the OS picker — a renderer
    // path is never trusted) or from a marketplace release id. Validation +
    // atomic install happen in main.
    install: 'extensions:install',
    // Remove an installed extension: tear down its live child, delete its
    // (containment-checked) install dir, and forget its consent. Renderer passes
    // only an id — main re-derives + confines the path before deleting.
    uninstall: 'extensions:uninstall',
    // Manually check the (opt-in) remote registry for updates to installed
    // extensions and apply every compatible, non-permission-widening release.
    checkUpdates: 'extensions:checkUpdates',
    // Fetch the (opt-in) marketplace index and return browsable entries stamped
    // with installed / hasUpdate / compatible. Returns [] when no registry is
    // configured — the host never reaches the network by default.
    marketplaceList: 'extensions:marketplaceList',
    // Create a new LOCAL (in-app authored) extension: main mints a unique id,
    // scaffolds a starter template into a scratch working dir, packs + installs
    // it (through the same trust gates as any install), and records it in
    // local.json. Returns the minted id + working dir so the renderer can launch
    // the Creator agent against it. Subject to the SAME consent — no fast-path.
    createLocal: 'extensions:createLocal',
    // Adopt a user-picked existing extension source directory as a local editable
    // extension. Main owns the picker and records the canonical source path.
    adoptLocal: 'extensions:adoptLocal',
    // Clone an extension repository into the local extension workspace and
    // register its manifest directory as editable source.
    adoptLocalGit: 'extensions:adoptLocalGit',
    // Re-pack + reinstall a local extension from its recorded source working dir
    // ("Reload from source"). Renderer passes only an id; main RE-DERIVES the
    // working dir from local.json (never renderer/agent free-text — Rule 1).
    reinstallLocal: 'extensions:reinstallLocal',
    // Read the source working dir + scratch project for a local extension, so the
    // renderer can re-open the Creator agent against it ("Continue building").
    // Main re-derives from local.json (Rule 1); a non-local id returns an error.
    localInfo: 'extensions:localInfo',
    // Assemble a clean git-ready export of a local extension under <workingDir>/
    // share (manifest + dist/ + a generated README) and reveal it ("Prepare for
    // sharing"). Main re-derives the working dir from local.json (Rule 1).
    prepareShare: 'extensions:prepareShare',
    // Re-clone + reinstall a GIT extension from its recorded source repo ("Update
    // from repo"). Renderer passes only an id; main RE-DERIVES {url, ref} from
    // git.json (never renderer/agent free-text — Rule 1). Same gates + scrub as a
    // fresh git install; a scope-widening update re-prompts consent.
    reinstallFromGit: 'extensions:reinstallFromGit',
    // Fire-and-forget progress lines from an in-flight git install/update
    // (main → renderer), so the install dialog can show clone progress. Distinct
    // from projects:cloneProgress (project clone) even though both stream git.
    installProgress: 'extensions:installProgress',
    // Redeploy the app's runtime-deployed capability artifacts on demand: re-run
    // every bundled SKILL.md installer (into ~/.claude/skills) and re-sync each
    // project's `.mcp.json`. These normally deploy at boot; this is the explicit
    // "Reload skills & MCP" button so a shipped-content bump (or a stray manual
    // edit) can be re-applied without an app restart. Idempotent + best-effort;
    // takes no renderer data (re-reads the bundled roster + the project list).
    redeployCapabilities: 'extensions:redeployCapabilities'
  },
  claudeSettings: {
    read: 'claudeSettings:read',
    write: 'claudeSettings:write',
    openFile: 'claudeSettings:openFile'
  },
  codexSettings: {
    read: 'codexSettings:read',
    write: 'codexSettings:write'
  },
  openCodeSettings: {
    read: 'openCodeSettings:read',
    write: 'openCodeSettings:write'
  },
  authorizations: {
    apply: 'authorizations:apply'
  },
  skills: {
    list: 'skills:list',
    setEnabled: 'skills:setEnabled',
    setManyEnabled: 'skills:setManyEnabled',
    readHooks: 'skills:readHooks',
    reveal: 'skills:reveal',
    onChanged: 'skills:onChanged',
    bundles: {
      list: 'skills:bundles:list',
      create: 'skills:bundles:create',
      update: 'skills:bundles:update',
      delete: 'skills:bundles:delete',
      apply: 'skills:bundles:apply',
      onChanged: 'skills:bundles:onChanged'
    }
  },
  commands: {
    list: 'commands:list'
  },
  app: {
    homedir: 'app:homedir',
    version: 'app:version',
    microVmSupported: 'app:microVmSupported',
    setFullScreen: 'app:setFullScreen',
    isFullScreen: 'app:isFullScreen',
    onFullScreenChanged: 'app:onFullScreenChanged'
  },
  /**
   * Menu-bar popover surface (macOS frameless-card tray, behind
   * `menubarPopoverEnabled`). `request`/`focusSession`/`setFavorite`/`open`/
   * `hide`/`quit` are popover→main requests, each main-authorized (Rule 1);
   * `onSnapshot` is a main→popover push of the live fleet snapshot. See
   * `src/main/menubar.ts`.
   */
  menubar: {
    request: 'menubar:request',
    onSnapshot: 'menubar:onSnapshot',
    focusSession: 'menubar:focusSession',
    setFavorite: 'menubar:setFavorite',
    /**
     * Light-interaction WRITE path: reply to a blocked agent's parked question
     * from the popover without opening the app. Main re-authorizes the session
     * from its own record, refuses background (scheduled/headless) + non-live
     * sessions, and bounds/sanitizes the text before writing to the pty (Rule 1).
     */
    reply: 'menubar:reply',
    open: 'menubar:open',
    hide: 'menubar:hide',
    quit: 'menubar:quit'
  },
  /**
   * Multi-window control. `openProject` asks main to open (or focus) a window
   * locked to a single project — the gesture behind "Open in New Window". Main
   * validates the projectId against the store before opening (the renderer is
   * untrusted) and de-dupes against any window already showing that project.
   */
  windows: {
    openProject: 'windows:openProject'
  },
  /**
   * Auto-update (electron-updater), notify-only. `check`/`download`/`skip`/
   * `quitAndInstall` are renderer→main requests; `onStatus`/`onProgress` are
   * main→renderer pushes driven by the autoUpdater event stream. Nothing
   * downloads until `download` is called (the user opts in). Only core can push
   * (modules can't), so this lives here rather than in a module.
   */
  updates: {
    check: 'updates:check',
    download: 'updates:download',
    skip: 'updates:skip',
    quitAndInstall: 'updates:quitAndInstall',
    simulate: 'updates:simulate',
    getStatus: 'updates:getStatus',
    onStatus: 'updates:onStatus',
    onProgress: 'updates:onProgress',
    /**
     * Curated in-app release notes ("What's New"). `getReleaseNotes` returns the
     * bundled `docs/releases/*.md` parsed into `ReleaseNote[]`, newest-first,
     * optionally clamped to a version range (args advisory — main clamps to the
     * versions that actually ship, Rule 1). `consumeWhatsNew` is the race-free
     * pull the renderer makes on mount: main computes the pending
     * `(lastSeenVersion, current]` window at boot but only ADVANCES the baseline
     * when the renderer consumes it, so the modal can't be missed by a
     * late-attaching listener and fires exactly once.
     */
    getReleaseNotes: 'updates:getReleaseNotes',
    consumeWhatsNew: 'updates:consumeWhatsNew'
  },
  /**
   * First-run dependency doctor (src/main/dependency-doctor.ts): detect the
   * companion CLIs / MCP / plugins / extensions and auto-install the ones we
   * can. `onStatus` pushes the setup snapshot; `onProgress` streams per-step
   * install log lines — mirrors the updates channel pair.
   */
  deps: {
    get: 'deps:get',
    check: 'deps:check',
    install: 'deps:install',
    dismiss: 'deps:dismiss',
    onStatus: 'deps:onStatus',
    onProgress: 'deps:onProgress'
  },
  /**
   * Generic multiplexer for app modules (plugins/*). One channel pair for
   * all modules: `call` dispatches `{ moduleId, capability, args }` to the
   * module's main-side capability map; `storage*` back `ModuleHost.storage`.
   * Modules add nothing else to this file.
   */
  modules: {
    call: 'modules:call',
    storageGet: 'modules:storageGet',
    storageSet: 'modules:storageSet',
    pushInbox: 'modules:pushInbox',
    /**
     * The `ctx.stream` push direction (SDK streaming capability, wiring (a)):
     * the core-owned StreamRelay pushes live frames / the terminal signal
     * core→renderer directly, keyed by the opaque `subId` the broker minted.
     * These are the FIRST main→renderer push channels for an extension surface —
     * they carry NO renderer→main request; `stream.open`/`stream.close` ride the
     * existing broker port (child→host), not IPC.
     */
    streamFrame: 'modules:streamFrame',
    streamDone: 'modules:streamDone',
    /**
     * W1-4 trust inversion: a MAIN module asks the SHELL to perform a
     * renderer-only action (toast / navigate / select a project / launch). The
     * core-owned HostCommandRelay pushes the command here core→renderer, keyed by
     * the AUTHENTICATED moduleId. `hostCommand` is the ephemeral push; a PARKED
     * launch is durable — it's queued in main and pulled via
     * `drainParkedLaunches` (on panel mount + on each `launchParked` nudge) so a
     * launch requested while no panel is listening is never dropped.
     */
    hostCommand: 'modules:hostCommand',
    drainParkedLaunches: 'modules:drainParkedLaunches',
    /**
     * W1-5 main-reachable host UX: the renderer replies the human's answer to a
     * `confirm`/`notify` dialog a MAIN module requested (pushed via `hostCommand`)
     * back to main, keyed by the dialog's `requestId`, so the HostCommandRelay can
     * resolve the child's pending broker Promise. A late/unknown requestId is a
     * no-op (the relay already failed it closed on window loss / child exit).
     */
    replyHostDialog: 'modules:replyHostDialog'
  },
  scheduler: {
    list: 'scheduler:list',
    create: 'scheduler:create',
    update: 'scheduler:update',
    delete: 'scheduler:delete',
    setEnabled: 'scheduler:setEnabled',
    runNow: 'scheduler:runNow',
    onChanged: 'scheduler:onChanged',
    listTemplates: 'scheduler:listTemplates',
    onTemplatesChanged: 'scheduler:onTemplatesChanged',
    revealTemplatesDir: 'scheduler:revealTemplatesDir',
    groupsList: 'scheduler:groups:list',
    groupsCreate: 'scheduler:groups:create',
    groupsUpdate: 'scheduler:groups:update',
    groupsDelete: 'scheduler:groups:delete',
    groupsReorder: 'scheduler:groups:reorder',
    groupsOnChanged: 'scheduler:groups:onChanged'
  },
  goals: {
    list: 'goals:list',
    create: 'goals:create',
    update: 'goals:update',
    delete: 'goals:delete',
    setStatus: 'goals:setStatus',
    runNow: 'goals:runNow',
    onChanged: 'goals:onChanged'
  },
  followups: {
    list: 'followups:list',
    create: 'followups:create',
    update: 'followups:update',
    delete: 'followups:delete',
    setStatus: 'followups:setStatus',
    markSpawned: 'followups:markSpawned',
    onChanged: 'followups:onChanged'
  },
  // Per-project Activity Feed — a read-only, chronological history of what
  // happened on a project (sessions finished, reports, follow-ups/goals
  // resolved, library docs, commits, extension lifecycle). Derived on demand by
  // main from its own stores + git; a small greenfield slice (commits/extension/
  // project lifecycle) is persisted. `list` reads a page; `refresh` re-derives
  // (re-reads git); `digest` runs the LLM weekly recap; `onChanged` pushes when
  // the persisted slice mutates so an open feed re-fetches.
  feed: {
    list: 'feed:list',
    refresh: 'feed:refresh',
    digest: 'feed:digest',
    onChanged: 'feed:onChanged'
  },
  personas: {
    list: 'personas:list',
    onChanged: 'personas:onChanged',
    revealDir: 'personas:revealDir',
    save: 'personas:save',
    duplicate: 'personas:duplicate',
    delete: 'personas:delete'
  },
  teams: {
    list: 'teams:list',
    onChanged: 'teams:onChanged',
    revealDir: 'teams:revealDir',
    save: 'teams:save',
    duplicate: 'teams:duplicate',
    delete: 'teams:delete',
    launch: 'teams:launch',
    cancel: 'teams:cancel',
    startJob: 'teams:startJob',
    launchAutonomous: 'teams:launchAutonomous',
    stopAutonomous: 'teams:stopAutonomous',
    exportBundle: 'teams:exportBundle',
    importBundle: 'teams:importBundle'
  },
  /** In-memory autonomous team runs (orchestrator + workers driven to a goal). */
  autonomousRuns: {
    list: 'autonomousRuns:list',
    onChanged: 'autonomousRuns:onChanged'
  },
  quickPrompts: {
    list: 'quickPrompts:list',
    save: 'quickPrompts:save',
    delete: 'quickPrompts:delete',
    onChanged: 'quickPrompts:onChanged',
    revealDir: 'quickPrompts:revealDir'
  },
  llmPrompts: {
    list: 'llmPrompts:list',
    save: 'llmPrompts:save',
    delete: 'llmPrompts:delete',
    test: 'llmPrompts:test',
    revealDir: 'llmPrompts:revealDir',
    availableProviders: 'llmPrompts:availableProviders',
    onChanged: 'llmPrompts:onChanged'
  },
  voice: {
    transcribe: 'voice:transcribe',
    hasApiKey: 'voice:hasApiKey',
    ensureMicAccess: 'voice:ensureMicAccess'
  },
  /**
   * E2E test-observability surface (GATED, inert in production).
   *
   * These handlers are registered ONLY when `process.env.ZCC_E2E` is set at boot
   * (see `src/main/index.ts`), and the matching `window.__zccTest` bridge exists
   * ONLY when the preload sees the `--zcc-e2e` arg. With the flag off the channels
   * are never registered — there is no surface at all. Backed by the ring buffer
   * in `src/main/test-tap.ts`; used by the e2e SDK (`e2e/sdk/events.ts`).
   */
  test: {
    /** (cursor:number) => { entries: TapEntry[]; cursor:number } — drain new events/logs. */
    drainEvents: 'test:drainEvents',
    /** () => { seq:number; size:number; cap:number } — ring stats/current cursor. */
    snapshot: 'test:snapshot',
    /** () => void — clear the ring (seq stays monotonic). */
    reset: 'test:reset',
    /** E2E only: resolve a live session's already-issued MCP URL. */
    mcpRoute: 'test:mcpRoute'
  }
} as const;
