import type { DesktopBrowserApi } from './browser.js';
import type { MarketplaceCatalogRow } from '@zana-ai/zcc-domain';
import type {
  ProviderCliInstallActionKind,
  ProviderCliInstallEvent,
  ProviderCliKey,
  ProviderCliStatusResponse
} from '@zana-ai/zcc-contracts/host-rpc';
import type {
  AdoptLocalExtensionGitRequest,
  AgentMessage,
  AgentRecord,
  AgentState,
  AgentStatusReplay,
  AppConfig,
  AutonomousRun,
  CancelTeamLaunchResult,
  CatchUpSummaryResult,
  ClaudeProjectFileId,
  ClaudeProjectSettings,
  ClaudeSessionSummary,
  ClaudeSettingsResult,
  ClaudeSettingsScope,
  CloneProjectResult,
  CodexProjectSettings,
  CodexSettingsResult,
  ConversationHistorySnapshot,
  ConversationHistoryStartInput,
  CreateLocalExtensionRequest,
  CreateLocalExtensionResult,
  CreateTerminalRequest,
  DependencyProgress,
  DetailedInboxSummaryResult,
  EditorVerifyResult,
  EffectiveHarnessDefaultResult,
  Environment,
  EnvironmentAction,
  GitHostPullRequest,
  SpawnEnvironmentChoice,
  WorkspaceDiffResponse,
  WorkspaceStatus,
  ExtensionEntry,
  ExtensionInstallSource,
  ExtensionUpdateOutcome,
  FeedDigestResult,
  FeedNoiseResult,
  FeedPage,
  FollowUp,
  FollowUpCreateInput,
  FollowUpStatus,
  FollowUpUpdateInput,
  FsEntry,
  FsMutateResult,
  FsReadDataUrlResult,
  FsReadResult,
  FsResolveDocResult,
  FsWriteResult,
  GitBranch,
  GitCommitPreview,
  GitDiscardResult,
  GitShowResult,
  GitStatus,
  GitWorkflowResult,
  Goal,
  GoalCreateInput,
  GoalStatus,
  GoalUpdateInput,
  HarnessAuthKey,
  HarnessAuthStatusInfo,
  HarnessVerifyResult,
  IdleTriageResult,
  InboxEntry,
  InboxPdfExport,
  InboxPdfExportResult,
  InboxSummaryResult,
  LaunchProfileId,
  LaunchTeamResult,
  LibraryAddInput,
  LibraryDoc,
  LibraryScope,
  LibrarySearchResult,
  LlmPromptEntry,
  LlmProviderId,
  LlmRunResult,
  MarketplaceEntry,
  McpServer,
  McpServerEntry,
  MenubarReplyResult,
  MenubarSnapshot,
  OpenCodeProjectSettings,
  OpenCodeSessionSummary,
  OpenCodeSettingsResult,
  OpenResult,
  OpenTarget,
  OverseerActivity,
  OverseerAuditEntry,
  Persona,
  PersonaInput,
  PluginAppEntry,
  PluginEntry,
  PluginSettingsSnapshot,
  Project,
  ProjectExecutionConsentGrant,
  ProjectSettings,
  QuickPrompt,
  ReleaseNote,
  RemoteRootResult,
  RemoteTransferResult,
  Result,
  SavedRecord,
  SavedRecordInput,
  ScheduleCreateInput,
  ScheduleGroup,
  ScheduleGroupInput,
  ScheduleTemplate,
  ScheduleUpdateInput,
  ScheduledTask,
  SearchOptions,
  SearchResult,
  SessionStats,
  SetupStatus,
  SkillBundle,
  SkillBundleApplyMode,
  SkillBundleApplyResult,
  SkillBundleInput,
  SkillEntry,
  SlashCommand,
  SquadBundle,
  SshHostEntry,
  SshSyncResult,
  SubagentChild,
  Suggestion,
  Team,
  TeamInput,
  TerminalSession,
  TmuxRestoreCandidate,
  TmuxVerifyResult,
  UpdateProgress,
  UpdateStatus,
  VoiceTranscribeResult,
  WalkedFile,
  WhatsNewEvent,
  Worktree
} from '@zana-ai/zcc-domain/product';
import type {
  HarnessAdapterDescriptor,
  HarnessAgentDiscoveryResult
} from '@zana-ai/zcc-domain/harness-adapter';
import type { UsageSummary } from '@zana-ai/zcc-domain/telemetry-events';
import type {
  Host,
  JsonValue,
  PendingInteraction,
  PendingInteractionResolution
} from '@zana-ai/zcc-domain/thread-runtime';

export type HostBootstrapEvent =
  | { type: 'log'; text: string }
  | { type: 'done'; hostId: string }
  | { type: 'error'; code: string; message: string; pairingCommand?: string };

export interface CcApi {
  /** Isolated in-app browser overlay. Present only in the desktop preload. */
  browser: DesktopBrowserApi;
  startup: {
    state(): Promise<{ mode: 'ready' } | { mode: 'repair-required'; reason: 'harness-routing-migration' }>;
    retry(): Promise<{ mode: 'ready' } | { mode: 'repair-required'; reason: 'harness-routing-migration' }>;
    diagnostics(): Promise<{ ok: boolean }>;
    quit(): Promise<void>;
  };
  projectSettings: {
    get(id: string): Promise<ProjectSettings>;
    set(id: string, patch: Partial<ProjectSettings>): Promise<ProjectSettings>;
    onChanged(callback: (projectId: string) => void): () => void;
  };
  executionConsent: {
    listProject(projectId: string): Promise<ProjectExecutionConsentGrant[]>;
    revokeProject(projectId: string, grantId: string): Promise<ProjectExecutionConsentGrant[]>;
  };
  /**
   * Per-harness auth (Settings → Harness). `status` returns the base URL +
   * `hasToken` per family (never the token). `set` stores/clears a family's base
   * URL and/or token: a non-empty string sets, `null` clears that field,
   * `undefined` leaves it unchanged; the token is encrypted at rest in main.
   */
  harnessAuth: {
    status(): Promise<HarnessAuthStatusInfo[]>;
    set(
      key: HarnessAuthKey,
      patch: { baseUrl?: string | null; token?: string | null }
    ): Promise<HarnessAuthStatusInfo[]>;
  };
  /**
   * Code-harness verification (Settings → Code Harness). `verify` probes each
   * harness family's `<binary> --version` on demand and returns the enabled ×
   * installed matrix the launcher gates the profile picker on. Best-effort in
   * main — never throws; a missing binary reports `installed: false`.
   */
  harness: {
    verify(): Promise<HarnessVerifyResult[]>;
    descriptors(): Promise<HarnessAdapterDescriptor[]>;
    agentDescriptors(
      projectId: string,
      profile: LaunchProfileId,
      refresh?: boolean
    ): Promise<HarnessAgentDiscoveryResult>;
    effectiveDefault(projectId: string): Promise<EffectiveHarnessDefaultResult>;
  };
  /**
   * External-editor verification (Settings → Editor). `verify` probes each
   * editor's `<shim> --version` on demand and returns the install matrix the
   * Editor settings row displays. Best-effort in main — never throws; a missing
   * shim reports `installed: false`.
   */
  editor: {
    verify(): Promise<EditorVerifyResult[]>;
  };
  projects: {
    list(): Promise<Project[]>;
    add(path: string, opts?: { hostId?: string }): Promise<Result<Project>>;
    remove(id: string): Promise<void>;
    update(
      id: string,
      patch: {
        name?: string;
        color?: string;
        defaultAgents?: string[];
        defaultPersonas?: string[];
        favorite?: boolean;
        /**
         * Remote (SSH) projects only: the start directory the terminal `cd`s into
         * and the Explorer roots at. Empty string clears it (falls back to the
         * global `remoteDefaultPath`, then the remote `$HOME`). Ignored for local
         * projects. Keeps a remote session out of `$HOME`, where Claude Code
         * refuses to persist folder-trust — see the remote start-path field in
         * Project settings.
         */
        remotePath?: string;
      }
    ): Promise<Project | null>;
    touch(id: string): Promise<Project | null>;
    reorder(orderedIds: string[]): Promise<Project[]>;
    pickDirectory(): Promise<string | null>;
    addRemote(input: {
      host: string;
      user?: string;
      remotePath?: string;
      proxyJump?: string;
      name?: string;
    }): Promise<Result<Project>>;
    /**
     * Clone a git repository into the clone root and register the result as a
     * project. `name` overrides the folder/project name derived from the URL.
     * Live progress lines arrive on `onCloneProgress`. On a DEST_EXISTS result
     * the folder already existed and was left untouched.
     */
    clone(input: { url: string; name?: string }): Promise<CloneProjectResult>;
    /** Subscribe to `git clone --progress` lines for the in-flight clone. */
    onCloneProgress(cb: (line: string) => void): () => void;
    /** The absolute directory new clones land in (default `~/zcc-workspace`). */
    cloneRoot(): Promise<string>;
    /**
     * Ensure the built-in Quick Agent scratch project exists (rooted at
     * `~/zcc-workspace`, created on first call) and return it. Idempotent.
     */
    ensureQuickAgent(): Promise<Result<Project>>;
    /**
     * Fired with the full project list after any project mutation in the main
     * process — including adds made on an agent's behalf via the
     * `register_project` MCP tool — so the sidebar stays live without polling.
     */
    onChanged(cb: (projects: Project[]) => void): () => void;
    /**
     * Confined workspace path search for composer `@` mentions. Authorizes
     * `projectId` on the product server and walks the project root on the host.
     */
    paths(
      projectId: string,
      opts?: {
        query?: string;
        limit?: number;
        includeFiles?: boolean;
        includeDirectories?: boolean;
      }
    ): Promise<{
      paths: Array<{
        kind: 'file' | 'directory';
        path: string;
        name: string;
        score: number;
        positions: number[];
      }>;
      truncated: boolean;
    }>;
  };
  ssh: {
    listHosts(): Promise<SshHostEntry[]>;
    /** Re-read the user's SSH configuration and return discovered hosts. */
    syncHosts(): Promise<SshSyncResult>;
  };
  /**
   * Enrolled host-daemon machines. HTTP to the product server — join codes,
   * live connected status, permission ceiling, and remote directory browse.
   */
  hosts: {
    createJoinCode(): Promise<{ joinCode: string; hostId: string; expiresAt: number }>;
    list(): Promise<Host[]>;
    get(id: string): Promise<Host>;
    update(id: string, patch: { name: string }): Promise<Host>;
    updatePermissionCeiling(
      id: string,
      maxPermissionMode: 'accept-edits' | 'auto' | 'full'
    ): Promise<Host>;
    retryUpdate(id: string): Promise<{ ok: true }>;
    remove(id: string): Promise<{ ok: true }>;
    bootstrap(projectId: string): Promise<HostBootstrapEvent[]>;
    repair(id: string): Promise<HostBootstrapEvent[]>;
    updateSshIdentity(
      id: string,
      patch: { host: string; user?: string; proxyJump?: string }
    ): Promise<Host>;
    directory(id: string, path?: string): Promise<{
      directory: string;
      parent: string | null;
      entries: Array<{ kind: 'file' | 'directory'; name: string; path: string }>;
    }>;
    pathsExist(id: string, paths: string[]): Promise<{ existence: Record<string, boolean> }>;
    pickFolder(id: string, clientHostId: string): Promise<{ path: string | null }>;
    cloneDefaultPath(id: string, projectId: string): Promise<{ path: string }>;
    providerCliStatus(id: string): Promise<ProviderCliStatusResponse>;
    installProviderCli(
      id: string,
      request: { provider: ProviderCliKey; actionKind: ProviderCliInstallActionKind }
    ): Promise<ProviderCliInstallEvent[]>;
    onChanged(cb: (hosts: Host[] | undefined) => void): () => void;
  };
  /**
   * Outbound pairing-relay tunnel to the public origin (Heroku front door).
   * Status only — the origin and token live in AppConfig / env.
   */
  relay: {
    status(): Promise<{
      state: 'connected' | 'offline' | 'unconfigured';
      sessionId?: string;
      joinUntil?: number;
    }>;
    renewJoinWindow(): Promise<{
      state: 'connected' | 'offline' | 'unconfigured';
      sessionId?: string;
      joinUntil?: number;
    }>;
    onChanged(cb: (payload: {
      state: 'connected' | 'offline' | 'unconfigured';
      sessionId?: string;
      joinUntil?: number;
    }) => void): () => void;
  };
  /**
   * Thread control plane is HTTP to the product server (create/send/events).
   * Not a PTY spawn path. Desktop `terminals.create` remains legacyAgentSession.
   */
  threads: {
    create(input: {
      projectId: string;
      providerId: string;
      input?: string | string[] | Array<{ type: string; text?: string; mentions?: unknown[] }>;
      hostId?: string;
      environment?: SpawnEnvironmentChoice;
      cwd?: string;
      title?: string;
      permissionMode?: 'accept-edits' | 'auto' | 'full';
      model?: string;
      reasoningLevel?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'ultracode' | 'max' | 'ultra';
    }): Promise<Result<{
      id: string;
      projectId: string;
      hostId: string;
      environmentId: string | null;
      providerId: string;
      status: string;
      title: string | null;
      createdAt: number;
      cwd: string | null;
      branchName: string | null;
      isWorktree: boolean;
    }>>;
    /** @deprecated Use create(). */
    spawn(input: {
      projectId: string;
      providerId: string;
      input?: string | string[];
      hostId?: string;
      environment?: SpawnEnvironmentChoice;
      cwd?: string;
      title?: string;
    }): Promise<Result<{
      id: string;
      projectId: string;
      hostId: string;
      environmentId: string | null;
      providerId: string;
      status: string;
      title: string | null;
      createdAt: number;
      cwd: string | null;
      branchName: string | null;
      isWorktree: boolean;
    }>>;
    list(projectId?: string): Promise<Array<{
      id: string;
      projectId: string;
      hostId: string;
      environmentId: string | null;
      providerId: string;
      status: string;
      title: string | null;
      createdAt: number;
      cwd: string | null;
      branchName: string | null;
      isWorktree: boolean;
      archivedAt?: number | null;
      parentThreadId?: string | null;
      lastReadSeq?: number | null;
      maxSeq?: number;
      updatedAt?: number;
    }>>;
    get(threadId: string): Promise<{ thread: Record<string, unknown> }>;
    send(
      threadId: string,
      input: string | unknown[],
      mode?: string,
      extras?: {
        model?: string;
        reasoningLevel?: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'ultracode' | 'max' | 'ultra';
      }
    ): Promise<{ ok: boolean }>;
    stop(threadId: string): Promise<{ ok: boolean }>;
    cancelPlan(threadId: string): Promise<{ ok: boolean }>;
    resume(threadId: string): Promise<{ ok: boolean }>;
    timeline(threadId: string, query?: {
      segmentLimit?: number;
      beforeAnchorSeq?: number;
      beforeAnchorId?: string;
      afterSequence?: string;
      includeNestedRows?: 'true' | 'false';
      summaryOnly?: 'true' | 'false';
    }): Promise<{
      rows: unknown[];
      events: unknown[];
      status: string;
      goal?: unknown;
      pendingTodos?: unknown;
      activeThinking?: unknown;
      activePromptMode?: unknown;
      activeWorkflows?: unknown;
      activeBackgroundCommands?: unknown;
      modelFallback?: unknown;
      contextWindowUsage?: unknown;
      lastReadSeq?: number;
      maxSeq?: number;
      delta?: {
        upsertRows: unknown[];
        rowOrder?: string[];
      };
      timelinePage?: {
        kind: 'latest' | 'older';
        segmentLimit: number;
        returnedSegmentCount: number;
        hasOlderRows: boolean;
        olderCursor: { anchorSeq: number; anchorId: string } | null;
      };
    }>;
    read(threadId: string): Promise<{ thread: Record<string, unknown> }>;
    unread(threadId: string): Promise<{ thread: Record<string, unknown> }>;
    rename(threadId: string, title: string): Promise<{ thread: Record<string, unknown> }>;
    conversationOutline(threadId: string): Promise<{
      items: Array<{ id: string; role: 'user' | 'assistant'; preview: string; attachmentSummary: unknown }>;
      maxSeq: number;
    }>;
    timelineTurnSummaryDetails(
      threadId: string,
      query: { turnId: string; sourceSeqStart: string; sourceSeqEnd: string }
    ): Promise<{ rows: unknown[] }>;
    queuedMessages(threadId: string): Promise<unknown[]>;
    createQueuedMessage(threadId: string, body: { text?: string; input?: unknown[]; model?: string }): Promise<unknown>;
    updateQueuedMessage(threadId: string, queuedMessageId: string, body: { input: unknown[]; expectedUpdatedAt: number }): Promise<unknown>;
    deleteQueuedMessage(threadId: string, queuedMessageId: string): Promise<{ ok: true }>;
    sendQueuedMessage(threadId: string, queuedMessageId: string, mode: 'auto' | 'steer'): Promise<unknown>;
    reorderQueuedMessage(threadId: string, queuedMessageId: string, previousQueuedMessageId: string | null): Promise<unknown[]>;
    editMessage(threadId: string, body: {
      operationId: string;
      input: unknown[];
      expectedRequestSequence?: number;
      model?: string;
      reasoningLevel?: string;
    }): Promise<{ ok: true; operationId: string; requestSequence: number }>;
    hostFileContent(threadId: string, path: string): Promise<{
      path: string;
      relPath: string;
      content: string;
      encoding: 'utf8';
      contentType: string | null;
    }>;
    storageFiles(threadId: string): Promise<{
      files: Array<{ path: string; name: string }>;
      truncated: boolean;
      storageRootPath: string;
    }>;
    storageContent(threadId: string, path: string): Promise<{
      path: string;
      relPath: string;
      content: string;
      encoding: 'utf8';
      contentType: string | null;
    }>;
    open(threadId: string, body: {
      split?: 'right' | 'down' | 'left' | 'top' | 'replace';
      file: {
        source: 'workspace' | 'thread-storage';
        path: string;
        lineNumber: number | null;
      } | null;
    }): Promise<{ delivered: number }>;
    onOpen(cb: (payload: unknown) => void): () => void;
    events(threadId: string): Promise<{ events: unknown[] }>;
    executionOptions(query?: { providerId?: string }): Promise<{
      providers: Array<{
        id: string;
        displayName: string;
        available: boolean;
        composerActions: string[];
        capabilities: { permissionModes: string[] };
      }>;
      models: Array<{
        id: string;
        model: string;
        displayName: string;
        supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
        defaultReasoningEffort: string;
        isDefault: boolean;
      }>;
      selectedOnlyModels: Array<{
        id: string;
        model: string;
        displayName: string;
        supportedReasoningEfforts: Array<{ reasoningEffort: string; description: string }>;
        defaultReasoningEffort: string;
        isDefault: boolean;
      }>;
      permissionCeiling: string;
      modelLoadError: { providerId: string; code: string } | null;
    }>;
    providers(): Promise<{ providers: Array<{
      id: string;
      displayName: string;
      pluginId: string;
      permissionModes: string[];
      reasoningLevels: string[];
      composerActions: string[];
    }> }>;
    commands(projectId: string): Promise<{ commands: Array<{ id: string; name: string; providerId: string; description: string }> }>;
    onUpdated(cb: (payload: unknown) => void): () => void;
    onEvent(cb: (payload: unknown) => void): () => void;
    interactions: {
      list(threadId: string): Promise<PendingInteraction[]>;
      get(threadId: string, interactionId: string): Promise<PendingInteraction>;
      resolve(threadId: string, interactionId: string, resolution: PendingInteractionResolution): Promise<PendingInteraction>;
      respond(threadId: string, interactionId: string, value: JsonValue): Promise<PendingInteraction>;
      cancel(threadId: string, interactionId: string): Promise<PendingInteraction>;
    };
    archive(threadId: string): Promise<{ ok: boolean }>;
    fork(threadId: string, options?: { sourceSeqEnd?: number }): Promise<Result<{
      id: string;
      projectId: string;
      hostId: string;
      environmentId: string | null;
      providerId: string;
      status: string;
      title: string | null;
      createdAt: number;
      cwd: string | null;
      branchName: string | null;
      isWorktree: boolean;
    }>>;
  };
  environments: {
    list(projectId: string, hostId?: string): Promise<Environment[]>;
    status(environmentId: string): Promise<WorkspaceStatus>;
    diff(environmentId: string, target?: unknown): Promise<WorkspaceDiffResponse>;
    diffFiles(environmentId: string, target?: unknown): Promise<{
      outcome: 'available';
      files: Array<{
        path: string;
        previousPath: string | null;
        changeKind: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'type_changed';
        additions: number;
        deletions: number;
        binary: boolean;
        origin: 'tracked' | 'untracked';
        loadMode: 'auto' | 'on_demand' | 'too_large';
      }>;
      truncated: boolean;
      shortstat: string;
      mergeBaseRef: string | null;
      initialPatches: Array<{ path: string; patch: string; truncated: boolean }>;
    }>;
    diffPatch(
      environmentId: string,
      body: { target?: unknown; paths: string[] }
    ): Promise<{
      outcome: 'available';
      patches: Array<{ path: string; patch: string; truncated: boolean }>;
    }>;
    pullRequest(environmentId: string): Promise<{ pullRequest: GitHostPullRequest | null }>;
    action(environmentId: string, action: EnvironmentAction): Promise<Record<string, unknown>>;
    cancelProvision(environmentId: string): Promise<{ ok: boolean; cancelled?: boolean }>;
    destroy(environmentId: string): Promise<{ ok: boolean }>;
  };
  terminals: {
    verifyTmux(): Promise<TmuxVerifyResult>;
    listTmuxRestoreCandidates(): Promise<TmuxRestoreCandidate[]>;
    list(projectId: string): Promise<TerminalSession[]>;
    create(req: CreateTerminalRequest): Promise<Result<TerminalSession>>;
    /** Recreate a persisted tab from a main-owned capability. Legacy recipes require native confirmation. */
    restore(input: {
      capabilityId?: string;
      legacyRequest?: CreateTerminalRequest;
    }): Promise<Result<TerminalSession>>;
    /**
     * Re-attach a remote tab whose local `ssh` proxy died during machine sleep.
     * A capability is preferred. Legacy callers provide only tombstone identity;
     * main resolves request and tmux target from its persisted exited-session
     * record. Main re-authorizes and refuses unknown/mismatched identities and
     * non-remote projects.
     */
    reconnectRemote(input: {
      capabilityId?: string;
      legacy?: { projectId: string; profile: LaunchProfileId; sessionId: string };
    }): Promise<Result<TerminalSession>>;
    write(sessionId: string, data: string): Promise<void>;
    /**
     * Send a line of user input to a live session, as if typed at the prompt
     * (the text plus a trailing carriage return). Used by the inbox reply box
     * to answer a question an agent pushed via inbox_push, without leaving the
     * inbox. Thin intent-named wrapper over `write` so the carriage-return
     * convention lives in one place. Resolves false when the target pty already
     * exited (the agent died before the reply landed), true when delivered.
     */
    reply(sessionId: string, text: string): Promise<boolean>;
    resize(sessionId: string, cols: number, rows: number): Promise<void>;
    /** False means main could not safely terminate the session (for example a remote tmux failure). */
    close(sessionId: string): Promise<boolean>;
    /**
     * The session's retained output tail, for a late-subscribing TerminalView
     * (agent launched into the inspector modal / List-view monitor, which
     * mounts after the pty already printed) to replay into a fresh xterm so it
     * isn't a blank buffer. Empty string when nothing is buffered.
     */
    backlog(sessionId: string): Promise<string>;
    /**
     * Toggle the headless flag on a live session. Used to "hide" a tab
     * (X button / ⌘W) without killing its pty, and to restore one from
     * the Hidden picker.
     */
    setHeadless(sessionId: string, headless: boolean): Promise<TerminalSession | null>;
    /**
     * Toggle the per-agent Heartbeat opt-in (idle-nudge) on a live session.
     * Returns the updated session, or null if it's gone. Gated overall by the
     * `heartbeatEnabled` master switch; the UI hides the toggle for background
     * (scheduled/headless) agents.
     */
    setHeartbeat(sessionId: string, on: boolean): Promise<TerminalSession | null>;
    /**
     * Advisory: tell main which session is the foreground/active tab (or null
     * when none is focused). Fire-and-forget; main uses it only to SPARE the tab
     * the user is actively viewing from auto-close-idle — it can never authorize
     * a close, so a stale/forged value is harmless (renderer is untrusted).
     */
    setActiveSession(sessionId: string | null): Promise<void>;
    /**
     * Advisory: tell main which agents the user has starred/followed (the
     * persisted favorite-key set — stable `claudeSessionId` when present, else
     * the session id). Fire-and-forget; main uses it only to SPARE a pinned agent
     * from auto-close-idle — it can never authorize a close, so a stale/forged
     * value is harmless (renderer is untrusted).
     */
    setFavorites(keys: string[]): Promise<void>;
    /**
     * One-shot snapshot of every live session's current agent state, as
     * `[sessionId, state]` pairs. Seeds a freshly opened/reloaded window:
     * {@link onAgentStatus} is edge-triggered, so a window opened after an
     * agent's last transition (every per-project sub-window) would otherwise
     * never learn its state and its cards would sit stuck at `unknown`/Idle.
     */
    agentStatusSnapshot(): Promise<Array<[string, AgentState]>>;
    /**
     * Cursor-based replay of agent-status transitions after `sinceSeq`. Returns
     * either `{mode:'replay', events, headSeq}` (when no buffer gap) or
     * `{mode:'snapshot', snapshot, headSeq}` (when the cursor is too old / bogus
     * and the ring overflowed past it). Main validates `sinceSeq` (Rule 1) and
     * decides replay vs snapshot. A (re)connecting renderer replays missed status
     * transitions via this cursor, falling back to a full snapshot only on a
     * genuine buffer gap.
     */
    agentStatusSince(sinceSeq: number): Promise<AgentStatusReplay>;
    /**
     * One-shot snapshot of every session with a live sub-agent (Task tool)
     * count > 0, as `[sessionId, count]` pairs. Seeds a freshly opened window:
     * {@link onSubagents} is edge-triggered, so a window opened while a parent
     * is fanned out would otherwise show no badge until the next start/stop.
     * Sessions with no live sub-agents are omitted (0 is the renderer default).
     */
    subagentSnapshot(): Promise<Array<[string, number]>>;
    /**
     * One-shot snapshot of every session with ≥1 captured sub-agent child
     * record, as `[sessionId, SubagentChild[]]` pairs. Seeds a freshly opened
     * window the same way {@link subagentSnapshot} seeds the count.
     */
    subagentChildrenSnapshot(): Promise<Array<[string, SubagentChild[]]>>;
    onData(cb: (sessionId: string, data: string) => void): () => void;
    onExit(cb: (sessionId: string, code: number) => void): () => void;
    /**
     * Fired when the machine wakes from sleep (powerMonitor 'resume'). No
     * payload. The renderer uses it to re-attach remote tabs whose `ssh` proxy
     * died during sleep (see {@link reconnectRemote}).
     */
    onWake(cb: () => void): () => void;
    /**
     * Tab auto-rename pushes. `source` is `'osc'` (Claude's idle OSC title — the
     * fallback) or `'llm'` (the tab-namer micro-call from the first instruction,
     * which wins and pins). Absent `source` is treated as `'osc'`.
     */
    onTitle(
      cb: (sessionId: string, title: string, source?: 'osc' | 'llm') => void
    ): () => void;
    /** Fired when any session metadata changes (e.g. title/headless/exit). */
    onUpdated(cb: (session: TerminalSession) => void): () => void;
    /**
     * Live agent-state pushes (working/blocked/done/idle). Dedicated channel,
     * deliberately not folded into {@link onUpdated}: it fires far more often
     * and must land in a separate store slice so it can't rebuild the session
     * list on every tick. The 3rd `seq` arg is a monotonic counter advanced on
     * each transition, so a (re)connecting renderer can replay missed transitions
     * via {@link agentStatusSince}. See `docs/live-agent-status-plan.md`.
     */
    onAgentStatus(cb: (sessionId: string, state: AgentState, seq: number) => void): () => void;
    /**
     * Live sub-agent (Task tool) spawn count for a session. Dedicated channel,
     * like {@link onAgentStatus}, so it lands in its own store slice and a
     * start/stop never rebuilds the status rollup. Drives the "N sub-agents
     * running" badge on the parent session's card.
     */
    onSubagents(cb: (sessionId: string, count: number) => void): () => void;
    /**
     * Live per-child sub-agent records for a session (name/type + running/done).
     * Dedicated channel like {@link onSubagents}; pushes the full child array on
     * each change. Upgrades the "N sub-agents" badge to named child nodes.
     */
    onSubagentChildren(
      cb: (sessionId: string, children: SubagentChild[]) => void
    ): () => void;
    /**
     * Idle-triage classifications (idle-agent add-on; off by default). Fires
     * once per idle spell per session when the add-on is enabled. Dedicated
     * channel, like {@link onAgentStatus}, so it lands in its own store slice.
     */
    onIdleTriage(cb: (result: IdleTriageResult) => void): () => void;
    /**
     * Catch-up summary pushes (catch-up-summary add-on; EXPERIMENTAL, off by
     * default). Fires once per idle/blocked spell per session, after the
     * configured dwell, when the add-on is enabled. Delivers a tight markdown
     * catch-up for the agent modal's sub-terminal card. Dedicated channel, like
     * {@link onIdleTriage}, so it lands in its own store slice.
     */
    onCatchUpSummary(cb: (result: CatchUpSummaryResult) => void): () => void;
    /**
     * Generate a catch-up summary on demand for a live session (renderer-initiated
     * "Refresh summary" gesture when the user wants the latest state). Main
     * re-validates that `sessionId` belongs to `projectId` before reading its
     * transcript / running the LLM, so a stale/foreign id is rejected. Returns a
     * {@link CatchUpSummaryResult} with `ok: true` on success, `ok: false` on
     * failure (ineligible session, empty transcript, model error). Never throws.
     */
    generateCatchUpSummary(
      projectId: string,
      sessionId: string
    ): Promise<CatchUpSummaryResult>;
    /**
     * Clear a session's sticky "blocked / Needs you" overlay, re-tagging the
     * agent as Idle — a user gesture for an agent that's waiting on input the
     * user has decided to leave. Main re-validates that `sessionId` belongs to
     * `projectId` (Rule 1) then calls the same `clearBlocked` drop the Stop hook
     * performs; the resolved state falls back to the latest OSC reading (idle).
     * Resolves `true` when the overlay was cleared, `false` for a stale/foreign
     * id. Never throws.
     */
    clearAgentBlocked(projectId: string, sessionId: string): Promise<boolean>;
    /**
     * Per-session Overseer activity rollup (auto-approve cascade; experimental,
     * off by default). Fires (debounced) whenever a tool call is decided for a
     * session. Dedicated channel, like {@link onIdleTriage}, so an auto-approval
     * lands in its own store slice and never rebuilds the status rollup. Drives
     * the "auto-approved ×N (overseer)" card badge.
     */
    onOverseerActivity(cb: (activity: OverseerActivity) => void): () => void;
    /**
     * Summarize the given idle agents' work and push ONE combined entry to the
     * project's inbox — the optional "leave a summary" step of the Close-idle
     * action. Main owns this end to end (transcript read + LLM micro-call +
     * inbox append are all main-only capabilities); the renderer just hands it
     * the session ids it's about to close. Main re-validates that every id is a
     * live session belonging to `projectId` before reading its transcript, so a
     * stale/foreign id is skipped, not trusted. Returns how many agents were
     * actually summarized (0 when none had transcript text to classify); never
     * throws — a summary failure must not block the close that follows.
     */
    summarizeIdle(
      projectId: string,
      sessionIds: string[]
    ): Promise<{ summarized: number; entryId?: string }>;
    /**
     * Summarize ONE live agent's work on demand and push a single inbox entry
     * linked back to the session — the terminal modal's "Summarize to inbox"
     * action. Main owns it end to end (transcript read + LLM micro-call + inbox
     * append are main-only) and re-confines the id to `projectId` before reading
     * its transcript, so a stale/foreign id is rejected. Unlike `summarizeIdle`
     * the agent stays alive (no close). Never throws; returns a tagged result so
     * the renderer can toast precisely.
     */
    summarizeSession(
      projectId: string,
      sessionId: string
    ): Promise<
      | { ok: true; entryId: string }
      | { ok: false; reason: 'ineligible' | 'empty' | 'summary-failed' | 'write-failed' }
    >;
    /**
     * Read-only, display-only stats distilled from a claude session's transcript
     * (model, context tokens, rough cost, files touched, todo queue) for the
     * Agent Monitor status pane. Main authorizes from its own session record and
     * re-confines the id to `projectId`; a stale/foreign/non-claude id → null.
     * Never throws — resolves null on any failure so the pane just shows nothing.
     */
    sessionStats(projectId: string, sessionId: string): Promise<SessionStats | null>;
    /**
     * Fold the idle digest AND file per-agent follow-ups for any of `sessionIds`
     * that left work unfinished. The gated close twin of the read-only
     * `summarizeIdle`. Main re-confines every id to `projectId`.
     */
    closeFollowup(
      projectId: string,
      sessionIds: string[]
    ): Promise<{ summarized: number; followedUp: number }>;
  };
  config: {
    get(): Promise<AppConfig>;
    set(patch: Partial<AppConfig>): Promise<AppConfig>;
    /** Fires in EVERY window after any `config:set`, carrying the full new
     *  config, so each window re-applies its mirrored feature flags live. */
    onChanged(cb: (config: AppConfig) => void): () => void;
  };
  overseer: {
    /**
     * Recent Overseer decisions for the dry-run review pane, newest-first and
     * bounded by the audit ring's cap. Read-only diagnostic; empty when the
     * feature is off / nothing has been decided yet.
     */
    recent(limit?: number): Promise<OverseerAuditEntry[]>;
  };
  claude: {
    /** Main resolves this registered local project id to its canonical history scope. */
    listSessions(projectId: string): Promise<ClaudeSessionSummary[]>;
  };
  opencode: {
    listSessions(projectId: string): Promise<OpenCodeSessionSummary[]>;
  };
  history: {
    start(input: ConversationHistoryStartInput): Promise<ConversationHistorySnapshot>;
    refresh(snapshotId: string): Promise<ConversationHistorySnapshot>;
    page(snapshotId: string, opaquePageCursor?: string): Promise<ConversationHistorySnapshot>;
    release(snapshotId: string): Promise<void>;
    /** Main resolves this opaque row and launches provider-native exact resume. */
    resume(snapshotId: string, historyId: string): Promise<Result<TerminalSession>>;
  };
  fs: {
    /** Opens the native file chooser and returns only user-selected local paths. */
    pickFiles(): Promise<string[]>;
    listDir(path: string): Promise<FsEntry[]>;
    readFile(path: string): Promise<FsReadResult>;
    /**
     * Resolve a doc path reported by an agent that 404s at its reported
     * location — relocating it relative to `root`/`originCwd`. Main authorizes
     * and confines to `root`.
     */
    resolveDoc(root: string, reportedPath: string, originCwd?: string): Promise<FsResolveDocResult>;
    writeFile(path: string, content: string): Promise<FsWriteResult>;
    walkFiles(path: string): Promise<WalkedFile[]>;
    searchFiles(path: string, query: string, opts?: SearchOptions): Promise<SearchResult>;
    readDataUrl(path: string): Promise<FsReadDataUrlResult>;
    /** Create an empty file at `path`, confined to `root` (project dir). */
    createFile(root: string, path: string): Promise<FsMutateResult>;
    /** Create a directory at `path`, confined to `root`. */
    createDir(root: string, path: string): Promise<FsMutateResult>;
    /** Rename / move `from` to `to`, both confined to `root`. */
    rename(root: string, from: string, to: string): Promise<FsMutateResult>;
    /** Permanently delete `path` (recursive for dirs), confined to `root`. */
    delete(root: string, path: string): Promise<FsMutateResult>;
    /**
     * Resolve the remote browse root for a remote-backed project. The host /
     * user / start path come from the store (never the renderer); `projectId`
     * is the only argument. Returns the realpath'd remote root the Explorer
     * seeds its tree from.
     */
    remoteRoot(projectId: string): Promise<RemoteRootResult>;
    /** List a directory on the remote host of `projectId`. `path` is confined to the remote root. */
    listDirRemote(projectId: string, path: string): Promise<FsEntry[]>;
    /** Read a file on the remote host of `projectId`. `path` is confined to the remote root. */
    readFileRemote(projectId: string, path: string): Promise<FsReadResult>;
    /** Write to an existing remote regular file of `projectId`. Confined to the remote root. */
    writeFileRemote(projectId: string, path: string, content: string): Promise<FsWriteResult>;
    /** Create an empty file on the remote host of `projectId`. Confined to the remote root. */
    createFileRemote(projectId: string, path: string): Promise<FsMutateResult>;
    /** Create a directory on the remote host of `projectId`. Confined to the remote root. */
    createDirRemote(projectId: string, path: string): Promise<FsMutateResult>;
    /** Rename / move a remote path of `projectId`. Both ends confined to the remote root. */
    renameRemote(projectId: string, from: string, to: string): Promise<FsMutateResult>;
    /** Permanently delete a remote path of `projectId`. Confined to the remote root. */
    deleteRemote(projectId: string, path: string): Promise<FsMutateResult>;
    /**
     * Upload a local file to the remote host of `projectId`, staging it under
     * `<destDir>/.zcc-uploads/`. `destDir` is a remote dir (confined to root);
     * pass the session cwd or a tree folder. Returns the final remote path.
     */
    uploadToRemote(projectId: string, localPath: string, destDir: string): Promise<RemoteTransferResult>;
    /**
     * Download a remote file of `projectId` to the local machine. Opens an OS
     * save dialog (defaulting to the file's basename); `canceled` is set if the
     * user dismisses it. `remotePath` is confined to the remote root.
     */
    downloadFromRemote(projectId: string, remotePath: string): Promise<RemoteTransferResult>;
  };
  openers: {
    openIn(target: OpenTarget, path: string): Promise<OpenResult>;
  };
  clipboard: {
    /**
     * Write text via Electron's main-process `clipboard` module rather than the
     * renderer's `navigator.clipboard` — the web API can throw when the document
     * lacks focus/transient-activation; this path has no such restriction.
     */
    writeText(text: string): Promise<{ ok: boolean }>;
  };
  git: {
    /**
     * Git status of the repo containing `path`. `scope` — absolute paths the
     * caller cares about (an agent's write-set) — is passed to git as a
     * pathspec list so untracked NEW files are enumerated individually (git's
     * default collapses them into a `?? dir/` entry) and the walk is scoped +
     * fast. main confines `scope` to the repo before trusting it (Rule 1/2);
     * omit it for a full-tree status.
     */
    status(path: string, scope?: string[] | null): Promise<GitStatus | null>;
    showHead(path: string): Promise<GitShowResult>;
    discard(path: string): Promise<GitDiscardResult>;
    /** Create a short-lived, main-owned snapshot of every current project change. */
    previewCommit(projectId: string): Promise<{ ok: true; value: GitCommitPreview } | { ok: false; message: string }>;
    /** Commit only the confirmed main-owned write-set; stale previews are rejected. */
    commitProject(previewId: string, message: string): Promise<GitWorkflowResult>;
    /** Push the current branch of one main-authorized registered local project. */
    pushProject(projectId: string): Promise<GitWorkflowResult>;
    /** Best-effort Git-repository probe. Main remains authoritative at launch. */
    isRepo(path: string): Promise<boolean>;
    /** List the linked worktrees of the repo containing `path`. */
    listWorktrees(path: string): Promise<Worktree[]>;
    /** List the local branches of the repo containing `path`. */
    listBranches(path: string): Promise<GitBranch[]>;
    /**
     * Remove a linked worktree from the repo containing `projectPath`. `force`
     * drops it even with uncommitted/untracked changes (a clean worktree prunes
     * without it). main re-validates the target sits under the app-managed
     * worktree root before removing (Rule 1/2). Never rejects.
     */
    removeWorktree(
      projectPath: string,
      worktreePath: string,
      force?: boolean
    ): Promise<{ ok: boolean; message?: string }>;
  };
  files: {
    pathForFile(file: File): string;
    read(input: { hostId?: string; path: string; rootPath?: string }): Promise<{
      path: string;
      content: string;
      contentEncoding: 'utf8' | 'base64';
      mimeType?: string;
      sizeBytes: number;
      modifiedAtMs?: number;
      sha256: string;
    }>;
    list(input: { hostId?: string; path: string; query?: string; limit?: number }): Promise<{
      files: Array<{ path: string; name: string }>;
      truncated: boolean;
    }>;
    listPaths(input: {
      hostId?: string;
      path: string;
      query?: string;
      limit?: number;
      includeFiles: boolean;
      includeDirectories: boolean;
    }): Promise<{
      paths: Array<{
        kind: 'file' | 'directory';
        path: string;
        name: string;
        score: number;
        positions: number[];
      }>;
      truncated: boolean;
    }>;
  };
  app: {
    onMenuEvent(cb: (event: string) => void): () => void;
    homedir(): Promise<string>;
    /** The running app version (package.json `version`), for the About section. */
    version(): Promise<string>;
    /**
     * Whether this platform can run a microVM (Apple Silicon / KVM / WHP). Main is
     * the source of truth for the gate; the launcher uses it to disable the
     * microVM isolation option on unsupported hardware (e.g. Intel Mac).
     */
    microVmSupported(): Promise<boolean>;
    /** Fired when an OS notification click asks the UI to focus a session. */
    onFocusSession(cb: (sessionId: string, projectId: string) => void): () => void;
    /**
     * Fired when the menu-bar tray asks the UI to open the Scheduler. A task id
     * means "reveal this schedule in its scope"; absent means the overview.
     */
    onOpenScheduler(cb: (taskId?: string) => void): () => void;
    /** Fired when the menu-bar popover asks the UI to open the Agents board. */
    onOpenAgents(cb: () => void): () => void;
    /**
     * Fired when main mutates the favorite set on the UI's behalf (the menu-bar
     * popover pin), so the renderer's persisted star set stays authoritative
     * and in step. Carries the full key list.
     */
    onFavoritesChanged(cb: (keys: string[]) => void): () => void;
    /** Fired when a loud-tier native notification is clicked, to focus that inbox entry's project. */
    onFocusInboxEntry(cb: (entryId: string, projectId: string) => void): () => void;
    /** Set the focused BrowserWindow's OS-level fullscreen state. */
    setFullScreen(flag: boolean): Promise<void>;
    /** Whether the focused BrowserWindow is currently OS-level fullscreen. */
    isFullScreen(): Promise<boolean>;
    /** Fired on 'enter-full-screen'/'leave-full-screen' for this window (OS-initiated or IPC-initiated). */
    onFullScreenChanged(cb: (isFullScreen: boolean) => void): () => void;
  };
  /**
   * Menu-bar popover surface. Read-only for the popover renderer: it subscribes
   * to `onSnapshot` (live fleet pushes from `MenubarController`), asks for one
   * immediate snapshot via `request()` on mount, and calls the action verbs —
   * every one routes through a main-authorized handler (Rule 1), so the popover
   * never carries trust. `setFavorite` is the pin toggle (reuses the favorite
   * set the sidebar star uses).
   */
  menubar: {
    /** Ask main to push a fresh snapshot now (seeds the popover on open). */
    request(): Promise<MenubarSnapshot>;
    /** Live fleet snapshots pushed on any fleet/state/schedule change. */
    onSnapshot(cb: (snapshot: MenubarSnapshot) => void): () => void;
    /** Show the main window and focus a session (row click). */
    focusSession(sessionId: string, projectId: string): Promise<void>;
    /** Toggle a session's favorite/pin (the row pin affordance). */
    setFavorite(sessionId: string, favorite: boolean): Promise<void>;
    /**
     * Light-interaction reply: send `text` to a blocked agent's stdin without
     * opening the app. Resolves the outcome — `{ ok:false, reason }` when main
     * refuses (unknown/ended session, background job, empty text) so the popover
     * can surface why rather than silently dropping.
     */
    reply(sessionId: string, text: string): Promise<MenubarReplyResult>;
    /** Footer nav: show the main window on a named view. */
    open(view: 'dashboard' | 'agents' | 'settings' | 'scheduler'): Promise<void>;
    /** Hide the popover window (blur/Esc/after an action). */
    hide(): Promise<void>;
    /** Quit the whole app (footer power button). */
    quit(): Promise<void>;
  };
  /** Multi-window control surface (open a window scoped to one project). */
  windows: {
    /**
     * Open (or focus) a window locked to a single project — the renderer-side
     * half of "Open in New Window". Main validates the id and de-dupes against
     * an existing window for the same project. Resolves `true` once handled.
     */
    openProject(projectId: string): Promise<boolean>;
  };
  skills: {
    list(projectPath?: string): Promise<SkillEntry[]>;
    setEnabled(name: string, enabled: boolean): Promise<void>;
    setManyEnabled(updates: Array<{ name: string; enabled: boolean }>): Promise<void>;
    readHooks(): Promise<unknown>;
    reveal(skillId: string, projectPath?: string): Promise<{ ok: boolean; path: string; message?: string }>;
    onChanged(cb: () => void): () => void;
    bundles: {
      list(): Promise<SkillBundle[]>;
      create(input: SkillBundleInput): Promise<SkillBundle>;
      update(id: string, patch: Partial<SkillBundleInput>): Promise<SkillBundle | null>;
      delete(id: string): Promise<boolean>;
      apply(
        id: string,
        mode: SkillBundleApplyMode,
        projectPath?: string
      ): Promise<SkillBundleApplyResult>;
      onChanged(cb: (bundles: SkillBundle[]) => void): () => void;
    };
  };
  commands: {
    /** Discover Claude Code slash commands (user + enabled-plugin + project). */
    list(projectPath?: string): Promise<SlashCommand[]>;
  };
  inbox: {
    history(opts?: {
      limit?: number;
      before?: string;
      projectId?: string;
    }): Promise<{ entries: InboxEntry[]; hasMore: boolean }>;
    delete(id: string): Promise<boolean>;
    /**
     * Bulk-delete entries by explicit id list (the entries to REMOVE). Used by
     * "Clear inbox", which passes every non-kept id. Resolves the count removed.
     */
    deleteMany(ids: string[]): Promise<number>;
    /**
     * Render a standalone HTML document (the inbox detail, already rendered
     * in the renderer — mermaid SVGs and highlighted code included) to a PDF
     * via a hidden BrowserWindow, prompting the user for a save location.
     * Resolves the result of the save (cancelled is `{ ok: false }`).
     */
    exportPdf(input: InboxPdfExport): Promise<InboxPdfExportResult>;
    /**
     * Generate an AI digest of the inbox — the "AI Summary" card. Pass a
     * `projectId` to scope it to that project (the focused/scoped view), or
     * null/omit for an all-projects digest. Reads main's own store, runs the
     * `builtin:inbox-summary` micro-call, and returns a structured digest.
     * Never throws — failures resolve to `{ ok:false, reason }`.
     */
    summarize(projectId?: string | null): Promise<InboxSummaryResult>;
    /**
     * Generate a RICH, sectioned digest — backs the "expand" modal on the AI
     * Summary card. Same scope contract as {@link summarize} (pass a `projectId`
     * to scope, null/omit for all projects), but runs the
     * `builtin:inbox-summary-detailed` micro-call and returns themed sections
     * with actionable points. Each point's `projectId` (when present) is resolved
     * + validated in main from the model's project-name mention (Rule 1) so a
     * hallucinated name can't seed a spawn into the wrong project. On-demand only
     * — never background-warmed. Never throws — failures resolve to `{ ok:false }`.
     */
    summarizeDetailed(projectId?: string | null): Promise<DetailedInboxSummaryResult>;
    /**
     * OPTIONAL feed-noise classifier: return the ids of free-form reports main
     * judges ROUTINE (a "task done" note with no docs/question/goal) and safe to
     * fold into the collapsed "Routine" section. Same scope contract as
     * {@link summarize}. Runs the `builtin:feed-noise-classifier` micro-call
     * behind a deterministic candidate gate (a doc/question/goal-bearing entry
     * is never even shown to the model). On-demand only, gated by the
     * `feedNoiseClassifierEnabled` setting (off by default, spends tokens). Never
     * throws — failures resolve to an empty id set (nothing folded).
     */
    classifyNoise(projectId?: string | null): Promise<FeedNoiseResult>;
    onAppended(cb: (entry: InboxEntry) => void): () => void;
    onRemoved(cb: (id: string) => void): () => void;
    /**
     * Fires when a push was coalesced into an existing entry (same
     * `(projectId, dedupeKey)`) rather than appended — see
     * {@link InboxEntry.dedupeKey}. Carries the full refreshed entry (same `id`,
     * bumped `ts`/`occurrences`); the renderer replaces it in place. Distinct
     * from `onAppended` so the feed updates the existing row instead of
     * prepending a duplicate.
     */
    onUpdated(cb: (entry: InboxEntry) => void): () => void;
    /**
     * Fires when retention eviction drops old entries; carries their ids. The
     * renderer removes the rows and prunes their persisted read/keep/answered
     * markers so those localStorage maps stay bounded. Mirrors
     * `agents.onMessagesPruned`.
     */
    onPruned(cb: (removedIds: string[]) => void): () => void;
  };
  /**
   * Usage / cost rollup (WARP R2 B7). Data layer only — the dashboard view
   * lands in a follow-up PR.
   */
  usage: {
    /**
     * Compute a privacy-safe cost/usage summary across all registered projects
     * from their Claude transcripts. A main-only read (Rule 1): the renderer
     * supplies nothing; main aggregates over its own project registry, bounded
     * per Rule 5. Every session in the result carries id + project + persona +
     * model + cost/tokens/duration ONLY — never a prompt/title/file. Never
     * throws — an unexpected failure resolves to an empty summary.
     */
    getSummary(): Promise<UsageSummary>;
  };
  /**
   * Suggested Actions launcher (afl-03) — a SIBLING to the inbox, not a feed
   * category. Agents propose runnable next-steps via `suggest_action`; the
   * operator triggers them here. `run` re-authorizes every step in main (the
   * renderer never supplies the action — rule 1) and returns a nav directive
   * the renderer applies.
   */
  suggestions: {
    /** List suggestions, optionally scoped to a projectId. Newest-first, expiry-filtered. */
    list(projectId?: string): Promise<{ entries: Suggestion[]; hasMore: boolean }>;
    /** Dismiss (delete) a suggestion by id. Resolves whether it was removed. */
    dismiss(id: string): Promise<boolean>;
    /**
     * Execute a suggestion by id. Main reads it from its OWN store and
     * re-authorizes each action step; resolves a directive describing what the
     * renderer should do next (navigation only — spawns happen in main).
     */
    run(id: string): Promise<{ ok: boolean; nav?: string; projectId?: string; tabId?: string }>;
    onAppended(cb: (entry: Suggestion) => void): () => void;
    onRemoved(cb: (id: string) => void): () => void;
    /** Fires when a push coalesced into an existing entry (same dedupeKey). */
    onUpdated(cb: (entry: Suggestion) => void): () => void;
    /** Fires when retention eviction drops old suggestions; carries their ids. */
    onPruned(cb: (removedIds: string[]) => void): () => void;
  };
  /**
   * Inter-agent mesh, read-only. `list` is the live discovery registry;
   * `messages` is the agent↔agent audit history (separate from `inbox`, which
   * is agent→User). `onRegistryChanged` fires on register/seed/drop;
   * `onMessage` fires per send. Both return an unsubscribe fn.
   */
  agents: {
    list(): Promise<AgentRecord[]>;
    messages(projectId?: string): Promise<AgentMessage[]>;
    onRegistryChanged(cb: () => void): () => void;
    onMessage(cb: (msg: AgentMessage) => void): () => void;
    /** Fires when old messages are evicted by retention; carries their ids. */
    onMessagesPruned(cb: (removedIds: string[]) => void): () => void;
  };
  saved: {
    /** Persist a saved report. Resolves null on failure (caller toasts). */
    save(input: SavedRecordInput): Promise<SavedRecord | null>;
    list(): Promise<SavedRecord[]>;
    delete(id: string): Promise<boolean>;
    onChanged(cb: (records: SavedRecord[]) => void): () => void;
  };
  library: {
    list(): Promise<LibraryDoc[]>;
    add(input: LibraryAddInput): Promise<LibraryDoc | null>;
    update(id: string, patch: Partial<Pick<LibraryDoc, 'title' | 'summary' | 'tags'>>): Promise<LibraryDoc | null>;
    remove(id: string): Promise<boolean>;
    reveal(scope: LibraryScope, projectId?: string): Promise<{ ok: boolean; path: string; message?: string }>;
    /** Full-text search of document bodies across both scopes (bounded). */
    search(query: string): Promise<LibrarySearchResult>;
    /**
     * Read a doc's content by scope + relPath. Unlike the generic `fs.readFile`,
     * this confines to the scope's own library dir, so GLOBAL docs (which live
     * outside any registered project) can be previewed. The renderer passes only
     * scope + relPath — never an absolute path.
     */
    read(scope: LibraryScope, relPath: string, projectId?: string): Promise<FsReadResult>;
    /** Write a doc's content by scope + relPath (edit-save twin of `read`). */
    write(scope: LibraryScope, relPath: string, content: string, projectId?: string): Promise<FsWriteResult>;
    /** Create a folder at scope+relPath (and missing parents) — the folder tree's "New folder". */
    createFolder(scope: LibraryScope, relPath: string, projectId?: string): Promise<FsMutateResult>;
    /** Move/rename a file or folder, possibly across scopes (e.g. project doc -> Global). */
    move(
      from: { scope: LibraryScope; relPath: string; projectId?: string },
      to: { scope: LibraryScope; relPath: string; projectId?: string }
    ): Promise<FsMutateResult>;
    /** Permanently delete a file or folder (recursive for a folder), by scope+relPath. */
    deleteEntry(scope: LibraryScope, relPath: string, projectId?: string): Promise<FsMutateResult>;
    onChanged(cb: (docs: LibraryDoc[]) => void): () => void;
  };
  mcp: {
    list(projectPath: string): Promise<McpServer[]>;
    setEnabled(projectPath: string, name: string, enabled: boolean): Promise<void>;
    listAll(): Promise<McpServerEntry[]>;
    setEnabledById(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    onChanged(cb: (entries: McpServerEntry[]) => void): () => void;
  };
  plugins: {
    list(): Promise<PluginEntry[]>;
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    onChanged(cb: (entries: PluginEntry[]) => void): () => void;
  };
  marketplaces: {
    list(): Promise<MarketplaceCatalogRow[]>;
    add(source: string): Promise<MarketplaceCatalogRow>;
    refresh(source: string): Promise<MarketplaceCatalogRow>;
    remove(source: string): Promise<{ ok: true }>;
  };
  cliSkills: {
    status(hostIds?: string[]): Promise<{
      machines: Array<{
        hostId: string;
        hostName: string;
        status: 'installed' | 'outdated' | 'missing' | 'unknown';
      }>;
    }>;
    install(hostIds: string[]): Promise<{
      results: Array<
        | { ok: true; hostId: string; hostName: string; installations: Array<{ name: string; path: string }> }
        | { ok: false; hostId: string; hostName: string; errorMessage: string }
      >;
    }>;
  };
  pluginApps: {
    list(): Promise<PluginAppEntry[]>;
    onChanged(cb: (entries: PluginAppEntry[]) => void): () => void;
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>;
    callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
    getSettings(pluginId: string): Promise<PluginSettingsSnapshot>;
    setSettings(
      pluginId: string,
      values: Record<string, string | boolean | undefined>
    ): Promise<PluginSettingsSnapshot>;
    checkUpdates(): Promise<Array<{
      id: string;
      current: string;
      available: string;
      marketplace: string;
    }>>;
    applyUpdate(id: string): Promise<Result<true>>;
  };
  /**
   * Runtime extensions discovered under `~/.zcc/extensions/<id>/`.
   * Mirrors `plugins`. `setEnabled(id, false)` tears down the extension's main
   * module; `readRendererEntry(id)` returns the renderer bundle JS as a string
   * (or null) for the renderer to blob-import.
   */
  extensions: {
    list(): Promise<ExtensionEntry[]>;
    setEnabled(id: string, enabled: boolean): Promise<Result<true>>;
    reveal(id: string): Promise<Result<true>>;
    readRendererEntry(id: string): Promise<string | null>;
    /**
     * P3-D: record the user's consent to the extension's CURRENT declared
     * permissions, then re-discover (spawning/mounting it). After this the
     * entry's `consented` is true / `needsConsent` is null until an update
     * widens the declared set.
     */
    grantConsent(id: string): Promise<Result<true>>;
    /**
     * Declare an extra `permission` in the extension's manifest (the "add
     * permission" action / Doctor repair). This only WIDENS the declared set;
     * the subsequent re-discovery stamps `needsConsent:'widened'` so the user
     * must approve it via `grantConsent` before it takes effect — declaring a
     * capability never auto-grants it.
     */
    addPermission(id: string, permission: string): Promise<Result<true>>;
    /**
     * Remove a declared `permission` from the extension's manifest AND prune it
     * from the consent record. Narrowing the declared set is silent (no
     * re-prompt); pruning the approved snapshot preserves the
     * re-prompt-on-readd guarantee (a later re-add re-triggers consent).
     */
    removePermission(id: string, permission: string): Promise<Result<true>>;
    /**
     * Relaunch a disk extension's main-process child — teardown (if any) then
     * respawn from its retained spec. Recovers a crashed/hung backend without an
     * app restart. `value` is `true` when the fresh child reported ready, `false`
     * when it failed to come up; `ok:false` (code `NOT_FOUND`) for an unknown id
     * or a built-in (no separate child to respawn).
     */
    relaunch(id: string): Promise<Result<boolean>>;
    /**
     * Re-scan `~/.zcc/extensions` and reconcile live children without an app
     * restart: spawn newly-appeared/consented exts, respawn changed ones, tear
     * down removed ones. The explicit "Reload" button; the file-watcher invokes
     * the same path automatically. Takes no input — it only re-reads disk.
     */
    rescan(): Promise<Result<true>>;
    /**
     * Install an extension on demand without rebuilding the app. For a local
     * source main opens the OS picker itself (a renderer-supplied path is never
     * trusted); for a marketplace source it downloads + verifies the release.
     * Main validates the manifest, id, containment, and API compatibility before
     * the atomic install. A freshly installed ext with permissions starts
     * unconsented (its panel/main won't run until the consent overlay is approved).
     */
    install(source: ExtensionInstallSource): Promise<Result<{ id: string }>>;
    /**
     * Uninstall an installed extension: tear down its live child, remove its
     * (containment-checked) install dir, and forget its consent. Renderer passes
     * only an id; main re-derives and confines the path before deleting. A
     * built-in id is refused (`RESERVED_ID`).
     */
    uninstall(id: string): Promise<Result<true>>;
    /**
     * Check the opt-in remote registry for updates to installed extensions and
     * apply every compatible, non-permission-widening release. A no-op (empty
     * result) unless `~/.zcc/extension-registry.json` is enabled with an HTTPS URL.
     */
    checkUpdates(): Promise<Result<ExtensionUpdateOutcome[]>>;
    /**
     * Fetch the marketplace catalog: first-party plugins the app ships (offline)
     * unioned with configured community catalogs and the opt-in signed registry.
     * Each row is stamped with installed / hasUpdate / compatible. Returns []
     * only when nothing is bundled and no catalog or registry is configured —
     * the host never reaches the network by default.
     */
    marketplaceList(): Promise<Result<MarketplaceEntry[]>>;
    /**
     * Create a new LOCAL (in-app authored) extension. Main mints a unique id,
     * scaffolds a starter template into a scratch working dir, packs + installs
     * it through the SAME trust gates as any install (consent still applies — no
     * "trust local" fast-path), and records it in `local.json`. Returns the
     * minted id + working dir so the renderer can launch the Creator agent.
     */
    createLocal(req: CreateLocalExtensionRequest): Promise<Result<CreateLocalExtensionResult>>;
    /**
     * Pick an existing extension source directory, install its current build, and
     * register it as a local editable source. Main owns the picker and records
     * the canonical selected path; the renderer supplies no filesystem path.
     */
    adoptLocal(): Promise<Result<CreateLocalExtensionResult>>;
    /** Clone an extension repository and register its manifest directory as editable source. */
    adoptLocalGit(req: AdoptLocalExtensionGitRequest): Promise<Result<CreateLocalExtensionResult>>;
    /**
     * Re-pack + reinstall a local extension from its recorded source working dir
     * ("Reload from source"). Renderer passes only an id; main re-derives the
     * working dir from `local.json` (Rule 1) — never renderer/agent free-text.
     */
    reinstallLocal(id: string): Promise<Result<{ id: string }>>;
    /**
     * Re-clone + reinstall a GIT extension from its recorded source repo ("Update
     * from repo"). Renderer passes only an id; main re-derives `{url, ref}` from
     * `git.json` (Rule 1) — never renderer/agent free-text. Same gates + tree
     * scrub as a fresh git install; a scope-widening update re-prompts consent.
     */
    reinstallFromGit(id: string): Promise<Result<{ id: string }>>;
    /**
     * Resolve a local extension's source working dir + scratch project id so the
     * renderer can re-open the Creator agent against it ("Continue building").
     * Main re-derives from `local.json` (Rule 1); a non-local id fails.
     */
    localInfo(id: string): Promise<Result<CreateLocalExtensionResult>>;
    /**
     * Assemble a clean git-ready export of a local extension under
     * `<workingDir>/share` (manifest + `dist/` + a generated README with the
     * install one-liner) and reveal it in the OS file manager ("Prepare for
     * sharing"). Main re-derives the working dir from `local.json` (Rule 1).
     * Returns the absolute share dir path.
     */
    prepareShare(id: string): Promise<Result<{ shareDir: string }>>;
    /**
     * Redeploy the app's runtime capability artifacts on demand: re-run every
     * bundled SKILL.md installer (into `~/.claude/skills`) and re-sync each
     * project's `.mcp.json`. Idempotent + best-effort — the same edit-respecting
     * write as boot. Returns a per-skill outcome + the count of projects whose
     * MCP config was (re)written, so the UI can report what happened.
     */
    redeployCapabilities(): Promise<
      Result<{ skills: Array<{ name: string; ok: boolean }>; mcpProjects: number }>
    >;
    /**
     * Fire-and-forget clone/install progress lines from an in-flight git
     * install/update. Returns an unsubscribe fn. Distinct from
     * `projects.onCloneProgress` (project clones) though both stream from git.
     */
    onInstallProgress(cb: (line: string) => void): () => void;
    onChanged(cb: (entries: ExtensionEntry[]) => void): () => void;
  };
  claudeSettings: {
    read(projectId: string, scope: ClaudeSettingsScope): Promise<ClaudeSettingsResult>;
    write(
      projectId: string,
      scope: ClaudeSettingsScope,
      patch: ClaudeProjectSettings,
      expectedHash: string | null
    ): Promise<ClaudeSettingsResult>;
    openFile(projectId: string, fileId: ClaudeProjectFileId): Promise<OpenResult>;
  };
  codexSettings: {
    read(projectId: string): Promise<CodexSettingsResult>;
    write(projectId: string, patch: CodexProjectSettings, expectedHash: string | null): Promise<CodexSettingsResult>;
  };
  openCodeSettings: {
    read(projectId: string): Promise<OpenCodeSettingsResult>;
    write(projectId: string, patch: OpenCodeProjectSettings, expectedHash: string | null): Promise<OpenCodeSettingsResult>;
  };
  scheduler: {
    list(): Promise<ScheduledTask[]>;
    create(input: ScheduleCreateInput): Promise<Result<ScheduledTask>>;
    update(id: string, patch: ScheduleUpdateInput): Promise<Result<ScheduledTask>>;
    delete(id: string): Promise<Result<true>>;
    setEnabled(id: string, enabled: boolean): Promise<Result<ScheduledTask>>;
    runNow(id: string): Promise<Result<ScheduledTask>>;
    onChanged(cb: (tasks: ScheduledTask[]) => void): () => void;
    listTemplates(): Promise<ScheduleTemplate[]>;
    onTemplatesChanged(cb: (templates: ScheduleTemplate[]) => void): () => void;
    revealTemplatesDir(): Promise<{ ok: boolean; path: string; message?: string }>;
    groups: {
      list(): Promise<ScheduleGroup[]>;
      create(input: ScheduleGroupInput): Promise<Result<ScheduleGroup>>;
      update(id: string, patch: Partial<ScheduleGroupInput>): Promise<Result<ScheduleGroup>>;
      /** Removes the group; schedules referencing it fall back to Ungrouped. */
      delete(id: string): Promise<Result<true>>;
      reorder(orderedIds: string[]): Promise<ScheduleGroup[]>;
      onChanged(cb: (groups: ScheduleGroup[]) => void): () => void;
    };
  };
  /**
   * Persistent project goals — an objective + falsifiable success criteria that
   * the main process works toward by spawning a worker, evaluating it, and
   * re-spawning with feedback until the criteria pass (or it caps out / stalls).
   * Mirrors the scheduler surface; `setStatus` arms/pauses/cancels the loop.
   */
  goals: {
    list(): Promise<Goal[]>;
    create(input: GoalCreateInput): Promise<Result<Goal>>;
    update(id: string, patch: GoalUpdateInput): Promise<Result<Goal>>;
    delete(id: string): Promise<Result<true>>;
    /** Arm (`active`), suspend (`paused`), or abandon (`cancelled`) the loop. */
    setStatus(id: string, status: GoalStatus): Promise<Result<Goal>>;
    /** Force one iteration now, regardless of cadence. */
    runNow(id: string): Promise<Result<Goal>>;
    onChanged(cb: (goals: Goal[]) => void): () => void;
  };
  /**
   * Follow-ups — agent-parked questions / decisions awaiting a human. The durable
   * twin of the ephemeral "Needs you" idle badge. See `docs/followups-design.md`.
   */
  followups: {
    list(): Promise<FollowUp[]>;
    create(input: FollowUpCreateInput): Promise<Result<FollowUp>>;
    update(id: string, patch: FollowUpUpdateInput): Promise<Result<FollowUp>>;
    delete(id: string): Promise<Result<true>>;
    /** Move a follow-up to `open` / `resolved` / `dismissed`; optional resolution note. */
    setStatus(id: string, status: FollowUpStatus, resolution?: string): Promise<Result<FollowUp>>;
    /**
     * Stamp {@link FollowUp.spawnedAt} = now, marking the follow-up "work in
     * progress" so the UI locks its spawn buttons for {@link FOLLOWUP_SPAWN_LOCK_MS}.
     * Called after the renderer kicks off a spawn.
     */
    markSpawned(id: string): Promise<Result<FollowUp>>;
    onChanged(cb: (followups: FollowUp[]) => void): () => void;
  };
  /**
   * Per-project Activity Feed — a read-only, chronological history of what
   * happened on a project. Main derives it on demand from its own stores + git;
   * the renderer never supplies data, only the projectId to scope + a cursor.
   * See `.zcc/library/designs/project-activity-feed.md`.
   */
  feed: {
    /** Read a page of feed events for a project, newest-first. `before` is a cursor (ts). */
    list(projectId: string, opts?: { limit?: number; before?: number }): Promise<FeedPage>;
    /** Force a re-derive (re-reads git log) for a project, then return the first page. */
    refresh(projectId: string, opts?: { limit?: number }): Promise<FeedPage>;
    /** Run the LLM weekly-recap digest over a project's recent feed. Never rejects. */
    digest(projectId: string): Promise<FeedDigestResult>;
    /** Fires when a project's PERSISTED feed slice changed (commit/extension/project). */
    onChanged(cb: (projectId: string) => void): () => void;
  };
  /**
   * Launchable personas — named, reusable `claude` flag bundles. Read-only over
   * the merged persona store (builtin ⊕ user dir ⊕ project dir); authoring is by
   * hand-editing the JSON files the `reveal` action opens. Mirrors the
   * scheduler-template surface.
   */
  personas: {
    list(): Promise<Persona[]>;
    onChanged(cb: (personas: Persona[]) => void): () => void;
    revealDir(): Promise<{ ok: boolean; path: string; message?: string }>;
    /**
     * Create or overwrite a user persona (`~/.zcc/personas/<id>.json`). Pass an
     * existing `id` to edit in place; omit it (or leave blank) to mint a new one
     * with a slug derived from `name`. Saving with a built-in's id writes a user
     * shadow. Returns the stored persona on success.
     */
    save(input: PersonaInput): Promise<Result<Persona>>;
    /** Copy a resolved persona into a fresh user-owned persona. */
    duplicate(id: string): Promise<Result<Persona>>;
    /**
     * Remove the user file for an id. For a shadowed built-in this resets it to
     * the shipped default; for a user persona it deletes it. Project personas
     * are read-only and cannot be deleted here.
     */
    delete(id: string): Promise<Result<true>>;
  };
  /**
   * Launchable Teams — named bundles of personas that open N terminal tabs.
   * Read-only over the merged store (builtin ⊕ user dir ⊕ project dir ⊕
   * extension registrations); authoring is by the editor / hand-editing the JSON
   * files `revealDir` opens. Mirrors the `personas` surface. Extension teams are
   * in-memory and read-only (no file to edit/delete).
   */
  teams: {
    list(): Promise<Team[]>;
    onChanged(cb: (teams: Team[]) => void): () => void;
    revealDir(): Promise<{ ok: boolean; path: string; message?: string }>;
    /** Create or overwrite a user team (`~/.zcc/teams/<id>.json`). */
    save(input: TeamInput): Promise<Result<Team>>;
    /** Copy a resolved team into a fresh user-owned team. */
    duplicate(id: string): Promise<Result<Team>>;
    /** Remove the user file for an id (resets a shadowed builtin / deletes a user team). */
    delete(id: string): Promise<Result<true>>;
    /**
     * Launch a team into a project: open one terminal tab per slot (times its
     * quantity), orchestrator first carrying the team prompt. `projectId`
     * defaults to the team's `defaultProjectId`. Unknown persona ids are
     * skipped. Resolves the count of tabs opened plus the `cohortId` minted for
     * this launch (groups the tabs on the Agents board).
     */
    launch(
      teamId: string,
      projectId?: string
    ): Promise<Result<LaunchTeamResult>>;
    /** Cancel sessions from a renderer-owned interactive Team launch. */
    cancel(launchRequestId: string): Promise<Result<CancelTeamLaunchResult>>;
    /**
     * Launch a team as an AUTONOMOUS run into a project: opens orchestrator +
     * worker tabs, the orchestrator seeded with `goal`, and a main-side
     * supervisor nudges idle agents until the orchestrator declares done.
     */
    launchAutonomous(
      teamId: string,
      projectId: string,
      goal: string
    ): Promise<Result<{ runId: string }>>;
    /** Stop an active autonomous run (manual stop). */
    stopAutonomous(runId: string): Promise<Result<true>>;
    /**
     * Export a team + every persona it references as ONE {@link SquadBundle}
     * JSON file. Main owns the save dialog (Rule 1 — the renderer never sees a
     * raw path); `canceled` is set (not an error) if the user dismisses it.
     */
    exportBundle(teamId: string): Promise<Result<{ path: string; canceled?: boolean }>>;
    /**
     * Import a {@link SquadBundle} JSON file picked via a main-owned open
     * dialog: each persona is written through `personas.saveUser`, then the
     * team through `teams.saveUser` — the SAME validation gates as hand-editing
     * or the editor UI. `canceled` is set (not an error) if the user dismisses
     * the picker.
     */
    importBundle(): Promise<
      Result<{ team?: Team; personaCount: number; canceled?: boolean }>
    >;
  };
  /** In-memory autonomous team runs. */
  autonomousRuns: {
    list(): Promise<AutonomousRun[]>;
    onChanged(cb: (runs: AutonomousRun[]) => void): () => void;
  };
  /**
   * Pre-made starter prompts for the Agents-module Quick Agent launcher.
   * Read-only over the merged store (builtin ⊕ user dir); authoring is by
   * hand-editing the JSON files the `revealDir` action opens.
   */
  quickPrompts: {
    list(): Promise<QuickPrompt[]>;
    /** Persist a user quick prompt (shadows a builtin by id). Returns the stored entry. */
    save(entry: QuickPrompt): Promise<QuickPrompt>;
    /** Delete the user file for an id (resets a shadowed builtin, removes a user one). */
    delete(id: string): Promise<void>;
    onChanged(cb: (prompts: QuickPrompt[]) => void): () => void;
    revealDir(): Promise<{ ok: boolean; path: string; message?: string }>;
  };
  /** Editable LLM micro-call prompt registry (Settings → Prompts). */
  llmPrompts: {
    list(): Promise<LlmPromptEntry[]>;
    /** Persist a user prompt (shadows a builtin by id). Returns the stored entry. */
    save(entry: LlmPromptEntry): Promise<LlmPromptEntry>;
    /** Delete the user file for an id (resets a shadowed builtin). */
    delete(id: string): Promise<void>;
    /** Run a prompt with template vars and return the result (Test button). */
    test(id: string, vars: Record<string, string>): Promise<LlmRunResult>;
    revealDir(): Promise<{ ok: boolean; path: string; message?: string }>;
    /** Ids of providers usable right now (registered + key/binary present). */
    availableProviders(): Promise<LlmProviderId[]>;
    onChanged(cb: (prompts: LlmPromptEntry[]) => void): () => void;
  };
  voice: {
    transcribe(audio: string, mimeType: string): Promise<VoiceTranscribeResult>;
    /** Whether the host can transcribe (a host daemon is connected). */
    hasApiKey(): Promise<boolean>;
    /** Ensure the OS-level (macOS TCC) microphone permission is granted.
     *  Resolves true if access is available, false if the user denied it.
     *  A no-op that resolves true on non-macOS platforms. */
    ensureMicAccess(): Promise<boolean>;
  };
  /**
   * Generic bridge for app modules (plugins/*). `call` invokes a module's
   * main-side capability; `storage*` back the per-module KV store. Backs
   * `ModuleHost` in the renderer — modules never touch this directly.
   */
  modules: {
    call(moduleId: string, capability: string, args: unknown[]): Promise<unknown>;
    storageGet(moduleId: string, key: string): Promise<unknown>;
    storageSet(moduleId: string, key: string, value: unknown): Promise<void>;
    /**
     * Append an entry to the user's inbox on the module's behalf. `moduleId`
     * is threaded for future per-extension attribution/permission checks. The
     * inbox store requires `projectId` and at least one of `comments`/`docs`.
     */
    pushInbox(
      moduleId: string,
      msg: { projectId: string; comments?: string; docs?: Array<{ path: string }> }
    ): Promise<{ id: string }>;
    /**
     * ctx.stream push channel (S4): core relays each live frame for an opaque
     * `subId` here; the renderer host fans them out to per-subId subscribers.
     */
    onStreamFrame(cb: (subId: string, frame: unknown) => void): () => void;
    onStreamDone(
      cb: (subId: string, reason: { ok: boolean; error?: string }) => void
    ): () => void;
    /**
     * W1-4 trust inversion: core pushes a host command (toast/navigate/
     * selectProject/launch/launchParked) core→renderer, keyed by the
     * authenticated moduleId. Returns an unsubscribe fn.
     */
    onHostCommand(
      cb: (cmd: { moduleId: string; kind: string; payload: unknown }) => void
    ): () => void;
    /**
     * W1-4 durable park: pull + CLEAR every launch main has parked (on mount +
     * on each launchParked nudge). Each entry is a launch a main module
     * requested that awaits a human confirm before the renderer drives it.
     */
    drainParkedLaunches(): Promise<
      Array<{
        requestId: string;
        moduleId: string;
        spec: {
          projectId: string;
          personaId?: string;
          extraArgs?: string[];
          title?: string;
          cwd?: string;
          prompt?: string;
          label?: string;
          autoLaunch?: boolean;
        };
        parkedAt: string;
      }>
    >;
    /**
     * W1-5 main-reachable host UX: reply the human's answer to a `confirm`/
     * `notify` dialog a MAIN module requested (keyed by the dialog's requestId)
     * back to main, so the relay resolves the child's pending Promise. Answer is
     * `boolean` (confirm), `string | null` (notify action id), or `undefined`
     * (dismiss). A late/unknown id is a no-op main-side.
     */
    replyHostDialog(requestId: string, answer: unknown): Promise<void>;
  };
  /**
   * Auto-update (electron-updater), notify-only. `check` kicks a manual check
   * (NO auto-download). `download` starts fetching the available update —
   * `installNow` relaunches into it once staged, otherwise it applies on the
   * next quit. `skip` declines a version until a newer one ships.
   * `quitAndInstall` applies an already-downloaded update by relaunching.
   * `onStatus`/`onProgress` push the autoUpdater event stream; both return an
   * unsubscribe fn (same shape as inbox.onAppended).
   */
  updates: {
    check(): Promise<void>;
    download(opts?: { installNow?: boolean }): Promise<void>;
    skip(version: string): Promise<void>;
    quitAndInstall(): Promise<void>;
    /** Dev/QA only: drive a fake update flow (gated by
     *  `AppConfig.enableUpdateSimulation`, re-checked in main). No-op / rejects
     *  when not armed; never downloads or installs. */
    simulate(version: string): Promise<void>;
    /** Pull the current status — used on subscribe to catch a boot-check push
     *  that fired before this renderer's onStatus listener was attached. */
    getStatus(): Promise<UpdateStatus>;
    onStatus(cb: (status: UpdateStatus) => void): () => void;
    onProgress(cb: (progress: UpdateProgress) => void): () => void;
    /** Curated in-app release notes for the "What's New" modal, newest-first,
     *  optionally clamped to `(fromVersion, toVersion]` (advisory — main clamps
     *  to what actually ships). Empty on any read/parse failure. */
    getReleaseNotes(range?: {
      fromVersion?: string | null;
      toVersion?: string | null;
    }): Promise<ReleaseNote[]>;
    /** Race-free pull for the "What's New" modal: returns the pending window
     *  computed at boot (or null) and advances the seen-baseline so it fires
     *  exactly once. A second consumer gets null. */
    consumeWhatsNew(): Promise<WhatsNewEvent | null>;
  };
  /**
   * First-run dependency doctor. `check` re-runs detection; `install` triggers
   * the auto-installable steps (no-op for `manual`/`bundled` items); `dismiss`
   * persists `AppConfig.setupDismissed`. `onStatus`/`onProgress` push the live
   * setup snapshot + per-step install log; both return an unsubscribe fn.
   */
  deps: {
    get(): Promise<SetupStatus>;
    check(): Promise<void>;
    install(): Promise<void>;
    dismiss(): Promise<void>;
    onStatus(cb: (status: SetupStatus) => void): () => void;
    onProgress(cb: (progress: DependencyProgress) => void): () => void;
  };
}

/**
 * OS chrome that remains on the Electron preload after product I/O moves to
 * loopback HTTP. Window bounds, native menu, tray, updater, notifications —
 * not projects, terminals, inbox, or config.
 */
export type ZccDesktopApi = Pick<CcApi, 'app' | 'windows' | 'updates' | 'menubar'>;

declare global {
  interface Window {
    cc: CcApi;
    zccDesktop?: ZccDesktopApi;
  }
}
