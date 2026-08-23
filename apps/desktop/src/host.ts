/**
 * Compatibility IPC host. Window/tray/updater/preload live alongside this file
 * in `apps/desktop`; Electron-free helpers live in workspace packages and
 * `apps/server`. electron-vite loads this module through `apps/desktop/src/main.ts`.
 * This remains the `createWindow` / PTY / inbox authority until those handlers
 * move behind the runtime supervisor. Do not re-add re-export shims for
 * relocated modules — import the package or `apps/desktop` path instead.
 */
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
  clipboard
} from 'electron';
import { join, isAbsolute, resolve, sep, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { existsSync, realpathSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, relative } from 'node:path';
import { isTrustedRendererUrl, productServerUrl, rendererUrl, setProductionRendererOrigin } from './window/renderer-url.js';
import { startRuntimeSupervisor, type RuntimeSupervisor } from './runtime/runtime-supervisor.js';
import { applyPluginAgentCapabilities } from '@zana-ai/zcc-server/services/extensions/plugin-agent-sync';
import { runtimeHostAvailable, setRuntimeHostSupervisor } from '@zana-ai/zcc-host-daemon/harness/execution-environment';
import { IPC } from '@zana-ai/zcc-desktop-contract';
import { registerIpcFamilies } from './ipc/register.js';
import type { IpcCtx } from './ipc/ctx.js';
import { sanitizeExtraArgs } from '@zana-ai/zcc-domain/launch-sanitize';
import { providerCapabilities, isClaudeProfile, isCodexProfile, isOpenCodeProfile, seedPromptArgs } from '@zana-ai/zcc-domain/launch-provider';
import { EXTENSION_PROJECT_CATEGORY, store, scratchWorkspaceRoot, worktreeRoot, worktreeTargetDir } from '@zana-ai/zcc-server/services/projects/store';
import { PtyManager } from '@zana-ai/zcc-host-daemon/pty';
import { resolveMaxLiveSessions } from '@zana-ai/zcc-host-daemon/capacity';
import { revalidateLaunchCommit as revalidateCommonLaunchCommit } from '@zana-ai/zcc-server/services/launch/commit-revalidation';
import { LaunchAuthorizationService } from '@zana-ai/zcc-server/services/launch/authorization';
import { createLaunchCoordinator, LaunchSpawnError } from '@zana-ai/zcc-server/services/launch/coordinator';
import { createLaunchLedgerStore } from '@zana-ai/zcc-server/services/launch/ledger-store';
import { finalizeLaunchPreflight, preflightLaunch } from '@zana-ai/zcc-server/services/launch/preflight';
import { launchDigest } from '@zana-ai/zcc-server/services/launch/digest';
import { preflightTerminalExecution } from '@zana-ai/zcc-server/services/launch/execution-routing';
import { createRestoreCapabilityStore } from '@zana-ai/zcc-server/services/launch/restore-capability-store';
import { createTeamLifecycleIntegration, createTeamLifecycleStore } from '@zana-ai/zcc-server/services/launch/team-lifecycle-store';
import { bindLaunchPrincipal, type LaunchAuthorizationBinding, type LaunchPrincipal, type LaunchPrincipalRef } from '@zana-ai/zcc-server/services/launch/types';
import type { TerminalLaunchOptions } from '@zana-ai/zcc-server/services/launch/terminal-launcher';
import * as testTap from './test-tap.js';
import { AgentStatusTracker } from '@zana-ai/zcc-server/services/agents/agent-status';
import { OutputActivityMonitor } from '@zana-ai/zcc-host-daemon/output-activity';
import { ScreenScanBlockedDetector } from '@zana-ai/zcc-server/services/agents/screen-scan-blocked-detector';
import { HARNESS_REGISTRATIONS, providerFor, registrationFor, harnessAdapterDescriptorsFromVerify, refreshDynamicHarnessCatalogs } from '@zana-ai/zcc-host-daemon/harness/registry';
import { createExecutionConsentStore } from '@zana-ai/zcc-host-daemon/harness/execution-consent-store';
import { createExecutionConsentManagement } from '@zana-ai/zcc-host-daemon/harness/execution-consent-management';
import { ExecutionConsentService } from '@zana-ai/zcc-host-daemon/harness/execution-consent';
import { showExecutionConsentDialog } from './native/execution-consent-dialog.js';
import { runHarnessRoutingMigration } from '@zana-ai/zcc-server/services/harness-routing/migrator';
import { MigrationRepairRequiredError } from '@zana-ai/zcc-server/services/harness-routing/journal';
import { runStartupGate, type StartupState } from './startup-gate.js';
import { DEFAULT_RENDERER_ZOOM_FACTOR } from './window/window-zoom.js';
import { resolveLaunchSelection } from '@zana-ai/zcc-host-daemon/harness/launch-selection';
import { resolveEffectiveHarnessDefault } from '@zana-ai/zcc-host-daemon/harness/effective-default';
import { resolveExecutionState } from '@zana-ai/zcc-host-daemon/harness/target-resolution';
import { listClaudeSessions } from '@zana-ai/zcc-server/services/projects/claude';
import { listOpenCodeSessions } from '@zana-ai/zcc-server/services/projects/opencode-sessions';
import { ConversationHistoryService } from '@zana-ai/zcc-host-daemon/conversation-history';
import { listDir, readFile as fsReadFile, writeFile as fsWriteFile, walkFiles, searchFiles, readDataUrl, createFile as fsCreateFile, createDir as fsCreateDir, renamePath as fsRename, deletePath as fsDelete, resolveDoc as fsResolveDoc, confine } from '@zana-ai/zcc-server/services/projects/fs';
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
} from '@zana-ai/zcc-host-daemon/remote-fs';
import { uploadToRemote as fsUploadToRemote, downloadFromRemote as fsDownloadFromRemote } from '@zana-ai/zcc-host-daemon/remote-transfer';
import { openIn } from './native/openers.js';
import {
  getGitStatus,
  showHead,
  discardChanges,
  listWorktrees,
  listBranches,
  gitCommonDir,
  getRecentCommits,
  removeWorktree,
  withWorktreeLock,
  worktreeState,
  createWorktree,
  sanitizeBranchSlug,
  isGitRepo,
  previewProjectCommit,
  commitProjectChanges,
  pushProjectBranch
} from '@zana-ai/zcc-server/services/projects/git';
import { createInboxStore, type IInboxStore, type InboxEntry } from '@zana-ai/zcc-server';
import {
  createSuggestionsStore,
  type ISuggestionsStore,
  type Suggestion
} from '@zana-ai/zcc-server';
import { runSuggestion } from '@zana-ai/zcc-server/services/suggestions/run-suggestion';
import { mapAskUserQuestion, type AskUserQuestionInput } from '@zana-ai/zcc-server/services/inbox/ask-user-question-schema';
import {
  agentLabel,
  createAgentRegistryStore,
  type IAgentRegistryStore
} from '@zana-ai/zcc-server';
import { createAgentMessageLog, type IAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import { killLocalTmuxSession, listLocalTmuxSessionIds, reapOrphanTmuxSessions, verifyTmux } from '@zana-ai/zcc-host-daemon/tmux';
import { exportInboxPdf } from './native/inbox-pdf.js';
import { createSavedStore, type ISavedStore } from '@zana-ai/zcc-server';
import type { SavedRecord, SavedRecordInput } from '@zana-ai/zcc-domain/product';
import type { ConversationHistorySnapshot } from '@zana-ai/zcc-domain/product';
import type { CancelTeamLaunchResult, LaunchTeamResult, TeamLaunchAuthorizationInputSlot, TeamLaunchAuthorizationResult, TeamLaunchRequestInput, TeamFailedWorkerSlot, TeamLaunchedWorker } from '@zana-ai/zcc-domain/product';
import type { SubagentChild } from '@zana-ai/zcc-domain/product';
import type { FeedEvent, FeedEventInput, FeedDigestResult } from '@zana-ai/zcc-domain/product';
import type { LlmPromptEntry, LlmProviderId, LlmRunResult } from '@zana-ai/zcc-domain/product';
import type { QuickPrompt } from '@zana-ai/zcc-domain/product';
import type { InboxOrigin } from '@zana-ai/zcc-domain/product';
import { LibraryStore, type ILibraryStore } from '@zana-ai/zcc-server/services/library/library-store';
import { createBoundsStateController, restoreWindowState } from './window/bounds-state.js';
import type { LibraryDoc, LibraryAddInput, LibraryScope } from '@zana-ai/zcc-domain/product';
import { startMcpServer, type McpServerHandle } from '@zana-ai/zcc-server/services/mcp/mcp-server';
import { readMcpPort, writeMcpPort } from '@zana-ai/zcc-server';
import { startControlPlane, type ControlPlaneHandle } from './control/control-plane.js';
import { verifySessionControlCredential } from '@zana-ai/zcc-host-daemon/control-credential';
import { ensureMcpConfigForProject, rebuildExtensionServers } from '@zana-ai/zcc-host-daemon/mcp-config';
import { redeployBundledSkills, syncExtensionSkills, removeSkillsForExtension } from '@zana-ai/zcc-server/services/skills/skill-installer';
import { listMcpServers, setMcpServerEnabled } from '@zana-ai/zcc-server/services/mcp/mcp';
import {
  listMcpServersAll,
  revealMcpServer,
  setMcpServerEnabledById
} from '@zana-ai/zcc-server/services/mcp/mcp-catalogue';
import { listPlugins, revealPlugin, setPluginEnabled } from '@zana-ai/zcc-server/services/extensions/plugins';
import { claudeProjectFilePath, readClaudeProjectSettings, writeClaudeProjectSettings } from '@zana-ai/zcc-server/services/projects/claude-settings';
import { applyAuthorizations } from '@zana-ai/zcc-server/services/projects/authorizations';
import {
  listSkills,
  setSkillEnabled,
  setManyEnabled as setManySkillsEnabled,
  readHooks,
  revealSkillDir
} from '@zana-ai/zcc-server/services/skills/skills';
import { SkillBundlesStore } from '@zana-ai/zcc-server/services/skills/skill-bundles-store';
import { listCommands } from '@zana-ai/zcc-server/services/skills/commands';
import { ScheduleGroupsStore } from '@zana-ai/zcc-server/services/scheduler/schedule-groups-store';
import { watch as fsWatch, mkdirSync, type FSWatcher } from 'node:fs';
import { rm } from 'node:fs/promises';
import { parseSshConfig } from '@zana-ai/zcc-server/services/projects/ssh-config';
import {
  SshHostProviderRegistry,
  asSshHosts,
  asSshSyncResult,
  mergeSshHosts
} from './extensions/ssh-host-provider-registry.js';
import { ensureProcessPath } from '@zana-ai/zcc-host-daemon/env';
import { SchedulerManager } from '@zana-ai/zcc-server/services/scheduler/scheduler';
import { GoalManager } from '@zana-ai/zcc-server/services/goals/goal-manager';
import { FollowUpManager } from '@zana-ai/zcc-server/services/followups/followup-manager';
import { readClaudeLoops } from '@zana-ai/zcc-server/services/misc/claude-loops-store';
import { TrayController } from './tray.js';
import { MenubarController, isRepliable } from './menu.js';
import { createUpdater, type Updater } from './updater.js';
import { getReleaseNotes } from './release-notes.js';
import { compareVersions } from '@zana-ai/zcc-extension-sdk';
import { createDoctor, hasMissingDeps, type Doctor } from '@zana-ai/zcc-server/services/projects/dependency-doctor';
import { TemplateStore } from '@zana-ai/zcc-server/services/library/template-store';
import { QuickPromptStore } from '@zana-ai/zcc-server/services/library/quick-prompt-store';
import { resolveRulesGuidance } from '@zana-ai/zcc-server/services/projects/rules-file';
import { PromptRegistry, LlmService, ClaudeCliProvider, OpenAiProvider, GeminiProvider, type LlmProvider } from '@zana-ai/zcc-llm';
import { VoiceService } from './native/voice/voice-service.js';
import { OpenAiVoiceProvider } from './native/voice/openai-provider.js';
import { getOpenAiKey, getGeminiKey } from './native/voice/secrets.js';
import { IdleTriageService } from '@zana-ai/zcc-server/services/followups/idle-triage';
import { HeldQuestionService, HELD_QUESTION_MAX_HOLD_MS } from '@zana-ai/zcc-server/services/inbox/held-questions';
import { CatchUpSummaryService } from '@zana-ai/zcc-server/services/followups/catch-up-summary';
import { AutoReportLinkerService } from '@zana-ai/zcc-server/services/inbox/auto-report-linker';
import { Overseer, type OverseerToolEvent } from '@zana-ai/zcc-server/services/followups/overseer';
import { OverseerAuditRing } from '@zana-ai/zcc-server/services/followups/overseer-audit';
import { ContentScreen, type ContentScreenEvent, buildWarningText } from './window/content-screen.js';
import { HeartbeatService } from '@zana-ai/zcc-server/services/followups/heartbeat';
import { LocalExtensionWatcher } from '@zana-ai/zcc-server/services/extensions/local-extension-watcher';
import { AutonomousRunSupervisor, AUTONOMOUS_DEFAULTS } from '@zana-ai/zcc-server/services/agents/autonomous-run-supervisor';
import { AutoCloseIdleService } from '@zana-ai/zcc-server/services/followups/auto-close-idle';
import { AgentMailDrainService } from '@zana-ai/zcc-server/services/agents/agent-mail-drain';
import { KeepAwakeService, KEEP_AWAKE_DEFAULT_GRACE_MS } from './native/keep-awake.js';
import { CloseSummaryService } from '@zana-ai/zcc-server/services/followups/close-summary';
import { InboxSummaryService } from '@zana-ai/zcc-server';
import { UsageService } from '@zana-ai/zcc-server/services/agents/usage-service';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';
import { FeedNoiseClassifier } from '@zana-ai/zcc-server/services/feed/feed-noise-classifier';
import { FeedStore } from '@zana-ai/zcc-server';
import { FeedService } from '@zana-ai/zcc-server/services/feed/feed-service';
import { FeedSummaryService } from '@zana-ai/zcc-server/services/feed/feed-summary';
import {
  transcriptPath,
  readSessionStats,
  type SessionStats
} from '@zana-ai/zcc-host-daemon/harness/claude/transcript-reader';
import { TranscriptSource } from '@zana-ai/zcc-server/services/misc/transcript-source';
import type { HarnessAuthKey, HarnessAuthStatusInfo } from '@zana-ai/zcc-domain/product';
import { getHarnessAuthStatus, setHarnessAuth } from '@zana-ai/zcc-host-daemon/harness-auth';
import { microVmPlatformSupported } from '@zana-ai/zcc-host-daemon/harness/microvm-environment';
import { verifyHarnesses } from '@zana-ai/zcc-host-daemon/harness/harness-verify';
import { verifyEditors } from '@zana-ai/zcc-server/services/projects/editor-verify';
import { PersonaStore, resolvePersonaLaunch } from '@zana-ai/zcc-server/services/agents/persona-store';
import { TeamStore } from '@zana-ai/zcc-server/services/agents/team-store';
import { buildSquadBundle, validateSquadBundle } from '@zana-ai/zcc-server/services/agents/squad-bundle';
import { PersonaTeamRegistry, TEAM_SLOT_MAX } from './extensions/persona-team-registry.js';
import { MainModuleHost } from './modules/registry.js';
import { loadExtensions } from './extensions/loader.js';
import { ExtensionProcessHost, type DiskExtensionSpec } from './extensions/process-host.js';
import { spawnUtilityChild } from './extensions/spawn-child.js';
import { ModuleRouter } from './extensions/module-router.js';
import { PermissionBroker, grantFromManifest } from './extensions/permission-broker.js';
import { ReviewerBroker } from './extensions/reviewer-broker.js';
import { ReviewerApprovalService } from '@zana-ai/zcc-server/services/extensions/reviewer-approval';
import { createBrokerCapabilities } from './extensions/broker-caps.js';
import { pushInboxOnBehalfOf } from './extensions/inbox-broker.js';
import { MicroVmPool } from '@zana-ai/zcc-host-daemon/microvm/pool';
import { StreamRelay } from './extensions/stream-relay.js';
import { HostCommandRelay } from './extensions/host-command-relay.js';
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
import { isWithin } from '@zana-ai/zcc-path-confine';
import {
  seedBundledExtensions,
  installFromDir,
  installFromArchiveFile,
  installFromBundled,
  installFromGit,
  locateManifestDir,
  listBundledCatalog,
  uninstallExtension
} from '@zana-ai/zcc-server/services/extensions/extension-installer';
import {
  mintLocalId,
  workingDirFor,
  scaffoldLocalExtension,
  packLocalExtension,
  prepareShareDir,
  clampLocalKind,
  readWorkingDirId
} from '@zana-ai/zcc-server/services/extensions/local-extension';
import {
  maybeCheckRemoteUpdates,
  listMarketplace,
  resolveMarketplaceRelease,
  applyRelease
} from '@zana-ai/zcc-server/services/extensions/extension-registry';
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
} from '@zana-ai/zcc-domain/product';
import { MAIN_MODULES } from './modules/index.js';
import { homedir } from 'node:os';
import {
  AUTO_CLOSE_IDLE_DEFAULTS,
  HEARTBEAT_DEFAULTS,
  toPersonaSummary,
  toProjectSummary,
  toTeamSummary
} from '@zana-ai/zcc-domain/product';
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
} from '@zana-ai/zcc-domain/product';
import {
  readCodexProjectSettings,
  readOpenCodeProjectSettings,
  writeCodexProjectSettings,
  writeOpenCodeProjectSettings
} from '@zana-ai/zcc-server/services/misc/harness-settings';

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
      // DISK-ext ids only — NOT `moduleRouter.liveModuleIds()`, which unions in
      // trusted in-process built-ins. `syncDiskExtensions` tears down anything
      // live that isn't a desired DISK spec, so feeding it the built-ins would
      // tear them down on every boot/reload. The reconcile only owns disk children.
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
  restoreCapabilities.removeSession(sessionId);
  await killLocalTmuxSession(sessionId);
  const session = ptys.getSession(sessionId);
  if (!session) {
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
const promptRegistry = new PromptRegistry({
  homeDir: () => app.getPath('home'),
  revealPath: (path) => shell.openPath(path)
});
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
  // Back the built-in `ctx.resolveProjectRoot` confinement gate (A3).
  listProjects: () => store.listProjects(),
  home: app.getPath('home'),
  // Back `ctx.personas` / `ctx.teams` for the in-process built-in tier. The host
  // stamps provenance from `mod.id` (never self-declared); cleared on teardown.
  registry: personaTeamRegistry,
  // Back the generic built-in `ctx.summarizeSession`.
  // Confinement (CLAUDE.md #1): resolve the supplied id to a LIVE session and
  // take projectId FROM that session — never from the caller — then summarizeTurn
  // re-confines before reading. An unknown id → {ok:false}, never a read.
  summarizeSession: async (sessionId) => {
    const s = ptys.getSession(sessionId);
    if (!s) {
      console.log(`[summarizeSession] session=${sessionId.slice(0, 8)} → no live session`);
      return { ok: false };
    }
    console.log(
      `[summarizeSession] session=${sessionId.slice(0, 8)} project=${s.projectId} ` +
        `profile=${s.profile} claudeSessionId=${s.claudeSessionId ? s.claudeSessionId.slice(0, 8) : 'NONE'} cwd=${s.cwd}`
    );
    const res = await closeSummary.summarizeTurn(s.projectId, sessionId);
    console.log(
      `[summarizeSession] session=${sessionId.slice(0, 8)} → ok=${res.ok} len=${res.text?.length ?? 0}`
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
// are TRUSTED → `can()` always allows them (tier on provenance).
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
const registerExtensionProject = async (workingDir: string, name: string): Promise<Project> => {
  const projects = runtimeSupervisor
    ? await runtimeSupervisor.listProjects() as Project[]
    : store.listProjects();
  const existed = projects.some((p) => p.path === workingDir);
  const label = `Ext: ${name}`.slice(0, 256);
  // The server add path recognizes well-formed extension sources. Follow it with
  // the explicit category/name projection so the local-source record remains the
  // authority for a self-heal, matching the legacy ensureExtensionProject contract.
  // Never fall back after a runtime error: either server mutation may have committed.
  const project = runtimeSupervisor
    ? await runtimeSupervisor.addProject(workingDir) as Project
    : store.ensureExtensionProject(workingDir, name);
  const categorized = runtimeSupervisor && (project.category !== EXTENSION_PROJECT_CATEGORY || project.name !== label)
    ? await runtimeSupervisor.updateProject(project.id, { category: EXTENSION_PROJECT_CATEGORY, name: label }) as Project | null
    : project;
  if (!categorized) throw new Error('extension project disappeared during registration');
  if (!existed) {
    ensureMcpConfigForProject(categorized.id).catch((err) =>
      logMainError(`ensureMcpConfigForProject(${categorized.id})`, err)
    );
    templates.rebindProjects();
    personas.rebindProjects();
    teams.rebindProjects();
    libraryStore.rebindProjects?.();
    scheduler.rebindWatchers();
    goals.rebindWatchers();
    followups.rebindWatchers();
  }
  safeSend(
    IPC.projects.onChanged,
    runtimeSupervisor ? await runtimeSupervisor.listProjects() as Project[] : store.listProjects()
  );
  return categorized;
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
  const project = await registerExtensionProject(workingDir, name);
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
  const project = await registerExtensionProject(workingDir, name);
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
let runtimeSupervisor: RuntimeSupervisor | null = null;

function resolvedAppVersion(): string {
  const version = app.getVersion();
  const e2eVersion = process.env.ZCC_E2E_APP_VERSION;
  return version === '0.0' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(e2eVersion ?? '')
    ? e2eVersion!
    : version;
}

async function ensureRendererStaticHost(): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL || runtimeSupervisor) return;
  // electron-vite emits renderer assets beside the main bundle. Electron's asar
  // filesystem support keeps this usable in packaged builds without exposing a
  // broad filesystem server.
  const rootDir = join(__dirname, '../renderer');
  runtimeSupervisor = await startRuntimeSupervisor({
    rendererRoot: rootDir,
    dataDir: process.env.ZCC_DATA_DIR?.trim() || join(app.getPath('home'), '.zcc'),
    runtimeDir: __dirname,
    version: resolvedAppVersion()
  });
  runtimeSupervisor.onProjectSettingsChanged((projectId) => {
    safeSend(IPC.projectSettings.onChanged, projectId);
  });
  runtimeSupervisor.onPluginCapabilitiesChanged((contributors) => {
    void applyPluginAgentCapabilities(contributors, logMainError).then(() => safeSend(IPC.skills.onChanged));
  });
  runtimeSupervisor.onPluginAppsChanged((apps) => {
    safeSend(IPC.pluginApps.onChanged, apps);
  });
  setRuntimeHostSupervisor(runtimeSupervisor);
  setProductionRendererOrigin(runtimeSupervisor.rendererUrl);
}

/**
 * Launch authorization must read the same settings authority that accepts the
 * write. The legacy store remains the development-mode fallback until its
 * runtime replacement is available there as well.
 */
async function getAuthoritativeProjectSettings(projectId: string): Promise<ProjectSettings> {
  return runtimeSupervisor
    ? await runtimeSupervisor.getProjectSettings(projectId) as ProjectSettings
    : store.getProjectSettings(projectId);
}

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
    // All production launches arrive with the immutable authorized snapshot.
    // Keep the legacy sync fallback for narrow direct-call tests and development
    // tools that deliberately exercise this low-level helper in isolation.
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
      microVmMemoryMib: req.microVmMemoryMib,
      // Kept off while this first lane is verified through a dedicated internal
      // control path. Public terminal IPC remains behaviorally unchanged.
      runtimeHost: process.env.ZCC_RUNTIME_HOST === '1' && runtimeHostAvailable()
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
  const projectSettings = await getAuthoritativeProjectSettings(req.projectId);
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
      return result.value;
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
      if (ptys.getSession(session.id)) ptys.setRestoreCapabilityId(session.id, restoreCapabilityId);
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
    const currentSettings = await getAuthoritativeProjectSettings(project.id);
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
  const projectSettings = await getAuthoritativeProjectSettings(project.id);
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
      projectSettings,
      effectiveLaunch,
      storeRevision: launchDigest({
        projects,
        config: opts.config,
        projectSettings,
        persona: opts.persona
      })
    })
  });
  const executionAuthorization = await preflightTerminalExecution({
    config: opts.config,
    profile: opts.profile,
    persona: opts.persona,
    projectSettings,
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
      const currentSettings = await getAuthoritativeProjectSettings(project.id);
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
        projectSettings: authorizedPlan.resolved.projectSettings,
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
        request: {
          ...finalPlan.request,
          environment: finalPlan.request.environment === 'runtime-host' ? 'local' : finalPlan.request.environment
        },
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
  return { ok: true, value: { teamId: team.id, projectId: project.id, slots: authorized } };
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
  const cohortBase = { cohortId, teamId: team.id, teamName: team.name };

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
  const structured = opts && 'launchRequestId' in opts ? opts : undefined;
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

export async function reportTeamTask(
  callerPrincipalId: string,
  launchRequestId: string,
  slotId: string,
  outcome: 'complete' | 'failed'
): Promise<Result<unknown>> {
  const result = await teamLifecycleIntegration.reportTeamTask(callerPrincipalId, launchRequestId, slotId, outcome);
  return result.ok ? { ok: true, value: result.record } : { ok: false, code: result.code, message: 'team launch slot not found for caller' };
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
      zoomFactor: DEFAULT_RENDERER_ZOOM_FACTOR,
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
  const url = rendererUrl(projectId ? { projectId } : {});
  if (url) {
    win.loadURL(url);
  } else {
    // Startup-repair can render before normal bootstrap starts the local static
    // host. It is the only permitted file-backed product surface.
    win.loadFile(join(__dirname, '../renderer/index.html'), {
      search: projectId ? `projectId=${encodeURIComponent(projectId)}` : undefined
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
  _onProgress?: (line: string) => void
): Promise<CloneProjectResult> {
  const base = productServerUrl();
  try {
    const response = await fetch(new URL('api/v1/projects/clone', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: input.url, name: input.name })
    });
    const body = await response.json() as {
      ok?: boolean;
      project?: Project;
      path?: string;
      code?: string;
      message?: string;
    };
    if (!response.ok || !body.ok || !body.project) {
      return {
        ok: false,
        code: (body.code === 'DEST_EXISTS' || body.code === 'clone_target_exists' ? 'DEST_EXISTS' : 'CLONE_FAILED') as 'DEST_EXISTS' | 'CLONE_FAILED',
        message: body.message ?? 'Clone failed',
        path: body.path
      };
    }
    templates.rebindProjects();
    personas.rebindProjects();
    teams.rebindProjects();
    libraryStore.rebindProjects?.();
    scheduler.rebindWatchers();
    goals.rebindWatchers();
    followups.rebindWatchers();
    safeSend(
      IPC.projects.onChanged,
      runtimeSupervisor ? await runtimeSupervisor.listProjects() as Project[] : store.listProjects()
    );
    return { ok: true, project: body.project };
  } catch (err) {
    return { ok: false, code: 'CLONE_FAILED', message: String(err) };
  }
}

function registerIpc() {
  registerIpcFamilies({
    get E2E_TAP_ENABLED() { return E2E_TAP_ENABLED; },
    get MENUBAR_REPLY_MAX_CHARS() { return MENUBAR_REPLY_MAX_CHARS; },
    get activeForegroundSessionId() { return activeForegroundSessionId; },
    set activeForegroundSessionId(value) { activeForegroundSessionId = value; },
    get activeProjectSkillsId() { return activeProjectSkillsId; },
    get adoptLocalSource() { return adoptLocalSource; },
    get agentMessageLog() { return agentMessageLog; },
    get agentRegistry() { return agentRegistry; },
    get agentStatus() { return agentStatus; },
    get autoCloseIdle() { return autoCloseIdle; },
    get autonomousRuns() { return autonomousRuns; },
    get boundsControllers() { return boundsControllers; },
    get builtinIds() { return builtinIds; },
    get cancelTeamLaunch() { return cancelTeamLaunch; },
    get catchUpSummary() { return catchUpSummary; },
    get cloneAndRegisterProject() { return cloneAndRegisterProject; },
    get closeSummary() { return closeSummary; },
    get conversationHistory() { return conversationHistory; },
    get createInteractiveTerminal() { return createInteractiveTerminal; },
    get createLocalExtension() { return createLocalExtension; },
    get diskSpecsById() { return diskSpecsById; },
    get doctor() { return doctor; },
    get emitExtensionsChanged() { return emitExtensionsChanged; },
    get extensionEntries() { return extensionEntries; },
    set extensionEntries(value) { extensionEntries = value; },
    get emitMcpChanged() { return emitMcpChanged; },
    get emitPluginsChanged() { return emitPluginsChanged; },
    get executionConsentManagement() { return executionConsentManagement; },
    get exitedSessionStats() { return exitedSessionStats; },
    get extProcessHost() { return extProcessHost; },
    get favoriteAgentKeys() { return favoriteAgentKeys; },
    set favoriteAgentKeys(value) { favoriteAgentKeys = value; },
    get feedNoiseClassifier() { return feedNoiseClassifier; },
    get feedService() { return feedService; },
    get feedStore() { return feedStore; },
    get feedSummary() { return feedSummary; },
    get followups() { return followups; },
    get goals() { return goals; },
    get handleLoudInboxEntry() { return handleLoudInboxEntry; },
    get heartbeat() { return heartbeat; },
    get hostCommandRelay() { return hostCommandRelay; },
    get inboxStore() { return inboxStore; },
    get inboxSummary() { return inboxSummary; },
    get isTeamWorkerRestore() { return isTeamWorkerRestore; },
    get keepAwake() { return keepAwake; },
    get launchAuthorizedTerminal() { return launchAuthorizedTerminal; },
    get launchAutonomousTeam() { return launchAutonomousTeam; },
    get launchTeam() { return launchTeam; },
    get libraryStore() { return libraryStore; },
    get llmService() { return llmService; },
    get logMainError() { return logMainError; },
    get mainWindow() { return mainWindow; },
    get menubar() { return menubar; },
    get menubarPopoverEnabled() { return menubarPopoverEnabled; },
    get moduleRouter() { return moduleRouter; },
    get offLoudInboxAppended() { return offLoudInboxAppended; },
    set offLoudInboxAppended(value) { offLoudInboxAppended = value; },
    get openProjectWindow() { return openProjectWindow; },
    get overseerAudit() { return overseerAudit; },
    get packAndInstallLocal() { return packAndInstallLocal; },
    get pendingWhatsNew() { return pendingWhatsNew; },
    set pendingWhatsNew(value) { pendingWhatsNew = value; },
    get permissionBroker() { return permissionBroker; },
    get personas() { return personas; },
    get projectPathToOptions() { return projectPathToOptions; },
    get promptRegistry() { return promptRegistry; },
    get ptys() { return ptys; },
    get quickPrompts() { return quickPrompts; },
    get readLiveSessionStats() { return readLiveSessionStats; },
    get rebuildProviders() { return rebuildProviders; },
    get registerExtensionProject() { return registerExtensionProject; },
    get resolveTheme() { return resolveTheme; },
    get resolveWorktreeForRequest() { return resolveWorktreeForRequest; },
    get resolvedAppVersion() { return resolvedAppVersion; },
    get restoreCapabilities() { return restoreCapabilities; },
    get restorePrincipal() { return restorePrincipal; },
    get runDiskSync() { return runDiskSync; },
    get runtimeSupervisor() { return runtimeSupervisor; },
    get safeHandle() { return safeHandle; },
    get safeHandleFromWindow() { return safeHandleFromWindow; },
    get safeSend() { return safeSend; },
    get sanitizeRendererTerminalRequest() { return sanitizeRendererTerminalRequest; },
    get savedStore() { return savedStore; },
    get scheduleGroups() { return scheduleGroups; },
    get scheduler() { return scheduler; },
    get setActiveProjectSkillsWatcher() { return setActiveProjectSkillsWatcher; },
    get showMainWindow() { return showMainWindow; },
    get skillBundles() { return skillBundles; },
    get sshHostProviderRegistry() { return sshHostProviderRegistry; },
    get stampFeedEvent() { return stampFeedEvent; },
    get stopAutonomousRun() { return stopAutonomousRun; },
    get suggestionsStore() { return suggestionsStore; },
    get teams() { return teams; },
    get templates() { return templates; },
    get terminateSession() { return terminateSession; },
    get tray() { return tray; },
    get updater() { return updater; },
    get usageService() { return usageService; },
    get voiceService() { return voiceService; },
    get worktreeBySession() { return worktreeBySession; },
    get worktreeInUse() { return worktreeInUse; },
  } as IpcCtx);
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
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => {
            const win = BrowserWindow.getFocusedWindow() ?? mainWindow();
            if (win && !win.isDestroyed()) win.webContents.setZoomFactor(DEFAULT_RENDERER_ZOOM_FACTOR);
          }
        },
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
  // A repair-only window is loaded via `loadFile` (the loopback static host
  // isn't up yet — see createWindow). Once retry succeeds, that host IS up, so
  // `isTrustedRendererUrl` (renderer-url.ts) now judges the still-open file://
  // document untrusted against the new loopback origin and would block a
  // renderer-initiated reload. Main must drive this navigation itself (Rule 1:
  // renderer is untrusted, main authorizes) — and must be the ONLY side that
  // navigates: a renderer-initiated `location.reload()` firing around the same
  // time races this `loadURL`, and whichever loses cancels the other (both can
  // end up cancelled, leaving the window stuck). The renderer's retry() no
  // longer reloads itself; this is unconditional so dev (ELECTRON_RENDERER_URL,
  // same origin throughout) also gets its remount via this one path.
  if (startupState.mode === 'ready') {
    const win = unscopedWindow();
    const url = rendererUrl();
    if (win && !win.isDestroyed() && url) win.loadURL(url);
  }
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
  //   - built-in MAIN_MODULES → in-process moduleHost (trusted).
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
        .then(async ({ entries, modules }) => {
          await moduleHost.setupAll(modules);
          return maybeCheckRemoteUpdates(
            entries.map((e) => e.id),
            logMainError
          ).then((outcomes) => {
            for (const o of outcomes) {
              if (o.status === 'updated') {
                console.log(`[main] extension update: ${o.id} ${o.fromVersion ?? '∅'} → ${o.toVersion}`);
              } else if (o.status === 'needs-consent') {
                console.log(
                  `[main] plugin update held: ${o.id} → ${o.toVersion}`
                );
              }
            }
          });
        })
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
    registerProject: async (absPath: string) => {
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
      const projects = runtimeSupervisor
        ? await runtimeSupervisor.listProjects() as Project[]
        : store.listProjects();
      const existed = projects.some((p) => p.path === realTarget);
      // The main-side gate above establishes that the agent's path is allowed;
      // packaged registration still crosses the server's canonical add boundary.
      // No runtime fallback after an error: the server may already have committed.
      const project = runtimeSupervisor
        ? await runtimeSupervisor.addProject(realTarget) as Project
        : store.addProject(realTarget); // throws on a bad path → tool reports isError
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
      safeSend(
        IPC.projects.onChanged,
        runtimeSupervisor ? await runtimeSupervisor.listProjects() as Project[] : store.listProjects()
      );
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
  try {
    await ensureRendererStaticHost();
  } catch (error) {
    normalBootstrapStarted = false;
    throw error;
  }
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
  // built-in's timers and in-flight fetches keep running until the OS reaps
  // the process. Same fire-and-forget shape as the disk-ext teardown above —
  // don't block quit on it.
  void moduleHost.teardownAll();
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
  if (runtimeSupervisor) {
    const runtime = runtimeSupervisor;
    runtimeSupervisor = null;
    setRuntimeHostSupervisor(null);
    runtime.close().catch((err) => logMainError('runtimeSupervisor.close', err));
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
