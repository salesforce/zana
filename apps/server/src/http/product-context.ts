import { closeThreadReads } from '../services/threads/thread-reads.js';
import { closeQueuedMessages } from '../services/threads/queued-messages.js';
import { previewService, disposePreviews } from '../services/previews/preview-service.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readProductInstanceId } from '../instance-identity.js';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import type { AppConfig, ProductTeamOps, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  getConversationThread,
  openDatabase,
  recoverInterruptedDeferredThreadMessages,
  updateConversationThreadTitle,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { ClaudeCliProvider, LlmService, PromptRegistry } from '@zana-ai/zcc-llm';
import { listJsonFiles, writeJsonFile } from './disk-json.js';
import { CloseSummaryService } from '../services/followups/close-summary.js';
import { createProjectStore, type ProjectStore } from '../project-store.js';
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
  reconcileStoppingConversationThreadsOnHostConnect
} from '../services/threads/conversation-lifecycle.js';
import { publishConversationLifecycleOutcome } from '../services/threads/conversation-lifecycle-outcome.js';
import { healDisconnectedConversationThreadsForHost } from '../services/threads/conversation-host-recovery.js';
import { HOST_ACTIVE_WORK_DISCONNECT_GRACE_MS } from '../services/threads/conversation-runtime-display.js';
import { retryDueConversationSends } from '../services/threads/conversation-deferred-messages.js';
import { startDeferredRetryLoop } from '../services/threads/deferred-retry-loop.js';
import { disposeLocalHostDaemon } from '../services/hosts/host-relaunch.js';
import { startConversationHistoryMaintenance } from '../services/threads/conversation-history-maintenance.js';
import { PersistentTerminalSessions } from './persistent-terminal-sessions.js';
import { ProviderModelCatalogStore } from '../services/threads/provider-model-catalog-store.js';
import { createUiSendVerifier } from './ui-send-proof.js';
import { bridgeLaunchForProvider, listThreadProviders } from '../services/threads/thread-provider-catalog.js';

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
  db: ZccDatabase;
  hostHub: HostHub;
  modelCatalogs: ProviderModelCatalogStore;
  projects: ProjectStore;
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
  pairingRelay?: import('./pairing-relay-controller.js').PairingRelayHandle;
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
  verifyUiSend: (proof: unknown, threadId: string, itemId: string) => boolean;
  toProjects(): Project[];
  /** Release long-lived watchers started with this context. */
  dispose(): void;
}

export interface CreateProductHttpContextOptions {
  dataDir?: string;
  origins: LocalAppOriginArgs;
  enrollToken?: string;
  uiSendSecret?: string;
  /** Reuse a process-local project store when one already exists. */
  projects?: ProjectStore;
  onLibraryChanged?: () => void;
  onProjectsChanged?: () => void;
}

const identityConfig = {
  normalizeConfig: (input: Partial<AppConfig>) => input,
  projectConfigCompatibility: (input: AppConfig) => input,
  canonicalConfigForWrite: (input: AppConfig) => input,
  harnessEnabled: (_input: AppConfig, id: NonNullable<AppConfig['defaultHarness']>) => id === 'claude'
};

export function createProductHttpContext(
  options: CreateProductHttpContextOptions
): ProductHttpContext {
  const dataDir = options.dataDir ?? resolveZccDataDir();
  const projects = options.projects ?? createProjectStore({
    projectsFile: join(dataDir, 'projects.json'),
    remotePlaceholderRoot: join(dataDir, 'remote-projects')
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
  const hostHub = createHostHub(db, hub, terminalSessions, {
    pluginHostGenerations: () => ctx ? [...ctx.pluginHostArtifacts.entries()].map(([pluginId, artifact]) => ({ pluginId, generation: artifact.generation })) : [],
    onNewHostInstance: (hostId) => {
      pendingInteractions?.interruptPendingInteractionsForHost(
        hostId,
        'host-daemon-restarted'
      );
    },
    onHostConnected: (hostId) => {
      const timer = disconnectHealTimers.get(hostId);
      if (timer) {
        clearTimeout(timer);
        disconnectHealTimers.delete(hostId);
      }
      if (!ctx) return;
      void reconcileStoppingConversationThreadsOnHostConnect(ctx, hostId).catch(() => undefined);
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
      const updated = updateConversationThreadTitle(db, threadId, title);
      if (!updated) return;
      hub.emit('threads:updated', conversationThreadView(ctx, updated));
    },
    stillLive: (threadId) => Boolean(getConversationThread(db, threadId))
  });

  const closeSummary = new CloseSummaryService({
    getSession: () => null,
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

  ctx = {
    productInstanceId: readProductInstanceId(dataDir),
    origins: options.origins,
    dataDir,
    enrollToken,
    joinCodes: createJoinCodeStore(db),
    db,
    hostHub,
    modelCatalogs,
    projects,
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
    verifyUiSend: options.uiSendSecret && options.uiSendSecret.length >= 32
      ? createUiSendVerifier(options.uiSendSecret) : () => false,
    toProjects: () => projects.list() as unknown as Project[],
    dispose: () => {
      closeThreadReads(dataDir); closeQueuedMessages(dataDir);
      disposePreviews(ctx);
      stopHistoryMaintenance();
      ctx.cliCallbacks?.dispose();
      stopRetries();
      for (const timer of disconnectHealTimers.values()) clearTimeout(timer);
      disconnectHealTimers.clear();
      disposeLocalHostDaemon(ctx);
      inboxRead.dispose();
      promptRegistry.stop();
      ctx.plugins?.stop?.();
    }
  };
  previewService(ctx);
  const stopHistoryMaintenance = startConversationHistoryMaintenance(db);
  const stopRetries = startDeferredRetryLoop(() => retryDueConversationSends(ctx,
    (threadId) => flushHeldConversationSends(ctx, threadId, { enforceConcurrencyCap: true })));
  return ctx;
}
