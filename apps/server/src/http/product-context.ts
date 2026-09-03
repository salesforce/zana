import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveZccDataDir } from '@zana-ai/zcc-host-daemon/host-config';
import type { AppConfig, Project, TerminalSession } from '@zana-ai/zcc-domain/product';
import {
  getConversationThread,
  openDatabase,
  updateConversationThreadTitle,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import { ClaudeCliProvider, LlmService, PromptRegistry } from '@zana-ai/zcc-llm';
import { listJsonFiles, writeJsonFile } from './disk-json.js';
import { CloseSummaryService } from '../services/followups/close-summary.js';
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
  outputText?: string;
  outputTruncated?: boolean;
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
  closeSummary: CloseSummaryService;
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
  const dataDir = options.dataDir ?? resolveZccDataDir();
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
  let ctx!: ProductHttpContext;
  const hostHub = createHostHub(db, hub, terminalSessions, {
    onNewHostInstance: (hostId) => {
      pendingInteractions?.interruptPendingInteractionsForHost(
        hostId,
        'host-daemon-restarted'
      );
    },
    onConversationEvent: ({ threadId }) => {
      const thread = getConversationThread(db, threadId);
      if (!thread) return;
      hub.emit('threads:updated', conversationThreadView(ctx, thread));
    }
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
      llmService.setProvider(new ClaudeCliProvider(config.getConfig().claudeBinary || 'claude'));
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
    closeSummary,
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
