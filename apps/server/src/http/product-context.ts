import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { AppConfig, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  getConversationThread,
  openDatabase,
  updateConversationThreadTitle,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { ClaudeCliProvider, LlmService, PromptRegistry } from '@zana-ai/zcc-llm';
import { createProjectStore, type ProjectStore } from '../project-store.js';
import { createConfigStore } from '../services/config/config-store.js';
import { createInboxStore, type IInboxStore } from '../services/inbox/inbox-store.js';
import { createSuggestionsStore, type ISuggestionsStore } from '../services/suggestions/suggestions-store.js';
import { createSavedStore, type ISavedStore } from '../services/saved/saved-store.js';
import type { LocalAppOriginArgs } from './local-app-origins.js';
import { createProductHub, type ProductHub } from './product-hub.js';
import { createHostHub, type HostHub } from './host-hub.js';
import { PendingInteractionLifecycle } from '../services/interactions/pending-interactions.js';
import { conversationThreadView } from '../services/threads/conversation-create.js';
import { createThreadTitleNamer, type ThreadTitleNamer } from '../services/threads/thread-title-namer.js';
import { createJoinCodeStore, type JoinCodeStore } from '../services/hosts/join-codes.js';
import type { PluginService } from '../plugins/plugin-service.js';
import { PluginHostArtifactRegistry } from '../plugins/plugin-host-artifact-registry.js';
import { flushHeldConversationSends } from '../services/threads/conversation-lifecycle.js';
import { disposeLocalHostDaemon } from '../services/hosts/host-relaunch.js';

export interface ProductTerminalRecord extends TerminalSession {
  hostId: string;
}

export interface ProductHttpContext {
  origins: LocalAppOriginArgs;
  dataDir: string;
  enrollToken: string;
  joinCodes: JoinCodeStore;
  db: ZccDatabase;
  hostHub: HostHub;
  projects: ProjectStore;
  config: ReturnType<typeof createConfigStore>;
  inbox: IInboxStore;
  suggestions: ISuggestionsStore;
  saved: ISavedStore;
  hub: ProductHub;
  pendingInteractions: PendingInteractionLifecycle;
  threadTitleNamer: ThreadTitleNamer;
  terminalSessions: Map<string, ProductTerminalRecord>;
  plugins?: PluginService;
  pluginHostArtifacts: PluginHostArtifactRegistry;
  pairingRelay?: import('./pairing-relay-controller.js').PairingRelayHandle;
  toProjects(): Project[];
  /** Release long-lived watchers started with this context. */
  dispose(): void;
}

export interface CreateProductHttpContextOptions {
  dataDir?: string;
  origins: LocalAppOriginArgs;
  enrollToken?: string;
  /** Reuse a process-local project store when one already exists. */
  projects?: ProjectStore;
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
  const dataDir = options.dataDir ?? join(homedir(), '.zcc');
  const projects = options.projects ?? createProjectStore({
    projectsFile: join(dataDir, 'projects.json'),
    remotePlaceholderRoot: join(dataDir, 'remote-projects')
  });
  const config = createConfigStore(
    { homeDir: join(dataDir, '..'), configFile: join(dataDir, 'config.json') },
    identityConfig
  );
  const inbox = createInboxStore({ filePath: join(dataDir, 'inbox', 'entries.jsonl') });
  const suggestions = createSuggestionsStore({
    filePath: join(dataDir, 'suggestions', 'entries.jsonl')
  });
  const saved = createSavedStore({ dir: join(dataDir, 'saved') });
  const hub = createProductHub();
  const db = openDatabase(join(dataDir, 'zcc.sqlite'));
  const terminalSessions = new Map<string, ProductTerminalRecord>();
  let pendingInteractions: PendingInteractionLifecycle;
  const hostHub = createHostHub(db, hub, terminalSessions, {
    onNewHostInstance: (hostId) => {
      pendingInteractions?.interruptPendingInteractionsForHost(
        hostId,
        'host-daemon-restarted'
      );
    }
  });
  let ctx: ProductHttpContext;
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
  const threadTitleNamer = createThreadTitleNamer({
    autoRenameEnabled: () => config.getConfig().autoRenameTabs !== false,
    getEntry: (id) => promptRegistry.get(id),
    run: (entry, vars, dedupeKey) => {
      llmService.setProvider(new ClaudeCliProvider(config.getConfig().claudeBinary || 'claude'));
      return llmService.run(entry, vars, dedupeKey);
    },
    applyTitle: (threadId, title) => {
      const updated = updateConversationThreadTitle(db, threadId, title);
      if (!updated) return;
      hub.emit('threads:updated', conversationThreadView(ctx, updated));
    },
    stillLive: (threadId) => Boolean(getConversationThread(db, threadId))
  });

  ctx = {
    origins: options.origins,
    dataDir,
    enrollToken,
    joinCodes: createJoinCodeStore(),
    db,
    hostHub,
    projects,
    config,
    inbox,
    suggestions,
    saved,
    hub,
    pendingInteractions,
    threadTitleNamer,
    terminalSessions,
    pluginHostArtifacts: new PluginHostArtifactRegistry(),
    toProjects: () => projects.list() as unknown as Project[],
    dispose: () => {
      disposeLocalHostDaemon(ctx);
      promptRegistry.stop();
      ctx.plugins?.stop?.();
    }
  };
  return ctx;
}
