import { createMachineProjectSync, type MachineProjectSync } from '../services/hosts/machine-project-sync.js';
import { closeThreadReads } from '../services/threads/thread-reads.js';
import { closeQueuedMessages } from '../services/threads/queued-messages.js';
import { previewService, disposePreviews } from '../services/previews/preview-service.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProductInstanceId } from '../instance-identity.js';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import type { AppConfig, ProductTeamOps, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  getConversationThread,
  getHost,
  openDatabase,
  recoverInterruptedDeferredThreadMessages,
  updateConversationThreadTitle,
  conversationThreadTitleIsPlaceholder,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { ClaudeCliProvider, LlmService, PromptRegistry } from '@zana-ai/zcc-llm';
import { listJsonFiles, writeJsonFile } from './disk-json.js';
import { CloseSummaryService, warnCloseSummary } from '../services/followups/close-summary.js';
import { createProjectStore, type ProjectStore } from '../project-store.js';
import { createProjectSettingsStore, type ProjectSettingsStore } from '../project-settings-store.js';
import { createConfigStore } from '../services/config/config-store.js';
import { createInboxStore, type IInboxStore } from '../services/inbox/inbox-store.js';
import {
  createInboxReadStore,
  defaultInboxReadStateFile,
  type IInboxReadStore
} from '../services/inbox/inbox-read-store.js';
import { createSuggestionsStore, type ISuggestionsStore } from '../services/suggestions/suggestions-store.js';
import { createSavedStore, type ISavedStore } from '../services/saved/saved-store.js';
import type { LocalAppOriginArgs } from './local-app-origins.js';
import { createProductHub, type ProductHub } from './product-hub.js';
import { createHostHub, type HostHub } from './host-hub.js';
import { PendingInteractionLifecycle } from '../services/interactions/pending-interactions.js';
import { prunePendingInteractionInboxCopies } from '../services/interactions/pending-interaction-attention.js';
import { conversationThreadView } from '../services/threads/conversation-create.js';
import { emitPluginThreadStatus } from '../plugins/thread-events.js';
import { createThreadTitleNamer, type ThreadTitleNamer } from '../services/threads/thread-title-namer.js';
import { createJoinCodeStore, type JoinCodeStore } from '../services/hosts/join-codes.js';
import type { PluginService } from '../plugins/plugin-service.js';
import { PluginHostArtifactRegistry } from '../plugins/plugin-host-artifact-registry.js';
import {
  flushDueConversationSendsForHost,
  flushHeldConversationSends,
  reconcileStoppingConversationThreadsOnHostConnect,
  resumeOpenConversationSessionsAfterHostRestart
} from '../services/threads/conversation-lifecycle.js';
import { publishConversationLifecycleOutcome } from '../services/threads/conversation-lifecycle-outcome.js';
import { healDisconnectedConversationThreadsForHost } from '../services/threads/conversation-host-recovery.js';
import { HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS } from '../services/threads/conversation-runtime-display.js';
import { retryDueConversationSends, wakeLapsedEditHolds } from '../services/threads/conversation-deferred-messages.js';
import { startDeferredRetryLoop } from '../services/threads/deferred-retry-loop.js';
import { disposeLocalHostDaemon } from '../services/hosts/host-relaunch.js';
import { disposeEnvironmentRetireTimers } from '../services/environments/environment-cleanup.js';
import { createHostHubRemoteEnvironment, type RemoteEnvironmentService } from '../services/hosts/remote-environment.js';
import { startConversationHistoryMaintenance } from '../services/threads/conversation-history-maintenance.js';
import { PersistentTerminalSessions } from './persistent-terminal-sessions.js';
import { ProviderModelCatalogStore } from '../services/threads/provider-model-catalog-store.js';
import { createUiSendVerifier } from './ui-send-proof.js';
import { createPluginApprovalVerifier, signPluginApproval } from './plugin-approval-proof.js';
import { createNativeToolPolicyVerifier } from './native-tool-policy-proof.js';
import { bridgeLaunchForProvider, listThreadProviders } from '../services/threads/thread-provider-catalog.js';
import { createDbTunnelHostStore, createTunnelHostReopener, type TunnelHostStore } from '../services/hosts/tunnel-hosts.js';
import { reconcileRemoteProjectBindings, repairHost, tunnelLocalPort } from '../services/hosts/host-bootstrap.js';
import { createCoalescedReconciler, type CoalescedReconciler } from '../services/hosts/coalesced-reconciler.js';
import { PairStore, type PeerKeyProvider } from '../services/peers/pair-store.js';
import { PeerReplayWindow } from '../services/peers/peer-replay-window.js';
import { PluginStorageEpochs } from '../services/peers/plugin-storage-epochs.js';
import { ScopedLinkAuthority, type EnrolledPeerBridge } from '../services/peers/scoped-link-authority.js';
import { EnrolledPeerChannels, channelHash } from '../services/peers/enrolled-peer-channels.js';
import { PeerUseRequests } from '../services/peers/peer-use-requests.js';
import { createEnrolledPeerBridge } from '../services/peers/enrolled-peer-bridge.js';
import { PeerKeyUnavailableError } from '../services/peers/peer-auth.js';
import { PeerIntroductionInstaller, type InstallerConnector } from '../services/peers/introduction-installer.js';
import { PeerRouteOrigins } from '../services/peers/peer-route-origins.js';
import { PeerSshEndpoints } from '../services/peers/peer-ssh-endpoints.js';
import { PeerTunnels } from '@zana-ai/zcc-host-daemon/peer-tunnels';
import { listPublicHosts } from '../services/hosts/host-public.js';
import { CORE_APPROVAL_PRINCIPAL, PeerInvitations } from '../services/peers/peer-invitation.js';
import { PeerConnectionRegistry, type PeerConnectionUses } from '../services/peers/peer-connections.js';
import { PeerActiveUse } from '../services/peers/peer-active-use.js';
import { hostUseApproved } from '../services/peers/peer-uses.js';
import { PeerLinks } from '../services/peers/peer-links.js';
import { PluginLinkNotes } from '../services/peers/plugin-link-notes.js';
import { createPeerForwarderLease } from '../services/peers/peer-forwarder-lease.js';
import { checkRemoteLogin, createLocalEndpoint, e2ePeerSshOverride, preflightPeerSsh } from '../services/peers/peer-ssh-local.js';
import { PeerSshd } from '../services/peers/peer-sshd.js';
import { createPeerSshTransport } from '../services/peers/peer-ssh-transport.js';
import { SshAuthorizedKeys } from '../services/peers/ssh-authorized-keys.js';
import type { ConnectFetch } from '../mobile/connect-account.js';
import { hostname } from 'node:os';

export interface ProductTerminalRecord extends TerminalSession {
  hostId: string;
  daemonInstanceId?: string;
  outputText?: string;
  outputTruncated?: boolean;
  /** Monotonic UTF-16 length, including output evicted from the retained tail. */
  outputEndOffset?: number;
}

export interface ProductHttpContext {
  productInstanceId: string;
  origins: LocalAppOriginArgs;
  dataDir: string;
  enrollToken: string;
  joinCodes: JoinCodeStore;
  /** Remote ports of machines reached through a primary-owned SSH tunnel. */
  tunnelHosts?: TunnelHostStore;
  db: ZccDatabase;
  hostHub: HostHub;
  modelCatalogs: ProviderModelCatalogStore;
  /** Plugin-contributed environment for sessions on non-primary machines (memory only). */
  remoteEnvironment: RemoteEnvironmentService;
  projects: ProjectStore;
  /** Per-project settings (Settings → Project), read from disk on every call. */
  projectSettings: Pick<ProjectSettingsStore, 'get' | 'getPluginHarnessRouting' | 'setPluginHarnessRouting'>;
  remoteProjectReconciler?: CoalescedReconciler;
  machineProjectSync?: MachineProjectSync;
  config: ReturnType<typeof createConfigStore>;
  inbox: IInboxStore;
  inboxRead: IInboxReadStore;
  suggestions: ISuggestionsStore;
  saved: ISavedStore;
  hub: ProductHub;
  pendingInteractions: PendingInteractionLifecycle;
  threadTitleNamer: ThreadTitleNamer;
  closeSummary: CloseSummaryService;
  terminalSessions: Map<string, ProductTerminalRecord>;
  plugins?: PluginService;
  pluginHostArtifacts: PluginHostArtifactRegistry;
  peerPairs: PairStore;
  peerAuthority: ScopedLinkAuthority;
  peerChannels: EnrolledPeerChannels;
  peerControlReplay: PeerReplayWindow;
  /** App-level per-plugin storage epochs outside plugin folders; absent in contexts built without one. */
  pluginStorageEpochs?: PluginStorageEpochs;
  /** Present only with a real peer key: turns approved introductions into forward-only mutual enrollment. */
  peerInstaller?: PeerIntroductionInstaller;
  /** Owner-registered pinned SSH routes for peers. Present with the installer. */
  peerSshEndpoints?: PeerSshEndpoints;
  /** Owner-managed allowlist of advertised peer route origins. Present with the installer; read live by it. */
  peerRouteAllowlist?: PeerRouteOrigins;
  /** First-contact invitations. Present only with a real peer key. Plugins reach them in-process; core's own Add/Join/Approve use `/api/v1/peer-connections`. */
  peerInvitations?: PeerInvitations;
  /** Invitation-founded `peer.forward` links over Zana Connect machine codes, and their lifecycle. Present with invitations. */
  peerLinks?: PeerLinks;
  /** Owner-store view of plugin links for the core Peers hub. Absent: links are listed from host rows alone. */
  peerLinkDirectory?: import('../services/hosts/peer-link-view.js').PeerLinkDirectory;
  /** Core Add computer: starts Zana's own sshd and runs its self-test. Present with a peer key and SSH transport. */
  peerRemoteLoginCheck?: (signal: AbortSignal) => Promise<import('../services/peers/peer-ssh-local.js').RemoteLoginCheck>;
  /** Signs the single-use core approval proof for a binding core itself built, after the typed pairing code matched. Absent without a UI secret. */
  mintCoreApproval?: (binding: unknown) => string;
  /** Plugin-reported per-link state notes shown by the core Peers hub. In memory, bounded. */
  peerLinkNotes?: PluginLinkNotes;
  /** Plugin-facing connection hooks (removing handlers, change listeners, statuses). */
  peerConnections?: PeerConnectionRegistry;
  /** Core-observed recent successful `peers.call`s per plugin and computer; drives the Peers hub "Stop anyway?" confirm. */
  peerActiveUse?: PeerActiveUse;
  /** Per-plugin use records of connections; absent until the approval layer is installed. */
  peerConnectionUses?: PeerConnectionUses;
  /** Core-rendered two-sided approval of a plugin's use of a connection; backs `peerConnectionUses` and the `/api/v1/peer-uses` routes. */
  peerUseRequests?: PeerUseRequests;
  /**
   * Optional host-injected Team verbs. Product HTTP validates bounded wire
   * shape; Electron main authorizes team/project/persona and mutations.
   * Absent means 502 host_disconnected.
   */
  teamOps?: ProductTeamOps;
  /**
   * Unattended CLI Agent verbs via the product-server control-plane caller.
   * Absent means 502 host_disconnected.
   */
  cliAgentOps?: import('./cli-agent-ops.js').ProductCliAgentOps;
  /** Main-only session grants; absent on a server without a CLI coordinator. */
  cliCallbacks?: import('../services/launch/cli-callback-authority.js').CliCallbackAuthority;
  verifyUiSend: (proof: unknown, threadId: string, itemId: string, caller?: import('./ui-send-proof.js').UiSendCaller) => boolean;
  /** Consumes a desktop-signed plugin approval (plugin-approval-proof.ts). Absent or secretless servers refuse every token. */
  verifyPluginApproval?: (token: unknown, pluginId: string, binding: unknown) => boolean;
  /** Consumes main's proof on a native tool policy request (native-tool-policy-proof.ts). Absent or secretless servers refuse every one. */
  verifyNativeToolPolicy?: (token: unknown, body: string) => boolean;
  toProjects(): Project[];
  /** Release long-lived watchers started with this context. */
  dispose(): void | Promise<void>;
  /** Call after dispose to await peer recovery and admitted private-storage writes. */
  whenIdle(): Promise<void>;
}

export interface CreateProductHttpContextOptions {
  dataDir?: string;
  origins: LocalAppOriginArgs;
  enrollToken?: string;
  uiSendSecret?: string;
  /** Host-owned OS-protected key; absent means peer storage fails closed. */
  peerKeyProvider?: PeerKeyProvider & { dispose?(): void };
  /** Trusted enrollment bridge. Never supplied through plugin SDK or HTTP input. */
  enrolledPeerBridge?: EnrolledPeerBridge;
  /** Test seams for the introduction installer and its SSH tunnels. */
  peerInstallerConnector?: InstallerConnector;
  peerSshTunnels?: PeerTunnels;
  /** Host-supplied non-loopback https origins allowed as advertised peer routes, in addition to the owner-managed allowlist. */
  peerRouteOrigins?: readonly string[];
  /** Test/E2E seam: fetch used for every Zana Connect peer-link request (default: global fetch). */
  peerLinkConnect?: ConnectFetch;
  /** Reuse a process-local project store when one already exists. */
  projects?: ProjectStore;
  /** Reuse a process-local project-settings store when one already exists. */
  projectSettings?: Pick<ProjectSettingsStore, 'get' | 'getPluginHarnessRouting' | 'setPluginHarnessRouting'>;
  onLibraryChanged?: () => void;
  onProjectsChanged?: () => void;
}

const identityConfig = {
  normalizeConfig: (input: Partial<AppConfig>) => input,
  projectConfigCompatibility: (input: AppConfig) => input,
  canonicalConfigForWrite: (input: AppConfig) => input,
  harnessEnabled: (_input: AppConfig, id: NonNullable<AppConfig['defaultHarness']>) => id === 'claude'
};

function rejectUiSend(): boolean {
  return false;
}

export function createProductHttpContext(
  options: CreateProductHttpContextOptions
): ProductHttpContext {
  const dataDir = options.dataDir ?? resolveZccDataDir();
  const productInstanceId = readProductInstanceId(dataDir);
  const projects = options.projects ?? createProjectStore({
    projectsFile: join(dataDir, 'projects.json'),
    remotePlaceholderRoot: join(dataDir, 'remote-projects')
  });
  const projectSettings = options.projectSettings ?? createProjectSettingsStore({
    projectSettingsFile: join(dataDir, 'project-settings.json')
  });
  const config = createConfigStore(
    { homeDir: join(dataDir, '..'), configFile: join(dataDir, 'config.json') },
    identityConfig
  );
  const inboxFile = join(dataDir, 'inbox', 'entries.jsonl');
  const inbox = createInboxStore({ filePath: inboxFile });
  const inboxRead = createInboxReadStore({
    filePath: defaultInboxReadStateFile(inboxFile),
    inbox
  });
  const suggestions = createSuggestionsStore({
    filePath: join(dataDir, 'suggestions', 'entries.jsonl')
  });
  const saved = createSavedStore({ dir: join(dataDir, 'saved') });
  const hub = createProductHub(options.onLibraryChanged, options.onProjectsChanged);
  const db = openDatabase(join(dataDir, 'zcc.sqlite'));
  recoverInterruptedDeferredThreadMessages(db);
  const terminalSessions = new PersistentTerminalSessions(db);
  let pendingInteractions: PendingInteractionLifecycle;
  let ctx!: ProductHttpContext;
  const disconnectHealTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Hosts whose daemon came back as a new process; their sessions need reopening.
  const restartedHosts = new Set<string>();
  const tunnelHosts = createDbTunnelHostStore({ db, dataDir });
  // The primary's SSH tunnels die with its daemon and target this server's
  // per-process pairing port, so each primary connect reopens them.
  const tunnelReopener = createTunnelHostReopener(() => ctx, {
    store: tunnelHosts,
    localPort: () => tunnelLocalPort(ctx!),
    repair: (hostId) => repairHost(ctx!, hostId),
    log: (text) => console.warn(`[zcc] ${text}`)
  });
  const hostHub = createHostHub(db, hub, terminalSessions, {
    productInstanceId,
    pluginHostGenerations: () => ctx ? [...ctx.pluginHostArtifacts.entries()].map(([pluginId, artifact]) => ({ pluginId, generation: artifact.generation })) : [],
    onNewHostInstance: (hostId) => {
      pendingInteractions?.interruptPendingInteractionsForHost(
        hostId,
        'host-daemon-restarted'
      );
      restartedHosts.add(hostId);
    },
    onProjectCatalogueChanged: hostId => { void ctx?.machineProjectSync?.request(hostId); },
    onHostConnected: (hostId) => {
      const timer = disconnectHealTimers.get(hostId);
      if (timer) {
        clearTimeout(timer);
        disconnectHealTimers.delete(hostId);
      }
      if (!ctx) return;
      // A peer's connector into a forward-only host this app minted drives the invitation bootstrap.
      ctx.peerLinks?.onInboundConnected(hostId);
      if (getHost(db, hostId)?.enrollmentCapability !== 'execution') return;
      void ctx.remoteProjectReconciler?.request();
      void ctx.machineProjectSync?.request(hostId);
      tunnelReopener.hostConnected(hostId);
      ctx.remoteEnvironment.hostConnected(hostId);
      void reconcileStoppingConversationThreadsOnHostConnect(ctx, hostId).catch(() => undefined);
      if (restartedHosts.delete(hostId)) {
        void resumeOpenConversationSessionsAfterHostRestart(ctx, hostId).catch(() => undefined);
      }
      void flushDueConversationSendsForHost(ctx, hostId).catch(() => undefined);
      for (const provider of listThreadProviders().filter((row) => row.models?.scope === 'host')) {
        try {
          void ctx.modelCatalogs.read({
            hostId,
            providerId: provider.id,
            scope: 'host',
            prewarm: true,
            bridgeLaunch: bridgeLaunchForProvider(provider.id, ctx.pluginHostArtifacts)
          }).catch(() => undefined);
        } catch {
          // A provider plugin can still be building while the host reconnects.
        }
      }
    },
    onConversationEvent: ({ threadId }) => {
      const thread = getConversationThread(db, threadId);
      if (!thread) return;
      hub.emit('threads:updated', conversationThreadView(ctx, thread));
    },
    onConversationLifecycle: ({ threadId, event, outcome }) => {
      if (!ctx) return;
      publishConversationLifecycleOutcome(ctx, { threadId, event }, outcome);
      if (outcome.applied) emitPluginThreadStatus(ctx, outcome.thread);
    },
    onPluginHostEvent: event => { void ctx?.plugins?.emitHostEvent(event).catch(() => undefined); },
    onHostDisconnected: (hostId) => {
      ctx?.remoteEnvironment.hostDisconnected(hostId);
      ctx?.cliCallbacks?.abortHost(hostId);
      const existing = disconnectHealTimers.get(hostId);
      if (existing) clearTimeout(existing);
      disconnectHealTimers.set(hostId, setTimeout(() => {
        disconnectHealTimers.delete(hostId);
        if (!ctx) return;
        if (hostHub.connectedHostIds().includes(hostId)) return;
        healDisconnectedConversationThreadsForHost(ctx.db, ctx.hub, hostId);
      }, HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS));
    }
  });
  const remoteEnvironment = createHostHubRemoteEnvironment(hostHub, db);
  const modelCatalogs = new ProviderModelCatalogStore({
    db,
    callHostOnlineRpc: (input) => hostHub.callHostOnlineRpc(input),
    onChanged: (payload) => hub.emit('provider-model-catalog:changed', payload)
  });
  pendingInteractions = new PendingInteractionLifecycle({
    db,
    hub,
    callHostOnlineRpc: (input) => hostHub.callHostOnlineRpc(input),
    onInteractionSettled: ({ threadId, status, statusReason }) => {
      if (!ctx) return;
      if (status === 'interrupted' && (statusReason === 'thread-stopped' || statusReason === 'thread-deleted')) {
        return;
      }
      if (ctx.pendingInteractions.hasPendingThreadInteraction(threadId)) return;
      void flushHeldConversationSends(ctx, threadId).catch(() => undefined);
    },
    onPendingInteractionCreated: ({ threadId, interaction }) => {
      if (!ctx) return;
      void import('../services/threads/conversation-child-notifications.js')
        .then(({ notifyParentOfChildNeedsAttention }) => {
          notifyParentOfChildNeedsAttention(ctx, { threadId, interaction });
        })
        .catch(() => undefined);
    }
  });
  pendingInteractions.start();
  const envToken = process.env.ZCC_HOST_ENROLL_TOKEN;
  const enrollToken = options.enrollToken
    ?? (envToken && envToken.length >= 16 ? envToken : undefined)
    ?? randomBytes(32).toString('hex');
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dataDir, 'host-enroll.token'), enrollToken, { encoding: 'utf8', mode: 0o600 });

  inbox.onAppended((entry) => hub.emit('inbox:appended', entry));
  inbox.onRemoved((id) => hub.emit('inbox:removed', id));
  inbox.onUpdated((entry) => hub.emit('inbox:updated', entry));
  inbox.onPruned((ids) => hub.emit('inbox:pruned', ids));
  void prunePendingInteractionInboxCopies(inbox);
  suggestions.onAppended((entry) => hub.emit('suggestions:appended', entry));
  suggestions.onRemoved((id) => hub.emit('suggestions:removed', id));
  suggestions.onUpdated((entry) => hub.emit('suggestions:updated', entry));
  suggestions.onPruned((ids) => hub.emit('suggestions:pruned', ids));
  saved.onChanged((records) => hub.emit('saved:changed', records));

  // dataDir is ~/.zcc in production, so this is the same user-prompt dir the
  // desktop PromptRegistry watches. Tests get an isolated dir under the tmp dataDir.
  const promptRegistry = new PromptRegistry({ userDir: join(dataDir, 'llm-prompts') });
  promptRegistry.start();
  const llmService = new LlmService(new Map());
  const configuredClaudeProvider = (): ClaudeCliProvider => {
    const current = config.getConfig();
    // Desktop migration removes the legacy field from disk. The server's
    // config store does not project it back from the canonical harness entry.
    return new ClaudeCliProvider(current.harnesses?.byId?.claude?.binary || current.claudeBinary || 'claude');
  };
  const threadTitleNamer = createThreadTitleNamer({
    autoRenameEnabled: () => config.getConfig().autoRenameTabs !== false,
    getEntry: (id) => promptRegistry.get(id),
    run: (entry, vars, dedupeKey) => {
      llmService.setProvider(configuredClaudeProvider());
      return llmService.run(entry, vars, dedupeKey);
    },
    applyTitle: (threadId, title) => {
      const updated = updateConversationThreadTitle(db, threadId, title, 'auto');
      if (!updated) return;
      hub.emit('threads:updated', conversationThreadView(ctx, updated));
    },
    stillLive: (threadId) => Boolean(getConversationThread(db, threadId)),
    canAutoTitle: (threadId) => conversationThreadTitleIsPlaceholder(db, threadId)
  });

  const closeSummary = new CloseSummaryService({
    getSession: () => null,
    log: warnCloseSummary,
    hasTranscript: () => false,
    readLastTurn: async () => '',
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
      llmService.setProvider(configuredClaudeProvider());
      return llmService.run(entry, { lastTurn }, dedupeKey);
    },
    runTurnSummary: async () => ({ ok: false, text: '', error: 'unused', provider: 'claude-cli', ms: 0 }),
    readDigest: async () => '',
    runSessionSummary: async () => ({ ok: false, text: '', error: 'unused', provider: 'claude-cli', ms: 0 }),
    appendInbox: async (input) => {
      const entry = await inbox.append({
        projectId: input.projectId,
        projectLabel: input.projectLabel,
        sessionId: input.sessionId,
        comments: input.comments
      });
      return { id: entry.id };
    },
    projectLabel: (projectId) =>
      (projects.list() as unknown as Project[]).find((p) => p.id === projectId)?.name,
    createFollowUp: ({ projectId, sessionId, title, detail }) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      const project = (projects.list() as unknown as Project[]).find((p) => p.id === projectId);
      const dir = project ? join(project.path, '.zcc', 'followups') : join(dataDir, 'followups');
      writeJsonFile(dir, id, {
        id,
        projectId,
        title,
        detail,
        kind: 'note',
        status: 'open',
        origin: { source: 'agent', sessionId },
        sessionId,
        createdAt: now,
        updatedAt: now
      });
      hub.emit('followups:changed', [
        ...listJsonFiles(join(dataDir, 'followups')),
        ...(projects.list() as unknown as Project[]).flatMap((p) =>
          listJsonFiles(join(p.path, '.zcc', 'followups'))
        )
      ]);
      return id;
    }
  });

  let verifyUiSend: ProductHttpContext['verifyUiSend'] = rejectUiSend;
  let verifyPluginApproval: NonNullable<ProductHttpContext['verifyPluginApproval']> = rejectUiSend;
  let mintCoreApproval: ProductHttpContext['mintCoreApproval'];
  let verifyNativeToolPolicy: NonNullable<ProductHttpContext['verifyNativeToolPolicy']> = rejectUiSend;
  if (options.uiSendSecret && options.uiSendSecret.length >= 32) {
    verifyUiSend = createUiSendVerifier(options.uiSendSecret);
    verifyPluginApproval = createPluginApprovalVerifier(options.uiSendSecret);
    const approvalSecret = options.uiSendSecret;
    mintCoreApproval = binding => signPluginApproval(approvalSecret, CORE_APPROVAL_PRINCIPAL, binding as never);
    verifyNativeToolPolicy = createNativeToolPolicyVerifier(options.uiSendSecret);
  }

  const keyProvider = options.peerKeyProvider ?? { getKey: async () => null };
  const peerChannels = new EnrolledPeerChannels(join(realpathSync(dataDir), 'peer-channels'), productInstanceId, keyProvider);
  let peerAuthority!: ScopedLinkAuthority;
  // eslint-disable-next-line prefer-const -- assigned after the authority it guards
  let peerLinks: PeerLinks | undefined;
  const peerBridge = options.enrolledPeerBridge ?? createEnrolledPeerBridge({ instanceId: productInstanceId, db, hub: hostHub, channels: peerChannels });
  const peerPairs = new PairStore(join(realpathSync(dataDir), 'peer-pairs'), {
    localInstanceId: productInstanceId, keyProvider,
    authorizeTransfer: (context, binding) => peerAuthority.authorizeTransfer(context, binding),
    validateGrant: grant => peerAuthority.validateGrant(grant)
  });
  peerAuthority = new ScopedLinkAuthority({
    directory: join(realpathSync(dataDir), 'peer-authority'), instanceId: productInstanceId, keyProvider, pairs: peerPairs,
    enrollment: hostId => {
      const host = getHost(db, hostId);
      if (!host || host.destroyedAt) return null;
      return { hostId, keyHash: host.hostKeyHash, capability: host.enrollmentCapability,
        connected: Boolean(hostHub.getSession(hostId)) };
    },
    reverseEnrollment: async remoteId => {
      const channel = await peerChannels.remote(remoteId);
      return channel ? { hostId: channel.hostId, keyHash: channelHash(channel), capability: channel.capability } : null;
    },
    currentReverseEnrollment: remoteId => peerChannels.current(remoteId),
    // A link host is never plugin-usable before both owners consented and the founding linked it.
    isLinkUsable: hostId => peerLinks?.isLinkUsable(hostId) ?? true,
    // Default deny: a connection carries a plugin's traffic only with that plugin's approved use.
    isUseApproved: (hostId, pluginId) => hostUseApproved(db, hostId, pluginId),
    bridge: peerBridge
  });
  const joinCodes = createJoinCodeStore(db);
  /** Link-use label: the installed plugin's registered display name (never plugin input); read late, plugins attach after. */
  const pluginLabel = (pluginId: string): string | undefined => ctx?.plugins?.get(pluginId)?.name?.trim() || undefined;
  const peerSshEndpoints = options.peerKeyProvider ? new PeerSshEndpoints({ directory: join(realpathSync(dataDir), 'peer-ssh'),
    instanceId: productInstanceId, keyProvider, tunnels: options.peerSshTunnels }) : undefined;
  const peerRouteAllowlist = options.peerKeyProvider ? new PeerRouteOrigins({ directory: join(realpathSync(dataDir), 'peer-route-origins'),
    instanceId: productInstanceId, keyProvider }) : undefined;
  const peerInstaller = options.peerKeyProvider && peerSshEndpoints && peerRouteAllowlist ? new PeerIntroductionInstaller({
    directory: join(realpathSync(dataDir), 'peer-installer'), instanceId: productInstanceId, keyProvider,
    localAppDataDir: realpathSync(dataDir), db, hostHub, joinCodes, channels: peerChannels, authority: peerAuthority,
    localRoute: () => ctx.origins.serverPort ? `http://127.0.0.1:${ctx.origins.serverPort}/` : null,
    routeFor: (peerId, signal) => peerSshEndpoints.routeFor(peerId, signal),
    // Read on every route decision so owner edits apply without a restart. Unreadable storage contributes nothing.
    allowedOrigins: async () => [...(options.peerRouteOrigins ?? []), ...await peerRouteAllowlist.list().catch(() => [] as string[])],
    connector: options.peerInstallerConnector,
    dataDir, connectFetch: options.peerLinkConnect,
    pluginLabel,
    onChanged: () => { if (!disposed) hub.emit('hosts:changed', listPublicHosts(db, hostHub)); }
  }) : undefined;
  // The peer forwarder is lazy: nothing listens until a link needs it. F is remembered so authorized_keys lines stay valid.
  const peerForwarderLease = options.peerKeyProvider ? createPeerForwarderLease({ dataDir: realpathSync(dataDir),
    productPort: () => ctx.origins.serverPort ?? 0,
    // A busy remembered F is only replaced when no live link's permitopen / -L target names it (a squatter would intercept B's forward).
    canRebind: () => !peerLinks?.hasLiveServerLinks() }) : undefined;
  // Zana's own sshd serves computer connections; an E2E-isolated home keeps its fixture sshd and ~/.ssh contract instead.
  const peerSshd = options.peerKeyProvider && !e2ePeerSshOverride(process.env)
    ? new PeerSshd({ directory: join(realpathSync(dataDir), 'peer-sshd') }) : undefined;
  const peerAuthorizedKeys = options.peerKeyProvider ? new SshAuthorizedKeys({ instanceId: productInstanceId,
    ...(peerSshd ? { authorizedKeysPath: peerSshd.authorizedKeysPath } : {}) }) : undefined;
  if (peerSshd && peerAuthorizedKeys) {
    void (async () => {
      // Lines an earlier build wrote to ~/.ssh/authorized_keys would stay usable through the system sshd; drop them.
      const legacy = new SshAuthorizedKeys({ instanceId: productInstanceId });
      if ((await legacy.list()).length > 0) await legacy.reconcile(new Set());
      // Established links need A's sshd listening before B reconnects. After dispose, ensure rejects.
      if ((await peerAuthorizedKeys.list()).length > 0) await peerSshd.ensure();
    })().catch(error => console.warn(`[zcc] peer sshd boot failed: ${error instanceof Error ? error.message : String(error)}`));
  }
  const peerSsh = options.peerKeyProvider && peerForwarderLease && peerAuthorizedKeys ? createPeerSshTransport({
    directory: join(realpathSync(dataDir), 'peer-link-keys'), instanceId: productInstanceId, keyProvider,
    tunnels: options.peerSshTunnels ?? new PeerTunnels(), forwarder: peerForwarderLease,
    authorizedKeys: peerAuthorizedKeys,
    localEndpoint: createLocalEndpoint({ authorizedKeys: peerAuthorizedKeys, ...(peerSshd ? { sshd: peerSshd } : {}) }), preflight: preflightPeerSsh
  }) : undefined;
  const peerLinkNotes = new PluginLinkNotes();
  const peerConnections = new PeerConnectionRegistry();
  const peerActiveUse = new PeerActiveUse();
  const revokePeerUses = async (peerInstanceId: string) => {
    for (const pairId of await peerAuthority.activePairIds(peerInstanceId)) await peerAuthority.revoke(pairId).catch(() => undefined);
  };
  peerLinks = options.peerKeyProvider && peerSsh ? new PeerLinks({
    directory: join(realpathSync(dataDir), 'peer-links'), instanceId: productInstanceId, keyProvider,
    localAppDataDir: realpathSync(dataDir), db, hostHub, joinCodes, channels: peerChannels,
    ssh: peerSsh,
    invitations: () => peerInvitations,
    bridge: peerBridge,
    connector: options.peerInstallerConnector,
    pluginLabel,
    // One removal order everywhere: plugin handlers (bounded) -> revoke uses -> local drop -> peer notice (not awaited).
    onRemoving: async peerInstanceId => { await peerConnections.runRemoving(peerInstanceId); await revokePeerUses(peerInstanceId); },
    onRemoved: async peerInstanceId => {
      peerLinkNotes.clearPeer(peerInstanceId);
      peerConnections.forget(peerInstanceId);
      peerActiveUse.forget(peerInstanceId);
      peerUseRequests?.forget(peerInstanceId);
      await revokePeerUses(peerInstanceId);
    },
    onChanged: () => { if (!disposed) { hub.emit('hosts:changed', listPublicHosts(db, hostHub)); peerConnections.notifyChanged(); } }
  }) : undefined;
  const links = peerLinks;
  const peerUseRequests = links ? new PeerUseRequests({
    db, links, bridge: peerBridge, label: pluginLabel,
    verify: (token, principal, binding) => verifyPluginApproval(token, principal, binding),
    revoke: async (pluginId, computerId) => { await peerAuthority.revokeUse(pluginId, computerId); await peerAuthority.recover(); },
    isActive: (pluginId, computerId) => peerActiveUse.isActive(pluginId, computerId),
    onChange: () => { peerConnections.notifyChanged(); }
  }) : undefined;
  const peerInvitations: PeerInvitations | undefined = links ? new PeerInvitations({
    directory: join(realpathSync(dataDir), 'peer-invitations'), instanceId: productInstanceId, keyProvider,
    verifyOwnerApproval: (token, pluginId, binding) => ctx.verifyPluginApproval?.(token, pluginId, binding) ?? false,
    localName: () => hostname(),
    links: links.invitationLinks,
    linkKey: invitationId => peerSsh!.linkKey(invitationId),
    linkRef: invitationId => links.linkRef(invitationId),
    transport: links.transport,
    onConsented: pairing => links.onConsented(pairing),
    onFounding: (pairing, message) => links.onFounding(pairing, message),
    onTerminated: (invitationId, role, reason) => links.onTerminated(invitationId, role, reason)
  }) : undefined;
  const sweepLinks = () => { if (!disposed) void peerLinks?.sweep().catch(error => console.warn(`[zcc] peer links sweep failed: ${error instanceof Error ? error.message : String(error)}`)); };
  let disposed = false;
  const remoteProjectReconciler = createCoalescedReconciler(
    () => reconcileRemoteProjectBindings(ctx),
    (error) => console.warn(`[zcc] remote project reconcile failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  );
  ctx = {
    productInstanceId,
    origins: options.origins,
    dataDir,
    enrollToken,
    joinCodes,
    tunnelHosts,
    db,
    hostHub,
    modelCatalogs,
    remoteEnvironment,
    projects,
    projectSettings,
    remoteProjectReconciler,
    config,
    inbox,
    inboxRead,
    suggestions,
    saved,
    hub,
    pendingInteractions,
    threadTitleNamer,
    closeSummary,
    terminalSessions,
    pluginHostArtifacts: new PluginHostArtifactRegistry(),
    peerPairs,
    peerAuthority,
    peerChannels,
    peerInstaller,
    peerSshEndpoints,
    peerRouteAllowlist,
    peerInvitations,
    ...(peerSsh ? { peerRemoteLoginCheck: (signal: AbortSignal) => checkRemoteLogin(peerSsh.localEndpoint, signal) } : {}),
    ...(mintCoreApproval ? { mintCoreApproval } : {}),
    peerLinks,
    ...(peerLinks ? { peerLinkDirectory: peerLinks.directory } : {}),
    peerLinkNotes,
    peerConnections,
    peerActiveUse,
    ...(peerUseRequests ? { peerUseRequests, peerConnectionUses: peerUseRequests } : {}),
    peerControlReplay: new PeerReplayWindow({ directory: join(realpathSync(dataDir), 'peer-control-replay'), localInstanceId: productInstanceId, keyProvider }),
    pluginStorageEpochs: new PluginStorageEpochs({ directory: join(realpathSync(dataDir), 'plugin-storage-epochs'), instanceId: productInstanceId, keyProvider }),
    verifyUiSend,
    verifyPluginApproval,
    verifyNativeToolPolicy,
    toProjects: () => projects.list() as unknown as Project[],
    dispose: () => {
      if (disposed) return remoteProjectReconciler.dispose();
      disposed = true;
      stopPeerAuthority();
      ctx.peerInstaller?.dispose();
      ctx.peerLinks?.dispose();
      peerConnections.dispose();
      peerUseRequests?.dispose();
      peerSsh?.dispose();
      peerSshd?.dispose();
      void peerForwarderLease?.close().catch(error => console.warn(`[zcc] peer forwarder lease close failed: ${error instanceof Error ? error.message : String(error)}`));
      ctx.peerInvitations?.dispose();
      ctx.peerSshEndpoints?.dispose();
      ctx.peerRouteAllowlist?.dispose();
      ctx.peerAuthority.dispose();
      ctx.peerPairs.dispose();
      ctx.peerChannels.dispose();
      ctx.peerControlReplay.dispose();
      ctx.pluginStorageEpochs?.dispose();
      options.peerKeyProvider?.dispose?.();
      const reconcilerStopped = Promise.all([remoteProjectReconciler.dispose(), ctx.machineProjectSync?.dispose()]).then(() => undefined);
      closeThreadReads(dataDir); closeQueuedMessages(dataDir);
      disposePreviews(ctx);
      disposeEnvironmentRetireTimers(ctx);
      stopHistoryMaintenance();
      ctx.cliCallbacks?.dispose();
      stopRetries();
      for (const timer of disconnectHealTimers.values()) clearTimeout(timer);
      disconnectHealTimers.clear();
      tunnelReopener.dispose();
      disposeLocalHostDaemon(ctx);
      inboxRead.dispose();
      promptRegistry.stop();
      remoteEnvironment.dispose();
      ctx.plugins?.stop?.();
      return reconcilerStopped;
    },
    whenIdle: async () => {
      if (disposed) await remoteProjectReconciler.dispose();
      await ctx.peerInstaller?.whenIdle();
      await ctx.peerLinks?.whenIdle();
      await peerSsh?.whenIdle();
      await ctx.peerInvitations?.whenIdle();
      await ctx.peerSshEndpoints?.whenIdle();
      await ctx.peerRouteAllowlist?.whenIdle();
      await ctx.peerAuthority.whenIdle();
      await Promise.all([ctx.peerPairs.whenIdle(), ctx.peerChannels.whenIdle(), ctx.peerControlReplay.whenIdle(), ctx.pluginStorageEpochs?.whenIdle()]);
    }
  };
  ctx.machineProjectSync = createMachineProjectSync(ctx);
  previewService(ctx);
  const stopHistoryMaintenance = startConversationHistoryMaintenance(db);
  const stopRetries = startDeferredRetryLoop(async () => {
    // A queued-message editor whose lease lapsed (closed tab, quit app, restart)
    // would otherwise strand its row until the next unrelated drain.
    await wakeLapsedEditHolds(ctx, (threadId) => flushHeldConversationSends(ctx, threadId));
    await retryDueConversationSends(ctx,
      (threadId) => flushHeldConversationSends(ctx, threadId, { enforceConcurrencyCap: true }));
  });
  const warnPeer = (component: string) => (error: unknown) => {
    console.warn(`[zcc] peer ${component} failed: ${error instanceof Error ? error.message : String(error)}`);
  };
  const recoverPeers = () => { if (options.peerKeyProvider && !disposed) void peerAuthority.recover().catch(error => {
    if (error instanceof PeerKeyUnavailableError) return;
    // A non-key failure disposes the pair store for good; stop retrying against it and say why peer sync stopped.
    warnPeer('recovery (peer sync disabled)')(error);
    peerPairs.dispose();
    stopPeerAuthority();
  }); };
  const sweepInstaller = () => { if (!disposed) void peerInstaller?.sweep().catch(warnPeer('installer sweep')); };
  const unsubscribePeers = hub.subscribe('hosts:changed', recoverPeers);
  const peerTimer = options.peerKeyProvider ? setInterval(() => { recoverPeers(); sweepInstaller(); sweepLinks(); }, 30_000) : undefined;
  peerTimer?.unref();
  const stopPeerAuthority = () => { unsubscribePeers(); if (peerTimer) clearInterval(peerTimer); };
  recoverPeers();
  if (peerInstaller) void peerInstaller.start().catch(warnPeer('installer start'));
  peerInvitations?.start();
  if (peerLinks) void peerLinks.start().catch(warnPeer('links start'));
  void remoteProjectReconciler.request();
  return ctx;
}
