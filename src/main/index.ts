import {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  screen,
  Menu,
  nativeImage,
  powerMonitor,
  powerSaveBlocker,
  session,
  nativeTheme,
  systemPreferences,
  Notification,
  clipboard,
  type MessageBoxOptions
} from 'electron';
import { join, isAbsolute, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative } from 'node:path';
import { IPC } from '../shared/ipc.js';
import { sanitizeExtraArgs } from '../shared/launch-sanitize.js';
import { providerCapabilities, isClaudeProfile, isCodexProfile, isOpenCodeProfile, seedPromptArgs } from '../shared/launch-provider.js';
import { store, scratchWorkspaceRoot, worktreeRoot, worktreeTargetDir } from './store.js';
import { PtyManager } from './pty.js';
import { resolveMaxLiveSessions } from './launch/capacity.js';
import { revalidateLaunchCommit as revalidateCommonLaunchCommit } from './launch/commit-revalidation.js';
import { LaunchAuthorizationService } from './launch/authorization.js';
import { createLaunchCoordinator, LaunchSpawnError } from './launch/coordinator.js';
import { createLaunchLedgerStore } from './launch/ledger-store.js';
import { finalizeLaunchPreflight, preflightLaunch } from './launch/preflight.js';
import { launchDigest } from './launch/digest.js';
import { preflightTerminalExecution } from './launch/execution-routing.js';
import { createRestoreCapabilityStore } from './launch/restore-capability-store.js';
import { createTeamLifecycleIntegration, createTeamLifecycleStore } from './launch/team-lifecycle-store.js';
import { createExecutionStore } from './execution/store.js';
import { projectExecutionProjection } from './execution/projection.js';
import { SquadExecutionService } from './execution/service.js';
import { createExecutionArtifactStore } from './execution/artifact-store.js';
import { createExecutionHandoffStore } from './execution/handoff-store.js';
import { createResumeGrantStore } from './execution/resume-grant-store.js';
import { createResumeTokenStore } from './execution/resume-token-store.js';
import { relaunchExecutionMonitor } from './execution/relaunch-monitor.js';
import { preflightWorkflowProfile } from './squad-bundle.js';
import { bindLaunchPrincipal, type LaunchAuthorizationBinding, type LaunchPrincipal, type LaunchPrincipalRef } from './launch/types.js';
import type { TerminalLaunchOptions } from './launch/terminal-launcher.js';
import * as testTap from './test-tap.js';
import { AgentStatusTracker } from './agent-status.js';
import { OutputActivityMonitor } from './output-activity.js';
import { ScreenScanBlockedDetector } from './screen-scan-blocked-detector.js';
import { HARNESS_REGISTRATIONS, providerFor, registrationFor, harnessAdapterDescriptorsFromVerify, refreshDynamicHarnessCatalogs } from './harness/registry.js';
import { createExecutionConsentStore } from './harness/execution-consent-store.js';
import { createExecutionConsentManagement } from './harness/execution-consent-management.js';
import { ExecutionConsentService } from './harness/execution-consent.js';
import { showExecutionConsentDialog } from './harness/execution-consent-dialog.js';
import { runHarnessRoutingMigration } from './harness-routing-migration/migrator.js';
import { MigrationRepairRequiredError } from './harness-routing-migration/journal.js';
import { runStartupGate, type StartupState } from './startup-gate.js';
import { resolveLaunchSelection } from './harness/launch-selection.js';
import { resolveEffectiveHarnessDefault } from './harness/effective-default.js';
import { resolveExecutionState } from './harness/target-resolution.js';
import { listClaudeSessions } from './claude.js';
import { listOpenCodeSessions } from './opencode-sessions.js';
import { ConversationHistoryService } from './conversation-history.js';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, walkFiles, searchFiles, readDataUrl, createFile as fsCreateFile, createDir as fsCreateDir, renamePath as fsRename, deletePath as fsDelete, resolveDoc as fsResolveDoc, confine } from './fs.js';
import {
  remoteRoot as fsRemoteRoot,
  listDirRemote as fsListDirRemote,
  readFileRemote as fsReadFileRemote,
  writeFileRemote as fsWriteFileRemote,
  createFileRemote as fsCreateFileRemote,
  createDirRemote as fsCreateDirRemote,
  renameRemote as fsRenameRemote,
  deleteRemote as fsDeleteRemote,
  execRemote as fsExecRemote,
  resolveAndExecRemote
} from './remote-fs.js';
import { uploadToRemote as fsUploadToRemote, downloadFromRemote as fsDownloadFromRemote } from './remote-transfer.js';
import { openIn } from './openers.js';
import {
  getGitStatus,
  showHead,
  discardChanges,
  listWorktrees,
  listBranches,
  gitCommonDir,
  getRecentCommits,
  isGitRepo,
  createWorktree,
  removeWorktree,
  withWorktreeLock,
  worktreeState,
  sanitizeBranchSlug,
  previewProjectCommit,
  commitProjectChanges,
  pushProjectBranch
} from './git.js';
import { cloneProject } from './git-clone.js';
import { createInboxStore, type IInboxStore, type InboxEntry } from './inbox-store.js';
import {
  createSuggestionsStore,
  type ISuggestionsStore,
  type Suggestion
} from './suggestions-store.js';
import { runSuggestion } from './run-suggestion.js';
import { mapAskUserQuestion, type AskUserQuestionInput } from './ask-user-question-schema.js';
import {
  agentLabel,
  createAgentRegistryStore,
  type IAgentRegistryStore
} from './agent-registry-store.js';
import { createAgentMessageLog, type IAgentMessageLog } from './agent-message-log.js';
import { killLocalTmuxSession, listLocalTmuxSessionIds, reapOrphanTmuxSessions, verifyTmux } from './tmux.js';
import { exportInboxPdf } from './inbox-pdf.js';
import { createSavedStore, type ISavedStore } from './saved-store.js';
import type { SavedRecord, SavedRecordInput } from '../shared/types.js';
import type { ConversationHistorySnapshot } from '../shared/types.js';
import type { CancelTeamLaunchResult, LaunchTeamResult, TeamLaunchAuthorizationInputSlot, TeamLaunchAuthorizationResult, TeamLaunchRequestInput, TeamFailedWorkerSlot, TeamLaunchedWorker } from '../shared/types.js';
import type { SubagentChild } from '../shared/types.js';
import type { FeedEvent, FeedEventInput, FeedDigestResult } from '../shared/types.js';
import type { LlmPromptEntry, LlmRunResult } from '../shared/types.js';
import type { QuickPrompt } from '../shared/types.js';
import type { InboxOrigin } from '../shared/types.js';
import { LibraryStore, type ILibraryStore } from './library-store.js';
import { createBoundsStateController, restoreWindowState } from './bounds-state.js';
import type { LibraryDoc, LibraryAddInput, LibraryScope } from '../shared/types.js';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { readMcpPort, writeMcpPort } from './mcp-port-store.js';
import { startControlPlane, type ControlPlaneHandle } from './control-plane.js';
import { controlCredentialForSession, verifySessionControlCredential } from './control-credential.js';
import { ensureMcpConfigForProject, rebuildExtensionServers } from './mcp-config.js';
import { redeployBundledSkills, syncExtensionSkills, removeSkillsForExtension } from './skill-installer.js';
import { listMcpServers, setMcpServerEnabled } from './mcp.js';
import {
  listMcpServersAll,
  revealMcpServer,
  setMcpServerEnabledById
} from './mcp-catalogue.js';
import { listPlugins, revealPlugin, setPluginEnabled } from './plugins.js';
import { claudeProjectFilePath, readClaudeProjectSettings, writeClaudeProjectSettings } from './claude-settings.js';
import { applyAuthorizations } from './authorizations.js';
import {
  listSkills,
  setSkillEnabled,
  setManyEnabled as setManySkillsEnabled,
  readHooks,
  revealSkillDir
} from './skills.js';
import { SkillBundlesStore } from './skill-bundles-store.js';
import { listCommands } from './commands.js';
import { ScheduleGroupsStore } from './schedule-groups-store.js';
import { watch as fsWatch, mkdirSync, type FSWatcher } from 'node:fs';
import { rm } from 'node:fs/promises';
import { parseSshConfig } from './ssh-config.js';
import {
  SshHostProviderRegistry,
  asSshHosts,
  asSshSyncResult,
  mergeSshHosts
} from './extensions/ssh-host-provider-registry.js';
import { ensureProcessPath } from './env.js';
import { SchedulerManager } from './scheduler.js';
import { GoalManager } from './goal-manager.js';
import { FollowUpManager } from './followup-manager.js';
import { readClaudeLoops } from './claude-loops-store.js';
import { TrayController } from './tray.js';
import { MenubarController, isRepliable } from './menubar.js';
import { createUpdater, type Updater } from './updater.js';
import { getReleaseNotes } from './release-notes.js';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';
import { createDoctor, hasMissingDeps, type Doctor } from './dependency-doctor.js';
import { TemplateStore } from './template-store.js';
import { QuickPromptStore } from './quick-prompt-store.js';
import { resolveRulesGuidance } from './rules-file.js';
import { PromptRegistry } from './prompt-registry.js';
import { LlmService } from './llm-service.js';
import { VoiceService } from './voice-service.js';
import { OpenAiVoiceProvider } from './voice/openai-provider.js';
import { getOpenAiKey, getGeminiKey } from './voice/secrets.js';
import { IdleTriageService } from './idle-triage.js';
import { HeldQuestionService, HELD_QUESTION_MAX_HOLD_MS } from './held-questions.js';
import { CatchUpSummaryService } from './catch-up-summary.js';
import { AutoReportLinkerService } from './auto-report-linker.js';
import { Overseer, type OverseerToolEvent } from './overseer.js';
import { OverseerAuditRing } from './overseer-audit.js';
import { ContentScreen, type ContentScreenEvent, buildWarningText } from './content-screen.js';
import { HeartbeatService } from './heartbeat.js';
import { LocalExtensionWatcher } from './local-extension-watcher.js';
import { AutonomousRunSupervisor, AUTONOMOUS_DEFAULTS } from './autonomous-run-supervisor.js';
import { AutoCloseIdleService } from './auto-close-idle.js';
import { AgentMailDrainService } from './agent-mail-drain.js';
import { KeepAwakeService, KEEP_AWAKE_DEFAULT_GRACE_MS } from './keep-awake.js';
import { CloseSummaryService } from './close-summary.js';
import { InboxSummaryService } from './inbox-summary.js';
import { UsageService } from './usage-service.js';
import type { UsageSummary } from '../shared/telemetry-events.js';
import { FeedNoiseClassifier } from './feed-noise-classifier.js';
import { FeedStore } from './feed-store.js';
import { FeedService } from './feed-service.js';
import { FeedSummaryService } from './feed-summary.js';
import {
  transcriptPath,
  readSessionStats,
  type SessionStats
} from './harness/claude/transcript-reader.js';
import { TranscriptSource } from './transcript-source.js';
import { ClaudeCliProvider } from './llm/claude-cli-provider.js';
import { OpenAiProvider } from './llm/openai-provider.js';
import { GeminiProvider } from './llm/gemini-provider.js';
import type { LlmProvider } from './llm/provider.js';
import type { LlmProviderId } from '../shared/types.js';
import type { HarnessAuthKey, HarnessAuthStatusInfo } from '../shared/types.js';
import { getHarnessAuthStatus, setHarnessAuth } from './harness-auth.js';
import { microVmPlatformSupported } from './harness/microvm-environment.js';
import { verifyHarnesses } from './harness/harness-verify.js';
import { verifyEditors } from './editor-verify.js';
import { PersonaStore, resolvePersonaLaunch } from './persona-store.js';
import { TeamStore } from './team-store.js';
import { buildSquadBundle, validateSquadBundle } from './squad-bundle.js';
import { PersonaTeamRegistry, TEAM_SLOT_MAX } from './extensions/persona-team-registry.js';
import { MainModuleHost } from './modules/registry.js';
import { loadExtensions } from './extensions/loader.js';
import { ExtensionProcessHost, type DiskExtensionSpec } from './extensions/process-host.js';
import { spawnUtilityChild } from './extensions/spawn-child.js';
import { ModuleRouter } from './extensions/module-router.js';
import { PermissionBroker, grantFromManifest } from './extensions/permission-broker.js';
import { ReviewerBroker } from './extensions/reviewer-broker.js';
import { ReviewerApprovalService } from './reviewer-approval.js';
import { createBrokerCapabilities } from './extensions/broker-caps.js';
import { pushInboxOnBehalfOf } from './extensions/inbox-broker.js';
import { McpPool, ZANA_SERVER_DEF } from './zana/mcp-pool.js';
import { MicroVmPool } from './microvm/pool.js';
import { StreamRelay } from './extensions/stream-relay.js';
import { HostCommandRelay } from './extensions/host-command-relay.js';
import { resolveProjectRoot } from './resolve-project-root.js';
import {
  readConsentMap,
  effectivePermissions,
  grantConsent,
  revokeConsent,
  pruneConsentedPermission,
  type ConsentMap
} from './extensions/consent.js';
import {
  setExtensionEnabled,
  readRendererEntry,
  extensionDir,
  addExtensionPermission,
  removeExtensionPermission,
  getExtensionsDir,
  markLocal,
  clearLocal,
  getLocalRecord,
  findLocalRecordByCwd,
  markGit,
  clearGit,
  getGitRecord
} from './extensions/discovery.js';
import { isWithin } from './extensions/path-util.js';
import {
  seedBundledExtensions,
  installFromDir,
  installFromArchiveFile,
  installFromBundled,
  installFromGit,
  locateManifestDir,
  listBundledCatalog,
  uninstallExtension
} from './extension-installer.js';
import {
  mintLocalId,
  workingDirFor,
  scaffoldLocalExtension,
  packLocalExtension,
  prepareShareDir,
  clampLocalKind,
  readWorkingDirId
} from './local-extension.js';
import {
  maybeCheckRemoteUpdates,
  listMarketplace,
  resolveMarketplaceRelease,
  applyRelease
} from './extension-registry.js';
import { syncDiskExtensions } from './extensions/sync.js';
import type {
  AgentPresetView,
  ExtensionEntry,
  ExtensionInstallSource,
  ExtensionUpdateOutcome,
  MarketplaceEntry,
  CreateLocalExtensionRequest,
  CreateLocalExtensionResult,
  AdoptLocalExtensionGitRequest
} from '../shared/types.js';
import { MAIN_MODULES } from './modules/index.js';
import { homedir } from 'node:os';
import {
  AUTO_CLOSE_IDLE_DEFAULTS,
  HEARTBEAT_DEFAULTS,
  toPersonaSummary,
  toProjectSummary,
  toTeamSummary
} from '../shared/types.js';
import type {
  CreateTerminalRequest,
  SessionWorktree,
  Result,
  Project,
  CloneProjectResult,
  OpenTarget,
  OpenResult,
  SearchOptions,
  FsMutateResult,
  ProjectRemote,
  AppConfig,
  ProjectSettings,
  ClaudeProjectSettings,
  ClaudeProjectFileId,
  ClaudeSettingsResult,
  ClaudeSettingsScope,
  CodexProjectSettings,
  CodexSettingsResult,
  OpenCodeProjectSettings,
  OpenCodeSettingsResult,
  ApplyAuthorizationInput,
  ScheduleCreateInput,
  ScheduleUpdateInput,
  ScheduledTask,
  ScheduleGroup,
  ScheduleGroupInput,
  Goal,
  GoalCreateInput,
  GoalUpdateInput,
  GoalStatus,
  FollowUp,
  FollowUpCreateInput,
  FollowUpUpdateInput,
  FollowUpStatus,
  SkillBundleInput,
  SkillBundleApplyMode,
  InboxPdfExport,
  InboxSummaryResult,
  DetailedInboxSummaryResult,
  FeedNoiseResult,
  TerminalSession,
  AgentState,
  LaunchProfileId,
  IdleTriageResult,
  MenubarReplyResult,
  CatchUpSummaryResult,
  OverseerActivity,
  OverseerAuditEntry,
  Persona,
  PersonaInput,
  Team,
  TeamInput,
  SquadBundle,
  UpdateStatus,
  ReleaseNote,
  WhatsNewEvent,
  SetupStatus
} from '../shared/types.js';
import {
  readCodexProjectSettings,
  readOpenCodeProjectSettings,
  writeCodexProjectSettings,
  writeOpenCodeProjectSettings
} from './harness-settings.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Gate for the e2e test-observability tap (`test-tap.ts`). Default OFF — the tap
 * is armed via `testTap.enable()` at boot ONLY when this is set, and the `test:*`
 * IPC handlers / `window.__zccTest` bridge exist ONLY then. Matches the existing
 * `ZCC_*` env-flag convention; inert in production.
 */
const E2E_TAP_ENABLED = process.env.ZCC_E2E === '1' || process.env.ZCC_E2E === 'true';

export function logMainError(context: string, err: unknown) {
  const message = err instanceof Error ? err.stack || err.message : String(err);
  testTap.recordLog('error', context, message);
  console.error(`[main] ${context}: ${message}`);
}

/**
 * Resolve the stored tri-state `theme` to a concrete 'dark' | 'light' for
 * main-owned surfaces (tray, menubar popover) that can't read the renderer's
 * CSS cascade. 'system' follows the OS via electron `nativeTheme` (WARP-A2).
 */
function resolveTheme(): 'dark' | 'light' {
  const t = store.getConfig().theme;
  if (t === 'light') return 'light';
  if (t === 'dark') return 'dark';
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

/** Resolve `projectPath` (passed by the renderer) to listSkills options. */
function projectPathToOptions(projectPath?: string) {
  if (!projectPath) return {};
  const project = store.listProjects().find((p) => p.path === projectPath);
  // Renderer paths are advisory. Never let an unregistered path select an
  // arbitrary directory for skill discovery.
  return project ? { projectPath: project.path, projectId: project.id } : {};
}

function emitSkillsChangedDebounced() {
  if (skillChangeDebounce) clearTimeout(skillChangeDebounce);
  skillChangeDebounce = setTimeout(() => {
    skillChangeDebounce = null;
    safeSend(IPC.skills.onChanged);
    // Plugins and MCP share the same on-disk roots (~/.claude/plugins/ and
    // ~/.claude/settings.json) — fan out the same debounced tick to them
    // instead of installing duplicate watchers.
    void emitPluginsChanged();
    void emitMcpChanged();
  }, 250);
}

async function emitPluginsChanged() {
  try {
    const entries = await listPlugins();
    safeSend(IPC.plugins.onChanged, entries);
  } catch (err) {
    logMainError('emit plugins changed', err);
  }
}

/**
 * Re-discover runtime extensions and push the fresh list to the renderer.
 * Used after an enable/disable so the panel reflects the new state. Runs in
 * RE-DISCOVERY mode — it does NOT re-import or re-run setupAll. Instead it
 * stamps each main-bearing extension's `mainActive` from the host's currently-
 * live modules: a main module is relaunch-required to (re)activate (an ESM
 * import is URL-cached, so a re-import after teardown returns the same stale
 * instance). So a re-enabled-but-not-relaunched extension reads
 * `mainActive:false` and the renderer surfaces a relaunch hint rather than
 * mounting a panel whose `host.call()` would reject. Renderer-only extensions
 * reconcile fully live. Disable tears the main side down live in the handler.
 */
async function emitExtensionsChanged() {
  try {
    // Refresh the consent map FIRST so the GrantProvider + the re-discovered
    // `consented`/`needsConsent` stamping reflect any just-granted consent.
    consentMap = await readConsentMap();
    const { entries } = await loadExtensions({
      log: logMainError,
      activeMainIds: moduleRouter.liveModuleIds(),
      reservedIds: builtinIds
    });
    extensionEntries = entries;
    rebuildExtensionServers(extensionEntries);
    void syncExtensionSkills(extensionEntries, logMainError).then(() => safeSend(IPC.skills.onChanged));
    safeSend(IPC.extensions.onChanged, extensionEntries);
  } catch (err) {
    logMainError('emit extensions changed', err);
  }
}

/**
 * The HEAVY "disk changed" path: reconcile live disk-extension children against
 * what discovery now wants (a freshly installed / changed / removed / re-consented
 * extension). Shared by BOOT, the explicit "Reload" button (`extensions:rescan`),
 * and the `~/.zcc/extensions` file-watcher — one code path so the three can't
 * diverge. `emitExtensionsChanged` stays the LIGHT path (enable/disable/consent
 * re-stamp only, no spawn/teardown).
 *
 * Trust (rules #1/#2): every input here comes from trusted on-disk discovery
 * (which already validates id/containment), never from renderer data — the
 * rescan IPC carries no payload. Bounded (rule #5): only the small main-bearing
 * spec set is respawned; we never hash whole dirs on the main loop.
 */
let diskSyncChain: Promise<void> = Promise.resolve();

function runDiskSync(): Promise<void> {
  const run = diskSyncChain.then(runDiskSyncOnce, runDiskSyncOnce);
  diskSyncChain = run.catch(() => {});
  return run;
}

async function runDiskSyncOnce(): Promise<void> {
  try {
    // Refresh consent first so only CONSENTED exts yield a spawn spec (P3-D) and
    // the GrantProvider reflects any just-granted consent (mirrors the light path).
    consentMap = await readConsentMap();
    const result = await syncDiskExtensions(diskSpecsById, {
      loadBoot: () => loadExtensions({ log: logMainError, reservedIds: builtinIds }),
      loadReStamp: (live) =>
        loadExtensions({ log: logMainError, activeMainIds: live, reservedIds: builtinIds }),
      // DISK-ext ids only — NOT `moduleRouter.liveModuleIds()`, which unions in the
      // trusted in-process built-ins (zana, slack). `syncDiskExtensions` tears down
      // anything live that isn't a desired DISK spec, so feeding it the built-ins
      // made every boot/reload tear zana + slack straight back down (→ the renderer's
      // "Unknown module: zana"). The reconcile only ever owns disk children.
      liveModuleIds: () => extProcessHost.liveModuleIds(),
      spawn: (spec) => extProcessHost.spawn(spec),
      teardown: (id) => moduleRouter.teardown(id),
      log: logMainError
    });
    extensionEntries = result.entries;
    rebuildExtensionServers(extensionEntries);
    void syncExtensionSkills(extensionEntries, logMainError).then(() => safeSend(IPC.skills.onChanged));
    diskSpecsById.clear();
    for (const [id, spec] of result.diskSpecsById) diskSpecsById.set(id, spec);
    if (result.spawned.length || result.tornDown.length) {
      console.log(
        `[main] extension sync: spawned [${result.spawned.join(', ')}], torn down [${result.tornDown.join(', ')}]`
      );
    }
    safeSend(IPC.extensions.onChanged, extensionEntries);
  } catch (err) {
    logMainError('runDiskSync', err);
  }
}

async function emitMcpChanged() {
  try {
    const entries = await listMcpServersAll(store.listProjects());
    safeSend(IPC.mcp.onChanged, entries);
  } catch (err) {
    logMainError('emit mcp changed', err);
  }
}

function watchSkillsTarget(target: string): FSWatcher | null {
  if (!existsSync(target)) return null;
  try {
    return fsWatch(target, { persistent: false, recursive: true }, () =>
      emitSkillsChangedDebounced()
    );
  } catch {
    try {
      return fsWatch(target, { persistent: false }, () => emitSkillsChangedDebounced());
    } catch {
      // Watcher unsupported on this fs — panel still works without live updates.
      return null;
    }
  }
}

function startSkillsWatchers() {
  const home = homedir();
  const targets = [
    join(home, '.claude', 'skills'),
    join(home, '.claude', 'plugins'),
    join(home, '.claude', 'settings.json'),
    // ~/.claude.json is the canonical source for user-scope MCP servers;
    // without watching it, McpPanel goes stale after `claude mcp add`.
    join(home, '.claude.json')
  ];
  for (const target of targets) {
    const w = watchSkillsTarget(target);
    if (w) skillWatchers.push(w);
  }
}

function stopSkillsWatchers() {
  for (const w of skillWatchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  skillWatchers.length = 0;
  stopActiveProjectSkillsWatcher();
  if (skillChangeDebounce) {
    clearTimeout(skillChangeDebounce);
    skillChangeDebounce = null;
  }
}

/**
 * Debounced disk-extension reconcile. An install/upgrade writes several files
 * into the watched dir, so a 400ms window (higher than skills' 250ms) coalesces
 * that burst into one `runDiskSync`. Self-fire is safe: the second tick finds no
 * spec/consent delta, so the idempotent diff respawns nothing new — a cheap
 * re-stamp. (Rule #5: bounded — one debounced reconcile per burst.)
 */
function syncExtensionsDebounced() {
  if (extensionsChangeDebounce) clearTimeout(extensionsChangeDebounce);
  extensionsChangeDebounce = setTimeout(() => {
    extensionsChangeDebounce = null;
    void runDiskSync().catch((err) => logMainError('extensions watcher sync', err));
  }, 400);
}

/**
 * Start the single `~/.zcc/extensions` watcher (Rule #3 — called ONCE from
 * bootstrap, not createWindow). Mirrors `watchSkillsTarget`: prefer a recursive
 * watch, fall back to a flat one, and degrade gracefully (the "Reload" button
 * still works) if the fs can't watch. No-op when the dir doesn't exist yet.
 */
function startExtensionsWatcher() {
  const target = getExtensionsDir();
  // Ensure the dir exists so the watcher arms on FIRST boot too: on a fresh
  // install ~/.zcc/extensions doesn't exist yet at bootstrap (seedBundled
  // creates it later, async), and `fsWatch` on a missing path throws — which
  // would silently leave hot-reload dead until an app restart. Creating it here
  // is idempotent and harmless (discovery already treats an empty dir as "none").
  try {
    mkdirSync(target, { recursive: true });
  } catch {
    // Can't create it (perms / odd fs) — fall through; if it still doesn't
    // exist the watch below no-ops and the manual Reload button covers us.
  }
  if (!existsSync(target)) return;
  try {
    extensionsWatcher = fsWatch(target, { persistent: false, recursive: true }, () =>
      syncExtensionsDebounced()
    );
  } catch {
    try {
      extensionsWatcher = fsWatch(target, { persistent: false }, () =>
        syncExtensionsDebounced()
      );
    } catch {
      extensionsWatcher = null; // unsupported fs — manual Reload still works
    }
  }
}

/** Release the extensions watcher + its debounce timer (Rule #3 shutdown). */
function stopExtensionsWatcher() {
  if (extensionsWatcher) {
    try {
      extensionsWatcher.close();
    } catch {
      /* ignore */
    }
    extensionsWatcher = null;
  }
  if (extensionsChangeDebounce) {
    clearTimeout(extensionsChangeDebounce);
    extensionsChangeDebounce = null;
  }
}

function stopActiveProjectSkillsWatcher() {
  for (const w of activeProjectSkillsWatchers) {
    try {
      w.close();
    } catch {
      /* ignore */
    }
  }
  activeProjectSkillsWatchers = [];
  activeProjectSkillsPath = null;
  activeProjectSkillsId = null;
}

/**
 * The per-project skill directories to watch, across every agent tool. Kept in
 * sync with the `SKILL_PROVIDERS` registry's project-scope roots — Claude's
 * `.claude/skills` and Cursor's `.cursor/rules`. Listed here (rather than
 * imported from the providers) because a watcher only needs the well-known
 * relative dirs, not the discovery logic; if a new tool adds a project root,
 * add it here too so live updates light up.
 */
const PROJECT_SKILL_WATCH_DIRS: readonly string[][] = [
  ['.claude', 'skills'],
  ['.cursor', 'rules']
];

/**
 * Re-point the per-project skills watchers at the currently active project.
 * Called from the `projects.touch` IPC handler so that switching projects
 * (or selecting one for the first time) lights up live updates for files
 * dropped into `<project>/.claude/skills/` or `<project>/.cursor/rules/`.
 */
function setActiveProjectSkillsWatcher(
  projectPath: string | null,
  projectId: string | null
) {
  // Key on the project path/id (not the individual dirs) so switching to the
  // same project is a no-op even though we now arm multiple watchers.
  if (projectPath === activeProjectSkillsPath && projectId === activeProjectSkillsId) return;
  stopActiveProjectSkillsWatcher();
  if (!projectPath) return;
  for (const segments of PROJECT_SKILL_WATCH_DIRS) {
    const w = watchSkillsTarget(join(projectPath, ...segments));
    if (w) activeProjectSkillsWatchers.push(w);
  }
  activeProjectSkillsPath = projectPath;
  activeProjectSkillsId = projectId;
}

/**
 * Live app windows. Replaces the old single `win` so the app can open several
 * windows at once — a "main" window (no scoped project) plus any number of
 * per-project windows opened on demand (see `windows:openProject`). The optional
 * `projectId` is the project a window is locked to; `undefined` is the full,
 * unscoped shell. Entries are added in `createWindow` and removed on `closed`,
 * so the map only ever holds live, non-destroyed windows.
 *
 * `safeSend` fans every main→renderer push out across this set, so the ~30
 * existing broadcast call sites are unchanged — each window's renderer already
 * keys terminal/agent state by project and ignores sessions it isn't showing.
 *
 * Note this fan-out is deliberately UNFILTERED: a scoped window receives every
 * project's pushes and merely declines to display the irrelevant ones. Window
 * scope is a display lock, not an isolation boundary (see windowScope.ts). If a
 * real per-project isolation guarantee is ever required, filter here by the
 * target window's `projectId` for the project-bearing channels.
 */
const windows = new Map<number, { win: BrowserWindow; projectId?: string }>();
const boundsControllers = new Map<number, ReturnType<typeof createBoundsStateController>>();
/**
 * The unscoped "main" window, kept as a hint for the dock-reactivate and
 * tray "show window" paths (which want *a* window, preferring the full shell).
 * Always re-derived from `windows` when read, never trusted if destroyed.
 */
function mainWindow(): BrowserWindow | null {
  // Prefer an unscoped window; fall back to any live window.
  return unscopedWindow() ?? anyWindow();
}
/** The live unscoped (full-shell) window, or null if only scoped ones exist. */
function unscopedWindow(): BrowserWindow | null {
  for (const { win, projectId } of windows.values()) {
    if (!projectId && !win.isDestroyed()) return win;
  }
  return null;
}
/** Any live window, scoped or not. */
function anyWindow(): BrowserWindow | null {
  for (const { win } of windows.values()) {
    if (!win.isDestroyed()) return win;
  }
  return null;
}
const ptys = new PtyManager();
const conversationHistory = new ConversationHistoryService({
  projects: () => store.listProjects(),
  claude: (project, limit) => listClaudeSessions(project.path, limit),
  opencode: (project, limit) => listOpenCodeSessions(project.path, { binary: store.getConfig().opencodeBinary, limit })
});
// One serialized durable ledger for every coordinator-owned terminal launch.
const launchLedger = createLaunchLedgerStore({
  filePath: join(app.getPath('userData'), 'launch-ledger.json')
});
const launchLedgerEntriesBySession = new Map<string, string>();
const teamLifecycle = createTeamLifecycleStore({
  filePath: join(app.getPath('userData'), 'team-lifecycle.json')
});
const executionStore = createExecutionStore({
  filePath: join(app.getPath('userData'), 'squad-executions.json')
});
const executionArtifacts = createExecutionArtifactStore({
  filePath: join(app.getPath('userData'), 'squad-execution-artifacts.json')
});
const executionHandoffs = createExecutionHandoffStore({
  filePath: join(app.getPath('userData'), 'squad-execution-handoffs.json')
});
const executionResumeGrants = createResumeGrantStore({
  filePath: join(app.getPath('userData'), 'squad-execution-resume-grants.json')
});
const executionResumeTokens = createResumeTokenStore({
  filePath: join(app.getPath('home'), '.zcc', 'execution-resume.enc')
});
const restoreCapabilities = createRestoreCapabilityStore({
  filePath: join(app.getPath('userData'), 'restore-capabilities.json')
});
const mcpPortFile = join(app.getPath('userData'), app.isPackaged ? 'mcp-port.json' : 'mcp-port-dev.json');

function refreshRestoreCapability(session: TerminalSession): void {
  if (!session.restoreCapabilityId) return;
  const capability = restoreCapabilities.get(session.restoreCapabilityId);
  if (!capability) return;
  const registration = registrationFor(session.profile);
  const projection = registration?.restoreProjection?.({
    session,
    extraArgs: capability.request.extraArgs
  });
  const request: CreateTerminalRequest = {
    ...capability.request,
    title: session.title,
    profile: projection?.profile ?? session.profile,
    prompt: undefined,
    extraArgs: projection?.extraArgs ?? capability.request.extraArgs,
    resumeSessionId: projection?.resumeSessionId
  };
  restoreCapabilities.put({
    ...capability,
    request,
    sessionId: session.id,
    sessionProfile: session.profile,
    sessionTitle: session.title,
    remoteTmuxId: session.remoteTmuxId ?? capability.remoteTmuxId,
    exitedAt: session.status === 'exited' ? Date.now() : undefined
  });
}

function isTeamWorkerRestore(request: CreateTerminalRequest): boolean {
  return request.cohort?.role === 'worker';
}

function restorePrincipal(capability: { id: string; request: CreateTerminalRequest }): LaunchPrincipalRef {
  return isTeamWorkerRestore(capability.request)
    ? { kind: 'team', id: `restore:${capability.id}` }
    : { kind: 'automation', id: `restore:${capability.id}` };
}

const launchAuthorizationBySession = new Map<string, string>();
const launchPrincipals = new Map<string, LaunchPrincipal>();
const launchAuthorization = new LaunchAuthorizationService({
  resolvePrincipal: (id) => launchPrincipals.get(id)
});
async function terminateSession(sessionId: string, expected = true): Promise<boolean> {
  const session = ptys.getSession(sessionId);
  if (!session) {
    restoreCapabilities.removeSession(sessionId);
    return true;
  }
  const project = store.listProjects().find((candidate) => candidate.id === session.projectId);
  if (project?.remote && session.remoteTmuxId && !await ptys.killRemoteTmux(sessionId)) return false;
  restoreCapabilities.removeSession(sessionId);
  const closed = expected ? ptys.closeExpected(sessionId) : (ptys.close(sessionId), true);
  if (project && !project.remote) await killLocalTmuxSession(sessionId);
  return closed;
}

export function sanitizeRendererTerminalRequest(req: CreateTerminalRequest): CreateTerminalRequest {
  const {
    cohort: _cohort,
    headless: _headless,
    worktreeInfo: _worktreeInfo,
    ...safe
  } = req;
  return safe;
}
const teamLifecycleIntegration = createTeamLifecycleIntegration({
  store: teamLifecycle,
  isLiveSession: (sessionId) => {
    const session = ptys.getSession(sessionId);
    return !!session && session.status !== 'exited';
  },
  closeSession: (sessionId) => terminateSession(sessionId),
  releaseCapacity: (authorizationId) => launchAuthorization.complete(authorizationId),
  restoreCapacity: (capacity, activeAuthorizationIds) => {
    launchPrincipals.set(capacity.principal.id, capacity.principal);
    launchAuthorization.restoreCapacity(capacity.principal, capacity.launched, activeAuthorizationIds);
  }
});
const executionConsentStore = createExecutionConsentStore({
  filePath: join(app.getPath('userData'), 'execution-consent.json')
});
const executionConsentManagement = createExecutionConsentManagement({
  store: executionConsentStore,
  projectExists: (projectId) => store.listProjects().some((project) => project.id === projectId)
});
const executionConsentService = new ExecutionConsentService({
  store: executionConsentStore,
  showDialog: (request) => showExecutionConsentDialog(request, BrowserWindow.getFocusedWindow() ?? undefined)
});
// Rule 2 / 0.4: supply the registered-project roots so PtyManager can re-confine
// a local spawn cwd (realpath) at the moment of spawn — a lazy closure, so it
// always reflects the current project set and has no boot-ordering dependency.
// The app-managed worktree root (`~/zcc-worktrees`) is included as a trust
// anchor so an ISOLATED-WORKTREE launch (cwd under that root) passes the spawn
// gate: it's app-owned (only `createWorktree` in git.ts ever writes there — a
// worktree of a registered project), and confinement stays realpath-based so a
// symlink escaping the managed root still resolves outside it and is rejected.
ptys.setProjectRoots(() => [...store.listProjects().map((p) => p.path), worktreeRoot()]);
// WARP-C5: resolve the operator's layered RULES.md (~/.zcc/RULES.md +
// <project>/.zcc/RULES.md) for each launch. Maps the projectId to the registered
// project's path HERE (main authorizes — Rule 1), where the store is available;
// `resolveRulesGuidance` confines the project read against that root (Rule 2) and
// returns the composed system-prompt block (or null when no rules files exist).
// A lazy closure so edits to a RULES.md take effect on the next launch with no
// restart, and so it always reflects the current project set.
ptys.setRulesResolver((projectId) => {
  const path = store.listProjects().find((p) => p.id === projectId)?.path;
  return resolveRulesGuidance(path);
});
const agentStatus = new AgentStatusTracker();
/**
 * Output-activity heuristic (B6) for agents that DON'T emit OSC status glyphs
 * (codex, cursor). Claude drives its own working/idle via OSC titles; a
 * non-Claude agent would otherwise sit at `unknown` forever, so everything that
 * keys off the status stream (Agents board, auto-close-idle, heartbeat,
 * idle-triage, catch-up) never fires for it. This reports `working` on any
 * output and `idle` after a short silence into the SAME AgentStatusTracker sink,
 * so the fusion/debounce/ring stay unchanged. Fed only from the pty `data`
 * handler for `isAgent && !emitsOscStatus` sessions (below).
 */
const outputActivity = new OutputActivityMonitor({
  sink: agentStatus,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Screen-scan blocked detector (LAS-07 — the "needs-you" slice for non-Claude
 * harnesses). Claude signals blocked via its Notification hook; a harness with
 * NEITHER an OSC status glyph NOR a lifecycle hook (`emitsOscStatus:false` +
 * `supportsHooks:false` — OpenCode/cursor/pi) instead goes QUIET at a permission
 * prompt, which `outputActivity` would read as plain `idle`. This scans each such
 * session's settled screen text and, when it matches the provider's blocking-
 * prompt pattern (`detectBlockedPrompt` — the concrete harness string lives in the
 * provider, Rule 6), sets the SAME sticky blocked overlay the hook path uses. It
 * auto-clears when the agent resumes (output edge → `report('working')`). Fed from
 * the same pty `data` gate as `outputActivity` (below).
 */
const screenScanBlocked = new ScreenScanBlockedDetector({
  sink: agentStatus,
  detect: (sessionId, recentText) => {
    const session = ptys.getSession(sessionId);
    if (!session) return false;
    return providerFor(session.profile as LaunchProfileId)
      .adapter.status?.detectBlockedPrompt?.(recentText) ?? false;
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
const inboxStore: IInboxStore = createInboxStore();
// Suggested Actions launcher backing store (afl-03). Durable JSONL sibling of
// the inbox: holds runnable next actions an agent proposes for the operator.
const suggestionsStore: ISuggestionsStore = createSuggestionsStore();
// Inter-agent discovery registry (Phase 0 of the agent mesh). In-memory only:
// records are seeded when a pty spawns and dropped when it exits (see
// wireBridgeListeners), so they never outlive a live session — no persistence
// to drift. Exposed to claude sessions via the session-scoped MCP route.
const agentRegistry: IAgentRegistryStore = createAgentRegistryStore();
// Agent↔agent message channel (Phase 1 of the mesh). This is the audit log AND
// the per-target pull queue for agent_send / agent_inbox. Deliberately SEPARATE
// from inboxStore: peer traffic is never written to the user inbox. In-memory
// for the same reason as the registry (messages reference live session ids that
// don't survive a restart).
const agentMessageLog: IAgentMessageLog = createAgentMessageLog();
/**
 * Maps sessionId → teamLaunchId for every session spawned as part of a team
 * launch (both manual and autonomous). This scopes handle dedup and peer
 * discovery in the agent registry so two squads using the same personas in the
 * same project each get their own isolated namespace. Entries are removed on
 * pty exit (same lifecycle as the registry record).
 */
const teamLaunchSessions = new Map<string, string>();
/** Drop agent↔agent messages older than this. Peer traffic is ephemeral
 *  coordination chatter, so a short window keeps the audit strip current and
 *  the in-memory log bounded. */
const AGENT_MESSAGE_MAX_AGE_MS = 60 * 60 * 1000; // 1h
/** Sweep cadence for {@link AGENT_MESSAGE_MAX_AGE_MS}. Cleared in before-quit. */
const AGENT_MESSAGE_PRUNE_INTERVAL_MS = 5 * 60 * 1000; // every 5 min
let agentMessagePruneTimer: NodeJS.Timeout | null = null;
/**
 * Independent cadence for {@link PtyManager.reapDeadSessions}. Previously this
 * only ran as a side effect of an auto-firing schedule (scheduler.ts `fire()`),
 * so a quiet period with no recurring schedules let zombie sessions (child
 * reaped across sleep/wake, `onExit` lost) pin their master /dev/ptmx fd open
 * indefinitely — macOS caps pty slots at kern.tty.ptmx_max (default 511), so
 * enough of these eventually make every new spawn throw "posix_spawnp failed."
 * This timer sweeps regardless of schedule activity so the leak can't outrun
 * it. Cleared in before-quit.
 */
const PTY_REAP_INTERVAL_MS = 5 * 60 * 1000; // every 5 min
let ptyReapTimer: NodeJS.Timeout | null = null;
let conversationHistoryEvictTimer: NodeJS.Timeout | null = null;
/**
 * Delay before the boot-time tmux orphan reap, giving the renderer's
 * session-restore time to re-spawn (and thus re-attach) its tabs first — a
 * re-attached session is live and so not an orphan. Generous: a missed reap
 * just leaves a dead `cc-*` server until the next boot, harmless.
 */
const TMUX_REAP_GRACE_MS = 10_000;
let teamLifecycleReconcileTimer: NodeJS.Timeout | null = null;
const savedStore: ISavedStore = createSavedStore();
const libraryStore: ILibraryStore = new LibraryStore(() => store.listProjects());
const scheduler = new SchedulerManager();
// Persistent project goals: an event-driven loop that spawns a worker, evaluates
// it, and re-spawns with feedback until the success criteria pass (or it caps
// out / stalls). Deps wired at boot next to the scheduler (Rule 3).
const goals = new GoalManager();
// Follow-ups: agent-parked questions / decisions awaiting a human — the durable
// twin of the ephemeral "Needs you" idle badge. No loop (a follow-up is inert
// until acted on); deps wired at boot alongside goals (Rule 3).
const followups = new FollowUpManager();
let tray: TrayController | null = null;
let menubar: MenubarController | null = null;

/** macOS + config flag: the frameless-card menu-bar popover is the tray surface. */
function menubarPopoverEnabled(): boolean {
  return process.platform === 'darwin' && store.getConfig().menubarPopoverEnabled === true;
}
// Created in whenReady (needs `app` ready); a no-op shim in dev. Module-level
// so the IPC handlers can reach it.
let updater: Updater | null = null;
let doctor: Doctor | null = null;
/**
 * Pending "What's New" window, computed once at boot when the running version
 * overtakes the persisted `lastSeenVersion`. Consumed (and cleared, with the
 * baseline advanced) by the first renderer to call `IPC.updates.consumeWhatsNew`
 * — a pull, so a late-attaching listener can't miss it. Null when there's
 * nothing new to show (first-ever launch, or already up to date).
 */
let pendingWhatsNew: WhatsNewEvent | null = null;
const templates = new TemplateStore(() => store.listProjects());
const quickPrompts = new QuickPromptStore();
// LLM micro-call layer: an editable prompt registry + a provider-agnostic
// dispatcher. v1 registers only the claude-cli provider (a headless
// `claude --print` that reuses the user's Claude Code login). The claude binary
// is read from config at boot and refreshed on config:set so a binary change
// takes effect without a restart.
const promptRegistry = new PromptRegistry();
const llmService = new LlmService(new Map<LlmProviderId, LlmProvider>());
/** Single provider-registration path. Rebuilds the LLM providers from config.
 *  `claude-cli` is built from `config.claudeBinary`. The HTTP providers
 *  (`openai`/`gemini`) are registered unconditionally with a LAZY key getter —
 *  they read the encrypted key from safeStorage at call time and resolve to an
 *  honest `ok:false` "no API key configured" when absent, so a key added/removed
 *  later takes effect without a re-register. */
function rebuildProviders(config: AppConfig): void {
  llmService.setProvider(new ClaudeCliProvider(config.claudeBinary));
  llmService.setProvider(new OpenAiProvider(() => getOpenAiKey()));
  llmService.setProvider(new GeminiProvider(() => getGeminiKey()));
}
const voiceProviders = new Map([['openai', new OpenAiVoiceProvider(getOpenAiKey)]]);
const voiceService = new VoiceService(voiceProviders);
/** Sessions already named by the tab-namer — fire the LLM micro-call once each. */
const llmNamedSessions = new Set<string>();
/**
 * Idle-agent triage add-on (off by default; spends tokens). Classifies WHY an
 * agent is idle — waiting on you / done / paused — from its transcript's last
 * turn, once per idle spell. All collaborators injected so the service stays
 * Electron-free and unit-testable; the `claude --print` cost is gated by the
 * config flag, the claude-profile check, and a "no transcript text → no call"
 * bail (see {@link IdleTriageService}).
 */
/**
 * Provider-agnostic transcript seam shared by every transcript consumer (idle
 * triage, catch-up, close/turn summaries, and the sessionStats handler). Routes
 * each read to the right per-provider reader by capability — Claude derives its
 * path from cwd + claudeSessionId; Codex lazily resolves its rollout by session
 * id + spawn time. One instance so the Codex resolver cache is shared; released
 * per session on pty exit via `transcriptSource.forget(id)` (Rule 5).
 */
const transcriptSource = new TranscriptSource((ptyId, patch) => {
  // Native ids originate from a main-owned adapter resolver, never the renderer.
  ptys.setNativeSessionFields(ptyId, patch);
}, () => store.getConfig().opencodeBinary || 'opencode');
const EXITED_SESSION_STATS_MAX = 200;
const exitedSessionStats = new Map<string, { projectId: string; stats: SessionStats | null; pending?: Promise<SessionStats | null> }>();
const LIVE_SESSION_STATS_TTL_MS = 4_000;
const LIVE_SESSION_STATS_NEGATIVE_TTL_MS = 1_000;
const LIVE_SESSION_STATS_MAX = 200;
const liveSessionStats = new Map<string, { value?: SessionStats | null; expiresAt?: number; pending?: Promise<SessionStats | null> }>();

function transcriptRefForSession(session: TerminalSession) {
  return {
    id: session.id,
    profile: session.profile,
    cwd: session.cwd,
    claudeSessionId: session.claudeSessionId,
    codexSessionId: session.codexSessionId,
    openCodeSessionId: session.openCodeSessionId,
    createdAt: session.createdAt
  };
}

function retainExitedSessionStats(session: TerminalSession, pending?: Promise<SessionStats | null>): void {
  const entry: { projectId: string; stats: SessionStats | null; pending?: Promise<SessionStats | null> } = {
    projectId: session.projectId,
    stats: null
  };
  entry.pending = (pending ?? transcriptSource.readStats(transcriptRefForSession(session))).then((stats) => {
    entry.stats = stats;
    return stats;
  }).catch(() => null);
  exitedSessionStats.set(session.id, entry);
  while (exitedSessionStats.size > EXITED_SESSION_STATS_MAX) {
    exitedSessionStats.delete(exitedSessionStats.keys().next().value!);
  }
}

async function readLiveSessionStats(session: TerminalSession): Promise<SessionStats | null> {
  const cached = liveSessionStats.get(session.id);
  if (cached?.pending) return cached.pending;
  if (cached?.value !== undefined && cached.expiresAt && cached.expiresAt > Date.now()) return cached.value;

  const entry = cached ?? {};
  const read = (): Promise<SessionStats | null> => transcriptSource.readStats(transcriptRefForSession(session));
  entry.pending = read().then((stats) => {
    entry.pending = undefined;
    entry.value = stats;
    entry.expiresAt = Date.now() + (stats ? LIVE_SESSION_STATS_TTL_MS : LIVE_SESSION_STATS_NEGATIVE_TTL_MS);
    return stats;
  }, () => {
    entry.pending = undefined;
    entry.value = null;
    entry.expiresAt = Date.now() + LIVE_SESSION_STATS_NEGATIVE_TTL_MS;
    return null;
  });
  liveSessionStats.set(session.id, entry);
  while (liveSessionStats.size > LIVE_SESSION_STATS_MAX) {
    liveSessionStats.delete(liveSessionStats.keys().next().value!);
  }
  return entry.pending;
}
const idleTriage = new IdleTriageService({
  isEnabled: () => store.getConfig().idleTriageEnabled === true,
  delaySeconds: () => store.getConfig().idleTriageDelaySeconds ?? 20,
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          profile: s.profile,
          cwd: s.cwd,
          claudeSessionId: s.claudeSessionId,
          openCodeSessionId: s.openCodeSessionId,
          createdAt: s.createdAt,
          status: s.status,
          scheduled: s.scheduled,
          headless: s.headless
        }
      : null;
  },
  hasTranscript: (profile) => providerCapabilities(profile as LaunchProfileId).hasTranscript,
  readLastTurn: (ref) => transcriptSource.readLastTurn(ref),
  runTriage: (lastTurn, dedupeKey) => {
    const entry = promptRegistry.get('builtin:idle-triage');
    if (!entry) {
      return Promise.resolve({ ok: false, text: '', error: 'no idle-triage prompt', provider: 'claude-cli', ms: 0 });
    }
    return llmService.run(entry, { lastTurn }, `idle-triage:${dedupeKey}`);
  },
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Held-questions gate (the "quiet questions" feature; default ON). Suppresses a
 * BLOCKING inbox question while its originating agent is still `working` and
 * flushes it on the working→idle/blocked edge (or a ~10-min deadline), so a busy
 * fleet stops filling the inbox with half-relevant questions it often resolves
 * itself before it ever stops. It spends NO tokens — pure gating + a deferred
 * append. `observe` is wired to the agent-status edge and `remove` to pty exit
 * (Rule 3), mirroring {@link IdleTriageService}. The gate is passed into the MCP
 * inbox tools (`inbox_ask` / `inbox_push`) so they can park a question at push
 * time; `getAgentState` reads the live tracker (never renderer-supplied, Rule 1).
 */
const heldQuestions = new HeldQuestionService({
  isEnabled: () => store.getConfig().heldQuestionsEnabled !== false,
  getAgentState: (sessionId) => agentStatus.get(sessionId),
  append: (input) => inboxStore.append(input),
  maxHoldMs: () => HELD_QUESTION_MAX_HOLD_MS,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Catch-up summary add-on (EXPERIMENTAL, off by default; spends tokens). When an
 * agent settles into idle OR enters a blocked state (keyboard-choice / permission),
 * it reads the session transcript digest and runs the `builtin:catch-up-summary`
 * LLM micro-call to generate a tight catch-up: a one-line headline + up to ~4
 * bullets of "where are we / what changed". When the trigger is 'blocked', the
 * summary SHOULD include a recommended option + why. Emits {@link CatchUpSummaryResult}
 * the renderer surfaces under the terminal in the agent modal. All collaborators
 * injected so the service stays Electron-free and unit-testable (mirrors
 * {@link IdleTriageService}).
 */
const catchUpSummary = new CatchUpSummaryService({
  isEnabled: () => store.getConfig().catchUpSummaryEnabled === true,
  delaySeconds: () => store.getConfig().catchUpSummaryDelaySeconds ?? 20,
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          projectId: s.projectId,
          profile: s.profile,
          cwd: s.cwd,
          claudeSessionId: s.claudeSessionId,
          openCodeSessionId: s.openCodeSessionId,
          createdAt: s.createdAt,
          status: s.status,
          scheduled: s.scheduled,
          headless: s.headless
        }
      : null;
  },
  hasTranscript: (profile) => providerCapabilities(profile as LaunchProfileId).hasTranscript,
  readDigest: (ref) => transcriptSource.readDigest(ref),
  runSummary: (digest, trigger, dedupeKey) => {
    const entry = promptRegistry.get('builtin:catch-up-summary');
    if (!entry) {
      return Promise.resolve({ ok: false, text: '', error: 'no catch-up-summary prompt', provider: 'claude-cli', ms: 0 });
    }
    return llmService.run(entry, { digest, trigger }, `catch-up-summary:${dedupeKey}`);
  },
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Auto-report linker (ON by default — pure filename heuristic, no LLM spend).
 * See {@link AutoReportLinkerService} for the full rationale.
 */
const autoReportLinker = new AutoReportLinkerService({
  isEnabled: () => store.getConfig().autoReportLinkEnabled !== false,
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          projectId: s.projectId,
          profile: s.profile,
          cwd: s.cwd,
          claudeSessionId: s.claudeSessionId,
          openCodeSessionId: s.openCodeSessionId,
          createdAt: s.createdAt,
          scheduled: s.scheduled,
          headless: s.headless
        }
      : null;
  },
  hasTranscript: (profile) => providerCapabilities(profile as LaunchProfileId).hasTranscript,
  readStats: (ref) => transcriptSource.readStats(ref),
  projectRoot: (projectId) => store.listProjects().find((p) => p.id === projectId)?.path,
  toProjectRelative: (root, absPath) => {
    const c = confine(root, absPath);
    if (!c.ok) return null;
    const rel = relative(root, c.path);
    return rel.startsWith('..') ? null : rel.split(sep).join('/');
  },
  projectLabel: (projectId) => store.listProjects().find((p) => p.id === projectId)?.name,
  resolveOrigin: resolveInboxOrigin,
  alreadyLinked: async (sessionId, rel) => {
    const projectId = ptys.getSession(sessionId)?.projectId;
    if (!projectId) return false;
    const { entries } = await inboxStore.read({ projectId, limit: 500 });
    return entries.some((e) => e.sessionId === sessionId && e.docs?.some((d) => d.path === rel));
  },
  appendInbox: (input) => inboxStore.append(input).then((e) => ({ id: e.id }))
});
/**
 * Overseer auto-approval cascade (EXPERIMENTAL, off by default). When armed, the
 * synchronous PreToolUse hook (wired in pty.ts) routes each tool call here; the
 * cascade auto-approves provably-safe calls and hands everything else back to
 * the normal prompt. Fail-open everywhere — see {@link Overseer}. All deps are
 * injected (config read live; the LLM tier reuses the same micro-call service as
 * the tab-namer / idle-triage). Decisions are emitted as a `[overseer]`
 * diagnostic console line (see onOverseerHook); a bounded in-memory ring + a
 * dry-run audit pane is the documented next increment (docs/overseer-auto-approval.md),
 * deliberately not built yet — no `audit` dep is wired, so nothing accumulates.
 */
/**
 * Overseer decision-timeout ceilings (ms), the server-side fail-open guard on
 * the synchronous hook exchange. The FAST bound keeps the everyday path snappy;
 * the DEEP bound is used only while the "think harder" tier is enabled, so an
 * escalated call can afford a stronger model's reasoning. Both MUST stay under
 * the hook's own `curl -m` (see pty.ts, which picks its `-m` from the same
 * deep-tier flag) so a hung server degrades to the normal prompt, never a wedge.
 */
const OVERSEER_FAST_DECISION_TIMEOUT_MS = 8_000;
const OVERSEER_DEEP_DECISION_TIMEOUT_MS = 24_000;

const overseer = new Overseer({
  getConfig: () => {
    const c = store.getConfig();
    return {
      mode: c.overseerMode ?? 'off',
      llmTierEnabled: c.overseerLlmTierEnabled === true,
      deepTierEnabled: c.overseerDeepTierEnabled === true,
      denyPatterns: c.overseerDenyPatterns ?? []
    };
  },
  runJudge: (event: OverseerToolEvent, dedupeKey: string) =>
    runOverseerJudge('builtin:overseer-judge', event, dedupeKey),
  runJudgeDeep: (event: OverseerToolEvent, dedupeKey: string) =>
    runOverseerJudge('builtin:overseer-judge-deep', event, dedupeKey),
  // Deterministic path-confinement (rule 2): a Write/Edit is auto-approvable
  // only if its target's REALPATH stays inside the session cwd's realpath. We
  // realpath both sides (falling back to the lexical resolve for a not-yet-
  // existing target, whose *parent* we realpath) so a symlink can't smuggle the
  // write outside the tree. Any throw → false (not confined) — the never-throw
  // wrapper in Overseer.safeConfine backs this up too.
  confinePath: (targetPath: string, cwd: string): boolean => {
    try {
      if (!targetPath || !cwd) return false;
      const absTarget = isAbsolute(targetPath) ? targetPath : resolve(cwd, targetPath);
      let realRoot: string;
      try {
        realRoot = realpathSync(cwd);
      } catch {
        return false;
      }
      // The target file may not exist yet (a fresh Write); realpath its nearest
      // existing ancestor so a symlinked parent dir is still resolved, then keep
      // the lexical tail. This prevents `<cwd>/link-to-/etc/x` escaping the tree.
      let probe = absTarget;
      let real: string | null = null;
      // Walk up at most a bounded number of parents to find one that exists.
      for (let i = 0; i < 64 && probe && probe !== dirname(probe); i++) {
        try {
          const realProbe = realpathSync(probe);
          real = probe === absTarget ? realProbe : resolve(realProbe, relative(probe, absTarget));
          break;
        } catch {
          probe = dirname(probe);
        }
      }
      if (!real) return false;
      return isWithin(real, realRoot);
    } catch {
      return false;
    }
  }
});

/**
 * Content Screen (EXPERIMENTAL, off by default) — inbound prompt-injection
 * defense, the PostToolUse counterpart to the Overseer above. When armed, the
 * synchronous PostToolUse hook (wired in pty.ts) routes the RESULT of
 * WebFetch/WebSearch/third-party-MCP tool calls here; a `suspicious` verdict
 * adds a warning to the agent's context (never a block — see {@link
 * ContentScreen}). Fail-open everywhere. The classifier tier reuses the same
 * micro-call service (llmService/promptRegistry) as the Overseer's judge and
 * the tab-namer.
 */
const CONTENT_SCREEN_DECISION_TIMEOUT_MS = 8_000;

const contentScreen = new ContentScreen({
  getConfig: () => ({ mode: store.getConfig().contentScreenMode ?? 'off' }),
  runClassify: (event: ContentScreenEvent, dedupeKey: string) => {
    const entry = promptRegistry.get('builtin:content-screen');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no builtin:content-screen prompt',
        provider: 'claude-cli' as const,
        ms: 0
      });
    }
    return llmService.run(
      entry,
      {
        toolName: event.toolName,
        cwd: event.cwd,
        // Clamp is already applied by extractResponseText upstream; toString
        // covers the (rare) non-string toolResponse that slips through.
        toolResponse:
          typeof event.toolResponse === 'string' ? event.toolResponse : JSON.stringify(event.toolResponse)
      },
      dedupeKey
    );
  },
  audit: (event: ContentScreenEvent, decision) => {
    // Diagnostic only, mirrors the overseer/notify/subagent hook lines — no
    // bounded ring or UI pane yet (documented next increment, same posture the
    // Overseer's audit trail started from).
    console.log(
      `[content-screen] tool=${event.toolName} tier=${decision.tier} ` +
        `computed=${decision.computed} warn=${decision.warn} reason=${decision.reason}`
    );
  }
});

/**
 * Run one Overseer judge micro-call (fast or deep) by prompt id. Shared by the
 * two `runJudge*` deps so the input-clamping and missing-prompt fallback live in
 * one place. Never throws (provider contract).
 */
function runOverseerJudge(promptId: string, event: OverseerToolEvent, dedupeKey: string) {
  const entry = promptRegistry.get(promptId);
  if (!entry) {
    return Promise.resolve({ ok: false, text: '', error: `no ${promptId} prompt`, provider: 'claude-cli' as const, ms: 0 });
  }
  return llmService.run(
    entry,
    {
      toolName: event.toolName,
      cwd: event.cwd,
      // Clamp the serialized input so a huge Write body can't bloat the prompt.
      toolInput: JSON.stringify(event.toolInput).slice(0, 4_000)
    },
    dedupeKey
  );
}
/**
 * Bounded audit trail of the Overseer's decisions (the documented next increment
 * — see docs/overseer-auto-approval.md). Recorded in {@link onOverseerHook},
 * where the session/project ids are in scope (the cascade itself is UI-agnostic).
 * Two readers: the `overseer.recent` IPC (dry-run review pane) and a debounced
 * per-session rollup pushed over `onOverseerActivity` for the card badge. Capped,
 * so a chatty long-running session can't grow it unbounded (Rule 5).
 */
const overseerAudit = new OverseerAuditRing();
/**
 * Debounce the per-session Overseer-activity push so a burst of tool calls
 * coalesces into one renderer update (the badge only shows counts, so it never
 * needs every intermediate). Keyed by session; the trailing edge sends the
 * current rollup. Mirrors the agent-status debounce already on the hot path.
 */
const overseerActivityTimers = new Map<string, NodeJS.Timeout>();
function pushOverseerActivity(sessionId: string): void {
  if (overseerActivityTimers.has(sessionId)) return; // a trailing send is already armed
  const timer = setTimeout(() => {
    overseerActivityTimers.delete(sessionId);
    const rollup = overseerAudit.rollup(sessionId);
    if (rollup) safeSend(IPC.terminals.onOverseerActivity, rollup);
  }, 250);
  overseerActivityTimers.set(sessionId, timer);
}
/**
 * Agent Heartbeat: nudges an opted-in, non-background agent to keep going when
 * it sits idle for the configured delay (types the configured message into the
 * session, submitted like an inbox reply). Gated by the `heartbeatEnabled`
 * master switch and the per-session `heartbeat` flag; a runaway cap
 * auto-disables it and notifies. All collaborators injected so the timer logic
 * stays Electron-free and unit-testable (see {@link HeartbeatService}).
 */
const heartbeat = new HeartbeatService({
  isEnabled: () => store.getConfig().heartbeatEnabled === true,
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          heartbeat: s.heartbeat,
          scheduled: s.scheduled,
          headless: s.headless,
          status: s.status,
          projectId: s.projectId,
          title: s.title,
          liveSubagents: agentStatus.subagents(sessionId)
        }
      : null;
  },
  delaySeconds: () => store.getConfig().heartbeatDelaySeconds ?? HEARTBEAT_DEFAULTS.delaySeconds,
  maxNudges: () => store.getConfig().heartbeatMaxNudges ?? HEARTBEAT_DEFAULTS.maxNudges,
  message: () => {
    const m = store.getConfig().heartbeatMessage;
    return m && m.trim() ? m : HEARTBEAT_DEFAULTS.message;
  },
  reply: (sessionId, text) => ptys.reply(sessionId, text),
  setHeartbeat: (sessionId, on) => {
    ptys.setHeartbeat(sessionId, on);
  },
  pushInbox: (input) => {
    void inboxStore.append(input).catch((err) => logMainError('heartbeat pushInbox', err));
  },
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Autonomous team runs: orchestrator + workers driven toward a goal until the
 * orchestrator declares done (it ends its own session via
 * close_session_with_summary). The supervisor nudges idle agents and enforces
 * the max-rounds / timeout backstops. Injected deps keep it Electron-free and
 * unit-testable. Subscribed once here at init (Rule 3); released on run stop and
 * on pty exit.
 */
export const autonomousRuns = new AutonomousRunSupervisor({
  reply: (sessionId, text) => ptys.reply(sessionId, text),
  closeSession: (sessionId) => {
    if (!ptys.getSession(sessionId)) return false;
    ptys.close(sessionId);
    return true;
  },
  pushInbox: (input) => {
    void inboxStore.append(input).catch((err) => logMainError('autonomous pushInbox', err));
  },
  nudgeDelaySeconds: () =>
    store.getConfig().autonomousNudgeDelaySeconds ?? AUTONOMOUS_DEFAULTS.nudgeDelaySeconds,
  now: () => Date.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
autonomousRuns.on('changed', () => {
  safeSend(IPC.autonomousRuns.onChanged, autonomousRuns.list());
});
/**
 * The foreground/active tab id, reported by the renderer over
 * `terminals.setActiveSession`. Advisory ONLY — auto-close-idle reads it to
 * SPARE the tab the user is currently viewing; it can never authorize a close,
 * so a stale/forged value from the untrusted renderer is harmless (Rule 1).
 */
let activeForegroundSessionId: string | null = null;
/**
 * The set of favorite (starred/followed) agent keys, reported by the renderer
 * over `terminals.setFavorites`. Keyed the same way the renderer persists them
 * ({@link favoriteKey}: the stable `claudeSessionId` when present, else the
 * session id), so it reattaches across a restore. Advisory ONLY — auto-close-idle
 * reads it to SPARE a pinned agent; it can never authorize a close, so a
 * stale/forged value from the untrusted renderer is harmless (Rule 1).
 */
let favoriteAgentKeys = new Set<string>();
/**
 * Cache of each session's most recent idle-triage verdict, fed off the same
 * `triage` edge that drives the live badge. Auto-close reads it at fire time to
 * decide — at zero token cost — whether the agent had parked a question worth
 * turning into a durable follow-up before the silent close. Bounded (FIFO) so a
 * long-lived, many-session run can't grow it unbounded (Rule 5); an entry is
 * dropped on pty exit alongside the other per-session state.
 */
const lastTriageBySession = new Map<string, IdleTriageResult>();
const TRIAGE_CACHE_CAP = 200;

/**
 * Latest auto-title per live session (the OSC `✳ summary` idle title, or the
 * LLM tab-namer / `/rename` title — whichever last flowed through the `onTitle`
 * channel). Snapshotted onto an inbox entry's `origin.title` at push time so the
 * inbox can name the originating task even after the tab dies. Display-only,
 * bounded like the triage cache, and dropped on pty exit.
 */
const lastTitleBySession = new Map<string, string>();
const TITLE_CACHE_CAP = 400;

/**
 * Isolated worktrees minted for a session, so the `exit` handler can prune them
 * after the session is gone. Keyed by session id → the resolved worktree + the
 * owning project's root (needed to run `git worktree remove` from the repo).
 * Populated in {@link createTerminalConfined} for a worktree launch, consumed +
 * dropped on pty exit (Rule 3). Bounded like the other per-session caches.
 */
const worktreeBySession = new Map<string, { worktree: SessionWorktree; projectPath: string }>();
const pendingWorktreeUsers = new Map<string, number>();

function worktreeUseKey(path: string): string {
  return path;
}

function reserveWorktree(path: string): () => void {
  const key = worktreeUseKey(path);
  pendingWorktreeUsers.set(key, (pendingWorktreeUsers.get(key) ?? 0) + 1);
  return () => {
    const next = (pendingWorktreeUsers.get(key) ?? 1) - 1;
    if (next > 0) pendingWorktreeUsers.set(key, next);
    else pendingWorktreeUsers.delete(key);
  };
}

function worktreeInUse(path: string): boolean {
  return (pendingWorktreeUsers.get(worktreeUseKey(path)) ?? 0) > 0
    || [...worktreeBySession.values()].some((rec) => rec.worktree.path === path);
}
function cacheSessionTitle(sessionId: string, title: string): void {
  const t = title.trim();
  if (!t) return;
  lastTitleBySession.delete(sessionId);
  lastTitleBySession.set(sessionId, t);
  if (lastTitleBySession.size > TITLE_CACHE_CAP) {
    const oldest = lastTitleBySession.keys().next().value;
    if (oldest !== undefined) lastTitleBySession.delete(oldest);
  }
}

/**
 * Name a tab from its opening instruction via the `tab-namer` LLM
 * micro-call. Shared by the Claude `UserPromptSubmit` hook route AND the
 * OpenCode spawn-time trigger (OpenCode has no hook surface to deliver this
 * over — see CLAUDE.md's harness-provider notes — so main fires it directly
 * from the prompt text it already has at spawn). One-shot per session via
 * `llmNamedSessions`; safe to call repeatedly (bails once fired, until the
 * call resolves failed/thrown and releases the guard for a retry).
 */
function fireTabNamer(sessionId: string, text: string): void {
  if (llmNamedSessions.has(sessionId)) return;
  if (store.getConfig().autoRenameTabs === false) return;
  const session = ptys.getSession(sessionId);
  if (!session || session.status === 'exited') return;
  if (session.profile === 'shell') return;
  const entry = promptRegistry.get('builtin:tab-namer');
  if (!entry) return;
  llmNamedSessions.add(sessionId);
  void llmService
    .run(entry, { prompt: text }, sessionId)
    .then((r) => {
      // A resolved-but-failed call (timeout / non-zero exit / empty output —
      // the provider never throws, so these land HERE, not in .catch) must
      // release the one-shot so a later prompt can retry. Cold `claude
      // --print` can exceed the timeout; without this, the most common
      // failure would silently disable naming for the tab forever. The tab
      // still falls back to the OSC idle-title until a retry succeeds.
      if (!r.ok || !r.text.trim()) {
        llmNamedSessions.delete(sessionId);
        return;
      }
      // Re-check liveness: the call takes ~10–20s, the tab may have closed.
      if (!ptys.getSession(sessionId)) return;
      cacheSessionTitle(sessionId, r.text.trim());
      safeSend(IPC.terminals.onTitle, sessionId, r.text.trim(), 'llm');
    })
    .catch((err) => {
      // Allow a retry on a later prompt if the call threw outright.
      llmNamedSessions.delete(sessionId);
      logMainError('tab-namer', err);
    });
}
/**
 * Host-resolved resume coordinates for an inbox entry (Rule 1) — the shared
 * implementation behind `inbox_push`'s `resolveOrigin` and the auto-report
 * linker, both of which need to stamp an entry with the SAME origin shape a
 * manual push would carry. Resolved from the live pty; null when the session
 * is unknown or isn't a resumable claude tab.
 */
function resolveInboxOrigin(sessionId: string): InboxOrigin | null {
  const s = ptys.getSession(sessionId);
  if (!s) return null;
  const title = lastTitleBySession.get(sessionId)?.trim() || undefined;
  return {
    claudeSessionId: s.claudeSessionId,
    profile: s.profile,
    personaId: s.personaId,
    cwd: s.cwd,
    ...(title ? { title } : {})
  };
}
/** Cap on a single menu-bar light reply — one short answer, not a paste dump. */
const MENUBAR_REPLY_MAX_CHARS = 2000;
function cacheTriage(result: IdleTriageResult): void {
  // Refresh-in-place keeps insertion order stable; a genuinely new key that
  // overflows the cap evicts the oldest (first inserted).
  lastTriageBySession.delete(result.sessionId);
  lastTriageBySession.set(result.sessionId, result);
  if (lastTriageBySession.size > TRIAGE_CACHE_CAP) {
    const oldest = lastTriageBySession.keys().next().value;
    if (oldest !== undefined) lastTriageBySession.delete(oldest);
  }
}
/**
 * Auto-close idle agents (OFF by default; one-click master toggle). Closes an
 * opted-in fleet's non-background, non-delegating agents after they sit idle for
 * the configured dwell — silently, but only after turning any parked question
 * into a durable follow-up via the cached idle-triage verdict, so the user never
 * loses an agent that was waiting on them. All collaborators injected so the
 * timer logic stays Electron-free and unit-testable (see {@link AutoCloseIdleService}).
 */
const autoCloseIdle = new AutoCloseIdleService({
  isEnabled: () => store.getConfig().autoCloseIdleEnabled === true,
  delayMinutes: () => store.getConfig().autoCloseIdleMinutes ?? AUTO_CLOSE_IDLE_DEFAULTS.minutes,
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          status: s.status,
          projectId: s.projectId,
          title: s.title,
          profile: s.profile,
          scheduled: s.scheduled,
          headless: s.headless,
          liveSubagents: agentStatus.subagents(sessionId),
          lastInputAt: s.lastInputAt
        }
      : null;
  },
  activeSessionId: () => activeForegroundSessionId,
  // Starred agents are pinned by the user, so the idle timer never reclaims them.
  // Resolve the session's persisted favorite key (stable `claudeSessionId` when
  // present, else the session id — mirrors the renderer's `favoriteKey`) and
  // check it against the renderer-reported star set. Advisory / spare-only.
  isFavorite: (sessionId) => {
    const s = ptys.getSession(sessionId);
    if (!s) return false;
    return favoriteAgentKeys.has(s.claudeSessionId ?? sessionId);
  },
  now: () => Date.now(),
  // Expected close ⇒ exit code 0 (this was the app's decision, not a crash).
  closeSession: (sessionId) => ptys.closeExpected(sessionId),
  // Best-effort, zero-token: re-run the idle→follow-up bridge from the cached
  // verdict so a parked question survives the close. createFromIdle dedups on
  // (session, open question), so calling it again is idempotent.
  preserveParkedQuestion: (sessionId) => {
    const verdict = lastTriageBySession.get(sessionId);
    if (!verdict || verdict.resolution !== 'awaiting-reply') return false;
    try {
      return followups.createFromIdle(verdict) != null;
    } catch (err) {
      logMainError('autoCloseIdle preserveParkedQuestion', err);
      return false;
    }
  },
  pushInbox: (input) => {
    void inboxStore.append(input).catch((err) => logMainError('autoCloseIdle pushInbox', err));
  },
  // OFF by default: an idle auto-close doesn't drop an inbox breadcrumb unless the
  // user opts in (a preserved parked question still surfaces regardless). Read live.
  shouldNotifyInbox: () => store.getConfig().autoCloseIdleNotifyInbox === true,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle)
});
/**
 * Agent mesh mail-drain: on the idle/done edge, nudge an agent to read any
 * queued peer messages it was sent while busy (it would otherwise never know to
 * call `agent_inbox`). Announce-only — the {@link agentMessageLog} queue stays
 * authoritative; this just injects "you have N unread, run agent_inbox". Driven
 * off the same resolved-state edge as idle-triage/heartbeat below.
 */
const mailDrain = new AgentMailDrainService({
  pending: (sessionId) =>
    agentMessageLog.pull(sessionId).map((m) => ({ id: m.id, fromHandle: m.fromHandle })),
  reply: (sessionId, text) => ptys.reply(sessionId, text)
});
/**
 * Keep-awake: hold a `prevent-app-suspension` power-save block while any agent
 * is actively `working`, so locking the Mac (which doesn't kill us) can't let
 * the system idle-sleep out from under an in-flight turn. Driven off the same
 * resolved-status edge as the add-ons above; released (after a grace window)
 * once every agent goes quiet, and on app teardown (Rule 3 — see before-quit).
 */
const keepAwake = new KeepAwakeService({
  // Default ON: absent config ⇒ keep awake. Only an explicit `false` disables it.
  isEnabled: () => store.getConfig().keepAwakeWhileWorking !== false,
  startBlocker: () => powerSaveBlocker.start('prevent-app-suspension'),
  stopBlocker: (id) => {
    // stop() warns if the id is already stopped; guard so a raced release is silent.
    if (powerSaveBlocker.isStarted(id)) powerSaveBlocker.stop(id);
  },
  graceMs: () => KEEP_AWAKE_DEFAULT_GRACE_MS,
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
  onChange: (active) =>
    console.log(`[keep-awake] ${active ? 'engaged — Mac will not idle-sleep' : 'released'}`)
});
/**
 * Close-idle work summary (optional step of the Agents board's Close-idle
 * action). Independent of the idle-triage add-on above: it runs a fresh
 * `builtin:close-summary` micro-call per agent at close time, folds them into
 * one inbox entry, and re-confines every renderer-supplied session id to the
 * target project before reading its transcript (CLAUDE.md #1). Injected deps so
 * the orchestration stays Electron-free and unit-testable.
 */
const closeSummary = new CloseSummaryService({
  getSession: (sessionId) => {
    const s = ptys.getSession(sessionId);
    return s
      ? {
          projectId: s.projectId,
          profile: s.profile,
          cwd: s.cwd,
          claudeSessionId: s.claudeSessionId,
          openCodeSessionId: s.openCodeSessionId,
          createdAt: s.createdAt,
          title: s.title
        }
      : null;
  },
  hasTranscript: (profile) => providerCapabilities(profile as LaunchProfileId).hasTranscript,
  readLastTurn: (ref) => transcriptSource.readLastTurn(ref),
  runSummary: (lastTurn, dedupeKey) => {
    const entry = promptRegistry.get('builtin:close-summary');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no close-summary prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { lastTurn }, dedupeKey);
  },
  runTurnSummary: (lastTurn, dedupeKey) => {
    const entry = promptRegistry.get('builtin:turn-summary');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no turn-summary prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { lastTurn }, dedupeKey);
  },
  readDigest: (ref) => transcriptSource.readDigest(ref),
  runSessionSummary: (digest, dedupeKey) => {
    const entry = promptRegistry.get('builtin:session-summary');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no session-summary prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { digest }, dedupeKey);
  },
  appendInbox: (input) =>
    inboxStore
      .append({
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        sessionId: input.sessionId,
        comments: input.comments
      })
      .then((e) => ({ id: e.id })),
  projectLabel: (projectId) => store.listProjects().find((p) => p.id === projectId)?.name,
  // Used only by summarizeAndClose (the CLI `term close-summary` path). Same
  // close primitive the control plane / IPC use; returns false on an unknown id.
  closeTerminal: (sessionId) => {
    if (!ptys.getSession(sessionId)) return false;
    ptys.close(sessionId);
    return true;
  },
  // Used only by summarizeAndFollowUp (the Agents view's "Close & follow up").
  // Origin/session are host-stamped here (Rule 1) — the follow-up is attributed
  // to the agent being closed, not agent free-text. `note` kind: it's an
  // informational reminder about work left, not a live question awaiting reply.
  createFollowUp: ({ projectId, sessionId, title, detail }) => {
    try {
      const f = followups.create({
        projectId,
        title,
        detail,
        kind: 'note',
        origin: { source: 'agent', sessionId },
        sessionId,
        scope: { projectId }
      });
      return f.id;
    } catch (err) {
      logMainError('closeSummary createFollowUp', err);
      return null;
    }
  }
});
/** Backs the Inbox "AI Summary" card — reads main's own inbox store (the source
 *  of truth, not the renderer's filtered view) and runs the
 *  `builtin:inbox-summary` micro-call to distill a standup-style digest, whole
 *  or scoped to one project. Deps injected so it stays Electron-free + testable. */
const inboxSummary = new InboxSummaryService({
  readEntries: async (projectId, limit) => {
    const { entries } = await inboxStore.read({
      limit,
      ...(projectId ? { projectId } : {})
    });
    return entries;
  },
  runSummary: (entries, dedupeKey) => {
    const entry = promptRegistry.get('builtin:inbox-summary');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no inbox-summary prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    // The service collapses every failure into a generic "summary-failed" the
    // card shows as "Couldn't generate a summary right now." Log the REAL reason
    // here (timeout / non-zero exit / auth) so an intermittent failure is
    // diagnosable instead of silently swallowed.
    return llmService.run(entry, { entries }, dedupeKey).then((r) => {
      if (!r.ok) logMainError('inbox-summary', `${r.error ?? 'unknown'} (${r.ms}ms)`);
      return r;
    });
  },
  runDetailedSummary: (entries, dedupeKey) => {
    const entry = promptRegistry.get('builtin:inbox-summary-detailed');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no inbox-summary-detailed prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { entries }, dedupeKey).then((r) => {
      if (!r.ok) logMainError('inbox-summary-detailed', `${r.error ?? 'unknown'} (${r.ms}ms)`);
      return r;
    });
  },
  projectLabel: (projectId) => store.listProjects().find((p) => p.id === projectId)?.name,
  // Rule-1 trust seam for click-to-spawn: map a model-echoed project NAME to a
  // canonical id against main's own list (case-insensitive, exact match on name),
  // or null when nothing matches — a hallucinated/stale name gets no spawn.
  resolveProjectByName: (name) => {
    const needle = name.trim().toLowerCase();
    if (!needle) return null;
    const match = store.listProjects().find((p) => p.name.trim().toLowerCase() === needle);
    return match?.id ?? null;
  }
});
/** Backs the Usage / cost dashboard (WARP R2 B7). Aggregates a privacy-safe
 *  {@link UsageSummary} across all registered projects from their Claude
 *  transcripts — a main-only read (Rule 1) that maps each project's registered
 *  (already-confined) path to its transcript stats. Bounded per Rule 5 (project
 *  / per-project session / total-transcript caps inside the service). Deps
 *  injected so it stays Electron-free + testable; never throws. This PR wires
 *  only the data layer — the renderer view lands in a follow-up. */
const usageService = new UsageService({
  listProjects: () => store.listProjects().map((p) => ({ id: p.id, name: p.name, path: p.path })),
  listSessions: (projectPath) => listClaudeSessions(projectPath),
  readStats: (projectPath, sessionId) => {
    const path = transcriptPath(projectPath, sessionId);
    return path ? readSessionStats(path) : Promise.resolve(null);
  },
  log: (msg) => console.log(`[main] ${msg}`)
});
/** Backs the OPTIONAL "Routine" feed-noise demotion (Settings → Experimental →
 *  off by default; the IPC handler also re-checks the flag). Reads main's own
 *  inbox store, gates to comment-only report candidates, runs the
 *  `builtin:feed-noise-classifier` micro-call, and returns the ids to fold.
 *  Deps injected; never throws (a failure yields an empty demotion set). */
const feedNoiseClassifier = new FeedNoiseClassifier({
  readEntries: async (projectId, limit) => {
    const { entries } = await inboxStore.read({ limit, ...(projectId ? { projectId } : {}) });
    return entries;
  },
  runClassify: (entries, dedupeKey) => {
    const entry = promptRegistry.get('builtin:feed-noise-classifier');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no feed-noise-classifier prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { entries }, dedupeKey).then((r) => {
      if (!r.ok) logMainError('feed-noise-classifier', `${r.error ?? 'unknown'} (${r.ms}ms)`);
      return r;
    });
  }
});
/** The "Approve for me" reviewer — a fail-closed micro-call that may downgrade an
 *  otherwise-denied extension capability request to auto-approve. DI + never-throws,
 *  the same shape as {@link feedNoiseClassifier}; wired into the permission broker
 *  below via {@link ReviewerBroker}. */
const reviewerApproval = new ReviewerApprovalService({
  runReview: (req, dedupeKey) => {
    const entry = promptRegistry.get('builtin:approve-reviewer');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no approve-reviewer prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService
      .run(entry, { summary: req.summary, permission: req.permission, moduleId: req.moduleId }, dedupeKey)
      .then((r) => {
        if (!r.ok) logMainError('approve-reviewer', `${r.error ?? 'unknown'} (${r.ms}ms)`);
        return r;
      });
  }
});
/** Per-project Activity Feed — the PERSISTED slice (git commits + extension /
 *  project lifecycle) that has no other durable home. All other feed events are
 *  DERIVED live by {@link FeedService} from the inbox / followups / goals /
 *  library stores, so nothing is duplicated. Emits `'changed'` per projectId. */
const feedStore = new FeedStore((projectId) =>
  store.listProjects().find((p) => p.id === projectId)
);
feedStore.setLogger(logMainError);
/** Assembles a project's feed on demand: persisted slice + derived milestones +
 *  on-demand `git log` snapshot → merged, sorted newest-first, paginated. Reads
 *  main's own stores (Rule 1); never throws. */
const feedService = new FeedService({
  store: feedStore,
  readInbox: async (projectId, limit) => {
    const { entries } = await inboxStore.read({ limit, projectId });
    return entries;
  },
  listFollowups: () => followups.list(),
  listGoals: () => goals.list(),
  listLibrary: () => libraryStore.list(),
  getRecentCommits: (cwd, limit) => getRecentCommits(cwd, limit),
  resolveProject: (projectId) => {
    const p = store.listProjects().find((proj) => proj.id === projectId);
    return p ? { path: p.path, name: p.name } : undefined;
  },
  logger: logMainError
});
/** Backs the Feed "recap" card — reads main's own feed (via {@link feedService})
 *  and runs the `builtin:feed-digest` micro-call. Deps injected; never throws. */
const feedSummary = new FeedSummaryService({
  readEvents: async (projectId, limit) => {
    const page = await feedService.list(projectId, { limit });
    return page.events;
  },
  runSummary: (entries, dedupeKey) => {
    const entry = promptRegistry.get('builtin:feed-digest');
    if (!entry) {
      return Promise.resolve({
        ok: false,
        text: '',
        error: 'no feed-digest prompt',
        provider: 'claude-cli',
        ms: 0
      });
    }
    return llmService.run(entry, { entries }, dedupeKey);
  }
});
/** Stamp a greenfield feed event (project / extension lifecycle) into the
 *  persisted slice. Best-effort + idempotent via dedupeKey — a write failure or
 *  duplicate is a no-op, never a thrown error into the calling IPC handler. */
function stampFeedEvent(
  projectId: string,
  kind: FeedEventInput['kind'],
  title: string,
  dedupeKey: string,
  detail?: string
) {
  try {
    feedStore.append({ projectId, kind, ts: Date.now(), title, detail, dedupeKey });
  } catch (err) {
    logMainError('stampFeedEvent', err);
  }
}
/** Latest discovered runtime extensions; refreshed on boot + enable/disable.
 *  Declared early so the persona/team registry can resolve an extension's title
 *  from its id at registration time. */
let extensionEntries: ExtensionEntry[] = [];
/** Disk-extension spawn specs from the last load, keyed by id — retained so a
 *  single extension can be relaunched (teardown + respawn its child) without a
 *  full re-discovery. Refreshed on every loadExtensions. */
const diskSpecsById = new Map<string, DiskExtensionSpec>();
// Shared in-memory registry for extension-contributed personas/teams (design
// §3a). Both module hosts write to it (keyed by the authenticated moduleId);
// the persona/team stores read from it and re-emit `changed` on (de)registration.
const personaTeamRegistry = new PersonaTeamRegistry(() => extensionEntries);
const sshHostProviderRegistry = new SshHostProviderRegistry();
const personas = new PersonaStore(() => store.listProjects(), personaTeamRegistry);
const teams = new TeamStore(() => store.listProjects(), personaTeamRegistry);
// Host-managed MCP server pool (trusted core subsystem). Backs the brokered
// `ctx.mcp` capability for the zana disk extension (and the ungated built-in
// tier). Constructed ONCE here at app init; `disposeAll()` runs on before-quit
// (Rule 3). `resolveWorkspace` confines a renderer/ext-supplied projectPath
// against a registered project (Rules 1/2) via the pure `resolveProjectRoot`,
// then returns the workspace ROOT (the zana server manages `.zana` UNDER it via
// ZANA_WORKSPACE, so we hand it the parent of the resolved `.zana` dir).
const mcpPool = new McpPool({
  servers: [ZANA_SERVER_DEF],
  resolveWorkspace: (opts) =>
    dirname(
      resolveProjectRoot(opts, { listProjects: () => store.listProjects(), home: app.getPath('home') })
    ),
  log: logMainError
});

// --- microVM playground pool (Rule 3/7) ------------------------------------
// A host-managed pool of persistent, isolated microVM guests a NATIVE agent
// drives from OUTSIDE via the `microvm_exec` MCP tool (clone/build/run untrusted
// code in a VM with no host filesystem access). Constructed ONCE here; disposed
// on shutdown. The SDK is confined to `microvm/pool.ts` (Rule 7) and loaded
// lazily, so an Intel Mac / addon-less build never touches it — the pool just
// fails closed. `enabled` re-reads the live config each call so the Settings
// toggle takes effect without a restart; `platformSupported` gates before any
// SDK load.
const microVmPool = new MicroVmPool({
  enabled: () => store.getConfig().microVmEnabled === true,
  platformSupported: microVmPlatformSupported,
  log: logMainError
});

// Host-managed live-stream relay backs the brokered `ctx.stream` capability.
// Its endpoint registry remains host-owned so extensions cannot name arbitrary
// sockets or URLs; it is empty until core exposes another approved transport.
const streamSink = {
  frame: (subId: string, frame: unknown) => safeSend(IPC.modules.streamFrame, subId, frame),
  done: (subId: string, reason: { ok: boolean; error?: string }) =>
    safeSend(IPC.modules.streamDone, subId, reason)
};
const streamRelay = new StreamRelay({
  endpoints: [],
  sink: streamSink,
  log: logMainError
});
const moduleHost = new MainModuleHost({
  log: logMainError,
  // Back the built-in `ctx.resolveProjectRoot` confinement gate (A3): without
  // these deps the ctx omits resolveProjectRoot and zana fails closed at setup,
  // registering zero capabilities (→ "Unknown capability: zana.getSnapshot").
  listProjects: () => store.listProjects(),
  home: app.getPath('home'),
  // Back `ctx.personas` / `ctx.teams` for the in-process built-in tier. The host
  // stamps provenance from `mod.id` (never self-declared); cleared on teardown.
  registry: personaTeamRegistry,
  // Back `ctx.mcp` for the in-process built-in tier (ungated; pool still confines).
  mcpPool,
  // Back the generic built-in `ctx.summarizeSession` (Slack answer-relay et al.).
  // Confinement (CLAUDE.md #1): resolve the supplied id to a LIVE session and
  // take projectId FROM that session — never from the caller — then summarizeTurn
  // re-confines before reading. An unknown id → {ok:false}, never a read.
  summarizeSession: async (sessionId) => {
    const s = ptys.getSession(sessionId);
    if (!s) {
      console.log(`[slack-relay] summarizeSession session=${sessionId.slice(0, 8)} → no live session`);
      return { ok: false };
    }
    console.log(
      `[slack-relay] summarizeSession session=${sessionId.slice(0, 8)} project=${s.projectId} ` +
        `profile=${s.profile} claudeSessionId=${s.claudeSessionId ? s.claudeSessionId.slice(0, 8) : 'NONE'} cwd=${s.cwd}`
    );
    const res = await closeSummary.summarizeTurn(s.projectId, sessionId);
    console.log(
      `[slack-relay] summarizeTurn session=${sessionId.slice(0, 8)} → ok=${res.ok} len=${res.text?.length ?? 0}`
    );
    return res;
  }
});
/**
 * Cached consent map (`~/.zcc/extensions/consent.json`), refreshed
 * whenever `extensionEntries` is. The GrantProvider reads it synchronously to
 * intersect declared ∩ consented; `refreshExtensionState()` keeps both in sync.
 */
let consentMap: ConsentMap = {};
// P3-B/P3-D: ENFORCE the declared ExtensionPermission union as deny-by-default
// gates, intersected with what the user CONSENTED to. Built-in MAIN_MODULES
// (zana/slack) are TRUSTED → `can()` always allows them (tier on provenance).
// Disk extensions are not registered here; they are broker-gated at runtime.
//
// P3-D FLIP: the granted set is now `declared ∩ consented` (the consent map),
// not bare `declared`. An ext with no consent record → empty effective perms →
// everything denied (and it isn't spawned/mounted in the first place — see the
// loader). The broker / caps / handleBroker / renderer gate are UNCHANGED; only
// this provider changed, exactly as the P3-B seam was designed for.
const builtinIds = new Set<string>(MAIN_MODULES.map((m) => m.id));
const permissionBroker = new PermissionBroker({
  builtinIds,
  grants: (moduleId) => {
    if (builtinIds.has(moduleId)) return null; // built-ins never gated here
    const entry = extensionEntries.find((e) => e.id === moduleId);
    if (!entry || !entry.manifest) return null; // unknown / no manifest → deny
    // Effective granted = declared ∩ consented. No consent → [] → all denied.
    const granted = effectivePermissions(entry.manifest.permissions, consentMap, moduleId);
    return grantFromManifest(granted, entry.manifest.permissionScopes, entry.path);
  },
  audit: (a) =>
    logMainError(
      'permission-audit',
      `${a.allow ? 'ALLOW' : 'DENY'} ${a.moduleId} ${a.permission}${a.scope ? ` ${a.scope}` : ''}`
    )
});
// "Approve for me" gate — a decorator over the deterministic broker. In 'ask'
// (default) / 'fullAccess' mode it is a pure passthrough; in 'approveForMe' it
// may downgrade a narrow, eligible deny to allow on a cached reviewer verdict.
// It NEVER upgrades a hard/structural deny. The mode thunk re-reads config each
// call so a live toggle takes effect without re-wiring (rule 1: main authorizes).
const gatedBroker = new ReviewerBroker(
  permissionBroker,
  () => store.getConfig().reviewerApprovalMode ?? 'ask',
  reviewerApproval
);
// W1-4 trust inversion: the core-owned relay backing `ctx.host.*`. It pushes
// ephemeral shell nudges core→renderer via `IPC.modules.hostCommand`, and holds
// the DURABLE per-module parked-launch queue (Rule 5 bounded, Rule 3 cleared on
// child exit via caps.streamCloseAll). Constructed ONCE here (Rule 3). Park is
// enforced HERE off the authenticated tier — only a built-in may issue an
// immediate launch; a disk ext is always parked (its `autoLaunch` ignored).
const hostCommandRelay = new HostCommandRelay({
  send: (cmd) => safeSend(IPC.modules.hostCommand, cmd),
  isBuiltin: (moduleId) => builtinIds.has(moduleId),
  genId: () => randomUUID(),
  // W1-5 main-reachable confirm/notify fail closed when no window can render the
  // dialog — an unanswerable confirm resolves `false`, never hangs the child.
  canDeliverDialog: () => windows.size > 0,
  showConfirm: async (moduleId, spec) => {
    const parent = BrowserWindow.getFocusedWindow() ?? undefined;
    const options = {
      type: spec.danger ? 'warning' as const : 'question' as const,
      title: spec.title || 'Extension confirmation',
      message: spec.title || 'Extension confirmation',
      detail: `${spec.body ? `${spec.body}\n\n` : ''}Requested by extension: ${moduleId}`,
      buttons: [spec.confirmLabel || 'Confirm', spec.cancelLabel || 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      noLink: true
    };
    const result = parent && !parent.isDestroyed()
      ? await dialog.showMessageBox(parent, options)
      : await dialog.showMessageBox(options);
    return result.response === 0;
  }
});
// P3-A: untrusted DISK extensions run OUT-OF-PROCESS, one `utilityProcess` each.
// Disk extensions run out-of-process through the broker. The
// process host's storage broker reuses moduleHost's KV store, so disk-ext and
// built-in storage share one on-disk implementation; the anti-spoof guarantee
// is that a disk-ext CHILD reaches storage only via its broker, where the host
// substitutes the authenticated id (`process-host.ts` handleBroker). P3-B: the
// brokered exec/fs/fetch caps are gated against `permissionBroker` keyed by that
// same authenticated id.
let extProcessHost: ExtensionProcessHost;
let moduleRouter: ModuleRouter;
extProcessHost = new ExtensionProcessHost({
  spawn: spawnUtilityChild,
  storage: {
    get: (id, key) => moduleHost.storageGet(id, key),
    set: (id, key, value) => moduleHost.storageSet(id, key, value)
  },
  caps: createBrokerCapabilities(gatedBroker, {
    mcpPool,
    // Brokered `ctx.stream`: the core-owned relay above owns the live connection;
    // the cap gates (`stream` perm + `streamAllowlist`) and delegates to it. On a
    // child teardown/crash the process host calls `caps.streamCloseAll(id)` →
    // `relay.closeForModule(id)`, releasing every subscription the ext held.
    streamRelay,
    // W1-3 `ctx.emit`: reuse the SAME sink StreamRelay sends through so frames go
    // core→renderer via IPC.modules.streamFrame. The cap namespaces topic to
    // `ext:<moduleId>:<topic>` (authenticated) and bounds frames (≤128KiB, ~50fps).
    sink: streamSink,
    // Epic C brokered `ctx.llm`: reuse the host's own micro-call engine, gated
    // by the global `extensionLlmEnabled` kill switch (ships OFF). The thunk
    // re-reads config so a live toggle flips it without re-wiring the caps.
    llmService,
    llmEnabled: () => store.getConfig().extensionLlmEnabled === true,
    // W1-4 trust inversion `ctx.host.*`: the caps layer gates (session:launch /
    // projects:select) and delegates the renderer-only action to this relay.
    hostCommands: hostCommandRelay,
    remoteDefaults: {
      get: () => {
        const remoteDefaultPath = store.getConfig().remoteDefaultPath;
        return remoteDefaultPath ? { remoteDefaultPath } : {};
      },
      set: (input) => {
        store.setConfig({ remoteDefaultPath: input.remoteDefaultPath });
        const remoteDefaultPath = store.getConfig().remoteDefaultPath;
        return remoteDefaultPath ? { remoteDefaultPath } : {};
      }
    },
    installExtensionFromGit: async ({ url }) => {
      const gitRes = await installFromGit(
        url,
        { onProgress: (line) => safeSend(IPC.extensions.installProgress, line) },
        { reservedIds: builtinIds, log: logMainError }
      );
      if (!gitRes.ok) throw new Error(gitRes.message);
      const rec = await markGit(gitRes.value.id, {
        ...gitRes.value.provenance,
        installedAt: new Date().toISOString()
      });
      if (!rec.ok) {
        await uninstallExtension(gitRes.value.id, { reservedIds: builtinIds, log: logMainError }).catch(() => {});
        throw new Error('Could not record extension provenance');
      }
      extProcessHost.markPendingInstall(gitRes.value.id);
      await runDiskSync();
      return { id: gitRes.value.id };
    },
    // Phase B: brokered `ctx.inbox.push`. Gated by the same `inbox:push` token
    // as the renderer-panel path; `projectExists` re-authorizes the target
    // (Rule 1/2) so a grant to push isn't a grant to target any projectId.
    inbox: { inboxStore, projectExists: (id) => store.listProjects().some((p) => p.id === id) }
  }),
  // Disk-ext persona/team contribution routes here; the host stamps provenance
  // from the authenticated `state.moduleId` bound to the child's port.
  registry: personaTeamRegistry,
  listInstalledExtensions: () =>
    extensionEntries
      .filter((entry) => entry.manifest)
      .map((entry) => ({ id: entry.id })),
  log: logMainError
});
// The single dispatch entry the `modules:call` IPC handler routes through:
// built-in id → in-process moduleHost; disk-ext id → out-of-process child.
moduleRouter = new ModuleRouter(moduleHost, extProcessHost);
// Register (or heal) the dedicated Extensions-category project for a local
// extension and fire the SAME side effects a normal `projects.add` does — the
// cross-store rebinds AND the `projects:onChanged` push so the sidebar shows
// the new "Extensions" group live (createLocal is an extensions IPC, so the
// renderer wouldn't otherwise re-pull the project list). Idempotent: on a
// reload/continue against an already-registered project it's a cheap no-op
// beyond the refresh.
const registerExtensionProject = (workingDir: string, name: string): Project => {
  const existed = store.listProjects().some((p) => p.path === workingDir);
  const project = store.ensureExtensionProject(workingDir, name);
  if (!existed) {
    ensureMcpConfigForProject(project.id).catch((err) =>
      logMainError(`ensureMcpConfigForProject(${project.id})`, err)
    );
    templates.rebindProjects();
    personas.rebindProjects();
    teams.rebindProjects();
    libraryStore.rebindProjects?.();
    scheduler.rebindWatchers();
    goals.rebindWatchers();
    followups.rebindWatchers();
  }
  safeSend(IPC.projects.onChanged, store.listProjects());
  return project;
};
// Pack a local extension's source working dir + install it through the
// trusted seam + reconcile — the shared tail of `createLocal`, `reinstallLocal`,
// the `install_local_extension` MCP tool, and the hot-reload watcher. One code
// path so the four triggers can't diverge on the actual install mechanics.
const packAndInstallLocal = async (
  id: string,
  workingDir: string
): Promise<Result<{ id: string }>> => {
  const packed = await packLocalExtension(workingDir);
  if (!packed.ok) return packed;
  try {
    // Verify the packed snapshot, rather than the mutable source directory, so
    // an edit racing this operation cannot install bytes under another id.
    const packedId = await readWorkingDirId(packed.value.stagingDir);
    if (packedId !== id) {
      return {
        ok: false,
        code: 'ID_MISMATCH',
        message: `Packed manifest id "${packedId ?? '(none)'}" does not match "${id}"`
      };
    }
    const installed = await installFromDir(packed.value.stagingDir, {
      reservedIds: builtinIds,
      log: logMainError
    });
    if (!installed.ok) return installed;
    await runDiskSync();
    return installed;
  } finally {
    await rm(packed.value.stagingDir, { recursive: true, force: true }).catch(() => {});
  }
};
// Create a LOCAL (in-app authored) extension. Caller supplies only display
// intent (name/description/kind) — main mints the id and derives every path
// (Rule 1). Flow: mint unique id → scaffold source template into the scratch
// working dir → packAndInstallLocal (SAME manifest/id/api/reserved gates as any
// install) → markLocal → reconcile → register the dedicated Extensions-category
// project. Shared by the `createLocal` IPC handler and the `create_local_extension`
// MCP tool so the two entry points can't diverge. The agent's source dir is
// INERT; only the packed, gate-checked bytes install. Consent still applies (the
// template declares no permissions, so a bare panel installs consent-free;
// adding one later re-prompts).
const createLocalExtension = async (
  req: { name: string; description?: string; kind?: unknown }
): Promise<Result<CreateLocalExtensionResult>> => {
  const name = (req?.name ?? '').trim();
  if (!name) return { ok: false, code: 'BAD_NAME', message: 'A name is required' };
  // Mint an id unique against BOTH installed ids and reserved built-ins so it
  // can never shadow a trusted module or collide with an existing install.
  const taken = new Set<string>([...builtinIds, ...extensionEntries.map((e) => e.id)]);
  const id = mintLocalId({ name, taken });
  // Working dir under the scratch workspace — never HOME/a project/~/.zcc.
  const workingDir = workingDirFor(scratchWorkspaceRoot(), id);
  const scaffolded = await scaffoldLocalExtension(workingDir, {
    id,
    name,
    description: req.description,
    // Clamp the caller-supplied kind to a known template (Rule 1).
    kind: clampLocalKind(req.kind)
  });
  if (!scaffolded.ok) return scaffolded;
  const installed = await packAndInstallLocal(id, workingDir);
  if (!installed.ok) return installed;
  // Record the local pointer + mark-install so onInstall fires. Done AFTER
  // install so the freshly-discovered entry is already stamped source:'local'.
  await markLocal(id, workingDir).catch((err) => logMainError(`markLocal ${id}`, err));
  extProcessHost.markPendingInstall(id);
  // A dedicated project rooted at the extension's working dir, grouped under
  // the "Extensions" category so the Creator agent has a stable home (rather
  // than sharing the flat Quick Agent scratch). The dir exists (scaffold
  // mkdir'd it); the working dir is scratch-confined, so the project root is
  // too. Terminal spawn confines cwd to this project root (Rule 2). Wiring +
  // the projects:onChanged push (so the sidebar shows the new "Extensions"
  // group live) go through the shared helper.
  const project = registerExtensionProject(workingDir, name);
  // Feed: a local extension has a real per-project home (its Extensions-
  // category project), so its lifecycle IS observable in that project's feed.
  // Global (marketplace/bundled/dir) installs have no project home, so they
  // aren't stamped — the feed is strictly per-project (Rule 1).
  stampFeedEvent(
    project.id,
    'extension-installed',
    `Extension created: ${name}`,
    `extension-installed:${id}`
  );
  return { ok: true, value: { id, workingDir, projectId: project.id } };
};
// Register an already-existing source directory as local authoring source. Both
// the native-folder and repository-clone entry points terminate here so their
// validation, rollback, install, and project-registration behavior stays equal.
const adoptLocalSource = async (workingDir: string): Promise<Result<CreateLocalExtensionResult>> => {
  const id = await readWorkingDirId(workingDir);
  if (!id) {
    return { ok: false, code: 'NO_MANIFEST', message: 'Selected folder has no valid extension.json id' };
  }
  if (builtinIds.has(id)) {
    return { ok: false, code: 'RESERVED_ID', message: `"${id}" is a built-in and cannot be imported` };
  }

  // Preserve an existing source pointer if a failed import attempts to adopt a
  // replacement directory for the same installed extension.
  const previous = await getLocalRecord(id);
  const marked = await markLocal(id, workingDir);
  if (!marked.ok) return marked;
  const installed = await packAndInstallLocal(id, workingDir);
  if (!installed.ok) {
    if (previous) await markLocal(id, previous.workingDir).catch(() => {});
    else await clearLocal(id).catch(() => {});
    return installed;
  }

  const name = extensionEntries.find((entry) => entry.id === id)?.manifest?.title ?? id;
  const project = registerExtensionProject(workingDir, name);
  return { ok: true, value: { id, workingDir, projectId: project.id } };
};
// Hot-reload for a local extension being actively developed: while a live
// terminal session's cwd sits inside its working dir, watch `dist/` and
// auto pack+reinstall on change (reuses packAndInstallLocal — no new install
// logic). Bounded per Rule 5: armed/released per-session via
// onSessionMaybeLocal/onSessionExit inside wireBridgeListeners(), never a
// permanent watch on every scaffolded extension.
const localExtensionWatcher = new LocalExtensionWatcher({
  isEnabled: () => store.getConfig().localExtensionHotReloadEnabled ?? true,
  findLocalRecordByCwd,
  readWorkingDirId,
  reinstall: (id, workingDir) => packAndInstallLocal(id, workingDir),
  onFailure: (id, workingDir, message) => {
    logMainError(`localExtensionWatcher ${id}`, message);
    // Best-effort breadcrumb into the extension's own project (if it has one),
    // mirroring HeartbeatDeps.pushInbox's "silent background action needs a
    // human-visible trace" pattern.
    const project = store.listProjects().find((p) => p.path === workingDir);
    if (!project) return;
    void inboxStore
      .append({
        projectId: project.id,
        subject: `Hot-reload failed — ${project.name}`,
        comments: `**Hot-reload failed** for "${project.name}": ${message}`,
        dedupeKey: `local-extension-hot-reload-failed:${id}`
      })
      .catch((err) => logMainError('localExtensionWatcher pushInbox', err));
  }
});
const skillBundles = new SkillBundlesStore();
const scheduleGroups = new ScheduleGroupsStore();
const skillWatchers: FSWatcher[] = [];
let activeProjectSkillsWatchers: FSWatcher[] = [];
let activeProjectSkillsPath: string | null = null;
let activeProjectSkillsId: string | null = null;
let skillChangeDebounce: NodeJS.Timeout | null = null;
// Hot-reload of disk extensions: a single watcher on ~/.zcc/extensions + its
// debounce timer. Rule #3 — init ONCE at bootstrap (never createWindow), store
// the single handle + timer at module scope, release both on shutdown.
let extensionsWatcher: FSWatcher | null = null;
let extensionsChangeDebounce: NodeJS.Timeout | null = null;
let mcpServer: McpServerHandle | null = null;
let controlPlane: ControlPlaneHandle | null = null;

// Resolve packaged or unpackaged icon location. In dev electron-vite runs from
// repo root with __dirname=out/main, so the parent is the project root. Once
// packaged, electron-builder copies resources/ next to app.asar via `extraResources`,
// surfaced as process.resourcesPath.
function resolveIconPath(): string | null {
  const candidates = [
    process.resourcesPath ? join(process.resourcesPath, 'icon.icns') : null,
    process.resourcesPath ? join(process.resourcesPath, 'icon-1024.png') : null,
    join(__dirname, '../../resources/icon.icns'),
    join(__dirname, '../../resources/icon-1024.png')
  ].filter((p): p is string => !!p);
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function safeSend(channel: string, ...args: unknown[]) {
  // E2E tap: no-op export when ZCC_E2E is unset (one call into an empty fn — no
  // allocation, no push — so production timing is unaffected). See test-tap.ts.
  testTap.record(channel, args);
  for (const { win } of windows.values()) {
    if (win.isDestroyed() || win.webContents.isDestroyed()) continue;
    try {
      win.webContents.send(channel, ...args);
    } catch (err) {
      logMainError(`send ${channel}`, err);
    }
  }
}

/**
 * Send a menu/accelerator event to the window the user is currently acting on.
 * Menu items (new tab, toggle workspace mode, …) must hit the focused window —
 * a scoped project window included — not always the main one. Falls back to the
 * main window when nothing is focused (e.g. the menu fired while unfocused).
 */
function sendToFocused(channel: string, ...args: unknown[]) {
  const target = BrowserWindow.getFocusedWindow() ?? mainWindow();
  if (!target || target.isDestroyed() || target.webContents.isDestroyed()) return;
  try {
    target.webContents.send(channel, ...args);
  } catch (err) {
    logMainError(`sendToFocused ${channel}`, err);
  }
}

/**
 * Bring the full-shell (unscoped) window forward, recreating it if none is live.
 * Deliberately targets the UNSCOPED window: if only scoped project windows are
 * open, the tray/menu "show window" must give the user back the full shell, not
 * focus a single-project window they can't navigate out of.
 */
/**
 * Re-assert "regular" (Dock-present) activation on macOS. We ship NO
 * `LSUIElement` in Info.plist, yet the app can end up accessory/menu-bar-only —
 * LaunchServices can cache a stale `UIElement` classification for our bundle id
 * (common with many local dev builds sharing `dev.grebmann.zana-command-center`),
 * and the policy can also drift to accessory during a long-lived session. This
 * is idempotent and a no-op when already regular, so it's safe to call on every
 * window surface — not just at boot — which is what keeps the Dock icon from
 * silently vanishing mid-session (the boot-only claim never recovered it). Only
 * matters on macOS.
 */
function claimDock() {
  if (process.platform !== 'darwin') return;
  try {
    app.setActivationPolicy('regular');
    app.dock?.show();
  } catch (err) {
    logMainError('dock.claim', err);
  }
}

function showMainWindow() {
  claimDock();
  const win = unscopedWindow();
  if (!win) {
    createWindow(undefined, startupState.mode === 'repair-required');
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Open (or focus) a window scoped to a single project. Re-uses an existing
 * window already showing that project rather than spawning a duplicate, so the
 * gesture is idempotent. The `projectId` is validated against the store before
 * a window opens — the renderer is untrusted (CLAUDE.md #1), so an unknown id
 * is rejected here, not just advisory-checked in the renderer.
 */
function openProjectWindow(projectId: string) {
  if (!store.listProjects().some((p) => p.id === projectId)) {
    logMainError('openProjectWindow', `unknown projectId ${projectId}`);
    return;
  }
  for (const { win, projectId: pid } of windows.values()) {
    if (pid === projectId && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
      return;
    }
  }
  createWindow(projectId);
}

/**
 * Loud-tier (`InboxNotifyLevel === 'loud'`) OS presence — a native banner when
 * unfocused, plus a macOS dock badge independent of the renderer's unread
 * count (which main can't see: it lives in `useInboxRead`, a renderer-local
 * zustand `persist` store). Deliberately separate from `TrayController`'s
 * fleet-attention badge (a different signal — blocked agents, not inbox
 * loudness); see the CLAUDE.md coupling note on why the two never merge.
 *
 * `loudSinceFocus` only ever increments while every window is unfocused and
 * resets to 0 the moment any window regains focus — so the dock badge tracks
 * "loud entries you haven't come back to yet," not a running total.
 */
let loudSinceFocus = 0;
/** Disposer for the once-registered `inboxStore.onAppended` loud-tier subscription; released in before-quit (Rule 3). */
let offLoudInboxAppended: (() => void) | null = null;

function clearLoudBadge() {
  loudSinceFocus = 0;
  if (process.platform === 'darwin') app.dock?.setBadge('');
}

function handleLoudInboxEntry(entry: InboxEntry) {
  if (entry.notify !== 'loud') return;
  const anyFocused = [...windows.values()].some(({ win }) => !win.isDestroyed() && win.isFocused());
  if (anyFocused) return;
  if (process.platform === 'darwin') {
    loudSinceFocus += 1;
    app.dock?.setBadge(String(loudSinceFocus));
  }
  try {
    const notification = new Notification({
      title: entry.subject ?? entry.projectLabel ?? 'Zana Command Center',
      body: entry.comments ?? 'New notification'
    });
    notification.on('click', () => {
      showMainWindow();
      safeSend('app:focusInboxEntry', entry.id, entry.projectId);
    });
    notification.show();
  } catch (err) {
    logMainError('loudInboxNotification', err);
  }
}

function safeHandle<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (...args: TArgs) => TResult | Promise<TResult>,
  onError: (err: unknown, ...args: TArgs) => TResult
) {
  ipcMain.handle(channel, async (_event, ...args: TArgs) => {
    try {
      return await handler(...args);
    } catch (err) {
      logMainError(`ipc ${channel}`, err);
      return onError(err, ...args);
    }
  });
}

function safeHandleFromWindow<TArgs extends unknown[], TResult>(
  channel: string,
  handler: (win: BrowserWindow, ...args: TArgs) => TResult | Promise<TResult>,
  onError: (err: unknown, ...args: TArgs) => TResult
) {
  ipcMain.handle(channel, async (event, ...args: TArgs) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (!win || !windows.has(win.id)) throw new Error('calling window is unavailable');
      return await handler(win, ...args);
    } catch (err) {
      logMainError(`ipc ${channel}`, err);
      return onError(err, ...args);
    }
  });
}

/**
 * Resolve a framework-preset launch (Advanced Quick Agent) into ONE synthetic,
 * host-stamped {@link Persona}. Each id in `frameworkIds` names an installed
 * extension; main reads that extension's `agentPreset` from its OWN copy of the
 * discovered manifest view ({@link ExtensionManifestView.agentPreset}) — never
 * from any renderer-supplied text — and MERGES their primers, in order, into a
 * single persona whose `appendSystemPrompt` is the joined framework primer.
 * Launching that persona routes the primer through the existing, audited
 * `personaArgs_build` → `--append-system-prompt` path (pty.ts), so there is NO
 * bespoke per-framework injection code and no extension id in core launch logic
 * (Rule 6). Provenance is stamped `{ extensionId }` from the (first) authenticated
 * entry id, mirroring extension-contributed personas.
 *
 * Returns undefined when NO id resolves to a preset with a non-empty primer — the
 * caller then falls back to a bare launch. `personaId` takes precedence over
 * `frameworkIds` and is handled by the normal persona path, so this is only
 * consulted when no explicit persona was chosen.
 *
 * `includeInitialPrompt` gates the presets' opening prompt: the pty writes a
 * persona's `initialPrompt` to the session after first data, which would collide
 * with the user's own task (delivered as the positional argv turn). So the
 * caller passes `false` when the user typed a task — the primers still inject,
 * but the frameworks' kickoff prompt is dropped so the user's turn runs alone.
 * When the box was empty, the FIRST framework's kickoff IS the first turn.
 */
export function resolveFrameworkPersona(
  frameworkIds: string[],
  includeInitialPrompt: boolean
): Persona | undefined {
  return frameworkPersonaFromEntries(extensionEntries, frameworkIds, includeInitialPrompt);
}

/**
 * Pure core of {@link resolveFrameworkPersona} — takes the entry list explicitly
 * so it's unit-testable without the module-scoped `extensionEntries` closure.
 * Reads the primer only from the passed entries (main's trusted copy), never
 * from renderer input. Accepts a single id or a list; unknown / preset-less /
 * empty-primer ids are silently dropped from the merge.
 */
export function frameworkPersonaFromEntries(
  entries: ExtensionEntry[],
  frameworkIds: string | string[],
  includeInitialPrompt: boolean
): Persona | undefined {
  const ids = (Array.isArray(frameworkIds) ? frameworkIds : [frameworkIds]).filter(Boolean);
  // Resolve each id → its trusted preset, dropping unknown / primer-less ones.
  const resolved = ids
    .map((id) => {
      const entry = entries.find((e) => e.id === id);
      const preset = entry?.manifest?.agentPreset;
      if (!preset || !preset.systemPrompt?.trim()) return null;
      return { id, preset, title: entry?.manifest?.title ?? id };
    })
    .filter((r): r is { id: string; preset: AgentPresetView; title: string } => r !== null);
  if (resolved.length === 0) return undefined;

  // Single-framework launch keeps the original 1:1 shape (name/icon/id are the
  // one extension's) — byte-identical to the pre-multi behavior.
  if (resolved.length === 1) {
    const { id, preset, title } = resolved[0];
    return {
      id: `framework:${id}`,
      name: preset.label || title,
      icon: preset.icon,
      description: preset.description,
      baseProfile: preset.baseProfile ?? 'claude',
      model: preset.model,
      appendSystemPrompt: preset.systemPrompt,
      initialPrompt: includeInitialPrompt ? preset.initialPrompt : undefined,
      source: { extensionId: id, extensionTitle: title }
    };
  }

  // Multi-framework launch: MERGE the primers into one persona. The primers are
  // joined in selection order under labelled separators so the model can tell the
  // stacked frameworks apart. baseProfile/model/icon take the FIRST present value
  // (a single spawn has one base command + one model); the kickoff prompt is the
  // first framework that declares one. Provenance stamps the first extension.
  const first = resolved[0];
  const names = resolved.map((r) => r.preset.label || r.title);
  const mergedPrompt = resolved
    .map((r) => `## Framework: ${r.preset.label || r.title}\n\n${r.preset.systemPrompt.trim()}`)
    .join('\n\n');
  const kickoff = resolved.map((r) => r.preset.initialPrompt).find((p) => p?.trim());
  return {
    id: `framework:${resolved.map((r) => r.id).join('+')}`,
    name: names.join(' + '),
    icon: first.preset.icon,
    description: `Merged frameworks: ${names.join(', ')}`,
    baseProfile: resolved.map((r) => r.preset.baseProfile).find(Boolean) ?? 'claude',
    model: resolved.map((r) => r.preset.model).find((m) => m && m !== 'default'),
    appendSystemPrompt: mergedPrompt,
    initialPrompt: includeInitialPrompt ? kickoff : undefined,
    source: { extensionId: first.id, extensionTitle: first.title }
  };
}

/**
 * ASYNC pre-step for an ISOLATED-WORKTREE launch: resolve `req.worktree` (the
 * intent flag) into a concrete `req.worktreeInfo` (a minted/adopted checkout) so
 * the synchronous {@link createTerminalConfined} can use it as the cwd without
 * itself shelling git. Runs ONLY in the `terminals:create` IPC handler (the one
 * async entry point); the control plane / team launcher skip it (they never set
 * `worktree`), keeping `createTerminalConfined`'s signature synchronous.
 *
 * Ineligible targets preserve existing behavior and return the request unchanged.
 * Named requests fail closed when the name is invalid or git cannot create/reuse
 * the checkout; legacy boolean requests retain generated fallback behavior.
 * main re-authorizes everything — renderer never supplies a path (Rule 1). Any
 * renderer-set `worktreeInfo` is stripped first so it cannot smuggle a cwd.
 */
export async function resolveWorktreeForRequest(
  req: CreateTerminalRequest
): Promise<Result<CreateTerminalRequest>> {
  // Strip any untrusted pre-set worktreeInfo — only THIS function may set it.
  const { worktreeInfo: _ignored, ...base } = req;
  if (!req.worktree || req.cwd) return { ok: true, value: base };
  const requested =
    typeof req.worktree === 'object' && req.worktree.branch ? req.worktree.branch : undefined;
  const explicitName = typeof req.worktree === 'object';
  const derived =
    requested ?? req.title ?? (req.prompt ? req.prompt.slice(0, 60) : undefined);
  const sanitized = sanitizeBranchSlug(derived);
  if (explicitName && !sanitized) {
    return { ok: false, code: 'INVALID', message: 'Worktree name required.' };
  }
  const project = store.listProjects().find((p) => p.id === req.projectId);
  if (!project || project.remote || project.quickAgent) return { ok: true, value: base };
  if (!(await isGitRepo(project.path))) {
    return explicitName
      ? { ok: false, code: 'WORKTREE_UNAVAILABLE', message: 'Worktree isolation requires a Git repository.' }
      : { ok: true, value: base };
  }

  // Branch: an explicit pin (object form) wins; else derive from the launch
  // title/prompt; else a stable fallback. Sanitized to a git-legal slug.
  const slug = sanitized ?? `agent_${randomUUID().slice(0, 8)}`;
  const branchSlug = `zcc/${slug}`;
  const targetDir = worktreeTargetDir(project, slug);

  const res = await createWorktree(project.path, targetDir, branchSlug, worktreeRoot());
  if (!res.ok) {
    logMainError('resolveWorktreeForRequest', new Error(`worktree add failed: ${res.reason}`));
    if (explicitName) {
      return {
        ok: false,
        code: 'WORKTREE_CREATE_FAILED',
        message: `Could not prepare worktree "${slug}": ${res.reason}`
      };
    }
    return { ok: true, value: base };
  }
  return {
    ok: true,
    value: { ...base, worktreeInfo: { path: res.path, branch: res.branch } }
  };
}

/**
 * On a worktree-launched session's exit, decide the fate of its isolated
 * checkout: PRUNE it when the agent left nothing behind (clean tree + no unique
 * commits — {@link worktreeState}.prunable), otherwise KEEP it and post an inbox
 * breadcrumb so the user can find/merge/discard the work themselves. Best-effort
 * and never throws — a failed read/remove just leaves the worktree in place
 * (the safe direction: we never force-delete work). Consumes + drops the cache
 * entry (Rule 3 cleanup); a no-worktree session is a cheap no-op.
 */
export async function maybePruneWorktreeOnExit(sessionId: string): Promise<void> {
  const rec = worktreeBySession.get(sessionId);
  worktreeBySession.delete(sessionId);
  if (!rec) return;
  const { worktree, projectPath } = rec;
  try {
    await withWorktreeLock(projectPath, worktree.branch, async () => {
      // Reused names deliberately let multiple sessions share one checkout. The
      // check occurs inside the same lifecycle lock as allocation/removal so a
      // relaunch cannot adopt it between this check and `git worktree remove`.
      if (worktreeInUse(worktree.path)) {
        return;
      }
      const state = await worktreeState(worktree.path);
      if (state.prunable) {
        const res = await removeWorktree(projectPath, worktree.path, false);
        if (!res.ok) {
          logMainError('maybePruneWorktreeOnExit', new Error(res.message ?? 'worktree remove failed'));
        }
        return;
      }
      // Uncommitted or unmerged work — keep the checkout and tell the user where
      // it is. Skip when the project row is gone (uninstalled mid-session).
      const project = store.listProjects().find((p) => p.path === projectPath);
      if (!project) return;
      const why = state.dirty
        ? 'has uncommitted changes'
        : `has ${state.commits} unmerged commit${state.commits === 1 ? '' : 's'}`;
      void inboxStore
        .append({
          projectId: project.id,
          subject: `Worktree kept — ${worktree.branch}`,
          comments:
            `An isolated agent finished on branch \`${worktree.branch}\` — its worktree ${why}, ` +
            `so it was kept (not pruned).\n\nWorktree: \`${worktree.path}\`\n\n` +
            `Merge it (\`git merge ${worktree.branch}\`) or, once done, remove it with ` +
            `\`git worktree remove ${worktree.path}\`.`
        })
        .catch((err) => logMainError('maybePruneWorktreeOnExit inbox', err));
    });
  } catch (err) {
    logMainError('maybePruneWorktreeOnExit', err);
  }
}

interface EffectiveLaunch {
  projectRoot: string;
  cwd: string;
  /** Path whose canonical target selected cwd. Re-resolved at commit to detect retargeting. */
  trustedPath: string;
  /** Main-owned scratch intent. Materialized only after authorization reaches spawn. */
  scratch?: { label?: string };
  worktree?: SessionWorktree;
}

/** Resolve launch cwd once from main-owned project state and confined request intent. */
export function resolveEffectiveLaunch(
  req: Pick<CreateTerminalRequest, 'cwd' | 'isolateScratch' | 'title' | 'worktreeInfo'>,
  project: Project
): EffectiveLaunch {
  const projectRoot = project.remote ? project.path : realpathSync(project.path);
  let cwd = projectRoot;
  let trustedPath = project.path;
  const scratch = req.isolateScratch && !req.cwd && project.quickAgent && !project.remote
    ? { label: typeof req.isolateScratch === 'string' ? req.isolateScratch : req.title }
    : undefined;
  const requestedCwd = scratch ? undefined : req.cwd;
  if (!project.remote && requestedCwd) {
    try {
      const realCwd = realpathSync(requestedCwd);
      if (isWithin(realCwd, projectRoot)) {
        cwd = realCwd;
        trustedPath = requestedCwd;
      }
    } catch {
      /* missing or escaping cwd falls back to the registered project root */
    }
  }
  if (
    req.worktreeInfo?.path &&
    !project.remote &&
    !req.isolateScratch &&
    !req.cwd &&
    !project.quickAgent
  ) {
    try {
      const realWt = realpathSync(req.worktreeInfo.path);
      if (isWithin(realWt, realpathSync(worktreeRoot()))) {
        return {
          projectRoot,
          cwd: realWt,
          trustedPath: req.worktreeInfo.path,
          worktree: { path: realWt, branch: req.worktreeInfo.branch }
        };
      }
    } catch {
      /* missing or escaping worktree falls back to the registered project root */
    }
  }
  return { projectRoot, cwd, trustedPath, ...(scratch ? { scratch } : {}) };
}

/** Materialize authorized scratch intent and canonical-confine its resulting cwd. */
function materializeEffectiveLaunch(effective: EffectiveLaunch): EffectiveLaunch {
  if (!effective.scratch) return effective;
  const trustedPath = store.createScratchSubfolder(effective.scratch.label);
  const cwd = realpathSync(trustedPath);
  if (!isWithin(cwd, effective.projectRoot)) {
    throw new Error('minted scratch cwd escaped registered project root');
  }
  return { ...effective, cwd, trustedPath };
}

/** Re-resolve launch trust anchors at commit; any symlink retarget fails closed. */
export function revalidateEffectiveLaunch(
  effective: EffectiveLaunch,
  project: Project
): { ok: true } | { ok: false; reason: string } {
  if (project.remote) {
    return project.path === effective.projectRoot && effective.cwd === effective.projectRoot
      ? { ok: true }
      : { ok: false, reason: 'project canonical root changed after preflight' };
  }
  try {
    if (realpathSync(project.path) !== effective.projectRoot) {
      return { ok: false, reason: 'project canonical root changed after preflight' };
    }
    if (realpathSync(effective.trustedPath) !== effective.cwd) {
      return { ok: false, reason: 'effective launch path changed after preflight' };
    }
  } catch {
    return { ok: false, reason: 'effective launch path changed after preflight' };
  }
  const trustedRoot = effective.worktree ? realpathSync(worktreeRoot()) : effective.projectRoot;
  return isWithin(effective.cwd, trustedRoot)
    ? { ok: true }
    : { ok: false, reason: 'effective launch path changed after preflight' };
}

/**
 * Spawn a terminal with the cwd confined to its project (CLAUDE.md #2). Shared
 * by the `terminals:create` IPC handler AND the CLI control plane so there is
 * exactly ONE copy of the confinement gate — a renderer- or CLI-supplied `cwd`
 * is honored only when `isWithin(cwd, project.path)`, otherwise it falls back to
 * the project root. main authorizes; the caller never pre-trusts the path.
 *
 * For an isolated-worktree launch the checkout is minted upstream by
 * {@link resolveWorktreeForRequest} (async git) and handed in via
 * `req.worktreeInfo`; this function only re-validates it sits under the managed
 * root and uses it as the cwd. It never itself shells git, so it stays sync.
 */
export function createTerminalConfined(
  req: CreateTerminalRequest,
  opts?: {
    autonomous?: boolean;
    /** Wake reconnect (remote only): original session id to re-attach as the
     *  remote `cc-<id>` tmux session. MAIN-only; never from the renderer req. */
    reconnectTmuxId?: string;
    /** Fold `--continue` into a remote claude reconnect. MAIN-only. */
    resume?: boolean;
    /** Coordinator-owned identity. MAIN-only; never read from renderer request. */
    preallocatedSessionId?: string;
    /** Immutable main-owned preflight snapshot. Prevents settings/persona TOCTOU. */
    launchSnapshot?: {
      project: Project;
      config: AppConfig;
      projectSettings: ProjectSettings;
      personas: Persona[];
      frameworkPersona?: Persona;
    };
    /** Main-resolved cwd shared by discovery authorization and spawn. */
    effectiveLaunch?: EffectiveLaunch;
  }
): Result<TerminalSession> {
  const project = opts?.launchSnapshot?.project
    ?? store.listProjects().find((p) => p.id === req.projectId);
  if (!project) return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
  try {
    // Remote projects ignore req.cwd entirely — the cwd is on the remote host
    // and is set via the in-shell `cd` we inject into the ssh argv.
    //
    // Confinement (CLAUDE.md #2): a caller-supplied cwd is honored ONLY when its
    // realpath resolves inside the project's realpath. We realpath BOTH sides so
    // a symlink inside the project that points out (e.g. `<project>/link → /`)
    // can't smuggle the cwd outside the tree — a lexical isWithin alone would be
    // fooled. Any resolution failure or escape falls back to the project root.
    const effectiveLaunch = materializeEffectiveLaunch(
      opts?.effectiveLaunch ?? resolveEffectiveLaunch(req, project)
    );
    const { cwd } = effectiveLaunch;
    // Isolated worktree: the `terminals:create` handler already minted/adopted
    // the checkout (async git) and handed us the RESOLVED path in `worktreeInfo`.
    // Honor it as the cwd directly — a worktree lives OUTSIDE the project root by
    // design, so the project-root `isWithin` above doesn't (and shouldn't) accept
    // it. Trust is upheld at spawn: the path sits under the app-managed
    // `~/zcc-worktrees` root, which is a trust anchor in `assertCwdConfined` (a
    // symlink escaping it still realpath-fails the gate). We re-realpath here and
    // require it to resolve under that managed root before accepting — never
    // trusting the field raw (Rule 1/2). Skipped for remote/scratch/explicit-cwd.
    const worktreeInfo = effectiveLaunch.worktree;
    // Resolve the persona (if any) + opening-prompt wiring via the shared seam
    // (resolvePersonaLaunch) so this path, the control plane, and any future MCP
    // spawn tool agree on persona resolution and the prompt-as-argv convention.
    // We still pass req.profile (NOT the helper's internal effectiveProfile) to
    // ptys.create — the pty layer re-derives the effective profile from the
    // persona itself, so substituting it here would double-apply baseProfile.
    // MAIN is the authority for the launch-arg denylist (CLAUDE.md #1). The
    // renderer host.ts sanitize is advisory; the zcc control plane applies none,
    // so strip denied flags from the UNTRUSTED req.extraArgs here — the one gate
    // both entry points share. resolvePersonaLaunch then appends the trusted
    // prompt positional; pty.ts synthesizes the trusted persona/project/global
    // flag layers (which legitimately include --permission-mode etc.) from store
    // data — those are NOT routed through this denylist.
    const { args: safeExtraArgs, removed } = sanitizeExtraArgs(req.extraArgs);
    if (removed.length > 0) {
      logMainError(
        'createTerminalConfined',
        new Error(`stripped denied launch flags: ${removed.join(', ')}`)
      );
    }
    const safeReq: CreateTerminalRequest = { ...req, extraArgs: safeExtraArgs };
    const { persona: explicitPersona } = resolvePersonaLaunch(
      { ...safeReq, prompt: undefined },
      opts?.launchSnapshot?.personas ?? personas.list()
    );
    // Framework preset (Advanced Quick Agent): only when the caller chose NO
    // explicit persona. A synthetic persona built from the extension's own
    // manifest primer, routed through the same `persona` slot so its
    // `appendSystemPrompt` is injected via `--append-system-prompt` by
    // personaArgs_build — no bespoke framework code path (Rule 6). The prompt
    // stays positional (req.profile is claude-family for an Advanced launch, so
    // resolvePersonaLaunch already appended it), and the synthetic persona's
    // baseProfile only overrides the base command inside pty.ts.
    const userGaveTask = !!(req.prompt?.trim() || (safeExtraArgs && safeExtraArgs.length > 0));
    const persona = explicitPersona ?? opts?.launchSnapshot?.frameworkPersona;
    const selection = resolveLaunchSelection({
      config: opts?.launchSnapshot?.config ?? store.getConfig(),
      project,
      personas: opts?.launchSnapshot?.personas ?? personas.list(),
      requestedProfile: req.profile,
      requestedSource: req.profileSource,
      requestedPersonaId: persona?.id,
      persona
    });
    if (!selection.ok) {
      return { ok: false, code: selection.code, message: selection.message };
    }
    const selectedPersona = selection.personaId
      ? (opts?.launchSnapshot?.personas ?? personas.list()).find((candidate) => candidate.id === selection.personaId)
      : undefined;
    const effectivePersona = persona ?? selectedPersona;
    const promptArgs = req.prompt ? seedPromptArgs(selection.profile, req.prompt) : [];
    const extraArgs = promptArgs.length
      ? [...safeExtraArgs, ...promptArgs]
      : safeExtraArgs.length ? safeExtraArgs : undefined;
    // microVM image override chain (env `'microvm'` only): explicit launcher
    // hint > persona default > project default > (builder allowlist default when
    // all absent). Every candidate is ADVISORY — the microVM builder re-resolves
    // the winner against the closed image allowlist before spawn (Rule 1), so a
    // stale/unknown persona or project value is rejected there, not honored.
    const projectMicroVmSettings = opts?.launchSnapshot?.projectSettings
      ?? store.getProjectSettings(req.projectId);
    const resolvedMicroVmImage =
      req.microVmImage ?? effectivePersona?.microVmImage ?? projectMicroVmSettings.microVmImage;
    const session = ptys.create({
      preallocatedSessionId: opts?.preallocatedSessionId,
      projectId: req.projectId,
      profile: selection.profile,
      persona: effectivePersona,
      cwd,
      cols: req.cols,
      rows: req.rows,
      config: opts?.launchSnapshot?.config ?? store.getConfig(),
      projectSettings: projectMicroVmSettings,
      extraArgs,
      harnessRouting: req.harnessRouting,
      title: req.title,
      remote: project.remote,
      cohort: req.cohort,
      headless: req.headless,
      // MAIN-only: autonomous team runs force --permission-mode acceptEdits +
      // disallow AskUserQuestion so agents act unattended (full bypass is
      // forbidden by managed policy). Never sourced from the renderer req.
      autonomous: opts?.autonomous === true,
      // MAIN-only wake-reconnect params (remote only). The pty layer UUID-checks
      // reconnectTmuxId before it reaches the tmux command string.
      reconnectTmuxId: opts?.reconnectTmuxId,
      resume: opts?.resume,
      // Provider-native exact-session resume (codex `resume <uuid>`): the id the
      // renderer captured on this tab and asks to reopen on restore. Only selects
      // WHICH prior session the CLI reopens (the CLI validates it), never a path
      // (Rule 1). Absent on a fresh launch.
      resumeSessionId: req.resumeSessionId,
      worktree: worktreeInfo,
      // Execution environment (WHERE it runs): renderer INTENT, re-resolved by
      // the pty layer through `environmentFor` (Rule 1 — the value only SELECTS a
      // registered environment, it can't define one). A kernel sandbox that can't
      // be enforced degrades to a verbatim spawn with an honest isolationStatus.
      environment: req.environment,
      sandboxDenyNetwork: req.sandboxDenyNetwork,
      // microVM advisory hints (env `'microvm'`): re-authorized in the microVM
      // builder (Rule 1 — image resolved against a closed allowlist, cpu/mem
      // clamped). Ignored by local/sandbox. The image is the resolved override
      // chain (launcher > persona > project > global); cpu/mem stay launcher-only hints.
      microVmImage: resolvedMicroVmImage,
      microVmCpus: req.microVmCpus,
      microVmMemoryMib: req.microVmMemoryMib
    });
    // Remember the worktree so the exit handler can prune it once the agent is
    // done (the `exit` event fires after the live session is dropped, so we
    // can't recover it from the session record then). Cache the owning project
    // root too — `git worktree remove` runs from the repo, not the worktree.
    if (worktreeInfo) {
      worktreeBySession.delete(session.id);
      worktreeBySession.set(session.id, { worktree: worktreeInfo, projectPath: project.path });
    }
    // OpenCode has no hook surface to deliver the first-prompt callback (see
    // CLAUDE.md's harness-provider notes), so fire the SAME tab-namer call
    // directly from the spawn-time prompt text main already has here. Guarded
    // by req.prompt being non-empty — a bare TUI launch or a resume relaunch
    // (which carries no prompt today) is naturally excluded, matching the "not
    // scheduled" requirement since this path is interactive-only. The explicit
    // !resumeSessionId/!opts?.resume check is a belt-and-suspenders guard: a
    // future "continue this session with a new instruction" launch could pass
    // BOTH a resume identity and a fresh prompt, which must not re-fire a
    // rename on a tab that already has a name.
    if (
      isOpenCodeProfile(selection.profile) &&
      req.prompt?.trim() &&
      !req.resumeSessionId &&
      !opts?.resume
    ) {
      fireTabNamer(session.id, req.prompt);
    }
    return { ok: true, value: session };
  } catch (err) {
    // The 50-session cap surfaces as a distinct RESOURCE_LIMIT code so a CLI /
    // script can branch on "too many sessions" (exit 4) vs a real spawn failure.
    const message = String(err);
    const code = /cap reached/.test(message) ? 'RESOURCE_LIMIT' : 'PTY_SPAWN_FAILED';
    return { ok: false, code, message };
  }
}

/** Generic new-launch path. Principal and spawn-only metadata come from main callers. */
async function launchAuthorizedTerminal(
  req: CreateTerminalRequest,
  principal: LaunchPrincipalRef,
  spawnOpts?: Parameters<typeof createTerminalConfined>[1],
  teamId?: string,
  onCommitted?: (identity: { authorizationId: string; sessionId: string }) => void | Promise<void>,
  preissuedAuthorizationId?: string,
  deadlineAt?: number,
  legacyPersonaFacetCompatibility = false,
  spawnLifecycle?: { maySpawn: () => Promise<boolean>; claimRunning: () => Promise<boolean> }
): Promise<Result<TerminalSession>> {
  const projects = store.listProjects();
  const foundProject = projects.find((candidate) => candidate.id === req.projectId);
  if (!foundProject) return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
  const project = foundProject;
  const config = store.getConfig();
  const personaSnapshot = personas.list();
  const projectSettings = store.getProjectSettings(req.projectId);
  const effectiveLaunch = resolveEffectiveLaunch(req, project);
  const userGaveTask = !!(req.prompt?.trim() || req.extraArgs?.length);
  const frameworkPersona = !req.personaId && req.frameworkIds?.length
    ? resolveFrameworkPersona(req.frameworkIds, !userGaveTask)
    : undefined;
  const resolvedPersonas = frameworkPersona ? [...personaSnapshot, frameworkPersona] : personaSnapshot;
  const plan = preflightLaunch(req, {
    principal: () => principal,
    // Capability-backed local tmux restore reuses the host-minted identity so
    // `tmux new-session -A -s cc-<id>` attaches to the surviving process.
    sessionId: spawnOpts?.preallocatedSessionId
      ? () => spawnOpts.preallocatedSessionId!
      : undefined,
    binding: () => ({
      consumerKind: principal.id.startsWith('control-plane:orchestrator:')
        ? 'orchestrator-child'
        : req.cohort ? 'team-slot' : 'terminal',
      personaId: req.personaId,
      teamId: req.cohort?.teamId,
      slotId: req.cohort?.slotId,
      scope: project.remote ? 'remote' : 'local',
      autonomous: spawnOpts?.autonomous === true,
      deadlineAt
    }),
    resolve: () => ({
      project,
      // Full values are intentionally snapshotted into digest. Spawn path still
      // re-resolves and re-confines them as defense in depth.
      requestedCwd: req.cwd,
      requestedProfile: req.profile,
      requestedPersonaId: req.personaId,
      config,
      projectSettings,
      personas: resolvedPersonas,
      frameworkPersona,
      effectiveLaunch,
      storeRevision: launchDigest({ projects, config, projectSettings, personas: resolvedPersonas })
    })
  });
  const selection = resolveLaunchSelection({
    config,
    project,
    personas: personaSnapshot,
    requestedProfile: req.profile,
    requestedSource: req.profileSource,
    requestedPersonaId: frameworkPersona?.id ?? req.personaId,
    persona: frameworkPersona
  });
  if (!selection.ok) return { ok: false, code: selection.code, message: selection.message };
  const executionAuthorization = await preflightTerminalExecution({
    config,
    profile: selection.profile,
    persona: selection.personaId
      ? resolvedPersonas.find((candidate) => candidate.id === selection.personaId)
      : undefined,
    projectSettings,
    harnessRouting: req.harnessRouting,
    extraArgs: req.extraArgs,
    projectId: project.id,
    projectPath: effectiveLaunch.cwd,
    scope: project.remote ? 'remote' : 'local',
    mode: principal.kind === 'interactive-user' ? 'interactive' : 'unattended',
    idempotencyKey: plan.idempotencyKey,
    legacyPersonaFacetCompatibility
  }, {
    consentStore: executionConsentStore,
    consentService: executionConsentService,
    installedVersion: async (adapterId) => (await verifyHarnesses(config))
      .find(({ family }) => family === adapterId)?.normalizedVersion
  });
  if (executionAuthorization.decision === 'blocked') {
    return { ok: false, code: 'DENIED', message: `Structured execution unavailable: ${executionAuthorization.reason}` };
  }
  const principalBudget = resolveMaxLiveSessions(config);
  const existingPrincipal = launchPrincipals.get(principal.id);
  // Team policy is bound once by authorizeTeamLaunch/launchTeam. Reuse that
  // main-owned principal here so per-request limits such as 1/1 are not widened
  // to the generic ceiling while each slot enters the shared launch path.
  const boundPrincipal = principal.kind === 'team' && existingPrincipal?.kind === 'team'
    ? existingPrincipal
    : bindLaunchPrincipal(principal, {
        id: principal.id,
        allowedProjectIds: principal.kind === 'interactive-user'
          ? projects.map((candidate) => candidate.id)
          : [project.id],
        maxConcurrent: principal.kind === 'team' ? 32 : principalBudget,
        // Fixed interactive/control-plane/chat principals represent a launch source,
        // not one action. Bound each active burst by the same machine/session budget;
        // complete() resets non-team run accounting once the burst drains.
        maxLaunchesPerRun: principal.kind === 'team' ? 32 : principalBudget
      }, teamId);
  if (!boundPrincipal) return { ok: false, code: 'DENIED', message: 'principal binding unavailable' };
  // Only team policy needs to stay fixed once bound (see comment above) — other
  // principal kinds (interactive-user, schedule, automation) legitimately get a
  // fresh binding on every call (e.g. allowedProjectIds tracks the live project
  // list), so comparing against the previously cached binding would falsely
  // deny a launch whenever a project is added/removed/reordered between calls.
  if (principal.kind === 'team' && existingPrincipal
    && launchDigest(existingPrincipal) !== launchDigest(boundPrincipal)) {
    return { ok: false, code: 'DENIED', message: 'principal binding changed during run' };
  }
  launchPrincipals.set(principal.id, boundPrincipal);
  const finalPlan = finalizeLaunchPreflight(plan, executionAuthorization);
  const preissuedAuthorization = preissuedAuthorizationId
    ? launchAuthorization.get(preissuedAuthorizationId)
    : undefined;
  if (preissuedAuthorizationId && !preissuedAuthorization) {
    return { ok: false, code: 'DENIED', message: 'unknown authorization' };
  }
  if (preissuedAuthorization) {
    const expected = {
      principal,
      projectId: project.id,
      teamId: req.cohort?.teamId,
      slotId: req.cohort?.slotId,
      personaId: req.personaId,
      profileId: selection.profile,
      scope: project.remote ? 'remote' as const : 'local' as const,
      autonomous: spawnOpts?.autonomous === true,
      initialTaskDigest: launchDigest(req.prompt ?? '')
    };
    const actual = preissuedAuthorization.binding;
    if (preissuedAuthorization.principal.id !== expected.principal.id
      || preissuedAuthorization.principal.kind !== expected.principal.kind
      || preissuedAuthorization.projectId !== expected.projectId
      || actual.teamId !== expected.teamId
      || actual.slotId !== expected.slotId
      || actual.personaId !== expected.personaId
      || actual.profileId !== expected.profileId
      || actual.scope !== expected.scope
      || actual.autonomous !== expected.autonomous
      || actual.initialTaskDigest !== expected.initialTaskDigest) {
      return { ok: false, code: 'DENIED', message: 'preissued authorization binding mismatch' };
    }
  }
  const coordinator = createLaunchCoordinator<CreateTerminalRequest, typeof plan.resolved, TerminalSession>({
    ledger: launchLedger,
    executionConsent: executionConsentStore,
    authorize: launchAuthorization,
    revalidate: async (authorizedPlan) => revalidateTerminalCommit(
      { ...authorizedPlan, executionAuthorization: finalPlan.executionAuthorization },
      selection.profile,
      selection.personaId ? resolvedPersonas.find((candidate) => candidate.id === selection.personaId) : undefined
    ),
    spawn: async (authorizedPlan) => {
      const result = createTerminalConfined(authorizedPlan.request, {
        ...spawnOpts,
        preallocatedSessionId: authorizedPlan.sessionId,
        launchSnapshot: {
          project: authorizedPlan.resolved.project,
          config: authorizedPlan.resolved.config,
          projectSettings: authorizedPlan.resolved.projectSettings,
          personas: authorizedPlan.resolved.personas,
          frameworkPersona: authorizedPlan.resolved.frameworkPersona
        },
        effectiveLaunch: authorizedPlan.resolved.effectiveLaunch
      });
      if (!result.ok) throw new LaunchSpawnError(result.code, result.message);
       const ready = ptys.waitForReady(result.value.id);
       const remaining = authorizedPlan.binding.deadlineAt === undefined
         ? undefined
         : authorizedPlan.binding.deadlineAt - Date.now();
       if (remaining === undefined) return ready;
        if (remaining <= 0) {
          await terminateSession(result.value.id);
          throw new LaunchSpawnError('DEADLINE_EXCEEDED', 'launch deadline elapsed before execution became ready');
        }
       let timer: NodeJS.Timeout | undefined;
       return Promise.race([
         ready,
         new Promise<never>((_resolve, reject) => {
            timer = setTimeout(() => {
              void terminateSession(result.value.id).finally(() => {
                reject(new LaunchSpawnError('DEADLINE_EXCEEDED', 'launch deadline elapsed before execution became ready'));
              });
            }, remaining);
         })
       ]).finally(() => {
         if (timer) clearTimeout(timer);
       });
    },
    onCommitted: ({ authorizationId, sessionId }) => onCommitted?.({ authorizationId, sessionId }),
    beforeSpawn: spawnLifecycle ? () => spawnLifecycle.maySpawn() : undefined,
    afterSpawn: spawnLifecycle ? () => spawnLifecycle.claimRunning() : undefined,
    terminateSpawned: (session) => terminateSession(session.id),
    onLaunched: ({ ledgerEntryId, authorizationId, session }) => {
      launchLedgerEntriesBySession.set(session.id, ledgerEntryId);
      launchAuthorizationBySession.set(session.id, authorizationId);
      const restoreCapabilityId = randomUUID();
      restoreCapabilities.put({
        id: restoreCapabilityId,
        request: finalPlan.request,
        sessionId: session.id,
        sessionProfile: session.profile,
        sessionTitle: session.title,
        remoteTmuxId: session.remoteTmuxId,
        createdAt: Date.now()
      });
      ptys.setRestoreCapabilityId(session.id, restoreCapabilityId);
    },
    onLedgerError: (error) => logMainError('launch ledger post-spawn transition', error)
  });
  return coordinator.launch(preissuedAuthorization
    ? { ...finalPlan, preissuedAuthorization: { id: preissuedAuthorization.id, binding: preissuedAuthorization.binding } }
    : finalPlan) as Promise<Result<TerminalSession>>;

  async function revalidateTerminalCommit(
    authorizedPlan: typeof finalPlan,
    profile: LaunchProfileId,
    persona: Persona | undefined
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const currentProjects = store.listProjects();
    const currentProject = currentProjects.find((candidate) => candidate.id === project.id);
    if (!currentProject) return { ok: false, reason: 'project identity changed after preflight' };
    const currentConfig = store.getConfig();
    const currentSettings = store.getProjectSettings(project.id);
    const currentPersonaCatalog = personas.list();
    const currentFrameworkPersona = !authorizedPlan.request.personaId && authorizedPlan.request.frameworkIds?.length
      ? resolveFrameworkPersona(
          authorizedPlan.request.frameworkIds,
          !(authorizedPlan.request.prompt?.trim() || authorizedPlan.request.extraArgs?.length)
        )
      : undefined;
    const currentPersonas = currentFrameworkPersona
      ? [...currentPersonaCatalog, currentFrameworkPersona]
      : currentPersonaCatalog;
    const currentRevision = launchDigest({ projects: currentProjects, config: currentConfig, projectSettings: currentSettings, personas: currentPersonas });
    const common = revalidateCommonLaunchCommit(authorizedPlan, {
      project: currentProject,
      storeRevision: currentRevision,
      liveCount: currentLaunchCapacityUsage(),
      capacity: resolveMaxLiveSessions(currentConfig)
    });
    if (!common.ok) return common;
    const currentEffectiveLaunch = revalidateEffectiveLaunch(authorizedPlan.resolved.effectiveLaunch, currentProject);
    if (!currentEffectiveLaunch.ok) return currentEffectiveLaunch;
    const currentExecution = await preflightTerminalExecution({
      config: currentConfig,
      profile,
      persona: currentFrameworkPersona ?? (persona?.id
        ? currentPersonas.find((candidate) => candidate.id === persona.id)
        : undefined),
      projectSettings: currentSettings,
      harnessRouting: authorizedPlan.request.harnessRouting, extraArgs: authorizedPlan.request.extraArgs,
      projectId: project.id, projectPath: authorizedPlan.resolved.effectiveLaunch.cwd, scope: currentProject.remote ? 'remote' : 'local',
      mode: principal.kind === 'interactive-user' ? 'interactive' : 'unattended',
      idempotencyKey: authorizedPlan.idempotencyKey,
      legacyPersonaFacetCompatibility
    }, {
      consentStore: executionConsentStore,
      installedVersion: async (adapterId) => (await verifyHarnesses(currentConfig))
        .find(({ family }) => family === adapterId)?.normalizedVersion
    });
    if (currentExecution.decision === 'blocked') return { ok: false, reason: currentExecution.reason };
    const currentBinding = {
      scope: currentExecution.scope,
      evidenceDigest: currentExecution.evidenceDigest,
      consentReservation: currentExecution.consentReservation
    };
    const expectedBinding = {
      scope: authorizedPlan.binding.scope,
      evidenceDigest: authorizedPlan.binding.evidenceDigest,
      consentReservation: authorizedPlan.binding.consentReservation
    };
    return launchDigest(currentBinding) === launchDigest(expectedBinding)
      ? { ok: true }
      : { ok: false, reason: 'execution evidence or consent changed after preflight' };
  }
}

/** Interactive renderer launch: main derives identity, authorizes once, then commits. */
async function createInteractiveTerminal(req: CreateTerminalRequest): Promise<Result<TerminalSession>> {
  const release = req.worktreeInfo ? reserveWorktree(req.worktreeInfo.path) : undefined;
  try {
    return await launchAuthorizedTerminal(req, { kind: 'interactive-user', id: 'interactive:local' });
  } finally {
    release?.();
  }
}

/** Scheduler/Goal Manager path: options and principal are main-derived before authorization. */
async function launchBackgroundTerminal(
  opts: TerminalLaunchOptions,
  principal: LaunchPrincipalRef
): Promise<TerminalSession> {
  const projects = store.listProjects();
  const project = projects.find((candidate) => candidate.id === opts.projectId);
  if (!project) throw new LaunchSpawnError('NOT_FOUND', 'project not found');
  const effectiveLaunch = resolveEffectiveLaunch(opts, project);
  const plan = preflightLaunch(opts, {
    principal: () => principal,
    binding: () => ({
      consumerKind: opts.cohort ? 'team-slot' : 'terminal', personaId: opts.persona?.id,
      teamId: opts.cohort?.teamId, slotId: opts.cohort?.slotId,
      scope: project.remote ? 'remote' : 'local', autonomous: opts.autonomous === true
    }),
    resolve: () => ({
      project,
      requestedCwd: opts.cwd,
      requestedProfile: opts.profile,
      requestedPersonaId: opts.persona?.id,
      config: opts.config,
      projectSettings: opts.projectSettings,
      effectiveLaunch,
      storeRevision: launchDigest({
        projects,
        config: opts.config,
        projectSettings: opts.projectSettings,
        persona: opts.persona
      })
    })
  });
  const executionAuthorization = await preflightTerminalExecution({
    config: opts.config,
    profile: opts.profile,
    persona: opts.persona,
    projectSettings: opts.projectSettings,
    harnessRouting: opts.harnessRouting,
    extraArgs: opts.extraArgs,
    projectId: project.id,
    projectPath: effectiveLaunch.cwd,
    scope: project.remote ? 'remote' : 'local',
    mode: opts.scheduled || opts.autonomous ? 'unattended' : 'headless',
    idempotencyKey: plan.idempotencyKey
  }, {
    consentStore: executionConsentStore,
    installedVersion: async (adapterId) => (await verifyHarnesses(opts.config))
      .find(({ family }) => family === adapterId)?.normalizedVersion
  });
  if (executionAuthorization.decision === 'blocked') {
    throw new LaunchSpawnError('DENIED', `Structured execution unavailable: ${executionAuthorization.reason}`);
  }
  const boundPrincipal = bindLaunchPrincipal(principal, {
    id: principal.id, allowedProjectIds: [project.id],
    maxConcurrent: resolveMaxLiveSessions(opts.config),
    maxLaunchesPerRun: resolveMaxLiveSessions(opts.config)
  }, opts.cohort?.teamId);
  if (!boundPrincipal) throw new LaunchSpawnError('DENIED', 'principal binding unavailable');
  launchPrincipals.set(principal.id, boundPrincipal);
  const finalPlan = finalizeLaunchPreflight(plan, executionAuthorization);
  const coordinator = createLaunchCoordinator<TerminalLaunchOptions, typeof plan.resolved, TerminalSession>({
    ledger: launchLedger,
    executionConsent: executionConsentStore,
    authorize: launchAuthorization,
    revalidate: async (authorizedPlan) => {
      const currentProjects = store.listProjects();
      const currentProject = currentProjects.find((candidate) => candidate.id === project.id);
      if (!currentProject) return { ok: false as const, reason: 'project identity changed after preflight' };
      const currentConfig = store.getConfig();
      const currentSettings = store.getProjectSettings(project.id);
      const currentPersona = opts.persona?.id
        ? personas.list().find((candidate) => candidate.id === opts.persona!.id)
        : undefined;
      const currentRevision = launchDigest({
        projects: currentProjects,
        config: currentConfig,
        projectSettings: currentSettings,
        persona: currentPersona
      });
      const common = revalidateCommonLaunchCommit(authorizedPlan, {
        project: currentProject,
        storeRevision: currentRevision,
        liveCount: currentLaunchCapacityUsage(),
        capacity: resolveMaxLiveSessions(currentConfig)
      });
      if (!common.ok) return common;
      const currentEffectiveLaunch = revalidateEffectiveLaunch(authorizedPlan.resolved.effectiveLaunch, currentProject);
      if (!currentEffectiveLaunch.ok) return currentEffectiveLaunch;
      const currentExecution = await preflightTerminalExecution({
        config: currentConfig,
        profile: authorizedPlan.request.profile,
        persona: currentPersona,
        projectSettings: currentSettings,
        harnessRouting: authorizedPlan.request.harnessRouting,
        extraArgs: authorizedPlan.request.extraArgs,
        projectId: currentProject.id,
        projectPath: authorizedPlan.resolved.effectiveLaunch.cwd,
        scope: currentProject.remote ? 'remote' : 'local',
        mode: authorizedPlan.request.scheduled || authorizedPlan.request.autonomous ? 'unattended' : 'headless',
        idempotencyKey: authorizedPlan.idempotencyKey
      }, {
        consentStore: executionConsentStore,
        installedVersion: async (adapterId) => (await verifyHarnesses(currentConfig))
          .find(({ family }) => family === adapterId)?.normalizedVersion
      });
      if (currentExecution.decision === 'blocked') return { ok: false as const, reason: currentExecution.reason };
      return launchDigest({
        scope: currentExecution.scope,
        evidenceDigest: currentExecution.evidenceDigest,
        consentReservation: currentExecution.consentReservation
      }) === launchDigest({
        scope: authorizedPlan.binding.scope,
        evidenceDigest: authorizedPlan.binding.evidenceDigest,
        consentReservation: authorizedPlan.binding.consentReservation
      })
        ? { ok: true as const }
        : { ok: false as const, reason: 'execution evidence or consent changed after preflight' };
    },
    spawn: async (authorizedPlan) => {
      const spawnLaunch = materializeEffectiveLaunch(authorizedPlan.resolved.effectiveLaunch);
      const session = createTerminalFromAuthorizedPlan({
        ...authorizedPlan.request,
        cwd: spawnLaunch.cwd,
        preallocatedSessionId: authorizedPlan.sessionId
      });
      return ptys.waitForReady(session.id);
    },
    onLaunched: ({ ledgerEntryId, authorizationId, session }) => {
      launchLedgerEntriesBySession.set(session.id, ledgerEntryId);
      launchAuthorizationBySession.set(session.id, authorizationId);
    },
    onLedgerError: (error) => logMainError('launch ledger post-spawn transition', error)
  });
  const result = await coordinator.launch(finalPlan);
  if (!result.ok) throw new LaunchSpawnError(result.code, result.message);
      const session = result.value;
      const restoreCapabilityId = randomUUID();
      session.restoreCapabilityId = restoreCapabilityId;
      restoreCapabilities.put({
        id: restoreCapabilityId,
        request: finalPlan.request,
        sessionId: session.id,
        sessionProfile: session.profile,
        sessionTitle: session.title,
        remoteTmuxId: session.remoteTmuxId,
        createdAt: Date.now()
      });
      return session;
}

function createTerminalFromAuthorizedPlan(opts: TerminalLaunchOptions): TerminalSession {
  return ptys.create(opts);
}

function currentLaunchCapacityUsage(): number {
  const manager = ptys as PtyManager & {
    liveCount?: () => number;
    listAll?: () => TerminalSession[];
  };
  return manager.liveCount?.() ?? manager.listAll?.().length ?? 0;
}

/**
 * Assemble the orchestrator's opening prompt: the team's own `initialPrompt`
 * (if any) followed by a roster of the workers just launched, so the
 * orchestrator can delegate to them by session id via `agent_send`. Every
 * worker auto-seeds into the discovery registry on spawn (see the
 * `sessionUpdated` handler), so a raw session id is immediately addressable —
 * the agent doesn't need the worker to `register_agent` first.
 *
 * Returns the team prompt verbatim when there are no workers (a solo
 * orchestrator), so a promptless team still launches cleanly.
 */
function orchestratorPrompt(
  team: Team,
  roster: Array<{ sessionId: string; label: string }>,
  goal?: string
): string {
  const base = team.initialPrompt?.trim() ?? '';
  // Autonomous run: fold the goal + the unattended-run contract into the prompt
  // so the orchestrator holds the goal and knows to call complete_autonomous_run
  // when it's met. The goal arrives already trimmed/capped from the caller.
  const goalBriefing = goal
    ? `Autonomous team run. Goal: ${goal}. This run is UNATTENDED: the user is not ` +
      `watching and cannot answer questions. Never ask the user — do NOT use ` +
      `AskUserQuestion; make reasonable assumptions, decide, and proceed, noting any ` +
      `assumptions in your final summary. When (and only when) the goal is fully ` +
      `achieved, post your final summary and call complete_autonomous_run with a ` +
      `markdown overview of what the team accomplished — this closes the workers and ` +
      `records the result while leaving your tab open for review. Do not stop until ` +
      `the goal is met.`
    : '';
  // No workers → a solo orchestrator; still fold in the goal briefing if any.
  if (roster.length === 0) {
    return [base, goalBriefing].filter(Boolean).join('\n\n');
  }
  const lines = roster.map((r) => `- ${r.label} — session \`${r.sessionId}\``);
  const briefing = [
    `You are the orchestrator of the "${team.name}" team. Your workers are already running:`,
    ...lines,
    '',
    'Delegate to a worker by sending it a message with the `agent_send` tool, addressing it by its session id (the `to` field). Check for their replies with `agent_inbox`. Coordinate the work, then summarise the outcome.'
  ].join('\n');
  return [base, goalBriefing, briefing].filter(Boolean).join('\n\n');
}

/**
 * The team dies with its lead. Given the id of a session that just exited and a
 * snapshot of every live session, close every OTHER still-live member of the
 * exiting session's cohort — but ONLY when the exiting session was the
 * orchestrator (host-stamped `role:'orchestrator'` at launch, never
 * self-declared). A worker exit tears down nothing; a non-team session has no
 * cohort and is a no-op.
 *
 * Pure over its injected deps so the cascade is unit-testable without the pty
 * exit closure. `getSession` must still resolve the exiting session (safe on the
 * real path: finalizeExit emits `exit` BEFORE dropping it from the live map).
 * `close` should be idempotent (closeExpected is), so re-closing a member the
 * autonomous supervisor already tore down is a harmless no-op, and workers can
 * never re-enter this branch — so there is no cascade loop. Returns the closed
 * member ids (for logging/tests).
 */
export function cascadeCloseTeamOnOrchestratorExit(deps: {
  exitedSessionId: string;
  getSession: (id: string) => TerminalSession | null;
  listAll: () => TerminalSession[];
  close: (id: string) => boolean;
}): { teamName: string; cohortId: string; closed: string[] } | null {
  const cohort = deps.getSession(deps.exitedSessionId)?.cohort;
  if (cohort?.role !== 'orchestrator') return null;
  if (cohort.executionId) return null;
  const closed: string[] = [];
  for (const member of deps.listAll()) {
    if (member.id === deps.exitedSessionId) continue;
    if (member.cohort?.cohortId !== cohort.cohortId) continue;
    if (member.status === 'exited') continue;
    if (deps.close(member.id)) closed.push(member.id);
  }
  return { teamName: cohort.teamName, cohortId: cohort.cohortId, closed };
}

const TEAM_AUTHORIZATION_TTL_MS = 2 * 60_000;

export function authorizeTeamLaunch(
  callerPrincipalId: string,
  teamId: string,
  projectId: string,
  launchRequestId: string,
  policy: { deadlineMs?: number; maxConcurrent?: number; maxLaunches?: number },
  slots: TeamLaunchAuthorizationInputSlot[],
  autonomous = false
): Result<TeamLaunchAuthorizationResult> {
  launchAuthorization.pruneExpired();
  for (const [principalId, principal] of launchPrincipals) {
    if (principal.kind === 'team' && launchAuthorization.forgetPrincipal(principalId)) {
      launchPrincipals.delete(principalId);
    }
  }
  if (!callerPrincipalId.trim() || !launchRequestId.trim()) return { ok: false, code: 'DENIED', message: 'missing caller principal or launch request id' };
  const team = teams.list().find((candidate) => candidate.id === teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', message: `team not found: ${teamId}` };
  const project = store.listProjects().find((candidate) => candidate.id === projectId);
  if (!project) return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
  const personaSnapshot = personas.list();
  const known = new Map(personaSnapshot.map((persona) => [persona.id, persona]));
  const expectedSlots: Array<{ slotId: string; personaId: string }> = [];
  const orchestratorId = team.orchestratorPersonaId;
  const hasOrchestrator = !!orchestratorId && known.has(orchestratorId);
  const workerCeiling = hasOrchestrator ? 31 : 32;
  outer: for (const [rowIndex, slot] of team.slots.entries()) {
    if (orchestratorId && slot.personaId === orchestratorId) continue;
    const quantity = Math.max(1, Math.min(TEAM_SLOT_MAX, slot.quantity ?? 1));
    for (let index = 0; index < quantity; index += 1) {
      if (expectedSlots.length >= workerCeiling) break outer;
      expectedSlots.push({ slotId: `${rowIndex}:${slot.personaId}:${index}`, personaId: slot.personaId });
    }
  }
  if (orchestratorId && expectedSlots.length < 32) {
    expectedSlots.push({ slotId: `orchestrator:${orchestratorId}`, personaId: orchestratorId });
  }
  if (slots.length !== expectedSlots.length) {
    return { ok: false, code: 'INVALID', message: 'task count does not match host-expanded Team slots' };
  }
  if (slots.some((slot) => !slot.initialTask.trim() || Buffer.byteLength(slot.initialTask, 'utf8') > 64 * 1_024)) {
    return { ok: false, code: 'INVALID', message: 'invalid initial task' };
  }
  const principalRef = { kind: 'team' as const, id: `team:${team.id}:${callerPrincipalId}:${launchRequestId}` };
  const maxLaunches = Math.min(policy.maxLaunches ?? 32, 32);
  const maxConcurrent = Math.min(policy.maxConcurrent ?? maxLaunches, maxLaunches);
  if (expectedSlots.length > maxLaunches) {
    return { ok: false, code: 'RESOURCE_LIMIT', message: `team launch requests ${expectedSlots.length} slots but limit is ${maxLaunches}` };
  }
  const principal = bindLaunchPrincipal(principalRef, {
    id: principalRef.id,
    allowedProjectIds: [project.id],
    maxConcurrent,
    maxLaunchesPerRun: maxLaunches
  }, team.id)!;
  const existing = launchPrincipals.get(principal.id);
  if (existing && launchDigest(existing) !== launchDigest(principal)) {
    return { ok: false, code: 'DENIED', message: 'principal binding changed during run' };
  }
  launchPrincipals.set(principal.id, principal);
  const authorizedAt = Date.now();
  const expiresAt = authorizedAt + TEAM_AUTHORIZATION_TTL_MS;
  const deadlineAt = policy.deadlineMs === undefined ? undefined : authorizedAt + policy.deadlineMs;
  const authorized: TeamLaunchAuthorizationResult['slots'] = [];
  const profileFor = (persona: Persona): LaunchProfileId => {
    if (persona.baseProfile) return persona.baseProfile;
    const selection = resolveLaunchSelection({
      config: store.getConfig(), project, personas: personaSnapshot,
      requestedProfile: 'claude', requestedSource: 'seeded-default',
      requestedPersonaId: persona.id, persona
    });
    return selection.ok ? selection.profile : 'claude';
  };
  for (const expected of expectedSlots) {
    if (!known.has(expected.personaId)) {
      return { ok: false, code: 'DENIED', message: `unknown persona: ${expected.personaId}` };
    }
  }
  for (const [index, expected] of expectedSlots.entries()) {
    const persona = known.get(expected.personaId)!;
    const profileId = profileFor(persona);
    const binding: LaunchAuthorizationBinding = {
      consumerKind: 'team-slot', teamId: team.id, slotId: expected.slotId, personaId: expected.personaId,
      profileId, initialTaskDigest: launchDigest(slots[index].initialTask),
      scope: project.remote ? 'remote' : 'local',
      storeRevision: launchDigest({ team, personas: personaSnapshot }),
      projectIdentityDigest: launchDigest(project), autonomous, expiresAt, deadlineAt
    };
    const decision = launchAuthorization.authorize({
      principal: principalRef, projectId: project.id,
      launchDigest: launchDigest({ principal: principalRef, projectId: project.id, binding }),
      binding, expiresAt
    });
    if (decision.decision === 'denied') {
      for (const slot of authorized) launchAuthorization.revoke(slot.authorizationId);
      return { ok: false, code: 'DENIED', message: decision.reason };
    }
    authorized.push({ ...slots[index], ...expected, authorizationId: decision.authorization.id });
  }
  return {
    ok: true,
    value: {
      teamId: team.id,
      projectId: project.id,
      slots: authorized,
      context: {
        version: 1,
        principalId: principalRef.id,
        authorizedAt,
        expiresAt,
        slots: authorized.map(({ slotId, personaId, authorizationId }) => ({ slotId, personaId, authorizationIdDigest: launchDigest(authorizationId) }))
      }
    }
  };
}

/**
 * Launch a Team into a project (design §4d — no daemon, cockpit hand-off):
 * workers open FIRST, then the orchestrator LAST carrying the team prompt + a
 * roster of the workers' session ids (see {@link orchestratorPrompt}). Each tab
 * opens through the same confined `createTerminalConfined` path, so argv is
 * sanitized by the existing main-side denylist. Workers open as their persona
 * with no prompt; the orchestrator carries the briefing. A slot whose
 * `personaId` no longer resolves against the persona store is SKIPPED (not
 * trusted). `projectId` falls back to the team's `defaultProjectId`.
 *
 * Returns the count of tabs opened + the launch's `cohortId`. main authorizes
 * throughout: the team is looked up from the store (not trusted from the
 * renderer), the project is validated by `createTerminalConfined`, and personaId
 * existence is checked here against the live persona list.
 */
export async function launchTeam(
  teamId: string,
  projectId?: string,
  opts?: { goal?: string; callerPrincipalId?: string } | TeamLaunchRequestInput
): Promise<Result<LaunchTeamResult>> {
  const team = teams.list().find((t) => t.id === teamId);
  if (!team) return { ok: false, code: 'NOT_FOUND', message: `team not found: ${teamId}` };
  const targetProjectId = projectId ?? team.defaultProjectId;
  if (!targetProjectId) {
    return { ok: false, code: 'INVALID', message: 'no projectId and team has no defaultProjectId' };
  }
  const project = store.listProjects().find((p) => p.id === targetProjectId);
  if (!project) return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
  const currentConfig = store.getConfig();

  const personaSnapshot = personas.list();
  const known = new Set(personaSnapshot.map((p) => p.id));
  const personaName = (id: string) => personas.list().find((p) => p.id === id)?.name ?? id;

  // Autonomous runs (goal present) drive the orchestrator + workers unattended:
  // the goal is folded into the orchestrator's opening prompt (see
  // {@link orchestratorPrompt}) and EVERY spawned tab is launched `autonomous`
  // (forces --permission-mode acceptEdits + no AskUserQuestion) so the team can
  // self-drive without blocking on per-tool approval. A plain launch (no goal)
  // is unchanged. The goal arrives already trimmed/capped from the caller.
  const goal = opts?.goal?.trim() || undefined;
  const autonomous = !!goal;
  let orchestratorSessionId: string | undefined;
  const workerSessionIds: string[] = [];

  // One cohort per launch (per-launch identity, not a per-team singleton):
  // relaunching the same team mints a fresh id, so two live runs are managed
  // separately on the board. The orchestrator's `role` (stamped below) is the
  // sole source of truth for the control-plane orchestrator gate — no side Set.
  const cohortId = randomUUID();
  const structured = opts && 'launchRequestId' in opts ? opts : undefined;
  const cohortBase = {
    cohortId,
    teamId: team.id,
    teamName: team.name,
    ...(structured?.executionId ? { executionId: structured.executionId } : {}),
    ...(structured?.executionJobTitle ? { executionJobTitle: structured.executionJobTitle } : {})
  };

  // Workers open FIRST so the orchestrator (opened last) can be handed a roster
  // of their live session ids in its opening prompt — turning the team into a
  // pre-wired mesh it can `agent_send` to, not strangers sharing a project. The
  // orchestrator slot itself is deferred out of this loop; a standalone
  // orchestrator persona (not a slot) is never a worker.
  const orchestratorId = team.orchestratorPersonaId;

  // Conservative ceiling on total tabs opened by one launch (Rule 5): bound the
  // Σ quantity so a malformed/huge team can't spawn an unbounded fleet. We
  // reserve ONE slot of headroom for the orchestrator so a huge team can't crowd
  // it out (the fleet driver must always get its tab).
  const MAX_TABS_PER_LAUNCH = 32;
  const hasOrchestrator = !!orchestratorId && known.has(orchestratorId);
  const workerCeiling = hasOrchestrator ? MAX_TABS_PER_LAUNCH - 1 : MAX_TABS_PER_LAUNCH;
  let launched = 0;
  // Roster handed to the orchestrator: each opened worker's id + display label.
  const roster: Array<{ sessionId: string; label: string }> = [];
  const workers: TeamLaunchedWorker[] = [];
  const failedSlots: TeamFailedWorkerSlot[] = [];
  const launchRequestId = structured?.launchRequestId ?? randomUUID();
  const callerPrincipalId = structured?.callerPrincipalId ?? opts?.callerPrincipalId ?? `legacy:${launchRequestId}`;
  const teamPrincipalRef = {
    kind: 'team' as const,
    id: structured ? `team:${team.id}:${callerPrincipalId}:${launchRequestId}` : `team:${team.id}:${cohortId}`
  };
  const expectedSlots: Array<{ slotId: string; personaId: string; label?: string; role: 'worker' | 'orchestrator' }> = [];
  let expectedCount = 0;
  outerExpansion: for (const [rowIndex, slot] of team.slots.entries()) {
    if (orchestratorId && slot.personaId === orchestratorId) continue;
    const quantity = Math.max(1, Math.min(TEAM_SLOT_MAX, slot.quantity ?? 1));
    for (let i = 0; i < quantity; i++) {
      if (expectedCount >= workerCeiling) break outerExpansion;
      expectedSlots.push({ slotId: `${rowIndex}:${slot.personaId}:${i}`, personaId: slot.personaId, label: slot.label, role: 'worker' });
      expectedCount += 1;
    }
  }
  if (orchestratorId && expectedCount < MAX_TABS_PER_LAUNCH) {
    expectedSlots.push({ slotId: `orchestrator:${orchestratorId}`, personaId: orchestratorId, role: 'orchestrator' });
  }
  if (structured) {
    if (!structured.callerPrincipalId?.trim() || !structured.launchRequestId?.trim()) {
      return { ok: false, code: 'INVALID', message: 'callerPrincipalId and launchRequestId are required' };
    }
    if (structured.slots.length !== expectedSlots.length
      || structured.slots.some((slot, index) => slot.slotId !== expectedSlots[index]?.slotId)) {
      return { ok: false, code: 'INVALID', message: 'structured slots do not match host-expanded Team slots' };
    }
    if (structured.requirePreauthorization && structured.slots.some((slot) => !slot.authorizationId?.trim())) {
      return { ok: false, code: 'DENIED', message: 'structured slot is missing authorizationId' };
    }
  }
  let launchDeadlineAt = structured?.policy?.deadlineMs === undefined
    ? undefined
    : Date.now() + structured.policy.deadlineMs;
  const taskFor = (slotId: string, fallback = '') => structured?.slots.find((slot) => slot.slotId === slotId)?.initialTask ?? fallback;
  // Teams reference Personas, not a harness. Pinned Personas retain their exact
  // profile; neutral Personas follow Project -> Global -> compatibility routing.
  const profileFor = (personaId: string): LaunchProfileId => {
    const persona = personaSnapshot.find((candidate) => candidate.id === personaId);
    if (persona?.baseProfile) return persona.baseProfile;
    const selected = resolveLaunchSelection({
      config: currentConfig,
      project,
      personas: personaSnapshot,
      requestedProfile: 'claude',
      requestedSource: 'seeded-default',
      requestedPersonaId: personaId,
      persona
    });
    return selected.ok ? selected.profile : 'claude';
  };
  const taskBindingFailure = (personaId: string): string | undefined => {
    if (!structured) return undefined;
    const descriptor = providerFor(profileFor(personaId)).adapter.descriptor;
    const transport = project.remote ? descriptor.initialTaskDelivery.remote : descriptor.initialTaskDelivery.local;
    return transport === 'spawn-arg' && descriptor.initialTaskDelivery.acceptanceSignal === 'argv-bound'
      ? undefined
      : `adapter "${descriptor.id}" cannot bind initial task at spawn`;
  };
  if (structured && structured.slots.some((slot) => !slot.initialTask.trim() || Buffer.byteLength(slot.initialTask, 'utf8') > 64 * 1_024)) {
    return { ok: false, code: 'INVALID', message: 'invalid initial task' };
  }
  const authorizationBindings = expectedSlots.map(({ slotId, personaId }) => ({
    slotId,
    authorizationBinding: launchDigest({
      consumerKind: 'team-slot', teamId: team.id, slotId, personaId,
      projectId: targetProjectId, scope: project.remote ? 'remote' : 'local',
      profile: profileFor(personaId), autonomous
    })
  }));
  const payloadDigest = launchDigest({
    teamId, projectId: targetProjectId, callerPrincipalId, launchRequestId,
    policy: {
      autonomous, goal: goal ?? null,
      deadlineMs: structured?.policy?.deadlineMs ?? null,
      maxConcurrent: structured?.policy?.maxConcurrent ?? 32,
      maxLaunches: structured?.policy?.maxLaunches ?? 32
    },
    slots: (structured?.slots ?? expectedSlots.map(({ slotId }) => ({ slotId, initialTask: taskFor(slotId) })))
      .map((slot, index) => ({
        slotId: slot.slotId,
        initialTask: slot.initialTask,
        authorizationBinding: authorizationBindings[index]?.authorizationBinding
      }))
  });
  const existingRequest = await teamLifecycle.findRequest(callerPrincipalId, launchRequestId);
  if (existingRequest?.payloadDigest !== undefined && existingRequest.payloadDigest !== payloadDigest) {
    return { ok: false, code: 'CONFLICT', message: 'launch request id reused with changed payload' };
  }
  if (existingRequest?.outcome.status === 'in-progress') {
    return { ok: false, code: 'IN_PROGRESS', message: 'team launch request is still in progress' };
  }
  if (existingRequest?.outcome.status === 'completed') {
    for (const slot of structured?.slots ?? []) {
      if (slot.authorizationId) launchAuthorization.revoke(slot.authorizationId);
    }
    const replay = existingRequest.outcome.result;
    if (!replay.ok) return replay;
    return { ok: true, value: {
      ...replay.value,
      orchestratorSessionId: replay.value.orchestratorSessionId,
      workerSessionIds: replay.value.workerSessionIds ?? []
    } };
  }
  if (structured?.requirePreauthorization) {
    const currentStoreRevision = launchDigest({ team, personas: personaSnapshot });
    const currentProjectIdentity = launchDigest(project);
    for (const [index, expected] of expectedSlots.entries()) {
      const requested = structured.slots[index];
      const authorization = launchAuthorization.get(requested.authorizationId!);
      if (!authorization) return { ok: false, code: 'DENIED', message: 'unknown authorization' };
      const expectedProfile = profileFor(expected.personaId);
      const binding = authorization.binding;
      if (authorization.principal.id !== teamPrincipalRef.id
        || authorization.principal.kind !== teamPrincipalRef.kind
        || authorization.projectId !== targetProjectId
        || binding.consumerKind !== 'team-slot'
        || binding.teamId !== team.id
        || binding.slotId !== expected.slotId
        || binding.personaId !== expected.personaId
        || binding.profileId !== expectedProfile
        || binding.scope !== (project.remote ? 'remote' : 'local')
        || binding.autonomous !== autonomous
        || (structured.policy?.deadlineMs === undefined
          ? binding.deadlineAt !== undefined
          : binding.deadlineAt !== binding.expiresAt - TEAM_AUTHORIZATION_TTL_MS + structured.policy.deadlineMs)
        || binding.initialTaskDigest !== launchDigest(requested.initialTask)
        || binding.storeRevision !== currentStoreRevision
        || binding.projectIdentityDigest !== currentProjectIdentity
        || binding.evidenceDigest !== undefined
        || binding.consentReservation !== undefined) {
        revokeRequestAuthorizations();
        return { ok: false, code: 'DENIED', message: 'preissued authorization binding mismatch' };
      }
      const valid = launchAuthorization.validatePreissued(requested.authorizationId!, {
        principal: teamPrincipalRef, projectId: targetProjectId, binding
      });
      if (!valid.ok) {
        revokeRequestAuthorizations();
        return { ok: false, code: 'DENIED', message: valid.reason };
      }
    }
    launchDeadlineAt = launchAuthorization.get(structured.slots[0].authorizationId!)?.binding.deadlineAt;
    if (launchDeadlineAt !== undefined && launchDeadlineAt <= Date.now()) {
      revokeRequestAuthorizations();
      return { ok: false, code: 'DEADLINE_EXCEEDED', message: 'team launch deadline elapsed before spawn' };
    }
  }
  const runLimit = Math.min(structured?.policy?.maxLaunches ?? 32, 32);
  const concurrentLimit = Math.min(structured?.policy?.maxConcurrent ?? runLimit, runLimit);
  if (expectedSlots.length > runLimit) {
    return { ok: false, code: 'RESOURCE_LIMIT', message: `team launch requests ${expectedSlots.length} slots but limit is ${runLimit}` };
  }
  const runPrincipal = bindLaunchPrincipal(teamPrincipalRef, {
    id: teamPrincipalRef.id, allowedProjectIds: [targetProjectId], maxConcurrent: concurrentLimit, maxLaunchesPerRun: runLimit
  }, team.id) as Extract<LaunchPrincipal, { kind: 'team' }>;
  const claim = await teamLifecycle.claim({
    callerPrincipalId, launchRequestId, payloadDigest,
    capacity: { principal: runPrincipal, launched: 0 }
  });
  if (claim.outcome === 'in-progress') {
    return { ok: false, code: 'IN_PROGRESS', message: 'team launch request is still in progress' };
  }
  if (claim.outcome === 'replay') {
    if (claim.record.outcome.status !== 'completed') {
      return { ok: false, code: 'IN_PROGRESS', message: 'team launch request is still in progress' };
    }
    revokeRequestAuthorizations();
    const replay = claim.record.outcome.result;
    if (!replay.ok) return replay;
    return { ok: true, value: { ...replay.value, workerSessionIds: replay.value.workerSessionIds ?? [] } };
  }
  if (claim.outcome === 'conflict') return { ok: false, code: 'CONFLICT', message: 'launch request id reused with changed payload' };

  const launchSlot = async (
    expectedSlot: { slotId: string; personaId: string; label?: string; role: 'worker' | 'orchestrator' },
    request: CreateTerminalRequest
  ): Promise<Result<TerminalSession>> => {
    const { slotId, personaId } = expectedSlot;
    let authorizationId = structured?.slots.find((slot) => slot.slotId === slotId)?.authorizationId;
    if (!structured?.requirePreauthorization) {
      const profileId = profileFor(personaId);
      const expiresAt = Date.now() + TEAM_AUTHORIZATION_TTL_MS;
      const principal = bindLaunchPrincipal(teamPrincipalRef, {
        id: teamPrincipalRef.id, allowedProjectIds: [targetProjectId], maxConcurrent: concurrentLimit, maxLaunchesPerRun: runLimit
      }, team.id)!;
      const existing = launchPrincipals.get(principal.id);
      if (existing && launchDigest(existing) !== launchDigest(principal)) {
        return { ok: false, code: 'DENIED', message: 'principal binding changed during run' };
      }
      launchPrincipals.set(principal.id, principal);
      const binding: LaunchAuthorizationBinding = {
        consumerKind: 'team-slot', teamId: team.id, slotId, personaId, profileId,
        initialTaskDigest: launchDigest(request.prompt ?? ''), scope: project.remote ? 'remote' : 'local',
        storeRevision: launchDigest({ team, personas: personaSnapshot }),
         projectIdentityDigest: launchDigest(project), autonomous, expiresAt, deadlineAt: launchDeadlineAt
      };
      const authorized = launchAuthorization.authorize({
        principal: teamPrincipalRef, projectId: targetProjectId,
        launchDigest: launchDigest({ principal: teamPrincipalRef, projectId: targetProjectId, binding }),
        binding, expiresAt
      });
      if (authorized.decision === 'denied') return { ok: false, code: 'DENIED', message: authorized.reason };
      authorizationId = authorized.authorization.id;
    }
    let durableIdentity: { authorizationId: string; sessionId: string } | undefined;
    const result = await launchAuthorizedTerminal(
      request,
       teamPrincipalRef,
      { autonomous },
       team.id,
       async (identity) => {
         const record = await teamLifecycle.addWorker(claim.record.id, {
           sessionId: identity.sessionId, authorizationId: identity.authorizationId, cohortId,
           slotId, personaId, projectId: targetProjectId, process: 'spawning', attention: 'active', task: 'unknown',
           delivery: 'bound-at-spawn'
         });
         durableIdentity = identity;
         teamLifecycleIntegration.track(record);
        },
        authorizationId,
        launchAuthorization.get(authorizationId!)?.binding.deadlineAt,
        // Team Personas predate strict facet evidence. Preserve unsupported
        // stored facets for both UI and structured Team launches while explicit
        // role/model/execution targets still pass their normal evidence gates.
        true,
        {
          maySpawn: () => teamLifecycle.workerMaySpawn(claim.record.id, slotId),
          claimRunning: () => teamLifecycle.claimWorkerRunning(claim.record.id, slotId)
        }
    );
    if (durableIdentity) {
      try {
        if (result.ok) {
          const updated = await teamLifecycle.updateWorker(claim.record.id, slotId, { process: 'running' });
          teamLifecycleIntegration.track(updated.record);
        } else if (result.code === 'CANCEL_PENDING') {
          const current = await teamLifecycle.get(claim.record.id);
          if (current) teamLifecycleIntegration.track(current);
        } else {
          const updated = await teamLifecycle.updateWorker(claim.record.id, slotId, { process: 'spawn-failed' });
          teamLifecycleIntegration.track(updated.record);
        }
      } catch (error) {
        const current = await teamLifecycle.get(claim.record.id);
        const process = current?.workers.find((worker) => worker.slotId === slotId)?.process;
        if (process !== 'canceled' && process !== 'exited' && process !== 'spawn-failed') throw error;
        if (current) teamLifecycleIntegration.track(current);
      }
    }
    return result;
  };

  for (const expectedSlot of expectedSlots.filter((slot) => slot.role === 'worker')) {
     const { slotId, personaId, label: slotLabel } = expectedSlot;
     if (!known.has(personaId)) {
       const authorizationId = structured?.slots.find((slot) => slot.slotId === slotId)?.authorizationId;
       if (authorizationId) launchAuthorization.revoke(authorizationId);
       failedSlots.push({ slotId, personaId, reason: 'unknown persona' });
       continue;
     }
     const bindingFailure = taskBindingFailure(personaId);
     if (bindingFailure) {
       const authorizationId = structured?.slots.find((slot) => slot.slotId === slotId)?.authorizationId;
       if (authorizationId) launchAuthorization.revoke(authorizationId);
       failedSlots.push({ slotId, personaId, reason: bindingFailure });
       continue;
     }
      const repeatIndex = Number(slotId.slice(slotId.lastIndexOf(':') + 1));
      const rowIndex = Number(slotId.slice(0, slotId.indexOf(':')));
      const quantity = Math.max(1, Math.min(TEAM_SLOT_MAX, team.slots[rowIndex]?.quantity ?? 1));
      const label = slotLabel || personaName(personaId);
       const res = await launchSlot(expectedSlot,
        {
          projectId: targetProjectId,
          profile: profileFor(personaId),
          personaId,
          cols: 80,
          rows: 24,
          // Workers run as BACKGROUND: still listed on the Agents board (with the
          // Background badge) and grouped under their cohort, but never nudged,
          // triaged, or promoted to "Needs you". The user deals only with the
          // orchestrator; workers report to it via agent_send.
           headless: true,
           ...(taskFor(slotId) ? { prompt: taskFor(slotId) } : {}),
          cohort: {
            ...cohortBase,
            role: 'worker',
             slotId,
             ...(slotLabel ? { slotLabel } : {})
           },
           ...(slotLabel ? { title: slotLabel } : {})
         }
       );
       if (res.ok) {
        launched += 1;
        // quantity>1 → suffix so two tabs of one slot are distinguishable in the
        // roster (the orchestrator addresses each by its own session id).
         roster.push({ sessionId: res.value.id, label: quantity > 1 ? `${label} ${repeatIndex + 1}` : label });
        // Squad grouping: every launched tab shares the one cohortId so the
        // registry namespaces this launch (renderer squad view + discovery).
        teamLaunchSessions.set(res.value.id, cohortId);
        // Track worker ids so an autonomous run can nudge/tear them down.
         workerSessionIds.push(res.value.id);
         const authorizationId = launchAuthorizationBySession.get(res.value.id)!;
         workers.push({ sessionId: res.value.id, cohortId, slotId, personaId, projectId: targetProjectId, authorizationId });
       } else {
         failedSlots.push({ slotId, personaId, reason: res.message });
       }
  }

  // Orchestrator LAST, carrying the team prompt + the worker roster. Whether it's
  // a declared slot or a standalone persona id, it opens exactly once here.
  if (orchestratorId && !hasOrchestrator) {
    failedSlots.push({ slotId: `orchestrator:${orchestratorId}`, personaId: orchestratorId, reason: 'unknown persona' });
  } else if (hasOrchestrator && launched < MAX_TABS_PER_LAUNCH) {
    const orchestratorSlotId = `orchestrator:${orchestratorId}`;
    const orchestratorTask = taskFor(orchestratorSlotId, orchestratorPrompt(team, roster, goal));
    const bindingFailure = taskBindingFailure(orchestratorId!);
    if (bindingFailure) {
      const authorizationId = structured?.slots.find((slot) => slot.slotId === orchestratorSlotId)?.authorizationId;
      if (authorizationId) launchAuthorization.revoke(authorizationId);
      failedSlots.push({ slotId: orchestratorSlotId, personaId: orchestratorId!, reason: bindingFailure });
    } else {
    const res = await launchSlot({ slotId: orchestratorSlotId, personaId: orchestratorId!, role: 'orchestrator' },
      {
        projectId: targetProjectId,
        profile: profileFor(orchestratorId!),
        personaId: orchestratorId!,
        cols: 80,
        rows: 24,
        title: team.name,
        // role:'orchestrator' stamped on the session IS the control-plane
        // orchestrator attestation (promotes it past agent-class). Host-set from
        // the launch, never self-declared; dies with the session (Rule 3).
        cohort: { ...cohortBase, role: 'orchestrator', slotId: `orchestrator:${orchestratorId}` },
        ...(orchestratorTask ? { prompt: orchestratorTask } : {})
      }
    );
    if (res.ok) {
      launched += 1;
      orchestratorSessionId = res.value.id;
      // Same shared cohortId as the workers, so the orchestrator groups with its
      // squad in the registry / renderer squad view.
      teamLaunchSessions.set(res.value.id, cohortId);
      const authorizationId = launchAuthorizationBySession.get(res.value.id)!;
      workers.push({ sessionId: res.value.id, cohortId, slotId: orchestratorSlotId, personaId: orchestratorId!, projectId: targetProjectId, authorizationId });
    } else {
      failedSlots.push({ slotId: orchestratorSlotId, personaId: orchestratorId!, reason: res.message });
    }
    }
  }

  const result: LaunchTeamResult = { launchRequestId, launched, cohortId, workers, failedSlots, orchestratorSessionId, workerSessionIds };
  const operationResult: Result<LaunchTeamResult> = launched === 0 && structured
    ? { ok: false, code: 'TEAM_LAUNCH_FAILED', message: failedSlots.map((slot) => `${slot.slotId}: ${slot.reason}`).join('; ') || 'team launched no workers' }
    : { ok: true, value: result };
  await teamLifecycle.complete(claim.record.id, operationResult, result);
  const lifecycleRecord = await teamLifecycle.get(claim.record.id);
  if (lifecycleRecord) teamLifecycleIntegration.track(lifecycleRecord);
  return operationResult;

  function revokeRequestAuthorizations(): void {
    if (!structured) return;
    for (const slot of structured.slots) {
      if (!slot.authorizationId) continue;
      const authorization = launchAuthorization.get(slot.authorizationId);
      if (authorization?.principal.id === teamPrincipalRef.id) launchAuthorization.revoke(slot.authorizationId);
    }
  }
}

export async function cancelTeamLaunch(
  callerPrincipalId: string,
  launchRequestId: string
): Promise<Result<CancelTeamLaunchResult>> {
  if (!callerPrincipalId.trim() || !launchRequestId.trim()) {
    return { ok: false, code: 'INVALID', message: 'callerPrincipalId and launchRequestId are required' };
  }
  const canceled = await teamLifecycleIntegration.cancelTeamLaunch(callerPrincipalId, launchRequestId);
  return canceled.ok
    ? { ok: true, value: {
        canceledSessionIds: canceled.canceledSessionIds,
        pendingSessionIds: canceled.pendingSessionIds,
        lifecycleState: canceled.lifecycleState
      } }
    : { ok: false, code: canceled.code, message: 'team launch request not found for caller' };
}

export async function getTeamLaunch(callerPrincipalId: string, launchRequestId: string): Promise<Result<unknown>> {
  const result = await teamLifecycleIntegration.getTeamLaunch(callerPrincipalId, launchRequestId);
  return result.ok ? { ok: true, value: result.record } : { ok: false, code: result.code, message: 'team launch request not found for caller' };
}

const squadExecutionService = new SquadExecutionService({
  store: executionStore,
  artifacts: executionArtifacts,
  authorizeTeamLaunch,
  launchTeam,
  getTeamLaunch: async (callerPrincipalId, launchRequestId) => {
    const result = await getTeamLaunch(callerPrincipalId, launchRequestId);
    return result.ok ? result.value : undefined;
  },
  cancelTeamLaunch: async (callerPrincipalId, launchRequestId) => cancelTeamLaunch(callerPrincipalId, launchRequestId),
  replyToSession: (sessionId, text) => ptys.reply(sessionId, text),
  resumeGrants: executionResumeGrants,
  clearResumeToken: (projectId, executionId) => executionResumeTokens.clear(projectId, executionId),
  preflightWorkflow: (teamId, workflow) => {
    const team = teams.list().find((candidate) => candidate.id === teamId);
    return team ? preflightWorkflowProfile(workflow, team, personas.list()) : { ok: false, code: 'INVALID_WORKFLOW_PROFILE', message: 'workflow profile Team is unavailable' };
  }
});

export async function reportTeamTask(
  callerPrincipalId: string,
  launchRequestId: string,
  slotId: string,
  outcome: 'complete' | 'failed'
): Promise<Result<unknown>> {
  // Worker routes have no owner principal. Authorize against main's durable
  // session-to-slot binding, never the launch owner's session identity.
  const record = (await teamLifecycle.list()).find((candidate) => candidate.launchRequestId === launchRequestId
    && candidate.workers.some((worker) => worker.sessionId === callerPrincipalId && worker.slotId === slotId));
  if (!record) return { ok: false, code: 'NOT_FOUND', message: 'team launch slot not found for caller' };
  const updated = await teamLifecycle.updateWorker(record.id, slotId, {
    task: outcome === 'complete' ? 'caller-reported-complete' : 'caller-reported-failed'
  });
  return { ok: true, value: updated.record };
}

/**
 * Launch a team as an autonomous run (the body of the `teams:launchAutonomous`
 * IPC handler, extracted so it is unit-testable end-to-end). main authorizes:
 * launchTeam re-looks-up the team + confines the project; the goal is trimmed +
 * length-capped here; the supervisor is started and tears the tabs back down if
 * it rejects the run.
 */
export async function launchAutonomousTeam(
  teamId: string,
  projectId: string,
  goal: string
): Promise<Result<{ runId: string }>> {
  try {
    if (typeof teamId !== 'string' || !teamId.trim()) {
      return { ok: false, code: 'INVALID', message: 'teamId is required' };
    }
    if (typeof projectId !== 'string' || !projectId.trim()) {
      return { ok: false, code: 'INVALID', message: 'projectId is required' };
    }
    const trimmedGoal = typeof goal === 'string' ? goal.trim().slice(0, 4000) : '';
    if (!trimmedGoal) {
      return { ok: false, code: 'INVALID', message: 'goal is required' };
    }
    const launched = await launchTeam(teamId, projectId, { goal: trimmedGoal });
    if (!launched.ok) return { ok: false, code: launched.code, message: launched.message };
    if (!launched.value.orchestratorSessionId) {
      return {
        ok: false,
        code: 'NO_ORCHESTRATOR',
        message: 'team has no orchestrator to drive the run'
      };
    }
    const orchestratorSessionId = launched.value.orchestratorSessionId;
    const workerSessionIds = launched.value.workerSessionIds;
    const runId = randomUUID();
    try {
      autonomousRuns.start({
        runId,
        teamId,
        projectId,
        goal: trimmedGoal,
        orchestratorSessionId,
        workerSessionIds,
        limits: {
          maxRounds: store.getConfig().autonomousMaxRounds ?? AUTONOMOUS_DEFAULTS.maxRounds,
          timeoutMs: store.getConfig().autonomousTimeoutMs ?? AUTONOMOUS_DEFAULTS.timeoutMs
        }
      });
    } catch (startErr) {
      for (const sid of [orchestratorSessionId, ...workerSessionIds]) {
        if (ptys.getSession(sid)) ptys.close(sid);
      }
      return { ok: false, code: 'AUTONOMOUS_LAUNCH_FAILED', message: String(startErr) };
    }
    return { ok: true, value: { runId } };
  } catch (err) {
    return { ok: false, code: 'AUTONOMOUS_LAUNCH_FAILED', message: String(err) };
  }
}

/** Stop an active autonomous run by id (the `teams:stopAutonomous` handler body). */
export function stopAutonomousRun(runId: string): Result<true> {
  if (typeof runId !== 'string' || !runId.trim()) {
    return { ok: false, code: 'INVALID', message: 'runId is required' };
  }
  const stopped = autonomousRuns.stop(runId, 'manual');
  if (!stopped) return { ok: false, code: 'NOT_FOUND', message: `no active run: ${runId}` };
  return { ok: true, value: true };
}

/**
 * Open an app window. With no `projectId` it's the full, unscoped shell (the
 * default window opened at boot and on dock-reactivate). With a `projectId` the
 * renderer locks to that one project — see `windows:openProject` and the
 * renderer's boot-time `?projectId=` read. Every window registers itself in the
 * `windows` map and removes itself on `closed`, which is what `safeSend` fans
 * out across.
 */
function createWindow(projectId?: string, repairOnly = false) {
  // Capture the window the user invoked from BEFORE creating the new one, so a
  // scoped window cascades off its actual opener (not whatever `mainWindow()`
  // would pick, and never off itself once it's in the map).
  const opener = BrowserWindow.getFocusedWindow();
  // Only the unscoped main window restores/persists saved bounds. Scoped
  // windows open at the default size, cascaded so stacked ones don't perfectly
  // overlap — per-project bounds persistence is a deliberate later step.
  const config = store.getConfig();
  const saved = projectId || repairOnly ? undefined : config.windowBounds;
  const restored = restoreWindowState(
    saved,
    projectId || repairOnly ? undefined : config.windowMaximized,
    screen.getAllDisplays(),
    screen.getPrimaryDisplay()
  );

  const iconPath = resolveIconPath();
  const win = new BrowserWindow({
    width: projectId || repairOnly ? 1400 : restored.bounds.width,
    height: projectId || repairOnly ? 900 : restored.bounds.height,
    x: projectId || repairOnly ? undefined : restored.bounds.x,
    y: projectId || repairOnly ? undefined : restored.bounds.y,
    minWidth: projectId || repairOnly ? 900 : restored.minWidth,
    minHeight: projectId || repairOnly ? 600 : restored.minHeight,
    title: 'Zana',
    icon: iconPath ?? undefined,
    backgroundColor: '#0b0f15',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      // CommonJS preload (../preload/index.js) — REQUIRED because sandbox:true
      // below cannot load an ESM preload (it fails silently → window.cc
      // undefined → renderer crash). Build emits CJS; see electron.vite.config.
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: true,
      // The sandboxed preload can't reliably read process.env, so pass the e2e
      // flag as an argv token it CAN read (process.argv). Only present when the
      // tap is enabled; gates the window.__zccTest bridge in preload.
      ...(E2E_TAP_ENABLED ? { additionalArguments: ['--zcc-e2e'] } : {})
    }
  });

  windows.set(win.id, { win, projectId });
  win.on('closed', () => {
    conversationHistory.releaseWindow(win.id);
    windows.delete(win.id);
    boundsControllers.delete(win.id);
  });

  // A scoped window opens slightly offset from its opener so a freshly-opened
  // project window isn't hidden exactly behind the window it was opened from.
  if (projectId && opener && opener !== win && !opener.isDestroyed()) {
    const b = opener.getBounds();
    win.setBounds({ x: b.x + 36, y: b.y + 36, width: b.width, height: b.height });
  }

  // Harden every <webview> the renderer attaches: rewrite their preferences to
  // safe defaults and reject schemes other than http(s)/file/about. The user
  // never points the preview pane at app:// or javascript:, so any such URL is
  // either a typo or untrusted scrollback content — we drop it.
  win.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    webPreferences.contextIsolation = true;
    webPreferences.nodeIntegration = false;
    webPreferences.sandbox = true;
    delete (webPreferences as { preload?: string }).preload;
    const src = params.src ?? '';
    const ok =
      src === 'about:blank' ||
      src.startsWith('http://') ||
      src.startsWith('https://') ||
      src.startsWith('file://');
    if (!ok) event.preventDefault();
  });

  // Persist bounds on resize/move (debounced) so a relaunch restores them.
  // Only the unscoped main window owns the saved bounds.
  if (!projectId && !repairOnly) {
    const controller = createBoundsStateController({
      win,
      initialBounds: restored.bounds,
      initialMaximized: config.windowMaximized,
      write: (state) => store.setConfig(state)
    });
    boundsControllers.set(win.id, controller);
    win.on('resize', controller.scheduleBounds);
    win.on('move', controller.scheduleBounds);
    win.on('maximize', () => controller.setMaximized(true));
    win.on('unmaximize', () => controller.setMaximized(false));
    // `close` can be cancelled; retain controller until `closed` so a later close still flushes.
    win.on('close', () => {
      controller.flushForClose();
    });
  }

  // Push OS-level fullscreen transitions to the renderer that's actually IN
  // this window (not every window — each has its own fullscreen state), so a
  // fullscreen toggle initiated by the OS (e.g. the green traffic-light button)
  // or another IPC caller keeps the renderer's own UI in sync.
  win.on('enter-full-screen', () => {
    const controller = boundsControllers.get(win.id);
    controller?.beginFullscreenTransition();
    controller?.endFullscreenTransition();
    if (!win.isDestroyed()) win.webContents.send(IPC.app.onFullScreenChanged, true);
  });
  win.on('leave-full-screen', () => {
    const controller = boundsControllers.get(win.id);
    controller?.endFullscreenTransition();
    if (!win.isDestroyed()) win.webContents.send(IPC.app.onFullScreenChanged, false);
  });

  // The scoped project id rides in as a query param so the renderer can lock to
  // it before first paint (read in main.tsx). Unscoped windows get no param.
  const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : '';
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}${query}`);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: query ? query.slice(1) : undefined
    });
  }

  if (!projectId && !repairOnly) {
    // macOS can reapply native zoom state after BrowserWindow construction on a
    // process relaunch, overriding explicit constructor bounds. Reassert normal
    // state once native window restoration has finished.
    win.once('ready-to-show', () => {
      if (win.isDestroyed() || win.isFullScreen()) return;
      win.unmaximize();
      win.setBounds(restored.bounds);
      if (restored.maximized) win.maximize();
    });
  }

  // DevTools no longer auto-opens in dev — it spawned a second detached window
  // on every launch (noisy, and it confuses window-targeting E2E harnesses).
  // Open it on demand via View ▸ Toggle Developer Tools (⌥⌘I) or the menu role.
}

/**
 * Wire the long-lived `ptys` / `agentStatus` event bridge to the renderer.
 *
 * MUST be called exactly once, at app init — NOT from `createWindow()`.
 * `createWindow` re-runs whenever the window is recreated (macOS dock
 * `activate` after the last window closes, or `showMainWindow`). Registering
 * these listeners there leaked one fresh set per recreation onto the two
 * long-lived manager singletons, so after a single close→reopen every PTY
 * chunk was `safeSend`-ed twice (then 3×, 4×…) — duplicated terminal output,
 * plus the EventEmitter "possible leak" warning. The handlers target
 * `safeSend`, which already no-ops when the window is missing/destroyed, so
 * binding them once for the process lifetime is correct regardless of how many
 * times the window comes and goes.
 */
let bridgeListenersWired = false;
function wireBridgeListeners() {
  if (bridgeListenersWired) return;
  bridgeListenersWired = true;

  ptys.on('data', (sessionId: string, data: string) => {
    safeSend(IPC.terminals.onData, sessionId, data);
    // Feed the raw PTY stream through the OSC-title detector. Cheap and
    // off the render path — only emits when the agent state actually changes.
    agentStatus.observeData(sessionId, data);
    // The registration chooses a primary visual source. Lifecycle hooks remain
    // an additive AgentStatusTracker overlay, never a mutually exclusive mode.
    const session = ptys.getSession(sessionId);
    if (session) {
      const status = providerFor(session.profile as LaunchProfileId).adapter.status;
      if (status?.mode === 'output-activity' || status?.mode === 'screen-scan') {
        outputActivity.observe(sessionId, data);
      }
      if (status?.mode === 'screen-scan') {
        screenScanBlocked.observe(sessionId, data);
      }
    }
  });
  ptys.on('exit', (sessionId: string, code: number) => {
    safeSend(IPC.terminals.onExit, sessionId, code);
    const ledgerEntryId = launchLedgerEntriesBySession.get(sessionId);
    launchLedgerEntriesBySession.delete(sessionId);
    const authorizationId = launchAuthorizationBySession.get(sessionId);
    launchAuthorizationBySession.delete(sessionId);
    if (authorizationId) launchAuthorization.complete(authorizationId);
    void teamLifecycleIntegration.onSessionExit(sessionId).catch((error) =>
      logMainError(`team lifecycle exit ${sessionId}`, error)
    );
    if (ledgerEntryId) {
      void launchLedger.transition(ledgerEntryId, 'exited').catch((error) =>
        logMainError(`launch ledger exit ${sessionId}`, error)
      );
    }
    const exitedSession = ptys.getSession(sessionId);
    if (exitedSession) {
      const finalRead = readLiveSessionStats(exitedSession);
      const liveStats = liveSessionStats.get(sessionId);
      liveSessionStats.delete(sessionId);
      retainExitedSessionStats(exitedSession, liveStats?.pending ?? finalRead);
      refreshRestoreCapability(exitedSession);
    }
    agentStatus.remove(sessionId);
    outputActivity.remove(sessionId);
    screenScanBlocked.remove(sessionId);
    idleTriage.remove(sessionId);
    // Drop any question held for this session — an agent that finished and closed
    // without ever idling never wanted the answer (a deliberate self-resolve on
    // exit); also clears the armed max-hold safety timers (Rule 3).
    heldQuestions.remove(sessionId);
    catchUpSummary.remove(sessionId);
    autoReportLinker.remove(sessionId);
    // Release the Codex rollout-resolver cache entry for this session (Rule 5);
    // a no-op for Claude/shell sessions (nothing cached under that key).
    transcriptSource.forget(sessionId);
    // Same release for the OpenCode session-id resolver's cache (Rule 5).
    heartbeat.remove(sessionId);
    // Drop a session that exits while working so a dead pty can't pin the Mac
    // awake; releases (after grace) if it was the last working agent.
    keepAwake.remove(sessionId);
    // Orchestrator exit = goal reached; worker exit just disarms its nudge.
    // run.summary stays undefined in v1 — close_session_with_summary already
    // pushes the orchestrator's own summary to the inbox as its own entry.
    autonomousRuns.onSessionExit(sessionId);
    // The team dies with its lead. When an ORCHESTRATOR session exits — for ANY
    // reason (manual close, crash, app quit) — tear down every other still-live
    // member of its cohort so a plain (non-autonomous) team launch can be
    // managed by a single close, and no worker is left reporting to a dead lead.
    // The autonomous supervisor already does this for goal-driven runs
    // (autonomous-run-supervisor.ts onSessionExit → 'orchestrator-gone'); this
    // generalises it to plain launches. Extracted into a pure, testable helper;
    // closeExpected marks a clean exit + is idempotent, so re-closing a member
    // the supervisor already tore down is a harmless no-op.
    const cascade = cascadeCloseTeamOnOrchestratorExit({
      exitedSessionId: sessionId,
      getSession: (id) => ptys.getSession(id),
      listAll: () => ptys.listAll(),
      close: (id) => {
        if (!ptys.getSession(id)) return false;
        void terminateSession(id);
        return true;
      }
    });
    if (cascade && cascade.closed.length > 0) {
      console.log(
        `[main] team: orchestrator ${sessionId} exited — closed ${cascade.closed.length} member(s) of team "${cascade.teamName}" (cohort ${cascade.cohortId})`
      );
    }
    autoCloseIdle.remove(sessionId);
    lastTriageBySession.delete(sessionId);
    lastTitleBySession.delete(sessionId);
    // Prune (or keep + surface) an isolated worktree this session was launched
    // into. Async + best-effort — fired-and-forgotten off the exit path so a
    // slow `git worktree remove` can't stall teardown; it consumes its own cache
    // entry (Rule 3). A non-worktree session is a cheap no-op.
    void maybePruneWorktreeOnExit(sessionId);
    if (activeForegroundSessionId === sessionId) activeForegroundSessionId = null;
    mailDrain.remove(sessionId);
    llmNamedSessions.delete(sessionId);
    // Drop this session's Overseer audit entries + any pending activity push so
    // an exited tab leaves nothing behind (Rule 3 cleanup; keeps the ring small).
    overseerAudit.clear(sessionId);
    const oat = overseerActivityTimers.get(sessionId);
    if (oat) {
      clearTimeout(oat);
      overseerActivityTimers.delete(sessionId);
    }
    // Orchestrator attestation now lives on the session's own `cohort.role` (set
    // at launch), so it's gone the instant the session record is dropped — no
    // side Set to clean up.
    // Drop the team-launch membership so a dead session can't leak into a
    // squad's discovery scope (also frees memory — Rule 5).
    teamLaunchSessions.delete(sessionId);
    // Drop the discovery record so an exited session stops showing up in a
    // peer's list_agents. Bound here (the once-wired bridge), never in
    // createWindow(), so a window reopen can't double-register the drop.
    agentRegistry.drop(sessionId);
    // Release this session's slot in the local-extension hot-reload watcher
    // (refcounted — only closes the fs watcher once the LAST session cwd'd
    // into that extension's working dir is gone).
    localExtensionWatcher.onSessionExit(sessionId);
  });
  ptys.on('sessionUpdated', (session) => {
    refreshRestoreCapability(session);
    safeSend(IPC.terminals.onUpdated, session);
    // Auto-seed the discovery registry so a transcript-bearing agent session is
    // discoverable by peers even if its agent never calls register_agent. Gated
    // on the `hasTranscript` capability (an agent with a resumable conversation,
    // vs a shell tab with no agent to discover) — provider-agnostic, so a future
    // transcript-bearing provider (Codex, once its reader lands) auto-seeds too.
    // upsert is idempotent and preserves registeredAt, so the repeat
    // sessionUpdated emits (e.g. a headless toggle) just refresh the record; an
    // explicit register_agent later enriches handle/role/capabilities.
    if (providerCapabilities(session.profile as LaunchProfileId).hasTranscript) {
      agentRegistry.upsert({
        sessionId: session.id,
        projectId: session.projectId,
        cwd: session.cwd,
        // Seed the DISPLAY name (the live tab title) so the session is
        // addressable before the agent picks its own handle — but NEVER as the
        // authoritative `handle`. The title drifts (Claude's task summary, the
        // user's rename), so writing it to `handle` is what made a registered
        // agent's name silently revert to its tab title. Passing it as
        // `displayName` refreshes the title on every sessionUpdated while
        // leaving any handle the agent registered untouched.
        displayName: session.title || session.profile,
        // Squad membership: prefer the cohort STAMPED SYNCHRONOUSLY on the
        // session by create() over the teamLaunchSessions side map. launchTeam
        // fills that map only AFTER createTerminalConfined returns, but create()
        // emits this sessionUpdated synchronously — so the map is still empty at
        // the first seed. Reading it here recorded teamLaunchId:undefined for
        // every team member, which the store then pins forever (set-once), so a
        // worker that never calls register_agent dropped out of its squad in the
        // Flow view and leaked into the "Solo agents" bucket. The cohortId IS the
        // teamLaunchId (same per-launch uuid); the map stays as a fallback.
        teamLaunchId: session.cohort?.cohortId ?? teamLaunchSessions.get(session.id)
      });
    }
    // Arm (or move) this session's slot in the local-extension hot-reload
    // watcher — a no-op unless its cwd sits inside a registered local
    // extension's working dir. cwd is set on the session record before this
    // event fires, so there's no race reading it here.
    void localExtensionWatcher.onSessionMaybeLocal(session.id, session.cwd);
  });
  agentStatus.on('status', (sessionId: string, state, seq) => {
    safeSend(IPC.terminals.onAgentStatus, sessionId, state, seq);
    const session = ptys.getSession(sessionId);
    if (session) void transcriptSource.observe(transcriptRefForSession(session));
    void teamLifecycleIntegration.onAgentStatus(sessionId, state).catch((error) =>
      logMainError(`team lifecycle status ${sessionId}`, error)
    );
    // Drive the idle-triage add-on off the SAME resolved-state edge: it fires
    // its LLM micro-call only on the transition INTO idle, once per idle spell,
    // and only when the add-on is enabled (it self-gates). Cheap on this hot
    // path — the read + call are fired-and-forgotten inside the service.
    idleTriage.observe(sessionId, state);
    // Drive the held-questions gate off the SAME resolved-state edge: on entering
    // idle/blocked it flushes any BLOCKING question it parked while the agent was
    // working, so the question surfaces the moment the user's input is useful
    // rather than mid-run. Self-gated on the master switch (default ON) and a
    // cheap no-op when nothing is held.
    heldQuestions.observe(sessionId, state);
    // Drive the catch-up-summary add-on off the SAME resolved-state edge: it
    // fires its LLM micro-call on entering idle OR 'blocked', once per spell,
    // and only when the add-on is enabled (it self-gates). Cheap on this hot
    // path — the read + call are fired-and-forgotten inside the service.
    catchUpSummary.observe(sessionId, state);
    // Drive the auto-report linker off the SAME resolved-state edge: on entering
    // idle it re-scans the session's file-touch list for a newly-created report-
    // looking file and links it to the inbox even if the agent never called
    // `inbox_push`. Pure filename heuristic (no LLM spend) — self-gated on the
    // master switch (default ON).
    autoReportLinker.observe(sessionId, state);
    // Drive the Heartbeat feature off the SAME resolved-state edge: on entering
    // idle it arms a delay timer and (for an opted-in, non-background agent)
    // nudges it to continue; on leaving idle it disarms. Self-gated on the
    // master switch + per-session flag, so this is a cheap no-op when off.
    heartbeat.observe(sessionId, state);
    // Drive keep-awake off the SAME edge: a session entering `working` pins the
    // Mac awake; leaving `working` arms the grace release. Self-gated on the
    // config toggle (default ON), so this is cheap when the fleet is idle.
    keepAwake.observe(sessionId, state);
    // Drive auto-close-idle off the SAME resolved-state edge: on entering idle it
    // arms the close timer (for an eligible, non-background, non-delegating
    // agent); on leaving idle it disarms. Self-gated on the master switch, so
    // this is a cheap no-op when the feature is off.
    autoCloseIdle.observe(sessionId, state);
    // Drive the mesh mail-drain off the SAME edge: on entering idle/done, nudge
    // the agent to read any peer mail queued while it was busy (announce-only;
    // the message-log queue stays the source of truth). Cheap no-op when the
    // queue is empty.
    mailDrain.observe(sessionId, state);
    // Drive autonomous runs off the SAME edge: nudge an idle member toward the
    // goal (no-op for any session not in a running autonomous run).
    autonomousRuns.observe(sessionId, state);
    // Diagnostic: the debounced state actually pushed to the renderer (drives
    // the dot + Agents tray). Pairs with [notify-hook] to show the full chain.
    console.log(`[agent-status] session=${sessionId.slice(0, 8)} → ${state}`);
  });
  idleTriage.on('triage', (result: IdleTriageResult) => {
    safeSend(IPC.terminals.onIdleTriage, result);
    // Cache the latest verdict so auto-close-idle can decide — at zero token
    // cost — whether to preserve a parked question before a silent close.
    cacheTriage(result);
    // A fresh verdict changes the question text a blocked row shows, so refresh
    // any open popover (cheap; only re-pushes if the card is visible).
    menubar?.refresh();
    console.log(
      `[idle-triage] session=${result.sessionId.slice(0, 8)} → ${result.resolution}` +
        (result.confidence !== undefined ? ` (${result.confidence.toFixed(2)})` : '')
    );
    // Durable twin of the ephemeral "Needs you" badge: a question the agent
    // parked at idle becomes a persistent Follow-up that survives kill/restart.
    // Self-gates on `awaiting-reply` + the config flag + non-background session;
    // dedups per (session) so a steady idle agent yields one open follow-up.
    if (result.resolution === 'awaiting-reply') {
      try {
        followups.createFromIdle(result);
      } catch (err) {
        console.error('[followups] createFromIdle failed:', err);
      }
    }
  });
  catchUpSummary.on('summary', (result: CatchUpSummaryResult) => {
    safeSend(IPC.terminals.onCatchUpSummary, result);
    console.log(
      `[catch-up-summary] session=${result.sessionId.slice(0, 8)} ` +
        `trigger=${result.trigger} ok=${result.ok}` +
        (result.ok ? ` (${result.ms}ms)` : result.error ? ` error=${result.error}` : '')
    );
  });
  // Claude's auto-generated task summary (parsed from the idle OSC title) —
  // the renderer adopts it as the tab name unless the user has manually
  // renamed the tab.
  agentStatus.on('title', (sessionId: string, title: string) => {
    cacheSessionTitle(sessionId, title);
    safeSend(IPC.terminals.onTitle, sessionId, title);
  });
  // Live sub-agent (Task tool) count — its own channel + store slice, kept off
  // onAgentStatus so a sub-agent start/stop never rebuilds the status rollup.
  agentStatus.on('subagents', (sessionId: string, count: number) => {
    safeSend(IPC.terminals.onSubagents, sessionId, count);
  });
  // Live per-child sub-agent records (name/type + running/done) — sibling
  // channel to onSubagents; pushes the full child array on each change.
  agentStatus.on('subagentChildren', (sessionId: string, children: SubagentChild[]) => {
    safeSend(IPC.terminals.onSubagentChildren, sessionId, children);
  });
}

async function cloneAndRegisterProject(
  input: { url: string; name?: string },
  onProgress?: (line: string) => void
): Promise<CloneProjectResult> {
  const configured = store.getConfig().cloneRoot?.trim();
  const destBase = configured && isAbsolute(configured) ? configured : store.ensureScratchRoot();
  try {
    const res = await cloneProject({ url: input.url, name: input.name, destBase, onProgress });
    if (!res.ok) {
      return {
        ok: false,
        code: res.code ?? 'CLONE_FAILED',
        message: res.message ?? 'Clone failed',
        path: res.path
      };
    }
    try {
      const project = store.addProject(res.path!);
      ensureMcpConfigForProject(project.id).catch((err) =>
        logMainError(`ensureMcpConfigForProject(${project.id})`, err)
      );
      templates.rebindProjects();
      personas.rebindProjects();
      teams.rebindProjects();
      libraryStore.rebindProjects?.();
      scheduler.rebindWatchers();
      goals.rebindWatchers();
      followups.rebindWatchers();
      safeSend(IPC.projects.onChanged, store.listProjects());
      return { ok: true, project, reused: res.reused };
    } catch (err) {
      return { ok: false, code: 'ADD_FAILED', message: String(err), path: res.path };
    }
  } catch (err) {
    return { ok: false, code: 'CLONE_FAILED', message: String(err) };
  }
}

function registerIpc() {
  let harnessVerificationCache: { expiresAt: number; result: Promise<Awaited<ReturnType<typeof verifyHarnesses>>> } | undefined;
  const verifiedHarnesses = () => {
    if (harnessVerificationCache && harnessVerificationCache.expiresAt > Date.now()) return harnessVerificationCache.result;
    const result = verifyHarnesses(store.getConfig());
    harnessVerificationCache = { expiresAt: Date.now() + 30_000, result };
    return result;
  };
  safeHandle(IPC.projects.list, () => store.listProjects(), () => []);
  ipcMain.handle(IPC.projects.add, async (_e, path: string): Promise<Result<Project>> => {
    try {
      const project = store.addProject(path);
      // Fire-and-forget the .mcp.json write; failure shouldn't block
      // adding a project (terminal still works without inbox push). Logged
      // for visibility.
      ensureMcpConfigForProject(project.id).catch((err) =>
        logMainError(`ensureMcpConfigForProject(${project.id})`, err)
      );
      stampFeedEvent(
        project.id,
        'project-created',
        `Project added: ${project.name}`,
        `project-created:${project.id}`
      );
      templates.rebindProjects();
      personas.rebindProjects();
      teams.rebindProjects();
      libraryStore.rebindProjects?.();
      scheduler.rebindWatchers();
      goals.rebindWatchers();
      followups.rebindWatchers();
      return { ok: true, value: project };
    } catch (err) {
      return { ok: false, code: 'ADD_FAILED', message: String(err) };
    }
  });
  ipcMain.handle(
    IPC.projects.addRemote,
    async (
      _e,
      input: { host: string; user?: string; remotePath?: string; proxyJump?: string; name?: string }
    ): Promise<Result<Project>> => {
      try {
        const project = store.addRemoteProject(input);
        return { ok: true, value: project };
      } catch (err) {
        return { ok: false, code: 'ADD_REMOTE_FAILED', message: String(err) };
      }
    }
  );
  // Clone-root: where `projects.clone` drops repos. Honors the configured
  // `cloneRoot` (Global Settings) when it's a valid absolute path; otherwise
  // falls back to `~/zcc-workspace` — the same scratch root the Quick Agent uses.
  // The fallback goes through ensureScratchRoot so a clone-first upgrade still
  // runs the legacy `~/cc-workspace` migration before materializing the dir.
  const cloneRoot = () => {
    const configured = store.getConfig().cloneRoot?.trim();
    if (configured && isAbsolute(configured)) return configured;
    return store.ensureScratchRoot();
  };
  ipcMain.handle(IPC.projects.cloneRoot, async (): Promise<string> => cloneRoot());
  ipcMain.handle(
    IPC.projects.clone,
    async (_e, input: { url: string; name?: string }): Promise<CloneProjectResult> => {
      try {
        return await cloneAndRegisterProject(input, (line) => safeSend(IPC.projects.cloneProgress, line));
      } catch (err) {
        return { ok: false, code: 'CLONE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.projects.ensureQuickAgent,
    async (): Promise<Result<Project>> => {
      try {
        const project = store.ensureQuickAgentProject();
        // Match projects.add: make sure the scratch project has an .mcp.json and
        // the various stores know about it, so a Quick Agent gets inbox push etc.
        ensureMcpConfigForProject(project.id).catch((err) =>
          logMainError(`ensureMcpConfigForProject(${project.id})`, err)
        );
        templates.rebindProjects();
        personas.rebindProjects();
        teams.rebindProjects();
        libraryStore.rebindProjects?.();
        scheduler.rebindWatchers();
        goals.rebindWatchers();
        followups.rebindWatchers();
        return { ok: true, value: project };
      } catch (err) {
        return { ok: false, code: 'ENSURE_QUICK_AGENT_FAILED', message: String(err) };
      }
    }
  );
  safeHandle(
    IPC.ssh.listHosts,
    async () => {
      const provider = sshHostProviderRegistry.activeModuleId();
      if (!provider) return parseSshConfig();
      try {
        const [generic, provided] = await Promise.all([
          parseSshConfig(),
          moduleRouter.dispatch(provider, 'listSshHosts', [])
        ]);
        return mergeSshHosts(generic, asSshHosts(provided));
      } catch (err) {
        logMainError(`ssh host provider ${provider}`, err);
        return parseSshConfig();
      }
    },
    () => []
  );
  ipcMain.handle(
    IPC.executionBoard.setResumeToken,
    async (_e, projectId: string, executionId: string, token: string, expiresAt: number): Promise<Result<true>> => {
      const project = store.listProjects().find((candidate) => candidate.id === projectId);
      const record = project ? await executionStore.getInProject(project.id, executionId) : undefined;
      if (!project || !record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };
      try {
        executionResumeTokens.set({ projectId: project.id, executionId: record.id, token, expiresAt });
        return { ok: true, value: true };
      } catch (error) {
        return { ok: false, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    IPC.executionBoard.clearResumeToken,
    async (_e, projectId: string, executionId: string): Promise<Result<true>> => {
      const project = store.listProjects().find((candidate) => candidate.id === projectId);
      const record = project ? await executionStore.getInProject(project.id, executionId) : undefined;
      if (!project || !record) return { ok: false, code: 'NOT_FOUND', message: 'execution not found for project' };
      try {
        executionResumeTokens.clear(project.id, record.id);
        return { ok: true, value: true };
      } catch (error) {
        return { ok: false, code: 'INVALID', message: error instanceof Error ? error.message : String(error) };
      }
    }
  );
  ipcMain.handle(
    IPC.executionBoard.relaunchMonitor,
    async (_e, projectId: string, executionId: string): Promise<Result<{ sessionId: string }>> =>
      relaunchExecutionMonitor({
        findProject: (id) => store.listProjects().find((candidate) => candidate.id === id),
        getExecution: (id, execution) => executionStore.getInProject(id, execution),
        confirm: async (record) => (await dialog.showMessageBox({
          type: 'question', buttons: ['Launch monitor', 'Cancel'], defaultId: 1, cancelId: 1,
          title: 'Relaunch execution monitor', message: `Launch a monitor for "${record.jobTitle}"?`,
          detail: 'This consumes the stored resume token and grants the new monitor access to this execution.'
        })).response === 0,
        readToken: (id, execution) => executionResumeTokens.readForBinding(id, execution),
        findOrchestratorPersona: () => personas.list().find((candidate) => candidate.id === 'builtin:orchestrator'),
        createMonitor: createTerminalConfined,
        bindMonitor: (sessionId, id, execution, token) => squadExecutionService.resumeBinding(sessionId, id, execution, token),
        closeMonitor: (sessionId) => ptys.close(sessionId),
        clearToken: (id, execution) => executionResumeTokens.clear(id, execution)
      }, projectId, executionId)
  );
  safeHandle(
    IPC.ssh.syncHosts,
    async () => {
      const provider = sshHostProviderRegistry.activeModuleId();
      if (!provider) return { hosts: await parseSshConfig() };
      try {
        const provided = asSshSyncResult(await moduleRouter.dispatch(provider, 'syncSshHosts', []));
        return { ...provided, hosts: mergeSshHosts(await parseSshConfig(), provided.hosts) };
      } catch (err) {
        logMainError(`ssh host provider sync ${provider}`, err);
        return {
          hosts: await parseSshConfig(),
          warning: 'Could not refresh the selected SSH host provider; showing hosts from ~/.ssh/config.'
        };
      }
    },
    () => ({ hosts: [] })
  );
  safeHandle(
    IPC.projects.remove,
    (id: string) => {
      ptys.list(id).forEach((s) => ptys.close(s.id));
      store.removeProject(id);
      scheduler.onProjectRemoved(id);
      scheduler.rebindWatchers();
      goals.onProjectRemoved(id);
      goals.rebindWatchers();
      followups.onProjectRemoved(id);
      followups.rebindWatchers();
      feedStore.onProjectRemoved(id);
      templates.rebindProjects();
      personas.rebindProjects();
      teams.rebindProjects();
      libraryStore.rebindProjects?.();
      // If the removed project was the one whose .claude/skills we were watching,
      // tear the watcher down — its path is now gone or owned by no-one.
      if (activeProjectSkillsId === id) setActiveProjectSkillsWatcher(null, null);
    },
    () => undefined
  );
  safeHandle(
    IPC.projects.update,
    (
      id: string,
      patch: {
        name?: string;
        color?: string;
        defaultAgents?: string[];
        defaultPersonas?: string[];
        launchDefault?: Project['launchDefault'];
        favorite?: boolean;
        remotePath?: string;
      }
    ) => store.updateProject(id, patch),
    () => null
  );
  safeHandle(
    IPC.projects.touch,
    (id: string) => {
      const touched = store.touchProject(id);
      // Re-point the per-project skills watcher whenever the renderer signals
      // a project switch — `projects.touch` is the canonical "selected" signal.
      setActiveProjectSkillsWatcher(touched?.path ?? null, touched?.id ?? null);
      return touched;
    },
    () => null
  );
  safeHandle(
    IPC.projects.reorder,
    (orderedIds: string[]) => store.reorderProjects(orderedIds),
    () => []
  );
  safeHandle(
    IPC.windows.openProject,
    (projectId: string) => {
      // Trust gate (CLAUDE.md #1): openProjectWindow re-validates the
      // renderer-supplied id against the store before opening a window.
      openProjectWindow(projectId);
      return true;
    },
    () => false
  );
  safeHandle(
    IPC.projects.pickDirectory,
    async () => {
      const win = mainWindow();
      if (!win) return null;
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory']
      });
      return result.canceled ? null : result.filePaths[0];
    },
    () => null
  );

  safeHandle(IPC.terminals.list, (projectId: string) => ptys.list(projectId), () => []);
  safeHandle(
    IPC.terminals.verifyTmux,
    () => verifyTmux(),
    () => ({ installed: false, installHint: 'brew install tmux' })
  );
  safeHandle(
    IPC.terminals.listTmuxRestoreCandidates,
    async () => {
      const liveTmuxIds = new Set(await listLocalTmuxSessionIds());
      return restoreCapabilities.list()
        .filter((capability) => capability.sessionId && liveTmuxIds.has(capability.sessionId))
        .map((capability) => ({
          capabilityId: capability.id,
          projectId: capability.request.projectId
        }));
    },
    () => []
  );
  ipcMain.handle(
    IPC.terminals.create,
    // Async: an isolated-worktree launch mints its checkout first (git is async),
    // then the resolved request flows through the SAME synchronous confined-create
    // gate. A non-worktree launch skips the git step entirely (resolver returns the
    // request unchanged), so the common path is unchanged.
    async (_e, req: CreateTerminalRequest): Promise<Result<unknown>> => {
      const resolved = await resolveWorktreeForRequest(sanitizeRendererTerminalRequest(req));
      return resolved.ok ? createInteractiveTerminal(resolved.value) : resolved;
    }
  );
  ipcMain.handle(
    IPC.terminals.restore,
    async (_e, input: { capabilityId?: string; legacyRequest?: CreateTerminalRequest }): Promise<Result<TerminalSession>> => {
      const reserved = input.capabilityId ? restoreCapabilities.reserve(input.capabilityId) : undefined;
      if (reserved) {
        const { capability, reservationId } = reserved;
        try {
          const resolved = await resolveWorktreeForRequest(capability.request);
          if (!resolved.ok) {
            restoreCapabilities.release(capability.id, reservationId);
            return resolved;
          }
          const launched = await launchAuthorizedTerminal(
            resolved.value,
            restorePrincipal(capability),
            capability.sessionId ? { preallocatedSessionId: capability.sessionId } : undefined,
            capability.request.cohort?.teamId,
            undefined,
            undefined,
            undefined,
            isTeamWorkerRestore(capability.request)
          );
          if (launched.ok) restoreCapabilities.consume(capability.id, reservationId);
          else restoreCapabilities.release(capability.id, reservationId);
          return launched;
        } catch (error) {
          restoreCapabilities.release(capability.id, reservationId);
          throw error;
        }
      }
      if (input.capabilityId) {
        return { ok: false, code: 'DENIED', message: 'restore capability unavailable or already reserved' };
      }
      if (!input.legacyRequest) {
        return { ok: false, code: 'DENIED', message: 'restore capability not found' };
      }
      const resolved = await resolveWorktreeForRequest(
        sanitizeRendererTerminalRequest(input.legacyRequest)
      );
      return resolved.ok
        ? launchAuthorizedTerminal(resolved.value, { kind: 'interactive-user', id: 'restore:legacy-confirmed' })
        : resolved;
    }
  );
  // Wake-from-sleep reconnect for a remote tab whose local `ssh` proxy died when
  // the machine slept. Re-authorizes the project (Rule 1 — the renderer supplies
  // only ids; main confirms the project exists AND is remote) and spawns a fresh
  // local pty that RE-ATTACHES the still-live `cc-<oldSessionId>` tmux session on
  // the box (attach-or-create), resuming the transcript if that session is gone.
  ipcMain.handle(
    IPC.terminals.reconnectRemote,
    async (_e, input: {
      capabilityId?: string;
      legacy?: { projectId: string; profile: LaunchProfileId; sessionId: string };
    }): Promise<Result<TerminalSession>> => {
      const legacyReconnect = !input.capabilityId && !!input.legacy;
      let reserved = input.capabilityId ? restoreCapabilities.reserve(input.capabilityId) : undefined;
      let capability = reserved?.capability;
      if (input.capabilityId && !capability) {
        return { ok: false, code: 'DENIED', message: 'reconnect capability unavailable or already reserved' };
      }
      if (!capability && input.legacy) {
        const stored = restoreCapabilities.findExitedSession(input.legacy);
        reserved = stored ? restoreCapabilities.reserve(stored.id) : undefined;
        capability = reserved?.capability;
        if (!capability) {
          return { ok: false, code: 'DENIED', message: 'legacy reconnect target not found or identity mismatch' };
        }
      }
      if (!capability) return { ok: false, code: 'DENIED', message: 'reconnect capability not found' };
      if (!reserved) return { ok: false, code: 'DENIED', message: 'reconnect capability reservation unavailable' };
      const release = () => {
        restoreCapabilities.release(capability.id, reserved.reservationId);
      };
      const project = store.listProjects().find((p) => p.id === capability.request.projectId);
      if (!project) {
        release();
        return { ok: false, code: 'NOT_FOUND', message: 'project not found' };
      }
      // Reconnect is a remote-only affordance: a local session has no detached
      // tmux agent to re-attach, so refuse rather than spawn a bogus duplicate.
      if (!project.remote) {
        release();
        return { ok: false, code: 'NOT_FOUND', message: 'project is not remote' };
      }
      if (!capability.remoteTmuxId) {
        release();
        return { ok: false, code: 'DENIED', message: 'reconnect capability has no remote tmux target' };
      }
      try {
        const launched = await launchAuthorizedTerminal(
          capability.request,
          legacyReconnect
            ? { kind: 'interactive-user', id: 'reconnect:legacy-confirmed' }
            : { kind: 'automation', id: `reconnect:${capability.id}` },
          { reconnectTmuxId: capability.remoteTmuxId, resume: true }
        );
        if (launched.ok) restoreCapabilities.consume(capability.id, reserved.reservationId);
        else release();
        return launched;
      } catch (error) {
        release();
        throw error;
      }
    }
  );
  safeHandle(
    IPC.terminals.write,
    (id: string, data: string) => ptys.write(id, data),
    () => undefined
  );
  safeHandle(
    IPC.terminals.reply,
    // Surface the delivery verdict to the renderer: `ptys.reply` returns false
    // when no live pty matches (the agent already exited), so the inbox reply
    // box can report a dead session instead of silently claiming success.
    (id: string, text: string) => ptys.reply(id, text),
    () => false
  );
  safeHandle(
    IPC.terminals.resize,
    (id: string, cols: number, rows: number) => ptys.resize(id, cols, rows),
    () => undefined
  );
  safeHandle(
    IPC.terminals.close,
    (id: string) => terminateSession(id),
    () => false
  );
  safeHandle(IPC.terminals.backlog, (id: string) => ptys.getBacklog(id), () => '');
  safeHandle(
    IPC.terminals.summarizeIdle,
    // Read-only "Summarize" board action: the agents stay RUNNING, so the digest
    // reads "Caught up on N agents", not "Closed N idle agents".
    (projectId: string, sessionIds: string[]) =>
      closeSummary.summarize(projectId, sessionIds, { closing: false }),
    () => ({ summarized: 0 })
  );
  safeHandle(
    IPC.terminals.closeFollowup,
    (projectId: string, sessionIds: string[]) =>
      closeSummary.summarizeAndFollowUp(projectId, sessionIds),
    // A failed summary/follow-up must not block the close the renderer does next.
    () => ({ summarized: 0, followedUp: 0 })
  );
  safeHandle(
    IPC.terminals.summarizeSession,
    (projectId: string, sessionId: string) => closeSummary.summarizeOne(projectId, sessionId),
    // Mirror the renderer's other failure reasons so a thrown handler still
    // toasts something sensible rather than a generic IPC error.
    () => ({ ok: false as const, reason: 'summary-failed' as const })
  );
  safeHandle(
    IPC.terminals.sessionStats,
    async (projectId: string, sessionId: string): Promise<SessionStats | null> => {
      // Rule 1: authorize from main's OWN session record, never renderer input.
      // A stale/foreign id (session died, or projectId doesn't own it) → null.
      const session = ptys.getSession(sessionId);
      if (!session) {
        const exited = exitedSessionStats.get(sessionId);
        if (!exited || exited.projectId !== projectId) return null;
        return exited.pending ? exited.pending : exited.stats;
      }
      if (session.projectId !== projectId) return null;
      return readLiveSessionStats(session);
    },
    () => null
  );
  safeHandle(
    IPC.terminals.generateCatchUpSummary,
    async (projectId: string, sessionId: string): Promise<CatchUpSummaryResult> => {
      // Re-validate that sessionId belongs to projectId (CLAUDE.md #1) before
      // reading its transcript / running the LLM. A stale/foreign id is rejected.
      const session = ptys.getSession(sessionId);
      if (!session || session.projectId !== projectId) {
        return {
          sessionId,
          projectId,
          ok: false,
          text: '',
          error: 'ineligible',
          ms: 0,
          generatedAt: Date.now(),
          trigger: 'idle'
        };
      }
      // Delegate to the service's on-demand generateOne method, which bypasses
      // the dwell timer and one-shot gate (the caller wants the latest state NOW).
      return catchUpSummary.generateOne(sessionId);
    },
    // Fallback on handler throw (should never happen — generateOne never throws).
    (): CatchUpSummaryResult => ({
      sessionId: '',
      projectId: '',
      ok: false,
      text: '',
      error: 'handler-failed',
      ms: 0,
      generatedAt: Date.now(),
      trigger: 'idle'
    })
  );
  safeHandle(
    IPC.terminals.clearAgentBlocked,
    (projectId: string, sessionId: string): boolean => {
      // Rule 1: authorize from main's OWN session record, never renderer input.
      // A stale/foreign id (session died, or projectId doesn't own it) is a no-op.
      const session = ptys.getSession(sessionId);
      if (!session || session.projectId !== projectId) return false;
      // Drop the sticky "blocked / Needs you" overlay — the same transition the
      // Stop hook performs when a turn ends. The resolved state falls back to the
      // latest OSC reading (typically idle), so the agent re-tags as Idle.
      agentStatus.clearBlocked(sessionId);
      return true;
    },
    () => false
  );
  safeHandle(
    IPC.terminals.setHeadless,
    (id: string, headless: boolean) => ptys.setHeadless(id, headless),
    () => null
  );
  safeHandle(
    IPC.terminals.setHeartbeat,
    (id: string, on: boolean) => {
      // Cancel any armed nudge immediately when turning OFF, so "off" takes
      // effect at once rather than after the live timer elapses (it would
      // self-cancel at the eligibility re-check, but a lingering timer is
      // surprising). Set the per-agent flag FIRST, then — when turning ON — arm
      // right away if the agent is already idle: the operator typically enables
      // Heartbeat on an agent they can see is already sitting idle, and
      // observe() only arms on the working→idle edge, which won't recur for an
      // already-idle session. Without this, "on" would silently never nudge.
      if (!on) heartbeat.cancel(id);
      const result = ptys.setHeartbeat(id, on);
      if (on) heartbeat.armIfIdle(id);
      return result;
    },
    () => null
  );
  safeHandle(
    IPC.terminals.setActiveSession,
    (id: string | null) => {
      // Advisory only — record which tab is foreground so auto-close-idle can
      // spare it. Never authorizes a close, so an unchecked id is harmless: a
      // forged value can only ever SPARE a session, never reach into another
      // project (Rule 1). Normalize anything non-string to null.
      activeForegroundSessionId = typeof id === 'string' ? id : null;
    },
    () => undefined
  );
  safeHandle(
    IPC.terminals.setFavorites,
    (keys: string[]) => {
      // Advisory only — record which agents the user has starred so
      // auto-close-idle can spare them. Never authorizes a close, so an unchecked
      // list is harmless: a forged key can only ever SPARE a session, never reach
      // into another project (Rule 1). Normalize anything non-array to empty.
      favoriteAgentKeys = new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []);
      // Re-arm any now-eligible idle agent — un-starring an already-idle agent
      // should let the timer reclaim it without waiting for a working→idle cycle.
      // (armAllIdle re-checks eligibility, so a still-starred agent stays spared;
      // a newly-starred armed timer simply bails at fire via the eligible() gate.)
      autoCloseIdle.armAllIdle();
      // The popover renders a pin per starred agent — keep it in step.
      menubar?.refresh();
    },
    () => undefined
  );
  // ----- menu-bar popover (macOS frameless card; behind menubarPopoverEnabled) --
  // The popover renderer is a thin, read-only view: it asks for a snapshot on
  // mount and calls these action verbs, each authorized from main's own state
  // (Rule 1). A no-op-shaped result keeps every call safe if the controller
  // failed to construct.
  safeHandle(
    IPC.menubar.request,
    () =>
      menubar?.buildSnapshot() ?? {
        agents: [],
        needsYou: 0,
        working: 0,
        scheduleCount: 0,
        nextRunAt: null,
        theme: resolveTheme()
      },
    () => ({
      agents: [],
      needsYou: 0,
      working: 0,
      scheduleCount: 0,
      nextRunAt: null,
      theme: 'dark' as const
    })
  );
  safeHandle(
    IPC.menubar.focusSession,
    (sessionId: string, projectId: string) => {
      // Authorize from main's OWN session record — a forged pair that doesn't
      // match a live session is dropped rather than focused (Rule 1).
      const s = ptys.getSession(sessionId);
      if (!s || s.projectId !== projectId) return;
      menubar?.hide();
      showMainWindow();
      safeSend('app:focusSession', sessionId, projectId);
    },
    () => undefined
  );
  safeHandle(
    IPC.menubar.setFavorite,
    (sessionId: string, favorite: boolean) => {
      // Toggle the pin using the SAME favorite-key scheme the sidebar star uses
      // (claudeSessionId ?? id), resolved from main's session record (Rule 1).
      const s = ptys.getSession(sessionId);
      if (!s) return;
      const key = s.claudeSessionId ?? sessionId;
      if (favorite) favoriteAgentKeys.add(key);
      else favoriteAgentKeys.delete(key);
      autoCloseIdle.armAllIdle();
      // Mirror the change into the renderer's persisted star set so the sidebar
      // and popover agree and it survives relaunch.
      safeSend('app:favoritesChanged', Array.from(favoriteAgentKeys));
      menubar?.refresh();
    },
    () => undefined
  );
  safeHandle<[string, string], MenubarReplyResult>(
    IPC.menubar.reply,
    (sessionId: string, text: string) => {
      // Light-interaction WRITE path. Every gate is re-checked here from main's
      // OWN state — the popover's sessionId/text are untrusted lookup inputs,
      // never a capability (Rule 1).
      if (!menubarPopoverEnabled()) return { ok: false, reason: 'disabled' };
      const s = ptys.getSession(sessionId);
      if (!s || (s.status !== 'running' && s.status !== 'starting')) {
        return { ok: false, reason: 'ended' };
      }
      // Refuse background work — a glance-surface reply into a detached
      // scheduled/headless job (no visible terminal) would be surprising. Same
      // gate the snapshot's `repliable` hint advertises.
      if (!isRepliable(s)) return { ok: false, reason: 'background' };
      // Bound + sanitize: collapse CR/LF (the reply is ONE submission — reply()
      // appends its own Enter; embedded newlines would smuggle extra keypresses)
      // and cap the length so the write path can't be flooded from the menu bar.
      const clean = text.replace(/[\r\n]+/g, ' ').trim().slice(0, MENUBAR_REPLY_MAX_CHARS);
      if (!clean) return { ok: false, reason: 'empty' };
      const ok = ptys.reply(sessionId, clean);
      if (ok) menubar?.refresh();
      return { ok, reason: ok ? undefined : 'ended' };
    },
    () => ({ ok: false, reason: 'ended' })
  );
  safeHandle(
    IPC.menubar.open,
    (view: 'dashboard' | 'agents' | 'settings' | 'scheduler') => {
      menubar?.hide();
      showMainWindow();
      if (view === 'agents') safeSend('app:openAgents');
      else if (view === 'settings') safeSend('app:openSettings');
      else if (view === 'scheduler') safeSend('app:openScheduler');
      // 'dashboard' just shows the window (its default view).
    },
    () => undefined
  );
  safeHandle(
    IPC.menubar.hide,
    () => menubar?.hide(),
    () => undefined
  );
  safeHandle(
    IPC.menubar.quit,
    () => app.quit(),
    () => undefined
  );
  safeHandle(
    IPC.terminals.agentStatusSnapshot,
    () => agentStatus.snapshot(),
    () => []
  );
  safeHandle(
    IPC.terminals.agentStatusSince,
    (sinceSeq: number) => {
      // Validate sinceSeq in main (Rule 1) — coerce junk to 0 for a full replay/snapshot.
      if (!Number.isFinite(sinceSeq) || sinceSeq < 0) sinceSeq = 0;
      return agentStatus.since(sinceSeq);
    },
    () => ({ mode: 'snapshot' as const, snapshot: [], headSeq: 0 })
  );
  safeHandle(
    IPC.terminals.subagentSnapshot,
    () => agentStatus.subagentSnapshot(),
    () => []
  );
  safeHandle(
    IPC.terminals.subagentChildrenSnapshot,
    () => agentStatus.subagentChildSnapshot(),
    () => []
  );

  safeHandle(IPC.config.get, () => store.getConfig(), () => store.getConfig());
  safeHandle<[Partial<AppConfig>], AppConfig>(
    IPC.config.set,
    (patch) => {
      // Window state is main-owned. Renderer config writes cannot alter shared
      // unscoped-window geometry or fullscreen monitor selection.
      const { windowBounds: _windowBounds, windowMaximized: _windowMaximized, ...safePatch } = patch;
      const next = store.setConfig(safePatch);
      if (
        patch.harnessCursorEnabled !== undefined ||
        patch.harnessCodexEnabled !== undefined ||
        patch.harnessPiEnabled !== undefined ||
        patch.harnessOpenCodeEnabled !== undefined ||
        patch.claudeBinary !== undefined ||
        patch.cursorBinary !== undefined ||
        patch.codexBinary !== undefined ||
        patch.piBinary !== undefined ||
        patch.opencodeBinary !== undefined
      ) {
        harnessVerificationCache = undefined;
      }
      // Keep the claude-cli LLM provider pointed at the configured binary so a
      // binary change takes effect without a restart.
      if (patch.claudeBinary !== undefined) {
        rebuildProviders(next);
      }
      // Apply a keep-awake toggle immediately: turning it OFF releases a held
      // block at once (don't wait for the grace timer / next status edge);
      // turning it ON re-acquires if any agent is currently working.
      if (patch.keepAwakeWhileWorking !== undefined) {
        keepAwake.refresh();
      }
      // Make the auto-close-idle master toggle act instantly across the fleet
      // rather than waiting for the next idle edge: turning OFF disarms every
      // pending close at once; turning ON arms a close for any agent already
      // sitting idle (observe() only arms on the working→idle edge, which won't
      // recur for an already-idle session). Eligibility is re-checked inside.
      if (patch.autoCloseIdleEnabled !== undefined) {
        if (next.autoCloseIdleEnabled === true) autoCloseIdle.armAllIdle();
        else autoCloseIdle.cancelAll();
      }
      // Flip the menu-bar surface live: switching to the popover clears the
      // native context menu (so the click toggles the card); switching back
      // rebuilds the native menu and hides any open popover. No relaunch.
      if (patch.menubarPopoverEnabled !== undefined) {
        if (next.menubarPopoverEnabled !== true) menubar?.hide();
        tray?.refreshSurface();
      }
      // Theme change re-themes an open popover on its next push.
      if (patch.theme !== undefined) menubar?.refresh();
      // Fan the new config out to EVERY window so other windows (per-project
      // windows, the focus window) refresh their mirrored feature flags live.
      // Without this a flag toggled off in one window (e.g. Follow-ups) keeps
      // rendering its tab/nav entry in the others until they reload.
      safeSend(IPC.config.onChanged, next);
      return next;
    },
    () => store.getConfig()
  );

  // Recent Overseer decisions for the dry-run review pane. Read-only; bounded by
  // the audit ring's cap so the result can never be unbounded (Rule 5). Empty
  // on any error — the pane just shows nothing.
  safeHandle<[number | undefined], OverseerAuditEntry[]>(
    IPC.overseer.recent,
    (limit) => overseerAudit.recent(limit),
    () => []
  );

  safeHandle(
    IPC.projectSettings.get,
    (id: string) => store.getProjectSettings(id),
    () => ({} as ProjectSettings)
  );
  // Mutations must reject on persistence failure so the renderer can roll back
  // its optimistic state and show the write error. Reads remain best-effort.
  ipcMain.handle(IPC.projectSettings.set, (_event, id: string, patch: Partial<ProjectSettings>) =>
    store.setProjectSettings(id, patch)
  );
  ipcMain.handle(IPC.executionConsent.listProject, (_event, projectId: string) =>
    executionConsentManagement.listProjectGrants(projectId)
  );
  ipcMain.handle(IPC.executionConsent.revokeProject, (_event, projectId: string, grantId: string) =>
    executionConsentManagement.revokeProjectGrant(projectId, grantId)
  );

  // Per-harness auth (Settings → Harness). Read main's own encrypted store (Rule 1
  // — never a renderer-supplied secret round-trip): `status` returns base URL +
  // hasToken per family; `set` stores/clears a family's base URL and/or token and
  // returns the refreshed status so the UI reflects the write without a second call.
  safeHandle(
    IPC.harnessAuth.status,
    () => getHarnessAuthStatus() as HarnessAuthStatusInfo[],
    () => []
  );
  safeHandle<[HarnessAuthKey, { baseUrl?: string | null; token?: string | null }], HarnessAuthStatusInfo[]>(
    IPC.harnessAuth.set,
    (key, patch) => {
      setHarnessAuth(key, patch);
      return getHarnessAuthStatus() as HarnessAuthStatusInfo[];
    },
    () => getHarnessAuthStatus() as HarnessAuthStatusInfo[]
  );

  // Code-harness verification (Settings → Code Harness). Probes each family's
  // `<binary> --version` best-effort against main's own config (Rule 1 — the
  // binary is resolved through the provider, never a renderer-supplied path).
  safeHandle(
    IPC.harness.verify,
    () => verifiedHarnesses(),
    () => []
  );
  safeHandle(
    IPC.harness.descriptors,
    async () => {
      const results = await verifiedHarnesses();
      await refreshDynamicHarnessCatalogs(results);
      return harnessAdapterDescriptorsFromVerify(results);
    },
    () => []
  );
  safeHandle(
    IPC.harness.agentDescriptors,
    async (projectId: unknown, profile: unknown, refresh: unknown) => {
      if (typeof projectId !== 'string' || typeof profile !== 'string') return { status: 'failure' };
      const project = store.listProjects().find((entry) => entry.id === projectId);
      if (!project || project.remote) return { status: 'failure' };
      const registration = registrationFor(profile as LaunchProfileId);
      if (!registration?.discoverAgentDescriptors) return { status: 'failure' };
      const verified = (await verifiedHarnesses()).find((result) => result.family === registration.id);
      if (!verified?.enabled || !verified.installed) return { status: 'failure' };
      return registration.discoverAgentDescriptors({
        profile: profile as LaunchProfileId,
        cwd: project.path,
        config: store.getConfig(),
        refresh: refresh === true
      });
    },
    () => ({ status: 'failure' as const })
  );
  safeHandle(
    IPC.harness.effectiveDefault,
    async (projectId: unknown) => {
      if (typeof projectId !== 'string') {
        return { ok: false as const, code: 'NOT_FOUND' as const, message: 'Project not found' };
      }
      return resolveEffectiveHarnessDefault({
        project: store.listProjects().find((entry) => entry.id === projectId),
        config: store.getConfig(),
        personas: personas.list(),
        availability: await verifiedHarnesses()
      });
    },
    () => ({ ok: false as const, code: 'UNAVAILABLE_DEFAULT' as const, message: 'Default harness unavailable' })
  );

  safeHandle(
    IPC.claude.listSessions,
    (projectId: unknown) => {
      if (typeof projectId !== 'string') return [];
      const project = store.listProjects().find((entry) => entry.id === projectId);
      // Native local history has no trustworthy remote-project contract. Resolve
      // the path from main's registered project record, never renderer input.
      return project && !project.remote ? listClaudeSessions(project.path) : [];
    },
    () => []
  );
  safeHandle(
    IPC.opencode.listSessions,
    (projectId: string) => {
      const project = store.listProjects().find((entry) => entry.id === projectId);
      return project
        ? listOpenCodeSessions(project.path, { binary: store.getConfig().opencodeBinary })
        : Promise.resolve([]);
    },
    () => []
  );
  safeHandleFromWindow<[{ projectId?: unknown; filter?: unknown }], ConversationHistorySnapshot>(
    IPC.history.start,
    (win, input: { projectId?: unknown; filter?: unknown }) => {
      // History resumes in the selected project's canonical cwd. Cross-project
      // aggregation would replay a native conversation with another project's
      // config/files/MCP assumptions, so `all` is intentionally unsupported.
      if (!input || input.filter !== 'project') {
        return conversationHistory.get(win.id, '');
      }
      const projectId = typeof input.projectId === 'string' ? input.projectId : undefined;
      if (!projectId) return conversationHistory.get(win.id, '');
      if (projectId && !store.listProjects().some((project) => project.id === projectId && !project.remote)) {
        return conversationHistory.get(win.id, '');
      }
      return conversationHistory.start(win.id, projectId);
    },
    () => conversationHistory.get(-1, '')
  );
  safeHandleFromWindow<[unknown], ConversationHistorySnapshot>(
    IPC.history.refresh,
    (win, snapshotId: unknown) => {
      const current = conversationHistory.get(win.id, snapshotId);
      if (current.status === 'expired') return current;
      const projectId = conversationHistory.scope(win.id, snapshotId);
      conversationHistory.release(win.id, snapshotId);
      return conversationHistory.refresh(win.id, projectId);
    },
    () => conversationHistory.get(-1, '')
  );
  safeHandleFromWindow<[unknown, unknown], ConversationHistorySnapshot>(
    IPC.history.page,
    (win, snapshotId: unknown, opaquePageCursor: unknown) => {
      if (opaquePageCursor !== undefined) return conversationHistory.get(win.id, '');
      return conversationHistory.get(win.id, snapshotId);
    },
    () => conversationHistory.get(-1, '')
  );
  safeHandleFromWindow<[unknown], void>(
    IPC.history.release,
    (win, snapshotId: unknown) => conversationHistory.release(win.id, snapshotId),
    () => undefined
  );
  safeHandleFromWindow<[unknown, unknown], Result<TerminalSession>>(
    IPC.history.resume,
    async (win, snapshotId: unknown, historyId: unknown): Promise<Result<TerminalSession>> => {
      const row = conversationHistory.find(win.id, snapshotId, historyId);
      if (!row) return { ok: false, code: 'DENIED', message: 'Conversation history row unavailable' };
      const project = store.listProjects().find((entry) => entry.id === row.projectId && !entry.remote);
      if (!project) return { ok: false, code: 'NOT_FOUND', message: 'Conversation project is unavailable' };
      const profile = row.source === 'claude' ? 'claude' : 'opencode';
      const resume = registrationFor(profile)?.nativeConversationResume?.(row.nativeConversationId);
      if (!resume) return { ok: false, code: 'DENIED', message: 'Exact native resume is unavailable' };
      return createInteractiveTerminal({
        projectId: project.id,
        cols: 80,
        rows: 24,
        title: row.title,
        ...resume
      });
    },
    () => ({ ok: false, code: 'DENIED', message: 'Conversation history unavailable' })
  );

  // `fs.writeFile` is confined below alongside the other read/write ops, once
  // `trustedReadPath` is in scope (it takes a single absolute path, like readFile).
  // The FS-mutation ops (create/rename/delete) confine their target to `root`,
  // but `root` itself arrives from the renderer — so an unchecked `root` would
  // let a buggy/compromised renderer mutate anywhere by naming a `root` of its
  // choosing. Enforce that `root` is a REGISTERED project path (the same trust
  // gate `terminals.create` applies to cwd), OR a git worktree linked to one of
  // those projects (CLAUDE.md #2 extends the trust anchor to a worktree of a
  // registered project, so the Explorer's worktree switcher can mutate files in
  // the selected checkout). Returns the trusted root, or null to reject.
  // Compared by realpath so a symlinked project still matches.
  const trustedProjectRoot = async (root: string): Promise<string | null> => {
    let realRoot: string;
    try {
      realRoot = realpathSync(root);
    } catch {
      return null;
    }
    const projects = store.listProjects();
    for (const p of projects) {
      try {
        if (realpathSync(p.path) === realRoot) return realRoot;
      } catch {
        /* project dir gone / unreadable — skip */
      }
    }
    // Not a registered root itself — is it a worktree of one? Two paths share a
    // repository iff their git common-dirs match. Resolve the candidate's
    // common-dir once, then compare against each registered project's. A bare
    // `null` common-dir (not a repo) never matches, so this can't widen trust to
    // non-repo paths.
    const rootCommon = await gitCommonDir(realRoot);
    if (!rootCommon) return null;
    for (const p of projects) {
      const projCommon = await gitCommonDir(p.path);
      if (projCommon && projCommon === rootCommon) return realRoot;
    }
    return null;
  };
  const rejectRoot = (): FsMutateResult => ({
    ok: false,
    message: 'Path is not inside a known project'
  });
  safeHandle(
    IPC.fs.createFile,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsCreateFile(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Create failed' })
  );
  safeHandle(
    IPC.fs.createDir,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsCreateDir(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Create failed' })
  );
  safeHandle(
    IPC.fs.rename,
    async (root: string, from: string, to: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsRename(r, from, to) : rejectRoot();
    },
    () => ({ ok: false, message: 'Rename failed' })
  );
  safeHandle(
    IPC.fs.delete,
    async (root: string, p: string) => {
      const r = await trustedProjectRoot(root);
      return r ? fsDelete(r, p) : rejectRoot();
    },
    () => ({ ok: false, message: 'Delete failed' })
  );
  // Reads (listDir / readFile) confine to a trusted root the same way the
  // mutating ops do (CLAUDE.md #1/#2 — main authorizes, renderer paths are
  // advisory). Every local read surface (Explorer, InboxDetail, the VS Code
  // provider) targets a registered project or a worktree of one, so we resolve
  // the target's enclosing trusted project root and reject anything that
  // realpath-escapes it. Without this, a renderer- or agent-supplied path like
  // `<project>/../../.ssh/id_rsa` (e.g. an inbox doc whose `path` traverses out)
  // would be read straight off disk. `confine` resolves symlinks on the parent
  // chain so an in-project symlink pointing outside is also rejected.
  const trustedReadPath = async (p: string): Promise<string | null> => {
    if (!p || typeof p !== 'string' || !isAbsolute(p)) return null;
    const projects = store.listProjects().filter((proj) => !proj.remote);
    // Try each registered (local) project root, plus any worktree linked to it,
    // as a confinement anchor. `confine` returns the normalized real path when
    // `p` sits inside; the first anchor that accepts it wins.
    for (const proj of projects) {
      const c = confine(proj.path, p);
      if (c.ok) return c.path;
      for (const wt of await listWorktrees(proj.path)) {
        const cw = confine(wt.path, p);
        if (cw.ok) return cw.path;
      }
    }
    return null;
  };
  // File attachments begin with a native chooser controlled by main. The
  // renderer receives only paths the user explicitly picked, never an arbitrary
  // renderer-supplied disk location.
  safeHandle(
    IPC.fs.pickFiles,
    async (): Promise<string[]> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
      if (!win) return [];
      const pick = await dialog.showOpenDialog(win, {
        title: 'Attach files to the agent task',
        properties: ['openFile', 'multiSelections']
      });
      return pick.canceled ? [] : pick.filePaths;
    },
    () => []
  );
  safeHandle(
    IPC.fs.listDir,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? listDir(real) : [];
    },
    () => []
  );
  safeHandle(
    IPC.fs.readFile,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? fsReadFile(real) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Read failed' })
  );
  // Writes confine to a trusted root the same way reads do (CLAUDE.md #1/#2 —
  // main authorizes, the renderer path is advisory). Without this, a buggy or
  // compromised renderer could overwrite any existing regular file the user can
  // write (~/.ssh/config, ~/.aws/credentials, ~/.zcc/*): `fsWriteFile`'s own
  // "must be a regular file" check is a sanity guard, NOT a confinement.
  safeHandle(
    IPC.fs.writeFile,
    async (p: string, content: string) => {
      const real = await trustedReadPath(p);
      return real ? fsWriteFile(real, content) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Write failed' })
  );
  // Resolve an inbox doc whose reported path doesn't exist under the project
  // root (the agent wrote it in a subdir or the library, then reported it
  // relative to that subdir). The renderer-supplied `root` and `originCwd` are
  // advisory — we confine `root` to a registered project first (Rule 1/2), and
  // `resolveDoc` itself confine()s every candidate (incl. originCwd) to that
  // trusted root, so the returned rel path is always inside the tree.
  safeHandle(
    IPC.fs.resolveDoc,
    async (root: string, reportedPath: string, originCwd?: string) => {
      if (!reportedPath || typeof reportedPath !== 'string') {
        return { ok: false, message: 'No path given' };
      }
      const realRoot = await trustedProjectRoot(root);
      if (!realRoot) return { ok: false, message: 'Path is not inside a known project' };
      const found = fsResolveDoc(
        realRoot,
        reportedPath,
        typeof originCwd === 'string' && originCwd ? originCwd : undefined
      );
      if (!found.ok) return { ok: false, message: 'File not found in this project' };
      const cleanReported = reportedPath.replace(/^[/\\]+/, '');
      return { ok: true, rel: found.rel, relocated: found.rel !== cleanReported };
    },
    () => ({ ok: false, message: 'Resolve failed' })
  );
  // walkFiles/searchFiles enumerate a tree (and searchFiles returns matched file
  // CONTENTS), so an unconfined path lets the renderer walk/grep arbitrary disk.
  // Confine the walk root to a registered project (or worktree of one) the same
  // way the read ops do — callers pass `project.path`.
  safeHandle(
    IPC.fs.walkFiles,
    async (p: string) => {
      const real = await trustedReadPath(p);
      return real ? walkFiles(real) : [];
    },
    () => []
  );
  safeHandle(
    IPC.fs.searchFiles,
    async (p: string, q: string, opts?: SearchOptions) => {
      const real = await trustedReadPath(p);
      return real ? searchFiles(real, q, opts) : { hits: [], scanned: 0, truncated: false };
    },
    () => ({ hits: [], scanned: 0, truncated: false })
  );

  // --- Remote (SSH) file browsing -------------------------------------------
  //
  // The renderer passes only a projectId; the host/user/start-path come from
  // the STORE (CLAUDE.md #1 — the renderer is untrusted, main authorizes). We
  // resolve each remote project's browse root once and cache it, then confine
  // every list/read under it inside remote-fs. Returns null when the project
  // isn't a known remote project so callers get a clean rejection.
  const remoteFor = (projectId: string): ProjectRemote | null => {
    const project = store.listProjects().find((p) => p.id === projectId);
    return project?.remote ?? null;
  };
  // projectId → resolved remote root. Cleared lazily only by app restart; a
  // remote project's start path is immutable for its lifetime, so caching the
  // realpath is safe and saves an ssh round-trip on every tree expansion.
  const remoteRootCache = new Map<string, string>();
  const resolveRemoteRoot = async (projectId: string): Promise<string | null> => {
    const cached = remoteRootCache.get(projectId);
    if (cached) return cached;
    const remote = remoteFor(projectId);
    if (!remote) return null;
    const res = await fsRemoteRoot(remote, store.getConfig().remoteDefaultPath);
    if (!res.ok || !res.root) return null;
    remoteRootCache.set(projectId, res.root);
    return res.root;
  };
  safeHandle(
    IPC.fs.remoteRoot,
    async (projectId: string) => {
      const remote = remoteFor(projectId);
      if (!remote) return { ok: false, message: 'Not a remote project' };
      const res = await fsRemoteRoot(remote, store.getConfig().remoteDefaultPath);
      if (res.ok && res.root) remoteRootCache.set(projectId, res.root);
      return res;
    },
    () => ({ ok: false, message: 'Failed to resolve remote root' })
  );
  safeHandle(
    IPC.fs.listDirRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return [];
      return fsListDirRemote(remote, root, p);
    },
    () => []
  );
  safeHandle(
    IPC.fs.readFileRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      return fsReadFileRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote read failed' })
  );
  // Remote mutations (Phase 2). Each resolves the remote config + root from the
  // store (never the renderer) and confines the path under the root inside
  // remote-fs. The `notRemote` reject keeps the error shape consistent with the
  // local mutate handlers.
  const notRemote = (): FsMutateResult => ({ ok: false, message: 'Not a remote project' });
  safeHandle(
    IPC.fs.writeFileRemote,
    async (projectId: string, p: string, content: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      return fsWriteFileRemote(remote, root, p, content);
    },
    () => ({ ok: false, message: 'Remote write failed' })
  );
  safeHandle(
    IPC.fs.createFileRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsCreateFileRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote create failed' })
  );
  safeHandle(
    IPC.fs.createDirRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsCreateDirRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote create failed' })
  );
  safeHandle(
    IPC.fs.renameRemote,
    async (projectId: string, from: string, to: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsRenameRemote(remote, root, from, to);
    },
    () => ({ ok: false, message: 'Remote rename failed' })
  );
  safeHandle(
    IPC.fs.deleteRemote,
    async (projectId: string, p: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return notRemote();
      return fsDeleteRemote(remote, root, p);
    },
    () => ({ ok: false, message: 'Remote delete failed' })
  );
  // Transfers: stream a local file up to the remote, or pull a remote file down
  // through an OS save dialog. Both resolve remote+root from the store and
  // confine the remote side under the root (inside remote-transfer).
  safeHandle(
    IPC.fs.uploadToRemote,
    async (projectId: string, localPath: string, destDir: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      // The renderer's session cwd may retain the configured remote start path,
      // while `root` is its physical (`pwd -P`) path. Always stage relative
      // drops at the canonical root so no renderer-provided path can broaden
      // the transfer's trust boundary.
      return fsUploadToRemote(remote, root, localPath, destDir === '.' ? root : destDir);
    },
    () => ({ ok: false, message: 'Upload failed' })
  );
  safeHandle(
    IPC.fs.downloadFromRemote,
    async (projectId: string, remotePath: string) => {
      const remote = remoteFor(projectId);
      const root = remote ? await resolveRemoteRoot(projectId) : null;
      if (!remote || !root) return { ok: false, message: 'Not a remote project' };
      const win = mainWindow();
      if (!win) return { ok: false, message: 'No window' };
      const result = await dialog.showSaveDialog(win, {
        defaultPath: basename(remotePath)
      });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      return fsDownloadFromRemote(remote, root, remotePath, result.filePath);
    },
    () => ({ ok: false, message: 'Download failed' })
  );
  safeHandle(
    IPC.openers.openIn,
    (target: OpenTarget, p: string) => {
      // Resolve the user's per-editor / terminal overrides from main's own
      // config (Rule 1 — never a renderer-supplied binary path).
      const cfg = store.getConfig();
      return openIn(target, p, {
        cursorBinary: cfg.editorCursorBinary,
        cursorApp: cfg.editorCursorApp,
        codeBinary: cfg.editorCodeBinary,
        codeApp: cfg.editorCodeApp,
        intellijBinary: cfg.editorIntellijBinary,
        intellijApp: cfg.editorIntellijApp,
        terminalApp: cfg.terminalApp
      });
    },
    () => ({ ok: false, message: 'Open failed' })
  );
  safeHandle(
    IPC.clipboard.writeText,
    (text: string) => {
      clipboard.writeText(text);
      return { ok: true };
    },
    () => ({ ok: false })
  );
  // External-editor verification (Settings → Editor). Probes each editor's
  // resolved `<shim> --version` best-effort against main's own config (Rule 1).
  safeHandle(
    IPC.editor.verify,
    () => verifyEditors(store.getConfig()),
    () => []
  );
  safeHandle(
    IPC.git.status,
    (p: string, scope?: string[] | null) => getGitStatus(p, scope),
    () => null
  );
  safeHandle(IPC.git.showHead, (p: string) => showHead(p), () => ({ ok: false, message: 'git show failed' }));
  safeHandle(IPC.git.discard, (p: string) => discardChanges(p), () => ({ ok: false, message: 'git discard failed' }));
  const authorizedGitProject = (projectId: string) => {
    const project = store.listProjects().find((candidate) => candidate.id === projectId);
    if (!project || project.remote) return null;
    try {
      return { project, cwd: realpathSync(project.path) };
    } catch {
      return null;
    }
  };
  const gitCommitPreviews = new Map<string, { cwd: string; preview: import('../shared/types.js').GitCommitPreview }>();
  safeHandle(
    IPC.git.previewCommit,
    async (projectId: string) => {
      const authorized = authorizedGitProject(projectId);
      if (!authorized) return { ok: false as const, message: 'Unknown or unavailable local project.' };
      const id = randomUUID();
      const preview = await previewProjectCommit(authorized.cwd, projectId, id, Date.now() + 60_000);
      if (!preview) return { ok: false as const, message: 'There are no changes to commit.' };
      gitCommitPreviews.set(id, { cwd: authorized.cwd, preview });
      return { ok: true as const, value: preview };
    },
    () => ({ ok: false as const, message: 'Could not preview changes.' })
  );
  safeHandle(
    IPC.git.commitProject,
    async (previewId: string, message: string) => {
      const pending = gitCommitPreviews.get(previewId);
      gitCommitPreviews.delete(previewId);
      if (!pending || pending.preview.expiresAt < Date.now()) {
        return { ok: false, message: 'Commit preview expired or was already used. Review and confirm again.' };
      }
      const authorized = authorizedGitProject(pending.preview.projectId);
      if (!authorized || authorized.cwd !== pending.cwd) return { ok: false, message: 'Project is no longer available.' };
      return commitProjectChanges(pending.cwd, message, pending.preview);
    },
    () => ({ ok: false, message: 'Commit failed.' })
  );
  safeHandle(
    IPC.git.pushProject,
    async (projectId: string) => {
      const authorized = authorizedGitProject(projectId);
      if (!authorized) return { ok: false, message: 'Unknown or unavailable local project.' };
      return pushProjectBranch(authorized.cwd);
    },
    () => ({ ok: false, message: 'Push failed.' })
  );
  safeHandle(IPC.git.isRepo, (p: string) => isGitRepo(p), () => false);
  safeHandle(IPC.git.listWorktrees, (p: string) => listWorktrees(p), () => []);
  safeHandle(IPC.git.listBranches, (p: string) => listBranches(p), () => []);
  // Manual worktree removal (the Explorer's worktree switcher, and any future
  // management surface). main authorizes (Rule 1): the target must be a
  // registered project's path AND the worktree must realpath-resolve under the
  // app-managed `~/zcc-worktrees` root — we only ever prune worktrees WE minted,
  // never an arbitrary path the renderer names. Returns a shaped failure on any
  // rejection rather than throwing.
  safeHandle(
    IPC.git.removeWorktree,
    async (projectPath: string, worktreePath: string, force?: boolean) => {
      const project = store.listProjects().find((p) => p.path === projectPath);
      if (!project) return { ok: false, message: 'unknown project' };
      let realWt: string;
      try {
        realWt = realpathSync(worktreePath);
      } catch {
        return { ok: false, message: 'worktree not found' };
      }
      if (!isWithin(realWt, realpathSync(worktreeRoot()))) {
        return { ok: false, message: 'not a managed worktree' };
      }
      const common = await gitCommonDir(realWt);
      const projectCommon = await gitCommonDir(project.path);
      if (!common || !projectCommon || common !== projectCommon) {
        return { ok: false, message: 'worktree does not belong to this project' };
      }
      const branch = (await listWorktrees(project.path)).find((tree) => tree.path === realWt)?.branch;
      if (!branch) return { ok: false, message: 'worktree branch not found' };
      const res = await withWorktreeLock(project.path, branch, async () => {
        if (worktreeInUse(realWt)) {
          return { ok: false, message: 'worktree is in use by a live agent' };
        }
        return removeWorktree(project.path, realWt, !!force);
      });
      // Drop any cached exit-prune entry now that it's gone (a session may still
      // be live; its exit handler will just no-op on the missing entry).
      for (const [sid, rec] of worktreeBySession) {
        if (rec.worktree.path === realWt) worktreeBySession.delete(sid);
      }
      return res;
    },
    () => ({ ok: false, message: 'worktree remove failed' })
  );

  // Inbox: history/delete RPCs + push subscriptions. We subscribe to the
  // store once at registration (registerIpc is called exactly once from
  // app.whenReady) and let `safeSend` no-op if the renderer isn't ready
  // yet — that way late subscribers in the renderer pick up the next
  // event without us re-binding listeners on window reactivation.
  safeHandle(
    IPC.inbox.history,
    (opts?: { limit?: number; before?: string; projectId?: string }) =>
      inboxStore.read(opts),
    () => ({ entries: [], hasMore: false })
  );
  safeHandle(
    IPC.inbox.delete,
    (id: string) => inboxStore.delete(id),
    () => false
  );
  safeHandle(
    IPC.inbox.deleteMany,
    (ids: string[]) => inboxStore.deleteMany(ids),
    () => 0
  );
  safeHandle(
    IPC.inbox.exportPdf,
    (input: InboxPdfExport) => exportInboxPdf(store.getConfig().pdfExportDir, input),
    (err) => ({ ok: false, message: err instanceof Error ? err.message : String(err) })
  );
  safeHandle(
    IPC.inbox.summarize,
    (projectId?: string | null) => inboxSummary.summarize(projectId ?? null),
    (): InboxSummaryResult => ({ ok: false, reason: 'summary-failed' })
  );
  safeHandle(
    IPC.inbox.summarizeDetailed,
    (projectId?: string | null) => inboxSummary.summarizeDetailed(projectId ?? null),
    (): DetailedInboxSummaryResult => ({ ok: false, reason: 'summary-failed' })
  );
  safeHandle(
    IPC.inbox.classifyNoise,
    (projectId?: string | null): Promise<FeedNoiseResult> => {
      // Gated in main (Rule 1): the renderer can invoke it, but the feature only
      // runs when the operator turned it on — otherwise an empty demotion set.
      if (store.getConfig().feedNoiseClassifierEnabled !== true) {
        return Promise.resolve({ routineIds: [], candidateCount: 0 });
      }
      return feedNoiseClassifier.classify(projectId ?? null);
    },
    (): FeedNoiseResult => ({ routineIds: [], candidateCount: 0 })
  );
  safeHandle(
    IPC.usage.getSummary,
    () => usageService.summarize(),
    // A failed rollup degrades to an honest empty summary (never a crash); the
    // service itself never throws, so this floor covers only an unexpected error.
    (): UsageSummary => ({
      generatedAt: Date.now(),
      sessionCount: 0,
      totalTokens: 0,
      totalPromptCount: 0,
      totalToolCalls: 0,
      totalMcpCalls: 0,
      byProject: [],
      byModel: [],
      topSessions: []
    })
  );
  inboxStore.onAppended((entry: InboxEntry) => {
    safeSend(IPC.inbox.onAppended, entry);
  });
  // Loud-tier OS presence (native Notification + dock badge) — subscribed
  // ONCE here at registerIpc (called once from bootstrap, not per
  // createWindow — Rule 3); disposed in before-quit alongside the other
  // once-registered subscriptions below.
  offLoudInboxAppended = inboxStore.onAppended(handleLoudInboxEntry);
  inboxStore.onRemoved((id: string) => {
    safeSend(IPC.inbox.onRemoved, id);
  });
  inboxStore.onUpdated((entry: InboxEntry) => {
    safeSend(IPC.inbox.onUpdated, entry);
  });
  inboxStore.onPruned((removedIds: string[]) => {
    safeSend(IPC.inbox.onPruned, removedIds);
  });

  // Suggested Actions launcher (afl-03): list/dismiss RPCs + a main-authorized
  // `run` seam + the same subscribe-once push wiring as the inbox above. `run`
  // NEVER trusts a renderer-supplied action — it reads the suggestion from
  // main's own store and re-authorizes every step (Rule 1/2), see runSuggestion.
  safeHandle(
    IPC.suggestions.list,
    (projectId?: string) => suggestionsStore.read({ projectId, limit: 200 }),
    () => ({ entries: [], hasMore: false })
  );
  safeHandle(
    IPC.suggestions.dismiss,
    (id: string) => suggestionsStore.delete(id),
    () => false
  );
  safeHandle(
    IPC.suggestions.run,
    (id: string) =>
      runSuggestion(id, {
        store: suggestionsStore,
        createTerminal: (req) =>
          launchAuthorizedTerminal(req, { kind: 'automation', id: `suggestion:${id}` }),
        listProjectIds: () => store.listProjects().map((p) => p.id)
      }),
    () => ({ ok: false })
  );
  suggestionsStore.onAppended((entry: Suggestion) => {
    safeSend(IPC.suggestions.onAppended, entry);
  });
  suggestionsStore.onRemoved((id: string) => {
    safeSend(IPC.suggestions.onRemoved, id);
  });
  suggestionsStore.onUpdated((entry: Suggestion) => {
    safeSend(IPC.suggestions.onUpdated, entry);
  });
  suggestionsStore.onPruned((removedIds: string[]) => {
    safeSend(IPC.suggestions.onPruned, removedIds);
  });

  // Agent mesh (read-only for the renderer): expose the live discovery registry
  // and the agent↔agent message history so the Agents board can show who's
  // registered and what peers said to each other. Distinct from inbox: this is
  // agent↔agent traffic, never agent→User. The registry change push carries no
  // payload (the renderer re-fetches list()), matching its cheap full-list
  // model; messages push the appended entry like inbox does.
  safeHandle(IPC.agents.list, () => agentRegistry.list(), () => []);
  safeHandle(
    IPC.agents.messages,
    (projectId?: string) => agentMessageLog.history(projectId),
    () => []
  );
  agentRegistry.onChanged(() => {
    safeSend(IPC.agents.onRegistryChanged);
  });
  agentMessageLog.onAppended((msg) => {
    safeSend(IPC.agents.onMessage, msg);
  });
  agentMessageLog.onPruned((removedIds) => {
    safeSend(IPC.agents.onMessagesPruned, removedIds);
  });

  // Saved reports: save/list/delete RPCs + full-list change pushes. The save
  // onError returns null so a failed write surfaces as a toast in the renderer
  // rather than throwing across IPC (the bridge type is SavedRecord | null).
  safeHandle(
    IPC.saved.save,
    (input: SavedRecordInput) => savedStore.save(input),
    () => null
  );
  safeHandle(IPC.saved.list, () => savedStore.list(), () => []);
  safeHandle(
    IPC.saved.delete,
    (id: string) => savedStore.delete(id),
    () => false
  );
  savedStore.onChanged((records: SavedRecord[]) => {
    safeSend(IPC.saved.onChanged, records);
  });

  // Library: add/list/update/remove/reveal RPCs + full-list change pushes.
  safeHandle(IPC.library.list, () => libraryStore.list(), () => []);
  safeHandle(
    IPC.library.add,
    (input: LibraryAddInput) => libraryStore.add(input),
    () => null
  );
  safeHandle(
    IPC.library.update,
    (id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>) =>
      libraryStore.update(id, patch),
    () => null
  );
  safeHandle(
    IPC.library.remove,
    (id: string) => libraryStore.remove(id),
    () => false
  );
  safeHandle(
    IPC.library.reveal,
    (scope: LibraryScope, projectId?: string) => libraryStore.revealDir(scope, projectId),
    () => ({ ok: false, path: '', message: 'Reveal failed' })
  );
  safeHandle(
    IPC.library.search,
    (query: string) => libraryStore.search(query),
    () => ({ hits: [], truncated: false })
  );
  // Read/write a library doc's content by SCOPE + relPath (not an absolute
  // path). Global docs live in `~/.zcc/library`, outside any registered project,
  // so the generic project-confined fs.readFile/writeFile rejects them; these
  // seams confine to the scope's own library dir instead (CLAUDE.md #1/#2 — main
  // resolves the trusted dir from the scope, the renderer never passes an abspath).
  safeHandle(
    IPC.library.read,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      libraryStore.readContent(scope, relPath, projectId),
    () => ({ ok: false, message: 'Read failed' })
  );
  safeHandle(
    IPC.library.write,
    (scope: LibraryScope, relPath: string, content: string, projectId?: string) =>
      libraryStore.writeContent(scope, relPath, content, projectId),
    () => ({ ok: false, message: 'Write failed' })
  );
  // Folder-tree CRUD (createFolder/move/delete) — the full-library explorer's
  // New folder / rename-move / delete actions. Same scope-confined trust model
  // as read/write above.
  safeHandle(
    IPC.library.createFolder,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      libraryStore.createFolder(scope, relPath, projectId),
    () => ({ ok: false, message: 'Create folder failed' })
  );
  safeHandle(
    IPC.library.move,
    (
      from: { scope: LibraryScope; relPath: string; projectId?: string },
      to: { scope: LibraryScope; relPath: string; projectId?: string }
    ) => libraryStore.moveEntry(from, to),
    () => ({ ok: false, message: 'Move failed' })
  );
  safeHandle(
    IPC.library.deleteEntry,
    (scope: LibraryScope, relPath: string, projectId?: string) =>
      libraryStore.deleteEntry(scope, relPath, projectId),
    () => ({ ok: false, message: 'Delete failed' })
  );
  libraryStore.onChanged(() => {
    const docs = libraryStore.list();
    safeSend(IPC.library.onChanged, docs);
  });

  safeHandle(
    IPC.fs.readDataUrl,
    async (p: string) => {
      // Confine to a registered project (covers Explorer + project-scope library
      // assets) OR the global library dir (`~/.zcc/library`, outside any project
      // — backs global-scope LibraryView image previews). Rule 1/2.
      let real = await trustedReadPath(p);
      if (!real) {
        const c = confine(libraryStore.userDir(), p);
        if (c.ok) real = c.path;
      }
      return real ? readDataUrl(real) : { ok: false, message: 'Path is not inside a known project' };
    },
    () => ({ ok: false, message: 'Read failed' })
  );

  safeHandle(
    IPC.mcp.list,
    (projectPath: string) => listMcpServers(projectPath),
    () => []
  );
  safeHandle(
    IPC.mcp.setEnabled,
    (projectPath: string, name: string, enabled: boolean) =>
      setMcpServerEnabled(projectPath, name, enabled),
    () => undefined
  );
  safeHandle(
    IPC.mcp.listAll,
    () => listMcpServersAll(store.listProjects()),
    () => []
  );
  safeHandle(
    IPC.mcp.setEnabledById,
    async (id: string, enabled: boolean) => {
      const res = await setMcpServerEnabledById(id, enabled, store.listProjects());
      if (res.ok) void emitMcpChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.mcp.reveal,
    (id: string) => revealMcpServer(id, store.listProjects()),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );

  safeHandle(IPC.plugins.list, () => listPlugins(), () => []);
  safeHandle(
    IPC.plugins.setEnabled,
    async (id: string, enabled: boolean) => {
      const res = await setPluginEnabled(id, enabled);
      if (res.ok) {
        void emitPluginsChanged();
        // Plugin enable/disable cascades to plugin-source MCPs; refresh.
        void emitMcpChanged();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.plugins.reveal,
    (id: string) => revealPlugin(id),
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );

  // Runtime extensions (~/.zcc/extensions/<id>/). Mirrors the plugins
  // handlers. `list` returns the latest scan; `setEnabled` flips the
  // enabled-map. Model: a renderer-only extension takes effect immediately; a
  // main-bearing extension's MAIN side (its capabilities) activates only at
  // boot — so enabling one leaves `mainActive:false` until relaunch, and
  // disabling tears the live main module down now.
  safeHandle(IPC.extensions.list, () => extensionEntries, () => []);
  safeHandle(
    IPC.extensions.setEnabled,
    async (id: string, enabled: boolean): Promise<Result<true>> => {
      const res = await setExtensionEnabled(id, enabled);
      if (res.ok) {
        if (enabled) {
          // ENABLE → reconcile the disk so a now-enabled, CONSENTED main-bearing
          // extension spawns live right away (out-of-process: `spawn()` is a fresh
          // fork, NOT a cached in-process `import()`, so no relaunch is needed —
          // the old "activates on next relaunch" caveat was from the pre-P3-A
          // in-process era). An unconsented ext still won't spawn (loadBoot emits
          // no spec until consent — P3-D), and a renderer-only one just re-stamps.
          await runDiskSync();
        } else {
          // DISABLE → tear the live module down now (await teardown, drop caps);
          // emitExtensionsChanged then re-stamps mainActive:false from the host.
          await moduleRouter.teardown(id);
          void emitExtensionsChanged();
        }
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.extensions.reveal,
    async (id: string): Promise<Result<true>> => {
      const dir = extensionDir(id);
      if (!existsSync(dir)) {
        return { ok: false, code: 'NOT_FOUND', message: `Extension not found: ${id}` };
      }
      await shell.openPath(dir);
      return { ok: true, value: true };
    },
    (err): Result<true> => ({
      ok: false,
      code: 'REVEAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  safeHandle(
    IPC.extensions.readRendererEntry,
    (id: string) => readRendererEntry(id, logMainError),
    () => null
  );
  // P3-D: persist consent to the extension's CURRENT declared permissions, then
  // re-discover. consentMap refreshes inside emitExtensionsChanged, so the
  // GrantProvider immediately reflects the grant. A renderer-only ext mounts on
  // the next reconcile; a main-bearing ext spawns on the next relaunch (same
  // model as enable — an already-running process isn't hot-swapped). We grant to
  // the live manifest's declared list so consent always matches what was shown.
  safeHandle(
    IPC.extensions.grantConsent,
    async (id: string): Promise<Result<true>> => {
      const entry = extensionEntries.find((e) => e.id === id);
      if (!entry || !entry.manifest) {
        return { ok: false, code: 'NOT_FOUND', message: `Extension not found: ${id}` };
      }
      // Grant to the live manifest's declared permissions AND scope allowlists,
      // so a later scope-widening update re-prompts (consent tracks scopes, not
      // just tokens — the update-from-repo escalation guard).
      const res = await grantConsent(id, entry.manifest.permissions, entry.manifest.permissionScopes);
      if (res.ok) void emitExtensionsChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Declare an extra permission in the extension's manifest, then re-discover.
  // This only WIDENS the declared set — emitExtensionsChanged re-stamps the
  // entry as needsConsent:'widened', so the consent prompt fires and the user
  // must approve before it's effective. Adding a permission never grants it.
  safeHandle(
    IPC.extensions.addPermission,
    async (id: string, permission: string): Promise<Result<true>> => {
      const res = await addExtensionPermission(id, permission);
      if (res.ok) void emitExtensionsChanged();
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Remove a declared permission: narrow the manifest, then prune the token from
  // the consent record so a later re-add re-prompts (the manifest narrowing is
  // silent). We AWAIT the prune BEFORE emitting (unlike addPermission's
  // fire-and-forget) so re-discovery sees the narrowed approved set — no
  // read-back race that could re-stamp a phantom 'widened'.
  safeHandle(
    IPC.extensions.removePermission,
    async (id: string, permission: string): Promise<Result<true>> => {
      const res = await removeExtensionPermission(id, permission);
      if (res.ok) {
        await pruneConsentedPermission(id, permission).catch((err) =>
          logMainError(`pruneConsentedPermission ${id}`, err)
        );
        void emitExtensionsChanged();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'WRITE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Relaunch a disk extension's child: teardown (no-op if already dead/crashed)
  // then respawn from its retained spec. `spawn()` clears the crash record and
  // tears down any live child first, so this recovers a crashed OR hung backend.
  // Built-ins (in-process, no child) return ok:false — nothing to respawn.
  safeHandle(
    IPC.extensions.relaunch,
    async (id: string): Promise<Result<boolean>> => {
      const spec = diskSpecsById.get(id);
      if (!spec) {
        return { ok: false, code: 'NOT_FOUND', message: `No disk extension to relaunch: ${id}` };
      }
      const ready = await extProcessHost.spawn(spec);
      // Re-stamp mainActive from the live set so the renderer reflects the
      // fresh child (or its failure to come up).
      void emitExtensionsChanged();
      return { ok: true, value: ready };
    },
    (err): Result<boolean> => ({
      ok: false,
      code: 'RELAUNCH_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Explicit "Reload" button: re-run the disk-extension reconcile (spawn new,
  // tear down removed, respawn changed). Takes no renderer payload → nothing to
  // validate (Rule #1). The watcher fires the same path automatically.
  safeHandle(
    IPC.extensions.rescan,
    async (): Promise<Result<true>> => {
      await runDiskSync();
      return { ok: true, value: true };
    },
    (err): Result<true> => ({
      ok: false,
      code: 'RESCAN_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Explicit "Reload skills & MCP" button: re-deploy the runtime capability
  // artifacts the app ships (bundled SKILL.md files) + re-sync every project's
  // `.mcp.json`. These deploy at boot; this re-applies a shipped-content bump
  // (or repairs a stray manual edit) without an app restart. No renderer payload
  // (Rule #1) — main re-reads the bundled roster + its own project list.
  safeHandle(
    IPC.extensions.redeployCapabilities,
    async (): Promise<Result<{ skills: Array<{ name: string; ok: boolean }>; mcpProjects: number }>> => {
      const skills = await redeployBundledSkills(logMainError);
      // Re-derive the extension-contributed server registry AND re-sync every
      // extension's own skill deploys from the CURRENT extension state before
      // re-syncing every project's `.mcp.json` — this is the button's literal
      // reason to exist: an extension installed/enabled since the last sync
      // gets its declared servers + skills applied right now, not just at the
      // next boot/rescan.
      rebuildExtensionServers(extensionEntries);
      await syncExtensionSkills(extensionEntries, logMainError);
      const projects = store.listProjects();
      const results = await Promise.all(
        projects.map((p) =>
          ensureMcpConfigForProject(p.id)
            .then(() => true)
            .catch((err) => {
              logMainError(`redeployCapabilities:ensureMcpConfigForProject(${p.id})`, err);
              return false;
            })
        )
      );
      // Let the skills catalogue refresh (a redeploy may have rewritten files).
      safeSend(IPC.skills.onChanged);
      return { ok: true, value: { skills, mcpProjects: results.filter(Boolean).length } };
    },
    (err): Result<{ skills: Array<{ name: string; ok: boolean }>; mcpProjects: number }> => ({
      ok: false,
      code: 'REDEPLOY_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Install on demand. Main owns every trust decision (Rule #1): for local
  // kinds it opens the OS picker ITSELF (the renderer never supplies a path),
  // and validates manifest/id/containment/reserved/API in `installFromDir`. The
  // marketplace kind resolves the best release from the opt-in registry and
  // applies it through the same verified channel as auto-update.
  safeHandle(
    IPC.extensions.install,
    async (source: ExtensionInstallSource): Promise<Result<{ id: string }>> => {
      const installOpts = { reservedIds: builtinIds, log: logMainError };
      let res: Result<{ id: string }>;
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
      if (source.kind === 'localDir') {
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Install extension from folder',
          properties: ['openDirectory']
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, code: 'CANCELED', message: 'Install canceled' };
        }
        res = await installFromDir(pick.filePaths[0], installOpts);
      } else if (source.kind === 'localArchive') {
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Install extension from archive',
          properties: ['openFile'],
          filters: [{ name: 'Extension archive', extensions: ['json'] }]
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: false, code: 'CANCELED', message: 'Install canceled' };
        }
        res = await installFromArchiveFile(pick.filePaths[0], installOpts);
      } else if (source.kind === 'marketplace') {
        const resolved = await resolveMarketplaceRelease(source.id, logMainError);
        if (!resolved) {
          return {
            ok: false,
            code: 'NOT_FOUND',
            message: `No installable release for "${source.id}" (registry off or id not offered)`
          };
        }
        const outcome = await applyRelease(resolved.release, resolved.deps);
        if (outcome.status === 'needs-consent') {
          // The release widens permissions — install the bytes is held back; the
          // user must re-consent. Surface as a typed failure the UI can explain.
          return {
            ok: false,
            code: 'NEEDS_CONSENT',
            message: `"${source.id}" requests new permissions: ${(outcome.addedPermissions ?? []).join(', ')}`
          };
        }
        if (outcome.status === 'error') {
          return { ok: false, code: 'INSTALL_FAILED', message: outcome.error ?? 'install failed' };
        }
        res = { ok: true, value: { id: source.id } };
      } else if (source.kind === 'git') {
        // Install from a remote repo. Main normalizes + clones the url, validates
        // the ref, confines the manifest dir, scrubs the tree, and funnels the
        // staged copy through installFromDir — same consent + broker gates as a
        // local dir. Progress streams to the renderer via installProgress.
        const gitRes = await installFromGit(
          source.url,
          { ref: source.ref, subdir: source.subdir, onProgress: (line) => safeSend(IPC.extensions.installProgress, line) },
          installOpts
        );
        if (!gitRes.ok) {
          res = gitRes;
        } else {
          // Record provenance FAIL-CLOSED: the remote-origin warning on the
          // consent screen is the only carrier of "unreviewed remote code", so a
          // failed provenance write must fail the install rather than leave a git
          // extension with no origin badge. markGit is mutex-guarded (Rule 4).
          const rec = await markGit(gitRes.value.id, {
            ...gitRes.value.provenance,
            installedAt: new Date().toISOString()
          });
          if (!rec.ok) {
            // Roll the just-installed bytes back out so we don't leave an
            // un-provenanced git extension behind.
            await uninstallExtension(gitRes.value.id, { reservedIds: builtinIds, log: logMainError }).catch(
              () => {}
            );
            return { ok: false, code: 'WRITE_FAILED', message: 'Could not record extension provenance' };
          }
          res = { ok: true, value: { id: gitRes.value.id } };
        }
      } else if (source.kind === 'bundled') {
        // Reinstall a first-party bundled extension from the app's own resources
        // (no network, no picker). Main maps the id → the app-owned bundled dir;
        // installFromBundled re-runs the same manifest/id/api/reserved gates.
        res = await installFromBundled(source.id, installOpts);
      } else {
        return { ok: false, code: 'BAD_SOURCE', message: 'Unknown install source' };
      }
      // Discover + spawn the newly installed extension (consent overlay fires
      // first if it declares permissions — P3-D). Only on a successful install.
      if (res.ok) {
        // Mark the id BEFORE the reconcile so the child's first `ready` (this
        // spawn, or a later consent-gated one) fires the one-time `onInstall`
        // hook exactly once — and never on an ordinary boot/reload. Fire-and-
        // forget inside the host; the reconcile isn't held on install work.
        extProcessHost.markPendingInstall(res.value.id);
        await runDiskSync();
      }
      return res;
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'INSTALL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Uninstall: tear the live child down FIRST (so no process holds the files),
  // remove the containment-checked install dir, forget consent, then reconcile.
  // Renderer passes only an id (Rule #1); `uninstallExtension` re-derives +
  // confines the path (Rule #2) and refuses reserved built-ins.
  safeHandle(
    IPC.extensions.uninstall,
    async (id: string): Promise<Result<true>> => {
      // Fire the pre-removal hook FIRST, while the child is still alive and its
      // ctx (fs/exec/fetch) still works — the extension's chance to clean up
      // state it wrote OUTSIDE its dir. Bounded + never-throwing inside the host,
      // so a misbehaving hook can't wedge the uninstall.
      await extProcessHost.dispatchLifecycle(id, 'onUninstall');
      // Feed: resolve a LOCAL extension's project home BEFORE clearLocal drops the
      // pointer, so we can stamp the uninstall into that project's feed. The
      // source working dir is left on disk on uninstall, so the project persists.
      const localBefore = await getLocalRecord(id).catch(() => null);
      const localTitle = extensionEntries.find((e) => e.id === id)?.manifest?.title ?? id;
      await moduleRouter.teardown(id); // no-op for an unknown / already-dead id
      const res = await uninstallExtension(id, { reservedIds: builtinIds, log: logMainError });
      if (res.ok) {
        if (localBefore) {
          const proj = store.listProjects().find((p) => p.path === localBefore.workingDir);
          if (proj) {
            stampFeedEvent(
              proj.id,
              'extension-uninstalled',
              `Extension uninstalled: ${localTitle}`,
              `extension-uninstalled:${id}`
            );
          }
        }
        // Purge the extension's persistent `ctx.storage` KV (its `<id>.json`) so
        // a later reinstall of the same id starts clean instead of inheriting
        // the removed extension's state — the storage twin of removing the dir.
        moduleRouter.storageClear(id);
        // Remove any deployed `ext-<id>-*` skill dirs. `syncExtensionSkills` below
        // (via runDiskSync) only prunes contributors it's GIVEN — an uninstalled
        // extension is absent from the next `extensionEntries`, so it would never
        // see it again; this explicit call is the only place that cleans it up.
        await removeSkillsForExtension(id, logMainError);
        safeSend(IPC.skills.onChanged);
        // Forget consent so a later reinstall re-prompts; ignore a cleanup miss.
        await revokeConsent(id).catch((err) => logMainError(`revokeConsent ${id}`, err));
        // Drop the local-authored registry entry (no-op for a non-local ext).
        // The source project under the scratch workspace is deliberately LEFT on
        // disk — uninstalling the packaged copy shouldn't destroy the user's
        // authoring work; only the installed bytes + our pointer to it go.
        await clearLocal(id).catch((err) => logMainError(`clearLocal ${id}`, err));
        // Drop the git-provenance registry entry (no-op for a non-git ext).
        await clearGit(id).catch((err) => logMainError(`clearGit ${id}`, err));
        await runDiskSync();
      }
      return res;
    },
    (err): Result<true> => ({
      ok: false,
      code: 'UNINSTALL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Create a LOCAL (in-app authored) extension. The renderer supplies only
  // display intent (name/description/kind) — createLocalExtension (module
  // scope) mints the id and derives every path (Rule 1).
  safeHandle(
    IPC.extensions.createLocal,
    (req: CreateLocalExtensionRequest) => createLocalExtension(req),
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'CREATE_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Adopt an EXISTING source directory into the local authoring workflow. Unlike
  // createLocal, the directory comes only from the OS picker, never renderer
  // text. Its current built artifact still crosses the normal pack/install seam;
  // local.json merely records where future reloads and Creator sessions operate.
  safeHandle(
    IPC.extensions.adoptLocal,
    async (): Promise<Result<CreateLocalExtensionResult>> => {
      const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
      if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
      const pick = await dialog.showOpenDialog(win, {
        title: 'Import editable extension folder',
        properties: ['openDirectory']
      });
      if (pick.canceled || !pick.filePaths[0]) {
        return { ok: false, code: 'CANCELED', message: 'Import canceled' };
      }

      let workingDir: string;
      try {
        // Canonicalize the picker result before persisting it. Future reloads use
        // this main-owned path, and the dedicated project is rooted here.
        workingDir = realpathSync(pick.filePaths[0]);
      } catch {
        return { ok: false, code: 'BAD_SOURCE', message: 'Could not access the selected folder' };
      }
      return adoptLocalSource(workingDir);
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'ADOPT_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Repository variant of "Open existing extension". The clone destination is
  // main-owned beneath the extension workspace; only a validated manifest dir
  // becomes editable local source. The source tree is intentionally retained on
  // success so the user can work directly in their Git checkout.
  safeHandle(
    IPC.extensions.adoptLocalGit,
    async (req: AdoptLocalExtensionGitRequest): Promise<Result<CreateLocalExtensionResult>> => {
      const cloned = await cloneProject({
        url: req?.url ?? '',
        ref: req?.ref,
        shallow: false,
        destBase: join(scratchWorkspaceRoot(), 'extensions'),
        onProgress: (line) => safeSend(IPC.extensions.installProgress, line)
      });
      if (!cloned.ok || !cloned.path) {
        return { ok: false, code: cloned.code ?? 'CLONE_FAILED', message: cloned.message ?? 'Could not clone repository' };
      }
      const located = await locateManifestDir(cloned.path, req?.subdir);
      if (!located.ok) return located;
      const adopted = await adoptLocalSource(located.value);
      if (!adopted.ok && !cloned.reused) {
        await rm(cloned.path, { recursive: true, force: true }).catch(() => {});
      }
      return adopted;
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'ADOPT_LOCAL_GIT_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Reload a local extension from its source ("Reload from source"). Renderer
  // passes only an id; main RE-DERIVES the working dir from local.json — never
  // renderer/agent free-text (Rule 1). Re-pack + installFromDir (same gates,
  // via the shared packAndInstallLocal tail, module scope).
  safeHandle(
    IPC.extensions.reinstallLocal,
    async (id: string): Promise<Result<{ id: string }>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      // Sanity: the source manifest's id must still match the registry key, so a
      // hand-edited manifest can't reinstall under a different id than we track.
      const declaredId = await readWorkingDirId(record.workingDir);
      if (declaredId !== id) {
        return {
          ok: false,
          code: 'ID_MISMATCH',
          message: `Source manifest id "${declaredId ?? '(none)'}" does not match "${id}"`
        };
      }
      return packAndInstallLocal(id, record.workingDir);
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'REINSTALL_LOCAL_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Update a git extension from its source repo ("Update from repo"). Renderer
  // passes only an id; main RE-DERIVES {url, ref} from git.json — never
  // renderer/agent free-text (Rule 1). Re-clone + installFromGit (same gates +
  // scrub). Because installFromDir upgrades in place and consent now tracks
  // scopes, a widened update re-prompts before it can run. markGit refreshes the
  // resolved sha / installedAt (fail-closed as on first install).
  safeHandle(
    IPC.extensions.reinstallFromGit,
    async (id: string): Promise<Result<{ id: string }>> => {
      const record = await getGitRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_GIT', message: `"${id}" was not installed from a repository` };
      }
      const gitRes = await installFromGit(
        record.url,
        {
          ref: record.ref,
          onProgress: (line) => safeSend(IPC.extensions.installProgress, line)
        },
        { reservedIds: builtinIds, log: logMainError }
      );
      if (!gitRes.ok) return gitRes;
      // Guard against a repo that renamed its manifest id out from under us — an
      // update must land on the SAME id we tracked, not silently install a new one.
      if (gitRes.value.id !== id) {
        await uninstallExtension(gitRes.value.id, { reservedIds: builtinIds, log: logMainError }).catch(
          () => {}
        );
        return {
          ok: false,
          code: 'ID_MISMATCH',
          message: `Repository now declares id "${gitRes.value.id}", expected "${id}"`
        };
      }
      // Provenance refresh is best-effort on the UPDATE path (unlike the initial
      // install, which fails closed): installFromDir has ALREADY swapped the bytes
      // in place, and the id is still tracked in git.json from the first install —
      // a failed sha/installedAt refresh only leaves the provenance stale, not an
      // un-provenanced extension. Reconcile regardless so the running child never
      // lags the on-disk bytes just because the metadata write failed.
      const rec = await markGit(gitRes.value.id, {
        ...gitRes.value.provenance,
        installedAt: new Date().toISOString()
      });
      if (!rec.ok) {
        logMainError(
          'reinstallFromGit',
          `bytes updated but provenance refresh failed for "${id}": ${rec.message ?? 'unknown'}`
        );
      }
      await runDiskSync();
      return { ok: true, value: { id: gitRes.value.id } };
    },
    (err): Result<{ id: string }> => ({
      ok: false,
      code: 'REINSTALL_GIT_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Resolve a local extension's source working dir + scratch project so the
  // renderer can re-open the Creator agent ("Continue building"). Re-derived from
  // local.json (Rule 1) — the renderer passes only an id.
  safeHandle(
    IPC.extensions.localInfo,
    async (id: string): Promise<Result<CreateLocalExtensionResult>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      // Re-derive (and self-heal) the dedicated Extensions-category project from
      // main's own record — never renderer/agent free-text (Rule 1). Seed the
      // display name from the installed entry's title, falling back to the id.
      const name = extensionEntries.find((e) => e.id === id)?.manifest?.title ?? id;
      const project = registerExtensionProject(record.workingDir, name);
      return { ok: true, value: { id, workingDir: record.workingDir, projectId: project.id } };
    },
    (err): Result<CreateLocalExtensionResult> => ({
      ok: false,
      code: 'LOCAL_INFO_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Prepare a git-ready export of a local extension ("Prepare for sharing").
  // Renderer passes only an id; main RE-DERIVES the working dir from local.json
  // (Rule 1) and assembles <workingDir>/share (manifest + dist/ + README), then
  // reveals it so the user can commit + push.
  safeHandle(
    IPC.extensions.prepareShare,
    async (id: string): Promise<Result<{ shareDir: string }>> => {
      const record = await getLocalRecord(id);
      if (!record) {
        return { ok: false, code: 'NOT_LOCAL', message: `"${id}" is not a local extension` };
      }
      const res = await prepareShareDir(record.workingDir);
      if (!res.ok) return res;
      await shell.showItemInFolder(res.value.shareDir);
      return res;
    },
    (err): Result<{ shareDir: string }> => ({
      ok: false,
      code: 'PREPARE_SHARE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Manual "Check for updates": apply every compatible, non-widening release for
  // the installed set (no-op unless the registry channel is configured). If any
  // were applied, reconcile so the new code spawns live.
  safeHandle(
    IPC.extensions.checkUpdates,
    async (): Promise<Result<ExtensionUpdateOutcome[]>> => {
      const outcomes = await maybeCheckRemoteUpdates(
        extensionEntries.map((e) => e.id),
        logMainError
      );
      if (outcomes.some((o) => o.status === 'updated')) await runDiskSync();
      return { ok: true, value: outcomes };
    },
    (err): Result<ExtensionUpdateOutcome[]> => ({
      ok: false,
      code: 'CHECK_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );
  // Browse the marketplace: the first-party BUNDLED catalog (offline, always
  // available) unioned with the opt-in remote registry (a remote release for an
  // id wins over its bundled twin). Never reaches the network by default — the
  // bundled rows are read from the app's own resources.
  safeHandle(
    IPC.extensions.marketplaceList,
    async (): Promise<Result<MarketplaceEntry[]>> => {
      const installedIds = extensionEntries.map((e) => e.id);
      const bundled = await listBundledCatalog(logMainError);
      const entries = await listMarketplace(
        installedIds,
        logMainError,
        undefined,
        bundled
      );
      return { ok: true, value: entries };
    },
    (err): Result<MarketplaceEntry[]> => ({
      ok: false,
      code: 'MARKETPLACE_FAILED',
      message: err instanceof Error ? err.message : String(err)
    })
  );

  safeHandleFromWindow<[string, ClaudeSettingsScope], ClaudeSettingsResult>(
    IPC.claudeSettings.read,
    async (win, projectId: string, scope: ClaudeSettingsScope) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'Claude settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { state: 'io-error' as const, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      return root
        ? readClaudeProjectSettings(root, scope)
        : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Claude settings read failed' })
  );
  safeHandleFromWindow<[string, ClaudeSettingsScope, ClaudeProjectSettings, string | null], ClaudeSettingsResult>(
    IPC.claudeSettings.write,
    async (
      win,
      projectId: string,
      scope: ClaudeSettingsScope,
      patch: ClaudeProjectSettings,
      expectedHash: string | null
    ) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'Claude settings are unavailable from this window' };
      const permissions = patch?.permissions;
      const widensPermissions =
        permissions?.defaultMode === 'bypassPermissions' ||
        !!permissions?.allow?.length ||
        !!permissions?.additionalDirectories?.length;
      if (widensPermissions) {
        const confirmation = await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['Cancel', 'Allow change'],
          defaultId: 0,
          cancelId: 0,
          title: 'Allow Claude permission change?',
          message: 'This change can expand Claude access or disable permission prompts for this project.',
          detail: 'Review the project settings before allowing this change.'
        });
        if (confirmation.response !== 1) {
          return { state: 'io-error' as const, message: 'Claude permission change was not allowed' };
        }
      }
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { state: 'io-error' as const, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      return root
        ? writeClaudeProjectSettings(root, scope, patch, expectedHash)
        : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Claude settings write failed' })
  );
  safeHandleFromWindow<[string, ClaudeProjectFileId], OpenResult>(
    IPC.claudeSettings.openFile,
    async (win, projectId: string, fileId: ClaudeProjectFileId): Promise<OpenResult> => {
      if (win !== mainWindow()) return { ok: false, message: 'Claude project files are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      if (!project) return { ok: false, message: 'Project is unavailable' };
      const root = await trustedProjectRoot(project.path);
      const path = root ? await claudeProjectFilePath(root, fileId) : null;
      if (!path) return { ok: false, message: 'Claude project file is unavailable' };
      const error = await shell.openPath(path);
      return error ? { ok: false, message: error } : { ok: true };
    },
    () => ({ ok: false, message: 'Could not open Claude project file' })
  );
  safeHandleFromWindow<[string], CodexSettingsResult>(
    IPC.codexSettings.read,
    async (win, projectId) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'Codex settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? readCodexProjectSettings(root) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Codex settings read failed' })
  );
  safeHandleFromWindow<[string, CodexProjectSettings, string | null], CodexSettingsResult>(
    IPC.codexSettings.write,
    async (win, projectId, patch, expectedHash) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'Codex settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? writeCodexProjectSettings(root, patch, expectedHash) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'Codex settings write failed' })
  );
  safeHandleFromWindow<[string], OpenCodeSettingsResult>(
    IPC.openCodeSettings.read,
    async (win, projectId) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'OpenCode settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? readOpenCodeProjectSettings(root) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'OpenCode settings read failed' })
  );
  safeHandleFromWindow<[string, OpenCodeProjectSettings, string | null], OpenCodeSettingsResult>(
    IPC.openCodeSettings.write,
    async (win, projectId, patch, expectedHash) => {
      if (win !== mainWindow()) return { state: 'io-error' as const, message: 'OpenCode settings are unavailable from this window' };
      const project = store.listProjects().find((entry) => entry.id === projectId && !entry.remote);
      const root = project && await trustedProjectRoot(project.path);
      return root ? writeOpenCodeProjectSettings(root, patch, expectedHash) : { state: 'io-error' as const, message: 'Project root is unavailable' };
    },
    () => ({ state: 'io-error' as const, message: 'OpenCode settings write failed' })
  );

  safeHandle(
    IPC.authorizations.apply,
    (input: ApplyAuthorizationInput) => applyAuthorizations(input),
    (err, input: ApplyAuthorizationInput) =>
      (input?.providers ?? []).map((provider) => ({
        provider,
        ok: false,
        message: err instanceof Error ? err.message : String(err)
      }))
  );

  safeHandle(
    IPC.skills.list,
    (projectPath?: string) => listSkills(projectPathToOptions(projectPath)),
    () => []
  );
  safeHandle(
    IPC.skills.setEnabled,
    (name: string, enabled: boolean) => setSkillEnabled(name, enabled),
    () => undefined
  );
  safeHandle(
    IPC.skills.setManyEnabled,
    (updates: Array<{ name: string; enabled: boolean }>) => setManySkillsEnabled(updates),
    () => undefined
  );
  safeHandle(IPC.skills.readHooks, () => readHooks(), () => null);
  safeHandle(
    IPC.skills.reveal,
    (skillId: string, projectPath?: string) =>
      revealSkillDir(skillId, projectPathToOptions(projectPath)),
    () => ({ ok: false, path: '', message: 'reveal failed' })
  );

  safeHandle(
    IPC.commands.list,
    (projectPath?: string) => listCommands(projectPathToOptions(projectPath)),
    () => []
  );

  safeHandle(IPC.skills.bundles.list, () => skillBundles.list(), () => []);
  safeHandle(
    IPC.skills.bundles.create,
    (input: SkillBundleInput) => skillBundles.create(input),
    () => null
  );
  safeHandle(
    IPC.skills.bundles.update,
    (id: string, patch: Partial<SkillBundleInput>) => skillBundles.update(id, patch),
    () => null
  );
  safeHandle(
    IPC.skills.bundles.delete,
    (id: string) => skillBundles.delete(id),
    () => false
  );
  safeHandle(
    IPC.skills.bundles.apply,
    (id: string, mode: SkillBundleApplyMode, projectPath?: string) =>
      skillBundles.apply(id, mode, projectPathToOptions(projectPath)),
    () => ({ ok: false, applied: 0, skippedPlugin: 0, message: 'apply failed' })
  );
  skillBundles.on('changed', (bundles) => {
    safeSend(IPC.skills.bundles.onChanged, bundles);
  });
  safeHandle(IPC.app.homedir, () => homedir(), () => '');
  safeHandle(
    IPC.app.version,
    () => {
      const version = app.getVersion();
      const e2eVersion = process.env.ZCC_E2E_APP_VERSION;
      return version === '0.0' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(e2eVersion ?? '')
        ? e2eVersion!
        : version;
    },
    () => ''
  );
  safeHandle(IPC.app.microVmSupported, () => microVmPlatformSupported(), () => false);
  // Renderer-driven fullscreen targets its sender window, never whichever window
  // happened to gain focus before main handles the request.
  safeHandleFromWindow<[boolean], void>(
    IPC.app.setFullScreen,
    (win, flag: boolean) => {
      if (typeof flag !== 'boolean') throw new TypeError('fullscreen flag must be boolean');
      if (win.isFullScreen() === flag) return;
      const controller = boundsControllers.get(win.id);
      if (flag) controller?.beginFullscreenTransition();
      win.setFullScreen(flag);
    },
    () => {}
  );
  safeHandleFromWindow(
    IPC.app.isFullScreen,
    (win) => win.isFullScreen(),
    () => false
  );

  // Auto-update. `updater` is null until whenReady wires it; check/install
  // no-op gracefully before then and in dev (the updater shim reports
  // `disabled`).
  safeHandle(
    IPC.updates.check,
    async () => {
      await updater?.checkForUpdates({ manual: true });
    },
    () => undefined
  );
  safeHandle(
    IPC.updates.download,
    async (opts?: { installNow?: boolean }) => {
      await updater?.downloadUpdate(opts);
    },
    () => undefined
  );
  safeHandle(
    IPC.updates.skip,
    (version: string) => {
      // Rule 1: the renderer is untrusted. This string is persisted into the
      // shared AppConfig, so bound it to a semver-ish token before it lands on
      // disk (a compromised renderer can't bloat config or persist junk).
      if (typeof version !== 'string' || version.length > 64 || !/^[\w.+-]+$/.test(version)) {
        return;
      }
      updater?.skipVersion(version);
    },
    () => undefined
  );
  safeHandle(
    IPC.updates.quitAndInstall,
    () => {
      updater?.quitAndInstall();
    },
    () => undefined
  );
  // Dev/QA: drive a fake update flow. Rule 1 — the renderer is untrusted, so
  // re-check the config gate HERE (not just in the updater) before letting a
  // fake "available"/"downloaded" reach the UI + inbox tap. `version` is
  // re-validated inside updater.simulate; a disabled gate makes this a no-op.
  safeHandle(
    IPC.updates.simulate,
    async (version: string) => {
      if (!store.getConfig().enableUpdateSimulation) return;
      await updater?.simulate(version);
    },
    () => undefined
  );
  // Pull the current status: a renderer that mounts after the boot check ran
  // (the boot `available` push fires before the window's onStatus listener is
  // attached) seeds its store from this instead of missing the one-shot event.
  safeHandle(
    IPC.updates.getStatus,
    (): UpdateStatus => updater?.getStatus() ?? { kind: 'idle' },
    () => ({ kind: 'idle' })
  );
  // Curated in-app release notes for the "What's New" modal. Args are advisory
  // hints — `getReleaseNotes` clamps to the versions that actually ship on disk
  // (Rule 1), and degrades to an empty array on any read/parse failure so the
  // modal simply shows nothing rather than erroring.
  safeHandle(
    IPC.updates.getReleaseNotes,
    (range?: { fromVersion?: string | null; toVersion?: string | null }): Promise<ReleaseNote[]> =>
      getReleaseNotes(range?.fromVersion ?? null, range?.toVersion ?? null),
    () => [] as ReleaseNote[]
  );
  // Race-free pull for the "What's New" modal: return the window computed at boot
  // (or null) and, when there is one, ADVANCE the baseline so it fires exactly
  // once regardless of when the renderer mounts. Idempotent — a second consumer
  // (e.g. a second window) gets null.
  safeHandle(
    IPC.updates.consumeWhatsNew,
    (): WhatsNewEvent | null => {
      const evt = pendingWhatsNew;
      if (evt) {
        pendingWhatsNew = null;
        store.setConfig({ lastSeenVersion: evt.toVersion });
      }
      return evt;
    },
    () => null
  );

  // First-run dependency doctor. `doctor` is null until whenReady wires it;
  // every handler no-ops gracefully before then. Detection/install are
  // best-effort in the doctor itself — nothing here throws into the renderer.
  safeHandle(
    IPC.deps.get,
    (): SetupStatus => doctor?.snapshot() ?? { busy: false, items: [] },
    () => ({ busy: false, items: [] })
  );
  safeHandle(
    IPC.deps.check,
    async () => {
      await doctor?.check();
    },
    () => undefined
  );
  safeHandle(
    IPC.deps.install,
    async () => {
      await doctor?.install();
    },
    () => undefined
  );
  safeHandle(
    IPC.deps.dismiss,
    () => {
      doctor?.dismiss();
    },
    () => undefined
  );

  // The Scheduler view merges the app's own schedules with READ-ONLY mirrors of
  // Claude Code `/loop` cron jobs (from .claude/scheduled_tasks.json). The app
  // owns only the former; the latter are tagged `external` and the mutating
  // handlers below reject them — the Claude harness owns their lifecycle.
  const listSchedulesForUi = (): ScheduledTask[] => [
    ...scheduler.list(),
    ...readClaudeLoops(store.listProjects(), new Date().toISOString())
  ];
  // A read-only foreign row can't be created/edited/run from the app. Guarding
  // by id prefix is enough — the renderer also hides the controls.
  const isExternalId = (id: string) => id.startsWith('claude-loop:');
  const externalReject = (): Result<never> => ({
    ok: false,
    code: 'READ_ONLY',
    message: 'This is a Claude /loop job — manage it from Claude Code, not here.'
  });

  safeHandle(IPC.scheduler.list, () => listSchedulesForUi(), () => []);
  ipcMain.handle(
    IPC.scheduler.create,
    async (_e, input: ScheduleCreateInput): Promise<Result<ScheduledTask>> => {
      try {
        if (!store.listProjects().some((project) => project.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${input.projectId}` };
        }
        return { ok: true, value: scheduler.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.update,
    async (_e, id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        if (patch.projectId !== undefined && !store.listProjects().some((project) => project.id === patch.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `project not found: ${patch.projectId}` };
        }
        return { ok: true, value: scheduler.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.delete,
    async (_e, id: string): Promise<Result<true>> => {
      if (isExternalId(id)) return externalReject();
      try {
        scheduler.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.setEnabled,
    async (_e, id: string, enabled: boolean): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        const task = scheduler.setEnabled(id, enabled);
        if (!task) return { ok: false, code: 'NOT_FOUND', message: `schedule not found: ${id}` };
        return { ok: true, value: task };
      } catch (err) {
        return { ok: false, code: 'SET_ENABLED_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.runNow,
    async (_e, id: string): Promise<Result<ScheduledTask>> => {
      if (isExternalId(id)) return externalReject();
      try {
        return { ok: true, value: scheduler.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    }
  );
  scheduler.on('changed', () => {
    safeSend(IPC.scheduler.onChanged, listSchedulesForUi());
  });

  // Goals — persistent objectives the main process works toward (spawn → evaluate
  // → re-spawn). Mirrors the scheduler IPC surface. The renderer is untrusted, so
  // create() rejects an unknown projectId here in main (Rule 1) before any loop
  // could spawn into it; the manager's own spawn path re-resolves the project.
  safeHandle(IPC.goals.list, () => goals.list(), () => []);
  ipcMain.handle(
    IPC.goals.create,
    async (_e, input: GoalCreateInput): Promise<Result<Goal>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: goals.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.update,
    async (_e, id: string, patch: GoalUpdateInput): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: goals.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        goals.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.setStatus,
    async (_e, id: string, status: GoalStatus): Promise<Result<Goal>> => {
      try {
        const goal = goals.setStatus(id, status);
        if (!goal) return { ok: false, code: 'NOT_FOUND', message: `goal not found: ${id}` };
        return { ok: true, value: goal };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.goals.runNow,
    async (_e, id: string): Promise<Result<Goal>> => {
      try {
        return { ok: true, value: goals.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    }
  );
  goals.on('changed', () => {
    safeSend(IPC.goals.onChanged, goals.list());
  });

  // Follow-ups — agent-parked questions / decisions awaiting a human. Mirrors the
  // goals IPC surface (minus runNow — a follow-up has no loop to run). The
  // renderer is untrusted, so create() rejects an unknown projectId here (Rule 1).
  safeHandle(IPC.followups.list, () => followups.list(), () => []);
  ipcMain.handle(
    IPC.followups.create,
    async (_e, input: FollowUpCreateInput): Promise<Result<FollowUp>> => {
      try {
        if (!store.listProjects().some((p) => p.id === input.projectId)) {
          return { ok: false, code: 'UNKNOWN_PROJECT', message: `unknown projectId: ${input.projectId}` };
        }
        return { ok: true, value: followups.create(input) };
      } catch (err) {
        return { ok: false, code: 'CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.update,
    async (_e, id: string, patch: FollowUpUpdateInput): Promise<Result<FollowUp>> => {
      try {
        return { ok: true, value: followups.update(id, patch) };
      } catch (err) {
        return { ok: false, code: 'UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        followups.remove(id);
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'DELETE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.setStatus,
    async (_e, id: string, status: FollowUpStatus, resolution?: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = followups.setStatus(id, status, resolution);
        if (!followUp) return { ok: false, code: 'NOT_FOUND', message: `follow-up not found: ${id}` };
        return { ok: true, value: followUp };
      } catch (err) {
        return { ok: false, code: 'SET_STATUS_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.followups.markSpawned,
    async (_e, id: string): Promise<Result<FollowUp>> => {
      try {
        const followUp = followups.markSpawned(id);
        if (!followUp) return { ok: false, code: 'NOT_FOUND', message: `follow-up not found: ${id}` };
        return { ok: true, value: followUp };
      } catch (err) {
        return { ok: false, code: 'MARK_SPAWNED_FAILED', message: String(err) };
      }
    }
  );
  followups.on('changed', () => {
    safeSend(IPC.followups.onChanged, followups.list());
  });

  // Activity Feed — a per-project, read-only history assembled on demand by
  // `feedService` (persisted greenfield slice + events derived from the inbox /
  // followups / goals / library stores + an on-demand `git log` snapshot). The
  // renderer is untrusted: it only supplies a projectId (validated against main's
  // own list, Rule 1) + a cursor. There is NO agent-facing write tool — every
  // writer is trusted host code. `refresh` re-reads `git log`; `list` doesn't.
  const feedProjectKnown = (projectId: string) =>
    typeof projectId === 'string' && store.listProjects().some((p) => p.id === projectId);
  safeHandle(
    IPC.feed.list,
    (projectId: string, opts?: { limit?: number; before?: number }) =>
      feedProjectKnown(projectId)
        ? feedService.list(projectId, { ...(opts ?? {}) })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  safeHandle(
    IPC.feed.refresh,
    (projectId: string, opts?: { limit?: number }) =>
      feedProjectKnown(projectId)
        ? feedService.list(projectId, { ...(opts ?? {}), refreshGit: true })
        : Promise.resolve({ events: [], hasMore: false }),
    () => ({ events: [], hasMore: false })
  );
  safeHandle(
    IPC.feed.digest,
    (projectId: string): Promise<FeedDigestResult> =>
      feedProjectKnown(projectId)
        ? feedSummary.summarize(projectId)
        : Promise.resolve({ ok: false, reason: 'empty' }),
    (): FeedDigestResult => ({ ok: false, reason: 'summary-failed' })
  );
  feedStore.on('changed', (projectId: string) => {
    safeSend(IPC.feed.onChanged, projectId);
  });

  safeHandle(IPC.scheduler.listTemplates, () => templates.list(), () => []);
  safeHandle(
    IPC.scheduler.revealTemplatesDir,
    () => templates.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal templates directory' })
  );
  templates.on('changed', () => {
    safeSend(IPC.scheduler.onTemplatesChanged, templates.list());
  });

  safeHandle(IPC.personas.list, () => personas.list(), () => []);
  safeHandle(
    IPC.personas.revealDir,
    () => personas.revealDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal personas directory' })
  );
  // Create / overwrite a user persona (the editor's save). Built-in ids write a
  // user shadow; an absent id mints a new slug. Validation lives in the store
  // (shared with the disk loader) — the renderer is untrusted, so a bad payload
  // comes back as a clean Result error rather than a thrown handler.
  ipcMain.handle(
    IPC.personas.save,
    async (_e, input: PersonaInput): Promise<Result<Persona>> => {
      try {
        if (!input || typeof input.name !== 'string' || !input.name.trim()) {
          return { ok: false, code: 'INVALID', message: 'name is required' };
        }
        return { ok: true, value: personas.saveUser(input) };
      } catch (err) {
        return { ok: false, code: 'PERSONA_SAVE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.personas.duplicate,
    async (_e, id: string): Promise<Result<Persona>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        return { ok: true, value: personas.duplicateUser(id) };
      } catch (err) {
        return { ok: false, code: 'PERSONA_DUPLICATE_FAILED', message: String(err) };
      }
    }
  );
  // Delete a user persona file. For a shadowed built-in this resets it to the
  // shipped default; for a user persona it removes it. Project personas are
  // read-only here (their files live under the repo, not the user dir).
  ipcMain.handle(
    IPC.personas.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        const removed = personas.deleteUser(id);
        if (!removed) {
          return { ok: false, code: 'NOT_FOUND', message: `no user persona: ${id}` };
        }
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'PERSONA_DELETE_FAILED', message: String(err) };
      }
    }
  );
  personas.on('changed', () => {
    safeSend(IPC.personas.onChanged, personas.list());
  });

  safeHandle(IPC.teams.list, () => teams.list(), () => []);
  safeHandle(
    IPC.teams.revealDir,
    () => teams.revealDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal teams directory' })
  );
  // Create / overwrite a user team. Validation lives in the store (shared with
  // the disk loader); a bad payload comes back as a clean Result error.
  ipcMain.handle(
    IPC.teams.save,
    async (_e, input: TeamInput): Promise<Result<Team>> => {
      try {
        if (!input || typeof input.name !== 'string' || !input.name.trim()) {
          return { ok: false, code: 'INVALID', message: 'name is required' };
        }
        return { ok: true, value: teams.saveUser(input) };
      } catch (err) {
        return { ok: false, code: 'TEAM_SAVE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.duplicate,
    async (_e, id: string): Promise<Result<Team>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        return { ok: true, value: teams.duplicateUser(id) };
      } catch (err) {
        return { ok: false, code: 'TEAM_DUPLICATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.delete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        if (typeof id !== 'string' || !id.trim()) {
          return { ok: false, code: 'INVALID', message: 'id is required' };
        }
        const removed = teams.deleteUser(id);
        if (!removed) {
          return { ok: false, code: 'NOT_FOUND', message: `no user team: ${id}` };
        }
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'TEAM_DELETE_FAILED', message: String(err) };
      }
    }
  );
  // Launch a team into a project. main authorizes (team + project + personaId
  // existence are all re-checked main-side); unknown persona slots are skipped.
  ipcMain.handle(
    IPC.teams.launch,
    async (
      _e,
      teamId: string,
      projectId?: string
    ): Promise<Result<LaunchTeamResult>> => {
      try {
        if (typeof teamId !== 'string' || !teamId.trim()) {
          return { ok: false, code: 'INVALID', message: 'teamId is required' };
        }
        return await launchTeam(
          teamId,
          typeof projectId === 'string' ? projectId : undefined,
          { callerPrincipalId: 'interactive:local' }
        );
      } catch (err) {
        return { ok: false, code: 'TEAM_LAUNCH_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.teams.cancel,
    async (_e, launchRequestId: string): Promise<Result<CancelTeamLaunchResult>> => {
      if (typeof launchRequestId !== 'string' || !launchRequestId.trim()) {
        return { ok: false, code: 'INVALID', message: 'launchRequestId is required' };
      }
      return cancelTeamLaunch('interactive:local', launchRequestId);
    }
  );
  // Launch a team as an autonomous run / stop one. Bodies live in the exported
  // launchAutonomousTeam / stopAutonomousRun functions (unit-tested end-to-end).
  ipcMain.handle(
    IPC.teams.launchAutonomous,
    async (_e, teamId: string, projectId: string, goal: string): Promise<Result<{ runId: string }>> =>
      launchAutonomousTeam(teamId, projectId, goal)
  );
  ipcMain.handle(
    IPC.teams.stopAutonomous,
    async (_e, runId: string): Promise<Result<true>> => stopAutonomousRun(runId)
  );
  safeHandle(IPC.autonomousRuns.list, () => autonomousRuns.list(), () => []);
  safeHandle(
    IPC.executionBoard.listProject,
    async (projectId: string) => {
      if (typeof projectId !== 'string' || !projectId.trim()) return [];
      const project = store.listProjects().find((candidate) => candidate.id === projectId);
      if (!project) return [];
      return projectExecutionProjection(await executionStore.listInProject(project.id), ptys.list(project.id)).map((execution) => ({
        ...execution,
        hasResumeToken: executionResumeTokens.status(project.id, execution.executionId).configured,
        teamName: teams.list().find((team) => team.id === execution.teamId)?.name ?? execution.teamId
      }));
    },
    () => []
  );
  // Export a team + its referenced personas as one bundle file. Main owns the
  // save dialog (Rule 1 — never a renderer-supplied path); a dismissed dialog
  // resolves `canceled: true`, not an error.
  ipcMain.handle(
    IPC.teams.exportBundle,
    async (_e, teamId: string): Promise<Result<{ path: string; canceled?: boolean }>> => {
      try {
        if (typeof teamId !== 'string' || !teamId.trim()) {
          return { ok: false, code: 'INVALID', message: 'teamId is required' };
        }
        const team = teams.list().find((t) => t.id === teamId);
        if (!team) return { ok: false, code: 'NOT_FOUND', message: `no team: ${teamId}` };
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const bundle: SquadBundle = buildSquadBundle(team, personas.list());
        const slug = team.id.replace(/[^a-zA-Z0-9._-]+/g, '_');
        const result = await dialog.showSaveDialog(win, {
          title: `Export "${team.name}" squad bundle`,
          defaultPath: `${slug}.squad.json`,
          filters: [{ name: 'Squad bundle', extensions: ['json'] }]
        });
        if (result.canceled || !result.filePath) {
          return { ok: true, value: { path: '', canceled: true } };
        }
        writeFileSync(result.filePath, JSON.stringify(bundle, null, 2));
        return { ok: true, value: { path: result.filePath } };
      } catch (err) {
        return { ok: false, code: 'BUNDLE_EXPORT_FAILED', message: String(err) };
      }
    }
  );
  // Import a bundle file picked via a main-owned open dialog: each persona is
  // written through personas.saveUser, then the team through teams.saveUser —
  // the same validation gates a hand-edited persona/team file goes through.
  ipcMain.handle(
    IPC.teams.importBundle,
    async (): Promise<Result<{ team?: Team; personaCount: number; canceled?: boolean }>> => {
      try {
        const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
        if (!win) return { ok: false, code: 'NO_WINDOW', message: 'No window to host the picker' };
        const pick = await dialog.showOpenDialog(win, {
          title: 'Import squad bundle',
          properties: ['openFile'],
          filters: [{ name: 'Squad bundle', extensions: ['json'] }]
        });
        if (pick.canceled || !pick.filePaths[0]) {
          return { ok: true, value: { personaCount: 0, canceled: true } };
        }
        let raw: unknown;
        try {
          raw = JSON.parse(readFileSync(pick.filePaths[0], 'utf8'));
        } catch (err) {
          return { ok: false, code: 'INVALID_JSON', message: `Unreadable bundle file: ${String(err)}` };
        }
        const validated = validateSquadBundle(raw);
        if ('error' in validated) {
          return { ok: false, code: 'INVALID_BUNDLE', message: validated.error };
        }
        for (const persona of validated.personas) personas.saveUser(persona);
        const savedTeam = teams.saveUser(validated.team);
        return { ok: true, value: { team: savedTeam, personaCount: validated.personas.length } };
      } catch (err) {
        return { ok: false, code: 'BUNDLE_IMPORT_FAILED', message: String(err) };
      }
    }
  );
  teams.on('changed', () => {
    safeSend(IPC.teams.onChanged, teams.list());
  });

  safeHandle(IPC.quickPrompts.list, () => quickPrompts.list(), () => []);
  // Editor write path (Agents launcher → "New / Edit quick prompt"). save
  // validates + persists a user file (shadows a builtin by id); delete removes
  // the user file (resetting a shadowed builtin to its shipped default).
  safeHandle<[QuickPrompt], QuickPrompt>(
    IPC.quickPrompts.save,
    (entry) => quickPrompts.saveUser(entry),
    // Re-throw so a write-time validation failure rejects the renderer's invoke
    // and surfaces as a UI error rather than silently reporting success.
    (err) => {
      throw err;
    }
  );
  safeHandle<[string], void>(
    IPC.quickPrompts.delete,
    (id) => quickPrompts.deleteUser(id),
    () => undefined
  );
  safeHandle(
    IPC.quickPrompts.revealDir,
    () => quickPrompts.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal quick-prompts directory' })
  );
  quickPrompts.on('changed', () => {
    safeSend(IPC.quickPrompts.onChanged, quickPrompts.list());
  });

  // LLM micro-call prompt registry (Settings → Prompts). list/save/delete back
  // the editor; test runs a prompt and returns the result.
  safeHandle(IPC.llmPrompts.list, () => promptRegistry.list(), () => []);
  safeHandle<[LlmPromptEntry], LlmPromptEntry>(
    IPC.llmPrompts.save,
    (entry) => promptRegistry.saveUser(entry),
    // Re-throw so a write-time validation failure (e.g. an unusable model)
    // rejects the renderer's invoke and surfaces as a UI error, rather than
    // silently reporting success on a rejected write.
    (err) => {
      throw err;
    }
  );
  safeHandle<[string], void>(
    IPC.llmPrompts.delete,
    (id) => promptRegistry.deleteUser(id),
    () => undefined
  );
  safeHandle<[string, Record<string, string>], LlmRunResult>(
    IPC.llmPrompts.test,
    async (id, vars) => {
      const entry = promptRegistry.get(id);
      if (!entry) {
        return {
          ok: false,
          text: '',
          error: `no prompt with id '${id}'`,
          provider: 'claude-cli',
          ms: 0
        };
      }
      return llmService.run(entry, vars ?? {});
    },
    (err) => ({
      ok: false,
      text: '',
      error: err instanceof Error ? err.message : String(err),
      provider: 'claude-cli',
      ms: 0
    })
  );
  safeHandle(
    IPC.llmPrompts.revealDir,
    () => promptRegistry.revealUserDir(),
    () => ({ ok: false, path: '', message: 'Failed to reveal llm-prompts directory' })
  );
  // Which LLM providers are usable right now (registered AND their key/binary is
  // in place). The Prompts picker offers only these so a user can't select a
  // provider that would silently return `ok:false 'no API key'`. Degrades to the
  // always-available claude-cli on any failure.
  safeHandle(
    IPC.llmPrompts.availableProviders,
    () => llmService.availableProviders(),
    () => ['claude-cli'] as LlmProviderId[]
  );
  promptRegistry.on('changed', () => {
    safeSend(IPC.llmPrompts.onChanged, promptRegistry.list());
  });

  // Voice transcription (OpenAI Whisper)
  ipcMain.handle(IPC.voice.transcribe, async (_ev, audioBase64: unknown, mimeType: unknown) => {
    if (typeof audioBase64 !== 'string' || typeof mimeType !== 'string') {
      return { ok: false, text: '', error: 'Invalid inputs', ms: 0 };
    }
    if (!mimeType.startsWith('audio/')) {
      return { ok: false, text: '', error: 'Invalid MIME type', ms: 0 };
    }
    try {
      const audio = Buffer.from(audioBase64, 'base64');
      if (audio.byteLength > 25 * 1024 * 1024) {
        return { ok: false, text: '', error: 'Audio too large (max 25 MB)', ms: 0 };
      }
      const cfg = store.getConfig();
      return await voiceService.transcribe({
        audio,
        mimeType,
        model: cfg.voiceModel || undefined,
        language: cfg.voiceLanguage || undefined
      });
    } catch (err) {
      return { ok: false, text: '', error: `Transcription failed: ${(err as Error).message}`, ms: 0 };
    }
  });

  ipcMain.handle(IPC.voice.hasApiKey, async () => {
    return (await getOpenAiKey()) != null;
  });

  // Ensure the OS-level microphone permission is granted before the renderer
  // calls getUserMedia. On macOS this surfaces the system TCC prompt the first
  // time; a prior denial resolves false so the renderer can show a recovery
  // hint instead of a silent failure. No-op (true) elsewhere.
  ipcMain.handle(IPC.voice.ensureMicAccess, async () => {
    if (process.platform !== 'darwin') return true;
    try {
      const status = systemPreferences.getMediaAccessStatus('microphone');
      if (status === 'granted') return true;
      if (status === 'denied') return false;
      return await systemPreferences.askForMediaAccess('microphone');
    } catch {
      return false;
    }
  });

  safeHandle(IPC.scheduler.groupsList, () => scheduleGroups.list(), () => []);
  ipcMain.handle(
    IPC.scheduler.groupsCreate,
    async (_e, input: ScheduleGroupInput): Promise<Result<ScheduleGroup>> => {
      try {
        return { ok: true, value: scheduleGroups.create(input) };
      } catch (err) {
        return { ok: false, code: 'GROUP_CREATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsUpdate,
    async (_e, id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>> => {
      try {
        const group = scheduleGroups.update(id, patch);
        if (!group) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: group };
      } catch (err) {
        return { ok: false, code: 'GROUP_UPDATE_FAILED', message: String(err) };
      }
    }
  );
  ipcMain.handle(
    IPC.scheduler.groupsDelete,
    async (_e, id: string): Promise<Result<true>> => {
      try {
        const ok = scheduleGroups.delete(id);
        if (!ok) return { ok: false, code: 'NOT_FOUND', message: `group not found: ${id}` };
        return { ok: true, value: true };
      } catch (err) {
        return { ok: false, code: 'GROUP_DELETE_FAILED', message: String(err) };
      }
    }
  );
  safeHandle(
    IPC.scheduler.groupsReorder,
    (orderedIds: string[]) => scheduleGroups.reorder(orderedIds),
    () => []
  );
  scheduleGroups.on('changed', (groups: ScheduleGroup[]) => {
    safeSend(IPC.scheduler.groupsOnChanged, groups);
  });

  // App-module multiplexer: one handler set serves every module (plugins/*).
  // `call` dispatches to the module's capability; `storage*` back its KV store.
  safeHandle(
    IPC.modules.call,
    (moduleId: string, capability: string, args: unknown[]) =>
      moduleRouter.dispatch(moduleId, capability, Array.isArray(args) ? args : []),
    (err) => {
      // Re-throw so the renderer's invoke() rejects with the real message,
      // which the module panel renders in its error state.
      throw err instanceof Error ? err : new Error(String(err));
    }
  );
  safeHandle(
    IPC.modules.storageGet,
    (moduleId: string, key: string) => moduleRouter.storageGet(moduleId, key),
    () => undefined
  );
  safeHandle(
    IPC.modules.storageSet,
    (moduleId: string, key: string, value: unknown) => {
      moduleRouter.storageSet(moduleId, key, value);
    },
    () => undefined
  );
  // W1-4 durable park: the renderer pulls + CLEARS every launch a main module
  // parked (on panel mount + on each `launchParked` nudge). Draining removes
  // them so a launch requested while no panel was listening is delivered on the
  // next attach, never re-delivered nor dropped. Rule 1: this returns the
  // ADVISORY spec; the renderer re-authorizes/spawns via its confined launch path.
  safeHandle(
    IPC.modules.drainParkedLaunches,
    () => hostCommandRelay.drainParked(),
    () => []
  );
  // W1-5 main-reachable host UX: the renderer replies a confirm/notify answer
  // back to main, keyed by the dialog's requestId, so the relay resolves the
  // child's pending broker Promise. Fire-and-forget from the renderer's side (it
  // doesn't await this); a late/unknown id is a harmless no-op.
  safeHandle(
    IPC.modules.replyHostDialog,
    (requestId: string, answer: unknown) => {
      hostCommandRelay.resolveDialog(String(requestId), answer);
    },
    () => undefined
  );
  // Inbox push on a module's behalf. P3-B: gate inbox:push MAIN-SIDE against the
  // permission broker, keyed by the passed moduleId. NOTE (anti-spoof): the
  // renderer passes its own moduleId as a plain arg — main gates the CLAIMED id.
  // A built-in id always passes (trusted); a disk ext is denied unless it
  // declared inbox:push. This is best-effort attribution until P3-C gives each
  // panel an authenticated origin (a panel today could claim another id). Still
  // strictly better than P3-A: a disk ext that lacks the grant cannot push.
  // Shared validation with the brokered main-process path (`inbox-broker.ts`);
  // this path passes NO `extensionSource` — its `moduleId` is only a claim,
  // never authenticated, unlike the brokered child path's port-bound id.
  safeHandle(
    IPC.modules.pushInbox,
    async (
      moduleId: string,
      msg: { projectId: string; comments?: string; docs?: Array<{ path: string }> }
    ) => {
      permissionBroker.assert(moduleId, 'inbox:push');
      return pushInboxOnBehalfOf(
        { inboxStore, projectExists: (id) => store.listProjects().some((p) => p.id === id) },
        moduleId,
        msg
      );
    },
    (err) => {
      throw err instanceof Error ? err : new Error(String(err));
    }
  );

  // E2E test-observability handlers — registered ONLY when the tap is enabled,
  // so with ZCC_E2E unset there is no `test:*` surface at all (an invoke would
  // reject "No handler registered"). Backed by the ring buffer in test-tap.ts.
  if (E2E_TAP_ENABLED) {
    ipcMain.handle(IPC.test.drainEvents, (_e, cursor: unknown) =>
      testTap.drain(typeof cursor === 'number' ? cursor : 0)
    );
    ipcMain.handle(IPC.test.snapshot, () => testTap.snapshot());
    ipcMain.handle(IPC.test.reset, () => {
      testTap.reset();
    });
    ipcMain.handle(IPC.test.mcpRoute, (_e, sessionId: unknown) => {
      if (typeof sessionId !== 'string' || !mcpServer) return null;
      const session = ptys.getSession(sessionId);
      if (!session || session.status === 'exited') return null;
      return `${mcpServer.url}/mcp/${encodeURIComponent(session.projectId)}/${encodeURIComponent(session.id)}/${controlCredentialForSession(session.id)}`;
    });
  }
}

function buildAppMenu() {
  const isMac = process.platform === 'darwin';
  const appName = 'Zana';
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: appName,
            submenu: [
              { role: 'about' as const, label: `About ${appName}` },
              { type: 'separator' as const },
              {
                label: 'Settings…',
                accelerator: 'Cmd+,',
                // Display the hint only — the renderer's capture-phase keydown
                // handler (shortcuts.ts) owns this chord. Without this, the
                // native accelerator AND the JS handler both fire on one press.
                registerAccelerator: false,
                click: () => sendToFocused('app:openSettings')
              },
              { type: 'separator' as const },
              { role: 'services' as const },
              { type: 'separator' as const },
              { role: 'hide' as const },
              { role: 'hideOthers' as const },
              { role: 'unhide' as const },
              { type: 'separator' as const },
              { role: 'quit' as const }
            ]
          }
        ] satisfies Electron.MenuItemConstructorOptions[])
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Claude Tab',
          accelerator: 'CmdOrCtrl+T',
          // Hint only; shortcuts.ts owns the keystroke (see Settings… above).
          registerAccelerator: false,
          click: () => sendToFocused('app:newClaudeTab')
        },
        {
          label: 'Reopen Closed Tab',
          accelerator: 'CmdOrCtrl+Shift+T',
          registerAccelerator: false,
          click: () => sendToFocused('app:reopenTab')
        },
        { type: 'separator' },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          registerAccelerator: false,
          click: () => sendToFocused('app:closeTab')
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Terminals / Explorer',
          accelerator: 'CmdOrCtrl+B',
          registerAccelerator: false,
          click: () => sendToFocused('app:toggleWorkspaceMode')
        },
        {
          label: 'Toggle Inbox',
          accelerator: 'CmdOrCtrl+I',
          registerAccelerator: false,
          click: () => sendToFocused('app:toggleInbox')
        },
        {
          label: 'Command Palette…',
          accelerator: 'CmdOrCtrl+P',
          registerAccelerator: false,
          click: () => sendToFocused('app:openPalette')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac
          ? ([
              { type: 'separator' as const },
              { role: 'front' as const },
              { type: 'separator' as const },
              { role: 'window' as const }
            ] satisfies Electron.MenuItemConstructorOptions[])
          : ([{ role: 'close' as const }] satisfies Electron.MenuItemConstructorOptions[]))
      ]
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Keyboard Shortcuts',
          accelerator: 'CmdOrCtrl+/',
          registerAccelerator: false,
          click: () => sendToFocused('app:openShortcuts')
        },
        { type: 'separator' },
        {
          label: 'View on GitHub',
          click: () => shell.openExternal('https://github.com/grebmann/zana-command-center')
        }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// Single-instance gate. Every instance binds the SAME fixed control socket and
// token (`~/.zcc/control.sock` / `.control.token`) and owns the SAME shared
// JSON under `~/.zcc` — so a second launch would re-bind the socket, rewrite
// the token (last-writer-wins, leaving the `zcc` CLI talking to a random
// instance), run a rival scheduler, and race writes to projects.json/inbox.
// The architecture assumes a single owner of the data dir; enforce it. A second
// launch hands its intent to the primary (focus the window) and quits before it
// can boot any of that machinery. Acquired here, before the control plane binds,
// the scheduler loads, and the first window opens.
//
// DEV EXCEPTION: when running unpackaged (`npm start` / electron-vite dev) we
// skip the gate so a dev build can run alongside the installed app — the common
// case of building/testing ZCC from *inside* the packaged ZCC. This is a
// dev-only convenience; the two instances still share `~/.zcc`, so the usual
// hazards (control-socket steal, rival scheduler, racing writes to the shared
// JSON) apply to the dev session. The shipped (packaged) build KEEPS the gate,
// so end users still get the single-owner guarantee.
if (!app.isPackaged) {
  app.whenReady().then(bootstrap);
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // A duplicate launch (Dock, Finder, `open -a`) just surfaces the existing
    // window instead of spawning a rival process.
    showMainWindow();
  });
  app.whenReady().then(bootstrap);
}

let startupState: StartupState = { mode: 'ready' };
let startupStateIpcRegistered = false;
let startupRetry: Promise<StartupState> | null = null;
let normalBootstrapStarted = false;
let e2eRepairInjected = false;

function migrationDataDir(): string {
  // Deterministic boot-path fixture. Inert unless existing E2E gate is armed;
  // one-shot behavior lets repair screen exercise real retry path.
  if (E2E_TAP_ENABLED && process.env.ZCC_E2E_STARTUP_REPAIR_ONCE === '1' && !e2eRepairInjected) {
    e2eRepairInjected = true;
    throw new MigrationRepairRequiredError('e2e-repair-once');
  }
  return join(app.getPath('home'), '.zcc');
}

function registerStartupStateIpc(): void {
  if (startupStateIpcRegistered) return;
  startupStateIpcRegistered = true;
  app.on('activate', () => {
    // Repair mode never reaches normal bootstrap, so window lifecycle belongs
    // beside startup IPC rather than normal services.
    if (!unscopedWindow()) createWindow(undefined, startupState.mode === 'repair-required');
    else showMainWindow();
  });
  ipcMain.handle(IPC.startup.state, () => startupState);
  ipcMain.handle(IPC.startup.retry, () => {
    if (startupState.mode !== 'repair-required') return startupState;
    if (!startupRetry) {
      startupRetry = runStartupMigration().finally(() => {
        startupRetry = null;
      });
    }
    return startupRetry;
  });
  ipcMain.handle(IPC.startup.diagnostics, async () => {
    if (startupState.mode !== 'repair-required') return { ok: false };
    const migrationDir = join(migrationDataDir(), 'harness-routing-migration');
    const error = await shell.openPath(existsSync(migrationDir) ? migrationDir : migrationDataDir());
    return { ok: error === '' };
  });
  ipcMain.handle(IPC.startup.quit, () => {
    if (startupState.mode === 'repair-required') app.quit();
  });
}

async function runStartupMigration(): Promise<StartupState> {
  startupState = await runStartupGate({
    migrate: () => runHarnessRoutingMigration(migrationDataDir()),
    launchNormal: bootstrapNormal,
    onRepairRequired: (state) => {
      startupState = state;
      logMainError('startup migration', 'repair required');
      if (!unscopedWindow()) createWindow(undefined, true);
      else showMainWindow();
    }
  });
  return startupState;
}

async function bootstrap() {
  registerStartupStateIpc();
  await runStartupMigration();
}

async function bootstrapNormal() {
  if (normalBootstrapStarted) return;
  normalBootstrapStarted = true;
  // Repair PATH before startup reconciliation shells out to tmux. Finder/Dock
  // launches otherwise miss Homebrew paths and silently fail to find sessions.
  ensureProcessPath();
  try {
    await launchLedger.reconcileStartup({
      consumeConsent: (reservationId) => executionConsentStore.consume(reservationId),
      // Capability-owned tmux sessions get renderer restore's bounded grace window.
      // Anything unclaimed is still removed by reapOrphanTmuxSessions below.
      reapSession: (sessionId) => restoreCapabilities.findSession(sessionId)
        ? Promise.resolve()
        : killLocalTmuxSession(sessionId)
    });
  } catch (error) {
    // A corrupt recovery record must surface the repair flow, not permanently
    // consume the one-shot bootstrap latch.
    normalBootstrapStarted = false;
    throw error;
  }
  // Arm the e2e observability tap FIRST (before registerIpc/wireBridgeListeners
  // below) so the very first main→renderer push and log is captured. No-op unless
  // ZCC_E2E was set at boot. See test-tap.ts / the E2E_TAP_ENABLED gate.
  if (E2E_TAP_ENABLED) testTap.enable();
  // The claude-cli provider was constructed at module-eval (above), before the
  // data dir was guaranteed present. Re-bind it now that the store can resolve
  // its config so a custom `claudeBinary` takes effect this session (not just
  // after the next config:set / restart).
  rebuildProviders(store.getConfig());
  // Repair PATH before any pty/opener/scheduler spawn. A GUI launch
  // (Finder/Dock) inherits a minimal PATH that omits ~/.local/bin,
  // /opt/homebrew/bin, etc. — so a bare `claude` spawn would ENOENT and
  // the tab would open already-exited. Must run before the first spawn.
  // Backfill a palette color onto any project that predates color
  // auto-assignment, so every project (and its agents) is color-marked from
  // the first render. Idempotent and cheap once all projects are colored.
  store.backfillProjectColors();
  // Materialize the scratch workspace (~/zcc-workspace) and pre-trust it in the
  // Claude CLI config on every launch (install/update included). Idempotent —
  // mkdir is recursive and the trust merge no-ops once accepted — so this just
  // guarantees the dir exists + is trusted before any scratch/Quick-Agent spawn,
  // rather than lazily on first Quick-Agent use. Best-effort: swallows failures
  // (e.g. a read-only home) so a boot never wedges on it.
  try {
    store.ensureScratchRoot();
  } catch (err) {
    logMainError('ensureScratchRoot', err);
  }
  // Apply branding before any window opens so the dock + About panel pick it up.
  app.setName('Zana');
  // Explicitly claim the Dock (a "regular" foreground app) at boot; re-asserted
  // on every window surface via `showMainWindow` so it also recovers if the
  // policy drifts to accessory mid-session (see `claimDock`).
  claimDock();
  const iconPath = resolveIconPath();
  if (process.platform === 'darwin' && iconPath && app.dock) {
    try {
      app.dock.setIcon(nativeImage.createFromPath(iconPath));
    } catch (err) {
      logMainError('dock.setIcon', err);
    }
  }
  app.setAboutPanelOptions({
    applicationName: 'Zana',
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
    copyright: '© 2026 grebmann',
    website: 'https://github.com/salesforce/zana',
    iconPath: iconPath ?? undefined
  });
  buildAppMenu();
  registerIpc();
  // Register the launcher scratch project before warmup. Otherwise Quick Agent
  // creates it only when its dialog opens, which leaves its first picker load
  // uncached despite the startup prefetch.
  try {
    store.ensureQuickAgentProject();
  } catch (err) {
    logMainError('ensureQuickAgentProject', err);
  }
  // Warm each discovery-capable registration for local projects. The launcher
  // reads the harness-owned cache; only an explicit refresh bypasses it.
  for (const registration of HARNESS_REGISTRATIONS) {
    if (!registration.discoverAgentDescriptors) continue;
    const profile = registration.defaultProfileId ?? registration.profiles[0]?.id;
    if (!profile) continue;
    for (const project of store.listProjects()) {
      if (project.remote) continue;
      void registration.discoverAgentDescriptors({
        profile,
        cwd: project.path,
        config: store.getConfig(),
        refresh: false
      });
    }
  }
  scheduler.setDeps({
    ptys,
    launchTerminal: launchBackgroundTerminal,
    store,
    inbox: inboxStore,
    logger: logMainError,
    resolvePersona: (id) => personas.list().find((p) => p.id === id)
  });
  scheduler.loadAll(store.listProjects());
  // Watch schedule dirs so a skill- or hand-authored schedule file goes live
  // without restart. Self-writes (run-history churn) are suppressed internally.
  scheduler.startWatching();
  // Goal loop: same lifetime + injection pattern as the scheduler. The evaluator
  // reuses the LLM micro-call layer (builtin:goal-evaluator) and the same
  // transcript reader idle-triage uses. `active` goals auto-resume on boot.
  goals.setDeps({
    ptys,
    launchTerminal: launchBackgroundTerminal,
    store,
    inbox: inboxStore,
    logger: logMainError,
    resolvePersona: (id) => personas.list().find((p) => p.id === id),
    readLastTurn: (ref) => transcriptSource.readLastTurn(ref),
    runEvaluator: (vars, dedupeKey) => {
      const entry = promptRegistry.get('builtin:goal-evaluator');
      if (!entry) {
        return Promise.resolve({
          ok: false,
          text: '',
          error: 'no goal-evaluator prompt',
          provider: 'claude-cli',
          ms: 0
        });
      }
      return llmService.run(
        entry,
        {
          statement: vars.statement,
          criteria: vars.criteria,
          lastTurn: vars.lastTurn,
          report: vars.report
        },
        `goal-eval:${dedupeKey}`
      );
    }
  });
  goals.loadAll(store.listProjects());
  goals.startWatching();
  // Follow-ups: same lifetime + injection pattern, minus any loop. `getSession` /
  // `resolveProjectForSession` let the idle-triage bridge attribute a parked
  // question to the right project and skip background sessions.
  followups.setDeps({
    store,
    inbox: inboxStore,
    logger: logMainError,
    getSession: (sessionId) => {
      const s = ptys.getSession(sessionId);
      return s ? { scheduled: s.scheduled, headless: s.headless } : null;
    },
    resolveProjectForSession: (sessionId) => ptys.getSession(sessionId)?.projectId,
    // Host-resolve resume coords from the live pty (Rule 1) so an agent/idle
    // follow-up carries a reopen target that survives its tab — the durable twin
    // of the inbox's `resolveOrigin`. Null for a gone/non-resumable session; the
    // follow-up is then stamped without coords and answers degrade to a fresh
    // spawn.
    resolveResume: (sessionId) => {
      const s = ptys.getSession(sessionId);
      if (!s) return null;
      return {
        claudeSessionId: s.claudeSessionId,
        profile: s.profile,
        personaId: s.personaId,
        cwd: s.cwd
      };
    },
    followupsFromIdle: () =>
      store.getConfig().followupsFromIdle ?? store.getConfig().idleTriageEnabled === true
  });
  followups.loadAll(store.listProjects());
  followups.startWatching();
  // macOS menu-bar presence for the scheduler: live schedule list, a
  // running-count badge, and show/quit controls. Reads the same scheduler +
  // pty state the window does. Non-fatal if it fails to start.
  try {
    // Frameless-card popover (macOS). Built unconditionally so a runtime flag
    // flip needs no relaunch, but the tray only routes to it when
    // `menubarPopoverEnabled()` is true; otherwise the native menu path runs.
    menubar = new MenubarController({
      ptys,
      scheduler,
      agentStatus,
      projectName: (id) => store.listProjects().find((p) => p.id === id)?.name ?? 'project',
      projectColor: (id) => store.listProjects().find((p) => p.id === id)?.color,
      isFavorite: (sessionId) => {
        const s = ptys.getSession(sessionId);
        if (!s) return false;
        return favoriteAgentKeys.has(s.claudeSessionId ?? sessionId);
      },
      // Cheap in-memory read of the cached idle-triage verdict (what a blocked
      // agent is waiting for), for the popover's light-interaction rows. No LLM/
      // fs cost on the hot snapshot path (Rule 5).
      triage: (sessionId) => lastTriageBySession.get(sessionId) ?? null,
      theme: () => resolveTheme(),
      preloadPath: join(__dirname, '../preload/index.js'),
      logger: logMainError
    });
    tray = new TrayController({
      scheduler,
      ptys,
      agentStatus,
      projectName: (id) => store.listProjects().find((p) => p.id === id)?.name ?? 'project',
      iconPath,
      showWindow: showMainWindow,
      focusSession: (sessionId, projectId) => {
        showMainWindow();
        safeSend('app:focusSession', sessionId, projectId);
      },
      openScheduler: (taskId) => safeSend('app:openScheduler', taskId),
      popover: menubar,
      popoverEnabled: menubarPopoverEnabled,
      logger: logMainError
    });
    tray.start();
  } catch (err) {
    logMainError('tray.start', err);
  }
  // Wake-from-sleep can leave many schedules well past their armed delay;
  // a re-load triggers our `arm()` drift fix so each one re-arms fresh
  // rather than firing in a stampede the moment the laptop wakes up.
  try {
    powerMonitor.on('resume', () => {
      // Sleep/wake is the documented trigger for a lost node-pty `onExit`
      // (child reaped by the OS while asleep) — reap immediately rather than
      // waiting for the next PTY_REAP_INTERVAL_MS tick or schedule fire, so a
      // long sleep can't accumulate leaked ptmx fds.
      ptys.reapDeadSessions();
      scheduler.loadAll(store.listProjects());
      // Tell the renderer the machine woke, so it can re-attach remote tabs whose
      // local `ssh` proxy died during sleep. The renderer owns tab authority
      // (mirrors the restore design), so main only fires the signal — it decides
      // WHICH tombstones to reconnect and calls terminals:reconnectRemote back.
      safeSend(IPC.terminals.onWake);
    });
  } catch (err) {
    logMainError('powerMonitor.resume', err);
  }
  templates.start();
  quickPrompts.start();
  promptRegistry.start();
  personas.start();
  teams.start();
  libraryStore.start?.();
  skillBundles.start();
  scheduleGroups.start();
  startSkillsWatchers();
  // Hot-reload watcher for ~/.zcc/extensions (Rule #3 — init once here, NOT in
  // createWindow which re-runs). Picks up installs/upgrades/removals live.
  startExtensionsWatcher();
  // Deploy every bundled SKILL.md into ~/.claude/skills so they show up in the
  // skill catalogue (zcc-center schedules/templates, saved-reports, brainstorm,
  // zcc-cli, extension-creator). Idempotent + edit-respecting + best-effort —
  // never blocks boot. Same roster the "Reload skills & MCP" button re-runs, so
  // the set lives in one place (skill-installer.ts `BUNDLED_SKILLS`).
  redeployBundledSkills(logMainError).catch((err) =>
    logMainError('redeployBundledSkills', err)
  );
  // Boot app modules. P3-A two-tier split (tier on PROVENANCE):
  //   - built-in MAIN_MODULES (zana, slack) → in-process moduleHost (trusted).
  //   - runtime DISK extensions → one `utilityProcess` each; their setup()/
  //     capabilities run in that child, NEVER in main. So untrusted disk code
  //     no longer touches the BrowserWindow / app state / sibling modules, and a
  //     crash/hang is isolated. (Residual: the child is still Node, so it can
  //     `import('node:child_process')` itself — P3-B brokers + a denylist close
  //     that. P3-A delivers process + crash isolation + a controlled RPC surface.)
  // Built-ins boot first and independently so a disk-ext failure can't touch
  // them; each child spawn is isolated so one bad ext doesn't break boot/others.
  moduleHost
    .setupAll(MAIN_MODULES)
    .catch((e) => logMainError('moduleHost.setupAll', e))
    .finally(() => {
      // Load the consent map before discovery so only CONSENTED disk exts spawn.
      readConsentMap()
        .then((m) => {
          consentMap = m;
        })
        // Reseed bundled extensions BEFORE discovery so a newer shipped version
        // (or a fresh install) is the one discovery picks up — users never stay
        // stuck on a stale ~/.zcc copy. Best-effort: never blocks boot.
        .then(() =>
          seedBundledExtensions((ctx, info) => {
            if (info instanceof Error) logMainError(ctx, info);
            else console.log(`[main] ${ctx}: ${typeof info === 'string' ? info : ''}`);
          })
        )
        // Opt-in remote-update channel: stage any newer compatible release into
        // ~/.zcc/extensions BEFORE the sync discovers + spawns it. A no-op unless
        // ~/.zcc/extension-registry.json is enabled + HTTPS (never reaches the
        // network by default). Permission-widening updates return needs-consent
        // and are NOT applied — logged for the user to approve in-app. Discovery
        // needs the installed ids; do a cheap discover-only pass first.
        .then(() => loadExtensions({ log: logMainError, reservedIds: builtinIds }))
        .then(({ entries }) =>
          maybeCheckRemoteUpdates(
            entries.map((e) => e.id),
            logMainError
          ).then((outcomes) => {
            for (const o of outcomes) {
              if (o.status === 'updated') {
                console.log(`[main] extension update: ${o.id} ${o.fromVersion ?? '∅'} → ${o.toVersion}`);
              } else if (o.status === 'needs-consent') {
                console.log(
                  `[main] extension update held (needs consent): ${o.id} → ${o.toVersion} (+${(o.addedPermissions ?? []).join(', ')})`
                );
              }
            }
          })
        )
        // Boot is just "rescan with empty prev + empty live" — runDiskSync spawns
        // every desired spec and tears down nothing, exactly as the old inline
        // block did, and now also picks up any staged remote update.
        .then(() => runDiskSync())
        .catch((err) => logMainError('loadExtensions', err));
    });
  // Boot the local MCP server, then plumb its URL into PtyManager so any
  // claude-family terminal spawns get `ZCC_MCP_URL` injected. Errors here
  // are logged but non-fatal — the app still works without inbox push.
  startMcpServer({
    // OpenCode bakes this URL into process config. Persist the selected port so
    // tmux-surviving agents reconnect to the new main process after an app restart.
    port: readMcpPort(mcpPortFile),
    inboxStore,
    suggestionsStore,
    // Suppress-while-working gate for BLOCKING inbox questions (default ON). The
    // inbox tools call `heldQuestions.maybeHold(...)` at push time; a held
    // question surfaces later on the agent's idle/blocked edge (Rule 1: the gate
    // reads the live agent-status tracker, never renderer/agent-supplied state).
    heldQuestions,
    projects: {
      get: (id: string) => store.listProjects().find((p) => p.id === id) ?? null
    },
    // A scheduled session's Stop hook pinged back — the agent finished its
    // turn. The scheduler stamps the run as finished (so the UI stops showing
    // "running"), and, for auto-close tasks, closes the pty as an *expected*
    // close so the run logs success rather than a kill-signal error. Non-
    // scheduled sessions (or any we can't match) fall back to a plain expected
    // close so nothing regresses.
    onStopHook: (_projectId: string, sessionId: string) => {
       // A lifecycle Stop is the authoritative end of an interactive turn. The
       // tracker keeps fallback behaviour for harnesses that never send one.
       agentStatus.turnFinished(sessionId);
       scheduler.onAgentFinished(sessionId);
      // A goal worker finishing its turn is the trigger to evaluate + branch
      // (achieved / re-spawn / escalate). No-op for non-goal sessions.
      void goals.onAgentFinished(sessionId);
       // A blocked overlay wins over turn completion. The next UserPromptSubmit
       // callback begins a new turn and clears it; clearing here would turn an
       // unanswered permission/question into an incorrect idle state.
      // A finished turn can have no in-flight sub-agents — reset the count so a
      // SubagentStop hook that never fired (e.g. a killed sub-agent) can't leave
      // a phantom badge on the parent.
      agentStatus.clearSubagents(sessionId);
      // A finished turn can't have a tool still in flight — reset the idle-veto
      // counter so a PostToolUse that never fired (e.g. a killed tool call)
      // can't permanently pin the session's status away from idle.
      agentStatus.clearToolsInFlight(sessionId);
    },
    // Notification/UserPromptSubmit callback → live "blocked — needs you"
    // status. The agent is waiting on the user on `blocked`, and resumed (or
    // the user answered) on `unblocked`.
    onNotifyHook: (_projectId: string, sessionId: string, action) => {
      if (action === 'blocked') agentStatus.markBlocked(sessionId);
      else agentStatus.turnStarted(sessionId);
      // Diagnostic: confirms the hook reached the main process. The emit to the
      // renderer is debounced (~250ms), so the red/grey dot is the real proof
      // the state landed — this line just proves the curl callback arrived.
      console.log(`[notify-hook] session=${sessionId.slice(0, 8)} action=${action}`);
    },
    // Overseer auto-approval callback (experimental). The agent BLOCKS on this,
    // so we parse the PreToolUse event, run the cascade, and return a verdict the
    // route serializes. cwd is resolved from the LIVE session (never the
    // agent-supplied body — rule 1). Any parse/look-up miss returns null →
    // empty reply → the agent's normal prompt (fail-open).
    onOverseerHook: async (projectId: string, sessionId: string, body: string) => {
      const session = ptys.getSession(sessionId);
      if (!session || session.status === 'exited') return null;
      let event: OverseerToolEvent;
      try {
        const raw = JSON.parse(body) as { tool_name?: unknown; tool_input?: unknown };
        if (typeof raw.tool_name !== 'string' || !raw.tool_name) return null;
        event = {
          toolName: raw.tool_name,
          toolInput:
            raw.tool_input && typeof raw.tool_input === 'object'
              ? (raw.tool_input as Record<string, unknown>)
              : {},
          cwd: session.cwd
        };
      } catch {
        return null;
      }
      const decision = await overseer.decide(event);
      // Record to the bounded audit ring and push a debounced per-session rollup
      // for the card badge / dry-run pane. The session/project ids only exist
      // here (the cascade itself is UI-agnostic), so this is the right seam.
      const entry: OverseerAuditEntry = {
        sessionId,
        projectId,
        toolName: event.toolName,
        tier: decision.tier,
        computed: decision.computed,
        verdict: decision.verdict,
        reason: decision.reason,
        at: Date.now()
      };
      overseerAudit.record(entry);
      pushOverseerActivity(sessionId);
      // Diagnostic, mirrors the notify/subagent hook lines. Shows the computed
      // verdict and what we actually acted on (they differ in dryRun).
      console.log(
        `[overseer] session=${sessionId.slice(0, 8)} tool=${event.toolName} ` +
          `tier=${decision.tier} computed=${decision.computed} acted=${decision.verdict}`
      );
      return { decision: decision.verdict, reason: decision.reason };
    },
    // Server-side fail-open guard on the whole Overseer exchange. Read from LIVE
    // config so enabling the deep "think harder" tier widens the ceiling without
    // a restart: the fast path keeps the snappy 8s bound, but when the deep tier
    // is armed we allow ~24s (the deep judge blocks the agent while it reasons).
    // MUST stay under the hook's own `curl -m` (set at spawn from the same knob),
    // so a hung server still degrades to the normal prompt rather than wedging.
    overseerDecisionTimeoutMs: () =>
      store.getConfig().overseerDeepTierEnabled === true
        ? OVERSEER_DEEP_DECISION_TIMEOUT_MS
        : OVERSEER_FAST_DECISION_TIMEOUT_MS,
    // Content Screen callback (experimental, inbound prompt-injection defense).
    // The agent BLOCKS on this, so we parse the PostToolUse event, run the
    // cascade, and return a warning the route serializes — or null (fail-open)
    // when nothing was flagged. cwd is resolved from the LIVE session (rule 1),
    // never the agent-supplied body.
    onContentScreenHook: async (_projectId: string, sessionId: string, body: string) => {
      const session = ptys.getSession(sessionId);
      if (!session || session.status === 'exited') return null;
      let event: ContentScreenEvent;
      try {
        const raw = JSON.parse(body) as { tool_name?: unknown; tool_input?: unknown; tool_response?: unknown };
        if (typeof raw.tool_name !== 'string' || !raw.tool_name) return null;
        event = {
          toolName: raw.tool_name,
          toolInput:
            raw.tool_input && typeof raw.tool_input === 'object'
              ? (raw.tool_input as Record<string, unknown>)
              : {},
          toolResponse: raw.tool_response,
          cwd: session.cwd
        };
      } catch {
        return null;
      }
      const decision = await contentScreen.decide(event);
      if (!decision.warn) return null;
      return { additionalContext: buildWarningText(event.toolName, decision.reason) };
    },
    // Server-side fail-open guard on the whole Content Screen exchange. Fixed
    // (unlike the Overseer's live-widened bound) — there is no deep tier here.
    contentScreenDecisionTimeoutMs: CONTENT_SCREEN_DECISION_TIMEOUT_MS,
    // First-prompt callback: name the tab from its first instruction. Fires
    // once per session (the hook POSTs on every prompt; fireTabNamer gates on
    // llmNamedSessions). OpenCode sessions never reach this route (no hook
    // surface) — they get the same call from createTerminalConfined instead.
    onFirstPromptHook: (_projectId: string, sessionId: string, text: string) => {
      fireTabNamer(sessionId, text);
    },
    // Sub-agent (Task tool) start/stop callback → live "N sub-agents running"
    // badge. PreToolUse(Task) increments, SubagentStop decrements; the parent's
    // Stop hook (above) resets the count as a drift guard.
    onSubagentHook: (_projectId: string, sessionId: string, action, identity) => {
      if (action === 'start') agentStatus.subagentStarted(sessionId, identity);
      else agentStatus.subagentStopped(sessionId);
      console.log(`[subagent-hook] session=${sessionId.slice(0, 8)} action=${action}`);
    },
    // Generic tool-activity callback → the idle-veto. `start`/`stop` bracket
    // every tool call (match-all PreToolUse/PostToolUse), so a quiet Bash/
    // WebSearch/etc. call keeps the session reading `working` even while
    // Claude's OSC title shows the idle glyph mid-call. `clear` is the Stop
    // hook's drift guard.
    onToolActivityHook: (_projectId: string, sessionId: string, action) => {
      if (action === 'start') agentStatus.toolStarted(sessionId);
      else if (action === 'stop') agentStatus.toolFinished(sessionId);
      else agentStatus.clearToolsInFlight(sessionId);
    },
    // Question callback (EXPERIMENTAL, opt-in). A session's `AskUserQuestion`
    // PreToolUse hook forwarded the tool-call JSON; render it in the app's own
    // Questions UI by REUSING the inbox_ask loop: parse → map to InboxQuestion[]
    // → append to the inbox for this session, so the existing
    // `inbox:onAppended` push → QuestionBlock render fires. The answer flows
    // back through the SAME replyToInboxEntry → terminals:reply → ptys.reply
    // path inbox_ask uses (the guaranteed terminal fallback stays live), so
    // there is NO new answer-injection code here. Fail-open: any miss just
    // leaves the in-terminal question as-is.
    onQuestionHook: (projectId: string, sessionId: string, rawBody: string) => {
      // Gate on the live flag — off ⇒ no-op (the hook shouldn't be armed at all
      // when disabled, but never trust the wire).
      if (store.getConfig().askUserQuestionUiEnabled !== true) return;
      const session = ptys.getSession(sessionId);
      if (!session || session.status === 'exited') return;
      let toolInput: AskUserQuestionInput | null = null;
      try {
        const raw = JSON.parse(rawBody) as { tool_input?: unknown };
        if (raw.tool_input && typeof raw.tool_input === 'object') {
          toolInput = raw.tool_input as AskUserQuestionInput;
        }
      } catch {
        return; // non-JSON body ⇒ nothing to render
      }
      const questions = mapAskUserQuestion(toolInput);
      if (questions.length === 0) return; // garbage / empty payload
      // A question always wants the user's eyes — bump a background run to loud
      // rather than dropping it into a collapsed group (mirrors inbox_ask).
      const scheduled = session.scheduled;
      const projectLabel = store.listProjects().find((p) => p.id === projectId)?.name;
      void inboxStore
        .append({
          projectId,
          projectLabel,
          questions,
          sessionId,
          scheduled,
          notify: scheduled ? 'loud' : undefined
        })
        .catch((err) => logMainError('question-hook pushInbox', err));
    },
    // A scheduled agent filed a run report via schedule_report. Attach it to
    // the matching run by sessionId (projectId is implied by the session).
    onReport: (_projectId: string, sessionId: string, summary: string, status) => {
      scheduler.attachReport(sessionId, summary, status);
      // A goal worker's run report feeds its iteration's evaluator input.
      goals.attachReport(sessionId, summary);
    },
    // Lets inbox_push stamp `scheduled` + `notify` (so the sidebar can group
    // and badge background-run entries) and drop `silent` pushes. Returns null
    // for non-scheduled sessions; a scheduled session missing a level defaults
    // to `quiet`.
    resolveScheduledLevel: (sessionId: string) => {
      const s = ptys.getSession(sessionId);
      if (!s?.scheduled) return null;
      return s.inboxLevel ?? 'quiet';
    },
    // Lets inbox_push stamp the originating agent's resume coordinates onto the
    // entry so the inbox can reopen its work after the tab is gone. Resolved
    // HERE from the live pty (main is the authority, Rule 1) — the agent never
    // supplies its own claudeSessionId/cwd. Returns null when the session is
    // unknown or isn't a resumable claude tab (a shell tab has no transcript).
    resolveOrigin: resolveInboxOrigin,
    // register_project tool: add a cloned/created dir to the project list on the
    // agent's behalf. Mirrors the IPC `projects.add` side-effects (mcp config +
    // store rebinds) and pushes `projects:onChanged` so the sidebar updates live.
    registerProject: (absPath: string) => {
      // Trust gate: register_project turns an AGENT-supplied path into a trusted
      // project root (subsequent fs.create/rename/delete confine to it). Without
      // a gate, a running agent could register `/etc`, `/`, or any readable dir
      // as a project. Confine the realpath'd target to a legitimate base — under
      // HOME, under the configured cloneRoot, or inside an already-registered
      // project's tree (a freshly-cloned subdir). Anything else is rejected.
      const isWithin = (child: string, parent: string): boolean => {
        const c = resolve(child);
        const p = resolve(parent);
        return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep);
      };
      let realTarget: string;
      try {
        realTarget = realpathSync(absPath);
      } catch {
        throw new Error(`register_project rejected: path does not exist (${absPath})`);
      }
      const allowedBases = [homedir(), store.getConfig().cloneRoot?.trim() || '']
        .filter((b): b is string => !!b)
        .concat(store.listProjects().map((p) => p.path));
      const allowed = allowedBases.some((base) => {
        try {
          return isWithin(realTarget, realpathSync(base));
        } catch {
          return false;
        }
      });
      if (!allowed) {
        throw new Error(
          `register_project rejected: ${absPath} is outside HOME, the clone root, and all known projects`
        );
      }
      const existed = store.listProjects().some((p) => p.path === absPath);
      const project = store.addProject(absPath); // throws on a bad path → tool reports isError
      if (!existed) {
        ensureMcpConfigForProject(project.id).catch((err) =>
          logMainError(`ensureMcpConfigForProject(${project.id})`, err)
        );
        templates.rebindProjects();
        personas.rebindProjects();
        teams.rebindProjects();
        libraryStore.rebindProjects?.();
        scheduler.rebindWatchers();
      }
      safeSend(IPC.projects.onChanged, store.listProjects());
      return { project, alreadyExisted: existed };
    },
    cloneProject: cloneAndRegisterProject,
    // create_local_extension tool: scaffold a brand-new local extension on the
    // agent's behalf. Identity-free like register_project above — reuses the
    // exact same flow the "Create extension" dialog runs (createLocalExtension,
    // hoisted to module scope so both the IPC handler and this tool call it).
    createLocalExtension: (req: { name: string; description?: string; kind?: string }) =>
      createLocalExtension(req),
    // Agent-mesh discovery (Phase 0): expose register_agent / list_agents /
    // find_agent on the session-scoped route. cwd + live status are resolved
    // server-side from the live pty / status tracker, never trusted from the
    // agent.
    agentRegistry,
    getSessionCwd: (sessionId: string) => ptys.getSession(sessionId)?.cwd,
    getAgentStatus: (sessionId: string) => agentStatus.get(sessionId),
    getTeamLaunchId: (sessionId: string) => teamLaunchSessions.get(sessionId),
    // Phase 1 messaging: agent_send audits to the message log (never the user
    // inbox) and injects into the target pty via reply() when it's idle.
    agentMessageLog,
    injectToSession: (sessionId: string, text: string) => ptys.reply(sessionId, text),
    // close_session / close_session_with_summary: let an agent end its own
    // session. Gated on the opt-in `agentSelfCloseEnabled` flag, read here at
    // boot: when off we pass `undefined`, so the tools are never registered and
    // the agent doesn't see them at all (preferable to a present-but-failing
    // tool). Toggling the flag takes effect on the next app launch. Same close
    // primitive as the control plane / IPC; the session-scoped MCP route
    // guarantees an agent can only ever close ITSELF, never a sibling.
    closeSession: store.getConfig().agentSelfCloseEnabled
      ? (sessionId: string) => {
          if (!ptys.getSession(sessionId)) return false;
          ptys.close(sessionId);
          return true;
        }
      : undefined,
    // install_local_extension: let the Extension Creator agent pack + install
    // its OWN local extension. WHICH extension is re-derived from the live
    // pty's cwd against `local.json` (findLocalRecordByCwd) — never from
    // anything the agent supplies (Rule 1/2). Mirrors
    // IPC.extensions.reinstallLocal's pipeline exactly (same ID_MISMATCH
    // sanity check, same pack → installFromDir → runDiskSync sequence), so
    // there's no new install logic here, only a new trigger.
    installOwnExtension: async (sessionId: string) => {
      const cwd = ptys.getSession(sessionId)?.cwd;
      if (!cwd) {
        return { ok: false, code: 'NO_SESSION', message: 'Unknown or dead session' } as const;
      }
      const found = await findLocalRecordByCwd(cwd);
      if (!found) {
        return {
          ok: false,
          code: 'NOT_LOCAL',
          message: 'This working directory is not a registered local extension'
        } as const;
      }
      const { id, record } = found;
      const declaredId = await readWorkingDirId(record.workingDir);
      if (declaredId !== id) {
        return {
          ok: false,
          code: 'ID_MISMATCH',
          message: `Source manifest id "${declaredId ?? '(none)'}" does not match "${id}"`
        } as const;
      }
      return packAndInstallLocal(id, record.workingDir);
    },
    // complete_autonomous_run: an autonomous-team orchestrator declares the goal
    // met. Always wired (independent of agentSelfCloseEnabled — autonomous runs
    // own their own completion). The supervisor rejects the call unless the
    // caller is the orchestrator of a running run, so the tool is harmless for
    // any other session that somehow invokes it.
    completeAutonomousRun: (orchestratorSessionId: string, summary: string) =>
      autonomousRuns.complete(orchestratorSessionId, summary) !== null,
    // close_idle_agents: let an agent close its OTHER idle peers. Gated on the
    // opt-in `closeIdlePeersEnabled` flag, read at boot (toggling takes effect on
    // the next launch). When off both deps are undefined, so the tool isn't
    // registered. `findIdleAgents` is the main-authoritative idle resolver: only
    // live, non-shell sessions whose live agent-state is neither working nor
    // blocked (the board's Idle-lane predicate), grouped by project, with the
    // caller always excluded — an agent can never close itself this way (that's
    // close_session). `allProjects` widens past the caller's own project. The
    // close itself reuses the same CloseSummaryService.summarizeAndClose the
    // board / CLI use, which re-confines every id to its project before killing.
    findIdleAgents: store.getConfig().closeIdlePeersEnabled
      ? ({ callerSessionId, callerProjectId, allProjects }) => {
          const projectIds = allProjects
            ? store.listProjects().map((p) => p.id)
            : [callerProjectId];
          const byProject = new Map<string, string[]>();
          for (const pid of projectIds) {
            const idle = ptys
              .list(pid)
              .filter((s) => s.id !== callerSessionId && s.profile !== 'shell')
              .filter((s) => {
                const state = agentStatus.get(s.id);
                if (state === 'working' || state === 'blocked') return false;
                // A parent with live sub-agents (Task spawns) only LOOKS at-rest
                // — it's parked awaiting work it dispatched. Closing it would
                // orphan the children, so it is NOT idle. (Mirrors the board's
                // Delegating lane; CLAUDE.md #1 — main decides, not the agent.)
                return agentStatus.subagents(s.id) === 0;
              })
              .map((s) => s.id);
            if (idle.length > 0) byProject.set(pid, idle);
          }
          return byProject;
        }
      : undefined,
    summarizeAndCloseProject: store.getConfig().closeIdlePeersEnabled
      ? (projectId, sessionIds, o) => closeSummary.summarizeAndClose(projectId, sessionIds, o)
      : undefined,
    // Persona discovery (list_personas) — same projection the control plane
    // serves. Read-only metadata; lets an agent see the roles it could spawn as
    // (the spawn action itself stays operator-only in v1).
    listPersonas: () => personas.list().map(toPersonaSummary),
    // Team discovery (list_teams) — read-only metadata; lets an agent enumerate
    // the launchable teams the app surfaces.
    listTeams: () => teams.list().map(toTeamSummary),
    // Team launch (launch_team) — the agent-driven counterpart of the Teams
    // panel's Launch button. Gated behind the off-by-default `teamLaunchEnabled`
    // flag, read at boot (toggling takes effect on next launch), mirroring the
    // `closeIdlePeersEnabled` pattern. main authorizes the whole launch.
    launchTeam: store.getConfig().teamLaunchEnabled ? launchTeam : undefined,
    authorizeTeamLaunch: store.getConfig().teamLaunchEnabled ? authorizeTeamLaunch : undefined,
    cancelTeamLaunch: store.getConfig().teamLaunchEnabled ? cancelTeamLaunch : undefined,
    getTeamLaunch: store.getConfig().teamLaunchEnabled ? getTeamLaunch : undefined,
    reportTeamTask: store.getConfig().teamLaunchEnabled ? reportTeamTask : undefined,
    executionService: store.getConfig().teamLaunchEnabled ? squadExecutionService : undefined,
    executionHandoffs: store.getConfig().teamLaunchEnabled ? executionHandoffs : undefined,
    validateExecutionHandoffTarget: store.getConfig().teamLaunchEnabled
      ? (sourceSessionId, targetSessionId, projectId) => {
          const source = ptys.getSession(sourceSessionId);
          const target = ptys.getSession(targetSessionId);
          return !!source && source.status !== 'exited' && source.projectId === projectId
            && !!target && target.status !== 'exited' && target.projectId === projectId;
        }
      : undefined,
    approveExecutionHandoff: store.getConfig().teamLaunchEnabled
      ? async (sourceSessionId, targetSessionId, projectId, executionId, operation) => {
          const source = ptys.getSession(sourceSessionId);
          const target = ptys.getSession(targetSessionId);
          if (!source || source.status === 'exited' || source.projectId !== projectId
            || !target || target.status === 'exited' || target.projectId !== projectId) return false;
          const options: MessageBoxOptions = {
            type: 'warning',
            buttons: ['Approve once', 'Deny'],
            defaultId: 1,
            cancelId: 1,
            title: operation === 'execution.resume-monitor' ? 'Approve execution resume monitoring' : 'Approve execution handoff',
            message: operation === 'execution.resume-monitor'
              ? `Allow ${target.title} to resume execution ${executionId} for ${source.title}, then monitor status and events?`
              : `Allow ${source.title} to hand off one control action for execution ${executionId} to ${target.title}?`,
            detail: operation === 'execution.resume-monitor'
              ? 'Approval grants one resume action and read-only status/event monitoring for 10 minutes. A new 10-minute window needs new human approval.'
              : 'Approval grants one short-lived action only. The target agent must still be live in this project.'
          };
          const window = anyWindow();
          const result = window ? await dialog.showMessageBox(window, options) : await dialog.showMessageBox(options);
          return result.response === 0;
        }
      : undefined,
    validateTeamRouteIdentity: store.getConfig().teamLaunchEnabled
      ? (sessionId, projectId) => {
          const session = ptys.getSession(sessionId);
          return !!session && session.status !== 'exited' && session.projectId === projectId;
        }
      : undefined,
    // Project discovery (list_projects) — the read counterpart to
    // register_project. Read-only metadata; lets an agent enumerate the user's
    // projects (resolve a name to an id, tell remote from local) over MCP.
    listProjects: () => store.listProjects().map(toProjectSummary),
    // remote_exec — run a shell command on a registered remote (SSH) project.
    // The agent supplies a projectId (a reference) + command; we resolve the
    // ProjectRemote from the STORE (never agent-supplied host/creds — rule 1)
    // and the realpath'd remote root, then confine the command's start dir under
    // it (rule 2). A non-remote / unknown id fails cleanly. Not pre-approved in
    // pty.ts except on autonomous runs, so first use raises a permission prompt.
    runRemoteCommand: (projectId, command, execOpts) =>
      resolveAndExecRemote(
        {
          findRemote: (id) => store.listProjects().find((p) => p.id === id)?.remote ?? null,
          defaultPath: store.getConfig().remoteDefaultPath,
          resolveRoot: fsRemoteRoot,
          exec: fsExecRemote
        },
        projectId,
        command,
        execOpts
      ),
    // microvm_exec / microvm_reset — run a shell command inside a project's
    // SANDBOXED microVM playground. The agent supplies a projectId (the guest
    // key) + command; the host-owned `microVmPool` authorizes the image (closed
    // allowlist, no "*"), lazily boots + reuses a per-project guest with NO host
    // mount, and confines execution to a VM (rule 1/7). Fails closed (disabled /
    // unsupported platform / SDK-absent / boot failure) as `{ok:false,message}`,
    // never a crash. Always wired: the pool itself gates on the config flag +
    // platform, so an off/unsupported app simply returns an honest failure rather
    // than the tool vanishing mid-session. Not pre-approved in pty.ts except on
    // autonomous runs.
    runMicrovmCommand: (projectId, command, execOpts) =>
      microVmPool.exec(projectId, command, execOpts),
    resetMicrovm: (projectId) => microVmPool.reset(projectId),
    // Library access (library_write/read/list/remove) — let an agent keep
    // durable docs in its OWN project's .zcc/library. The store realpath-confines
    // every path and host-stamps source:{kind:'agent'}; the route locks the
    // scope to the originating project. Always wired (no flag) — it's a
    // project-confined, non-destructive-by-default capability.
    libraryAgentApi: {
      agentList: (projectId) => libraryStore.agentList(projectId),
      agentRead: (projectId, relPath) => libraryStore.agentRead(projectId, relPath),
      agentWrite: (projectId, sessionId, input) =>
        libraryStore.agentWrite(projectId, sessionId, input),
      agentRemove: (projectId, relPath) => libraryStore.agentRemove(projectId, relPath)
    },
    // goal_* tools: let an agent create/list persistent Goals in its OWN project.
    // The route's projectId is authoritative — agentCreate stamps it onto the
    // input and forces scope to the project, so an agent can't target another
    // project or the global dir. agentList filters the manager's flat list down
    // to the route's project.
    goalAgentApi: {
      agentList: (projectId) => goals.list().filter((g) => g.projectId === projectId),
      agentCreate: (projectId, input) =>
        goals.create({ ...input, projectId, scope: { projectId } })
    },
    // followup_* tools: an agent files/lists/resolves Follow-ups in its OWN
    // project. Same trust model as goalAgentApi — the route's projectId is
    // authoritative. agentSetStatus is project-locked: it verifies the target
    // follow-up belongs to projectId before mutating (Rule 1).
    followupAgentApi: {
      agentList: (projectId) => followups.list().filter((f) => f.projectId === projectId),
      agentCreate: (projectId, input) =>
        followups.create({ ...input, projectId, scope: { projectId } }),
      agentSetStatus: (projectId, id, status, resolution) => {
        const target = followups.list().find((f) => f.id === id);
        if (!target || target.projectId !== projectId) return null;
        return followups.setStatus(id, status, resolution);
      }
    }
  })
    .then(async (handle) => {
      mcpServer = handle;
      writeMcpPort(mcpPortFile, handle.port);
      ptys.setMcpBaseUrl(handle.url);
      // Backfill .mcp.json for any project that doesn't already have one
      // (idempotent — safe to re-run on every boot).
      for (const project of store.listProjects()) {
        try {
          await ensureMcpConfigForProject(project.id);
        } catch (err) {
          logMainError(`ensureMcpConfigForProject(${project.id})`, err);
        }
      }
    })
    .catch((err) => logMainError('startMcpServer', err));
  // Bind the PTY/agent-status → renderer bridge ONCE for the process lifetime,
  // before the first window. Must not live in createWindow() (re-entrant on
  // macOS reactivate) or every reopen would double-send PTY output.
  wireBridgeListeners();
  // Retention sweep for the in-memory agent↔agent log. Armed once at init (never
  // in createWindow, per CLAUDE.md #3), cleared in before-quit. prune() emits
  // 'pruned' → onMessagesPruned push, so the renderer drops evicted rows live.
  agentMessagePruneTimer = setInterval(() => {
    agentMessageLog.prune(AGENT_MESSAGE_MAX_AGE_MS);
  }, AGENT_MESSAGE_PRUNE_INTERVAL_MS);
  // Independent pty-zombie reap sweep — see PTY_REAP_INTERVAL_MS. Armed once
  // at init (never in createWindow, per CLAUDE.md #3), cleared in before-quit.
  ptyReapTimer = setInterval(() => {
    ptys.reapDeadSessions();
  }, PTY_REAP_INTERVAL_MS);
  // One process-lifetime sweep bounds abandoned history snapshots even when no
  // renderer polls again. Window close/reload releases eagerly; this is fallback.
  conversationHistoryEvictTimer = setInterval(() => conversationHistory.evict(), 60_000);
  // Allow media (microphone) access for voice-to-text; deny all other
  // permission requests. Installed once at init (not in createWindow).
  // getUserMedia consults BOTH the request handler (interactive grant) and the
  // synchronous check handler — without the latter, Chromium can silently deny
  // the mic even after entitlements are in place.
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => permission === 'media');
  if (!unscopedWindow()) createWindow();
  // tmux orphan reaper (Phase 2): when persistence covers local sessions, kill `cc-*` tmux
  // servers left over from a previous run that no live pty is bound to. Runs
  // ONCE on boot, after a grace delay so the renderer's session-restore can
  // re-spawn its tabs first (each re-attaches via `tmux new-session -A`, making
  // it live and thus NOT an orphan). Liveness is the main process's own pty map
  // (ptys.getSession) — authoritative, unlike the restore snapshot which lives
  // in renderer localStorage and isn't readable here. Team lifecycle startup
  // reconciliation always runs; local tmux reaping runs only for scope `all`.
  teamLifecycleReconcileTimer = setTimeout(() => {
    teamLifecycleReconcileTimer = null;
    void (async () => {
      if (store.getConfig().tmuxScope === 'all') {
        const reaped = await reapOrphanTmuxSessions((sessionId) => ptys.getSession(sessionId) !== null);
        for (const sessionId of reaped) restoreCapabilities.removeSession(sessionId);
        if (reaped.length > 0) {
          console.log(`[tmux] reaped ${reaped.length} orphan session(s): ${reaped.join(', ')}`);
        }
      }
      const recovered = new Set(
        ptys.listAll().filter((session) => session.status !== 'exited').map((session) => session.id)
      );
      await teamLifecycleIntegration.reconcileStartup([...recovered]);
    })().catch((err) => logMainError('teamLifecycle.reconcileStartup', err));
  }, store.getConfig().tmuxScope === 'off' ? 0 : TMUX_REAP_GRACE_MS);
  // Auto-update: build the updater (a no-op shim in dev), kick one check on
  // boot, and arm the periodic background poll (every 30 min, cleared in
  // before-quit per CLAUDE.md #3). Notify-only — nothing downloads until the
  // user opts in; the renderer surfaces status via IPC.updates.onStatus. A
  // newer version also lands in the inbox once (deduped) so the user sees it
  // even with Settings closed. Best-effort — a failed check never blocks boot.
  // Surface a freshly-discovered update to the inbox exactly once per version,
  // so a 30-min poll that re-finds the same release doesn't re-notify. We tap
  // the same status stream the renderer consumes by wrapping the updater's
  // `safeSend` — no second event channel to keep in sync.
  let lastInboxedUpdateVersion: string | undefined;
  const updaterSend = (channel: string, ...args: unknown[]) => {
    if (channel === IPC.updates.onStatus) {
      const status = args[0] as UpdateStatus | undefined;
      if (
        status?.kind === 'available' &&
        status.version &&
        status.version !== lastInboxedUpdateVersion
      ) {
        const anchor = store.listProjects()[0];
        // Only mark the version done once an entry is actually appended.
        // Marking it before the anchor check would, when no project exists yet,
        // suppress the notice forever for this version even after the user adds
        // a project — so a later poll could still deliver it.
        if (anchor) {
          lastInboxedUpdateVersion = status.version;
          void inboxStore
            .append({
              projectId: anchor.id,
              projectLabel: anchor.name,
              subject: `Update available — v${status.version}`,
              comments:
                `**Update available — v${status.version}**\n\n` +
                'A newer version of Zana Command Center is ready. Open **Settings → About** ' +
                'to install it now or have it apply on your next restart.'
            })
            .catch((err) => logMainError('updater inbox notify', err));
        }
      }
    }
    safeSend(channel, ...args);
  };
  updater = createUpdater({
    safeSend: updaterSend,
    log: logMainError,
    getSkippedVersion: () => store.getConfig().skippedUpdateVersion,
    setSkippedVersion: (version) => {
      store.setConfig({ skippedUpdateVersion: version });
    },
    // Arm the simulate() affordance at the updater level. The LIVE gate is the
    // `enableUpdateSimulation` config re-checked in the `updates:simulate` IPC
    // handler (Rule 1 — main authorizes, and the flag can toggle at runtime);
    // this just lets an armed IPC call through.
    allowSimulation: true
  });
  updater.checkForUpdates({ manual: false }).catch((err) => logMainError('updater.checkForUpdates', err));
  updater.start();

  // "What's New" on first launch after an update. Compare the persisted
  // lastSeenVersion against the running version (main owns both — Rule 1; the
  // renderer never decides which notes to show). If we've advanced, STASH a
  // pending (lastSeen, current] window; the renderer pulls it via
  // `consumeWhatsNew` on mount, which is what advances the baseline — so a
  // late-attaching listener can't miss it and it fires exactly once. A
  // first-ever launch (no baseline) writes the baseline silently and stashes
  // nothing — a fresh install shouldn't be interrupted by a modal.
  try {
    const currentVersion = app.getVersion();
    const lastSeen = store.getConfig().lastSeenVersion ?? null;
    if (!lastSeen) {
      store.setConfig({ lastSeenVersion: currentVersion });
    } else if (compareVersions(currentVersion, lastSeen) > 0) {
      pendingWhatsNew = { fromVersion: lastSeen, toVersion: currentVersion };
    }
  } catch (err) {
    logMainError('whats-new boot check', err);
  }

  // First-run dependency doctor: detect the companion CLIs / MCP / plugins /
  // extensions the installer normally sets up, and surface anything missing so
  // the user can auto-install (or copy the manual command) from the in-app
  // setup checklist. The renderer subscribes via IPC.deps.onStatus and decides
  // whether to auto-open the checklist (only when something is missing AND the
  // user hasn't dismissed it — gated on AppConfig.setupDismissed in the store
  // init, mirroring the walkthrough). Best-effort — a failed check never blocks
  // boot. The check runs once here; the periodic poll lives in the updater, not
  // here, since dependency state only changes on explicit user action.
  doctor = createDoctor({
    safeSend,
    log: logMainError,
    setDismissed: (dismissed) => {
      store.setConfig({ setupDismissed: dismissed });
    }
  });
  doctor
    .check()
    .catch((err) => logMainError('dependencyDoctor.check', err));
  // Boot the CLI control plane (UDS at ~/.zcc/control.sock). Errors are logged
  // but non-fatal — the GUI works without the CLI. Started once here (CLAUDE.md
  // #3), torn down in before-quit. All op handlers reuse main's existing
  // authority: createTerminalConfined for path confinement, the scheduler/store
  // APIs the IPC handlers use, and the agent registry/message log the mesh uses.
  startControlPlane({
    socketPath: join(homedir(), '.zcc', 'control.sock'),
    tokenPath: join(homedir(), '.zcc', 'control.token'),
    log: (m) => console.log(m),
    listProjects: () =>
      store.listProjects().map((p) => ({ id: p.id, name: p.name, tag: p.tag, path: p.path })),
    listTerminals: (projectId?: string) =>
      projectId
        ? ptys.list(projectId)
        : store.listProjects().flatMap((p) => ptys.list(p.id)),
    createTerminal: (req, caller) => {
      const owner = caller.class === 'orchestrator' && caller.sessionId
        ? ptys.getSession(caller.sessionId)
        : null;
      return launchAuthorizedTerminal({
        ...req,
        ...(owner?.cohort ? {
          cohort: {
            ...owner.cohort,
            role: 'worker' as const,
            slotId: `orchestrator-child:${randomUUID()}`
          }
        } : {})
      }, {
        kind: 'automation',
        id: owner ? `control-plane:orchestrator:${owner.id}` : 'control-plane:operator'
      });
    },
    closeTerminal: (sessionId) => {
      if (!ptys.getSession(sessionId)) return false;
      ptys.close(sessionId);
      return true;
    },
    // `term close-summary`: summarize the sessions' work to the inbox, then
    // close them. Reuses the SAME CloseSummaryService the Agents-board
    // Close-idle action uses — one summarize-then-close path for every surface.
    summarizeAndCloseTerminals: (projectId, sessionIds, summarize) =>
      closeSummary.summarizeAndClose(projectId, sessionIds, { summarize }),
    replyTerminal: (sessionId, text) => ptys.reply(sessionId, text),
    getAgentStatus: (sessionId) => agentStatus.get(sessionId),
    isLiveSession: (sessionId) => ptys.getSession(sessionId) !== null,
    // App-attested orchestrator gate: a session is promoted past agent-class
    // only when MAIN stamped it as its cohort's orchestrator at launch. The
    // stamp lives on the live session record (host-set, never self-declared),
    // so it's authoritative while the session lives and gone when it exits.
    isOrchestratorSession: (sessionId) =>
      ptys.getSession(sessionId)?.cohort?.role === 'orchestrator',
    verifySessionCredential: verifySessionControlCredential,
    authorizeOrchestratorMutation: (sessionId, op, args) => {
      const orchestrator = ptys.getSession(sessionId);
      if (!orchestrator || orchestrator.cohort?.role !== 'orchestrator') {
        return { ok: false, reason: 'orchestrator session is not live' };
      }
      if (op === 'term.create') {
        return args.projectId === orchestrator.projectId
          ? { ok: true }
          : { ok: false, reason: 'orchestrator may launch only in its cohort project' };
      }
      const requestedIds = op === 'term.close'
        ? [args.sessionId]
        : Array.isArray(args.sessionIds) ? args.sessionIds : [];
      const closable = requestedIds.every((id) => {
        if (typeof id !== 'string' || id === sessionId) return false;
        const target = ptys.getSession(id);
        return target?.projectId === orchestrator.projectId
          && target.cohort?.cohortId === orchestrator.cohort?.cohortId;
      });
      if (op === 'term.close-summary' && args.projectId !== orchestrator.projectId) {
        return { ok: false, reason: 'orchestrator may summarize only its cohort project' };
      }
      return closable
        ? { ok: true }
        : { ok: false, reason: 'orchestrator may close only sessions in its cohort' };
    },
    confirmOperatorMutation: async (op) => {
      const parent = BrowserWindow.getFocusedWindow() ?? undefined;
      const options = {
        type: 'warning' as const,
        title: 'Allow ZCC CLI action?',
        message: `A local process requested privileged control action "${op}".`,
        detail: 'Approve only if you initiated this action from a trusted operator shell.',
        buttons: ['Allow once', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        noLink: true
      };
      const answer = parent && !parent.isDestroyed()
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options);
      return answer.response === 0;
    },
    listAgents: () => agentRegistry.list(),
    // Persona catalogue → non-sensitive metadata (id/name/description/profile/
    // model). Read-only; lets the CLI resolve `--persona <name>` against the
    // SAME live set the app uses (built-ins included), which the file-based
    // reader can't see.
    listPersonas: () => personas.list().map(toPersonaSummary),
    // Team catalogue → non-sensitive metadata; the `team.list` control-plane op.
    listTeams: () => teams.list().map(toTeamSummary),
    // Mirror the agent_send MCP tool: resolve handle (any project) → session id,
    // inject if the target is idle/done, always audit to the message log.
    sendToAgent: (to, message) => {
      let target = agentRegistry.find({ handle: to })[0] ?? agentRegistry.get(to);
      if (!target) return { ok: false, error: `no agent found for "${to}"` };
      const state = agentStatus.get(target.sessionId);
      const injectable = state === 'idle' || state === 'done';
      const delivered = injectable
        ? ptys.reply(target.sessionId, `[message from operator] ${message}`)
        : false;
      const targetLabel = agentLabel(target);
      const msg = agentMessageLog.append({
        fromSessionId: 'cli:operator',
        fromHandle: 'operator',
        toSessionId: target.sessionId,
        toHandle: targetLabel,
        projectId: target.projectId,
        body: message,
        deliveredAt: delivered ? Date.now() : undefined
      });
      return { ok: true, delivered, handle: targetLabel, id: msg.id };
    },
    listSchedules: () => scheduler.list(),
    runScheduleNow: (id) => {
      try {
        return { ok: true, value: scheduler.runNow(id) };
      } catch (err) {
        return { ok: false, code: 'RUN_FAILED', message: String(err) };
      }
    },
    setScheduleEnabled: (id, enabled) => {
      try {
        const task = scheduler.setEnabled(id, enabled);
        if (!task) return { ok: false, code: 'NOT_FOUND', message: `schedule not found: ${id}` };
        return { ok: true, value: task };
      } catch (err) {
        return { ok: false, code: 'SET_ENABLED_FAILED', message: String(err) };
      }
    }
  })
    .then((handle) => {
      controlPlane = handle;
    })
    .catch((err) => logMainError('startControlPlane', err));
  app.on('activate', () => {
    // Dock-reactivate must restore the full shell. Recreate it when no UNSCOPED
    // window is live — not merely when zero windows exist — so a user who closed
    // the main window but left a scoped project window open can still get back.
    if (!unscopedWindow()) createWindow();
    else showMainWindow();
  });
  // Loud-tier dock badge reset (Rule 3: registered ONCE here, never per
  // createWindow). Any window regaining focus means the user is back, so the
  // "loud entries missed while away" counter clears uniformly regardless of
  // which window they returned to.
  app.on('browser-window-focus', clearLoudBadge);
}

app.on('window-all-closed', () => {
  // On macOS the app stays alive after the last window closes (standard
  // behavior), so we must NOT kill the ptys here — background sessions are
  // meant to keep running. Teardown happens in `before-quit`. On other
  // platforms closing the last window quits, which routes through
  // before-quit and its confirmation below.
  if (process.platform !== 'darwin') app.quit();
});

// Set once the user has confirmed (or there was nothing to confirm) so the
// teardown path runs exactly once and re-entrant before-quit events don't
// re-prompt.
let quitConfirmed = false;

app.on('before-quit', (event) => {
  // Guard the user's running work: if any ptys are still alive, make quitting
  // a deliberate choice instead of silently killing in-flight agents and
  // background sessions (the previous behavior). Sessions aren't persisted, so
  // quitting really does end them.
  //
  // Auto-update interaction: a downloaded update installs on quit
  // (`autoInstallOnAppQuit`). Squirrel's quit hook runs *after* this handler, so
  // preventing the quit here (user clicks Cancel on the live-sessions prompt)
  // also cancels the install — the update simply applies on the next real quit.
  if (!quitConfirmed) {
    const live = ptys.liveCount();
    // The guard is opt-out: a user who churns through many short-lived sessions
    // can silence the prompt via `confirmQuitOnLiveSessions: false` (Settings),
    // in which case we quit immediately and just tear the live sessions down.
    const confirmOnLive = store.getConfig().confirmQuitOnLiveSessions !== false;
    if (live > 0 && confirmOnLive) {
      const opts = {
        type: 'warning' as const,
        buttons: ['Quit', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
        message: `Quit and end ${live} running session${live > 1 ? 's' : ''}?`,
        detail:
          'Terminals (including background ones) are not saved between launches. Quitting will terminate them.'
      };
      const parent = mainWindow();
      const choice = parent
        ? dialog.showMessageBoxSync(parent, opts)
        : dialog.showMessageBoxSync(opts);
      if (choice === 1) {
        event.preventDefault();
        return;
      }
    }
    quitConfirmed = true;
  }
  // Quit can bypass a usable per-window close transition. Clear native maximize
  // state here too, so macOS cannot restore a maximized window on next launch.
  for (const controller of boundsControllers.values()) controller.flushForClose();
  scheduler.stopWatching();
  scheduler.stopAll();
  goals.stopWatching();
  goals.stopAll();
  followups.stopWatching();
  updater?.stop();
  tray?.stop();
  tray = null;
  menubar?.stop();
  menubar = null;
  templates.stop();
  quickPrompts.stop();
  promptRegistry.stop();
  personas.stop();
  teams.stop();
  libraryStore.stop?.();
  skillBundles.stop();
  scheduleGroups.stop();
  stopSkillsWatchers();
  stopExtensionsWatcher();
  localExtensionWatcher.shutdown();
  // Kill every out-of-process extension child (P3-A). Electron also reaps a
  // utilityProcess on app quit, but tear down explicitly so teardown() runs and
  // no orphan lingers if quit is slow. Fire-and-forget — quitting won't block.
  void extProcessHost.teardownAll();
  // Tear down the in-process BUILT-IN modules too (Finding B): otherwise a
  // built-in's timers (e.g. slack's poll-loop setInterval) and in-flight
  // fetches keep running until the OS reaps the process. Same fire-and-forget
  // shape as the disk-ext teardown above — don't block quit on it.
  void moduleHost.teardownAll();
  // Kill every host-managed MCP server child (Rule 3): the pool holds persistent
  // stdio children that would otherwise hold a workspace lock past quit.
  mcpPool.disposeAll();
  // Kill every live microVM playground guest (Rule 3): the pool holds persistent
  // libkrun VMs that must be stopped so they don't outlive quit.
  microVmPool.disposeAll();
  // Tear down every live stream subscription (Rule 3): the relay holds persistent
  // SSE/socket connections that would otherwise outlive quit.
  streamRelay.disposeAll();
  if (agentMessagePruneTimer) {
    clearInterval(agentMessagePruneTimer);
    agentMessagePruneTimer = null;
  }
  if (teamLifecycleReconcileTimer) {
    clearTimeout(teamLifecycleReconcileTimer);
    teamLifecycleReconcileTimer = null;
  }
  if (ptyReapTimer) {
    clearInterval(ptyReapTimer);
    ptyReapTimer = null;
  }
  if (conversationHistoryEvictTimer) {
    clearInterval(conversationHistoryEvictTimer);
    conversationHistoryEvictTimer = null;
  }
  // Release any held power-save block + pending grace timer (Rule 3).
  keepAwake.shutdown();
  // Release the loud-tier inbox subscription (Rule 3).
  offLoudInboxAppended?.();
  offLoudInboxAppended = null;
  // Local tmux owns persistent inner processes. Let process teardown close our
  // client naturally; explicitly killing it emits a false terminal exit that
  // marks Team lifecycle state dead before next launch can reattach.
  ptys.killAll({ preserveLocalTmux: true });
  if (mcpServer) {
    const handle = mcpServer;
    mcpServer = null;
    handle.close().catch((err) => logMainError('mcpServer.close', err));
  }
  if (controlPlane) {
    const handle = controlPlane;
    controlPlane = null;
    handle.close().catch((err) => logMainError('controlPlane.close', err));
  }
});

process.on('uncaughtException', (err) => {
  logMainError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
  logMainError('unhandledRejection', reason);
});

// Disable navigation to external URLs in the renderer; open in browser instead
app.on('web-contents-created', (_e, contents) => {
  contents.on('render-process-gone', (_event, details) => {
    const win = BrowserWindow.fromWebContents(contents);
    if (win) conversationHistory.releaseWindow(win.id);
    logMainError('render-process-gone', details.reason);
  });
  contents.on('did-fail-load', (_event, code, description, url) => {
    logMainError('did-fail-load', `${code} ${description} (${url})`);
  });
  const isHttpUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };
  const isTrustedRendererUrl = (value: string) => {
    const devUrl = process.env.ELECTRON_RENDERER_URL;
    if (devUrl) {
      try {
        return new URL(value).origin === new URL(devUrl).origin;
      } catch {
        return false;
      }
    }
    return value.startsWith('file://');
  };
  const preventExternalNavigation = (event: Electron.Event, url: string) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  };
  contents.on('will-navigate', preventExternalNavigation);
  contents.on('will-redirect', preventExternalNavigation);
  contents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
});

app.on('child-process-gone', (_event, details) => {
  logMainError('child-process-gone', details.type + ':' + details.reason);
});
