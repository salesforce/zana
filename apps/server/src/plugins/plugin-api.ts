import { pagedConversationPromptHistory } from '../services/threads/conversation-prompt-history.js';
import { validatePluginHostValue } from './plugin-host-rpc.js';
import { searchPluginInbox, readPluginInbox } from './plugin-inbox.js';
import { completePluginAssistant } from './plugin-assistant.js';
import {
  isProjectIcon,
  spawnEnvironmentChoiceSchema,
  type CapabilityDescriptor,
  type ContractJson,
  type InteractionAcknowledgement,
  type InteractionContract,
  type ProjectIcon
} from '@zana-ai/zcc-domain';
import { threadProviderFamily } from '../services/threads/thread-execution-options.js';
import { readHostFile, writeHostFile } from '../http/files-via-host.js';
import { readPluginProjectFile, writePluginProjectFile } from '../http/plugin-project-files.js';
import { environmentPullRequest } from '../services/environments/environment-actions.js';
import { conversationHistoryAsync } from '../services/threads/conversation-history.js';
import { threadSummary } from './thread-events.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { parsePluginLinkNote } from '../services/peers/plugin-link-notes.js';
import { PEER_ID, validScope } from '../services/peers/peer-auth.js';
import { linkCapable } from '../services/peers/scoped-link-authority.js';
import { InvitationError, type PublicInvitationStatus } from '../services/peers/peer-invitation.js';
import type { PeerLinkView } from '../services/peers/peer-links.js';
import { SSH_REASONS } from '../services/peers/peer-ssh-contract.js';
import * as jitiModule from 'jiti';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { openAsyncJsonStore } from '../services/storage/async-json-store.js';
import { runInNewContext } from 'node:vm';
import { dirname, join, resolve, sep } from 'node:path';
import { applyPluginSqliteMigrations } from './plugin-database-migrations.js';
import { backupCopyHandle, createPluginDatabaseBackup } from './plugin-database-backup.js';
import { createRequire } from 'node:module';
import { createSqliteDatabase, listAllHosts, listExecutionHosts, getPrimaryHost, getConversationThread, type HostRow } from '@zana-ai/zcc-db';
import type { ProductHttpContext } from '../http/product-context.js';
import { MODERN_SQUAD_THREAD_ORIGIN } from '@zana-ai/zcc-domain/squad-origin';
import type {
  PluginAgentConfigureContext,
  PluginProviderDeclaration,
  PluginAgentConfigureResult,
  PluginAgentToolRecord,
  PluginCliExecutionResult,
  PluginCliRegistration,
  PluginCliCommandInfo,
  PluginDatabase,
  PluginHttpMethod,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginPeerRequest,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginMentionProviderRegistration,
  PluginMentionSearchContext,
  PluginMentionSuggestion,
  PluginMentionTrigger,
  PluginSettingDescriptor,
  PluginSettingValue,
  PluginSdkEnvironment,
  PluginSdkExecutionOptions,
  PluginSdkFileReadResult,
  PluginSdkModelCatalog,
  PluginSdkProviderInfo,
  PluginSdkThreadEventRow,
  PluginSdkThreadOutput,
  PluginSdkThreadSpawnArgs,
  PluginSdkThreadSummary,
  PluginDispatchAdmissionRequest,
  PluginHooks,
  PluginToolPolicyRequest,
  PluginToolPolicyDecision,
  PluginThreadEvent,
  PluginThreadEventName,
  ZccPluginApi,
  ZccPluginFactory
} from '@zana-ai/zcc-plugin-sdk/server';
import {
  PLUGIN_MENTION_TRIGGERS,
  enforcePluginCliOutputLimit,
  isPluginHostEntryDefinition,
  type PluginProjectTabAvailabilityRegistration
} from '@zana-ai/zcc-plugin-sdk/server';
import { normalizeRegisteredAgentTool } from '@zana-ai/zcc-plugin-sdk/internal/host-policy';
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TIMEOUT_MS,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  PLUGIN_CLI_COMMAND_NAME_PATTERN,
  RESERVED_ZCC_CLI_COMMANDS,
  pluginIdSchema,
  validatePluginMetadata,
  type JsonObject,
  type JsonValue
} from '@zana-ai/zcc-domain/thread-runtime';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import {
  acquireDesktopBrowserControl,
  captureDesktopBrowserTab,
  createDesktopBrowserTab,
  desktopBrowserTabAction,
  importDesktopBrowserCookies,
  listDesktopBrowserImportSources,
  listDesktopBrowserInstances,
  listDesktopBrowserTabs,
  openDesktopBrowserConnection,
  releaseDesktopBrowserControl
} from '../services/desktop-browsers.js';
import { cronMatches, cronMinuteKey } from '@zana-ai/zcc-plugin-sdk';
import { desktopBrowserImportSourceIdSchema } from '@zana-ai/zcc-host-daemon-contract';
import {
  bindPluginServices,
  createPluginServicesRegistry,
  type PluginServicesRegistry
} from '@zana-ai/zcc-plugin-sdk/server';
import { appendPluginLogLine } from './plugin-log.js';
import {
  listLibraryDocs,
  readLibraryDoc,
  writeLibraryDoc
} from '../http/library-via-host.js';
import type { LibraryDoc } from '@zana-ai/zcc-domain/product';
import {
  mergeSecretSettings,
  persistSecretSettings,
  publicSettingsValues
} from './plugin-secret-settings.js';

// Bundlers inline this value; packaged servers must not inspect a cwd's package.json.
import packageJson from '../../../../package.json' with { type: 'json' };
export const HOST_ZCC_VERSION: string = packageJson.version;
export const HOST_PLUGIN_SDK_VERSION = '0.1.0';
export const FACTORY_TIMEOUT_MS = 10_000;

/**
 * `threads.spawn({ harness })`. An unrecognised mode rejects instead of being
 * dropped: dropping it would silently fall back to the first provider.
 */
export function parseSpawnHarness(value: unknown): 'project-default' {
  if (value === 'project-default') return value;
  throw new Error(`unknown harness mode: ${typeof value === 'string' ? value : typeof value}; expected 'project-default'`);
}

function parseLibraryScope(value: unknown): 'project' | 'global' | null {
  return value === 'project' || value === 'global' ? value : null;
}

function toSdkLibraryDoc(doc: LibraryDoc) {
  return {
    id: doc.id,
    relPath: doc.relPath,
    title: doc.title,
    ...(doc.summary ? { summary: doc.summary } : {}),
    ...(doc.tags ? { tags: doc.tags } : {}),
    scope: (doc.scope ?? 'project') as 'project' | 'global',
    ...(doc.projectId ? { projectId: doc.projectId } : {})
  };
}


export type PluginRuntimeStatus =
  | 'running'
  | 'disabled'
  | 'degraded'
  | 'needs-configuration';

export interface PluginHttpRouteRecord {
  method: PluginHttpMethod;
  path: string;
  handler: (request: PluginHttpRequest) => PluginHttpResponse | Promise<PluginHttpResponse>;
}

export interface PluginHostEvent {
  hostId: string; pluginId: string; generation: string;
  kind: 'plugin.host.worker-exited' | 'plugin.host.signal'; signal?: string; payload?: unknown;
}
export interface PluginHandle {
  /** Host-owned teardown that must finish before plugin state can be snapshotted. */
  onQuiesce(hook: () => void | Promise<void>): void;
  providerDeclarations: PluginProviderDeclaration[];
  emitHostEvent(event: PluginHostEvent): Promise<void>;
  api: ZccPluginApi;
  extraSkillRoots: string[];
  extraInstructions: string[];
  extraInstructionProviders: Array<(ctx: { threadId: string; projectId: string }) => string | null | Promise<string | null>>;
  agentConfigurers: Array<
    (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  >;
  mentionProviders: Array<PluginMentionProviderRegistration & { pluginId: string }>;
  projectTabAvailability: Array<PluginProjectTabAvailabilityRegistration & { pluginId: string }>;
  cli: { registration: PluginCliRegistration | null };
  httpRoutes: PluginHttpRouteRecord[];
  peerHandlers: Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>;
  agentTools: PluginAgentToolRecord[];
  dispatchAdmissionHandlers: Array<(request: PluginDispatchAdmissionRequest) => import('@zana-ai/zcc-domain').DispatchAdmissionDecision | Promise<import('@zana-ai/zcc-domain').DispatchAdmissionDecision>>;
  toolPolicyHandlers: Array<(request: PluginToolPolicyRequest) => PluginToolPolicyDecision | Promise<PluginToolPolicyDecision>>;
  emitThreadEvent(event: PluginThreadEvent): Promise<void>;
  getSettings(): {
    descriptors: Record<string, PluginSettingDescriptor>;
    values: Record<string, PluginSettingValue | undefined>;
  };
  setSettings(values: Record<string, PluginSettingValue | undefined>): Promise<void>;
  subscribeRealtime(listener: (event: string, payload: unknown) => void): () => void;
  dispose(options?: { strict?: boolean }): Promise<void>;
}

function readJsonFile<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function writeJsonFile(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

const MENTION_TRIGGER_SET = new Set<string>(PLUGIN_MENTION_TRIGGERS);

export function mentionTriggersOf(
  registration: Pick<PluginMentionProviderRegistration, 'trigger' | 'triggers'>
): PluginMentionTrigger[] {
  const raw = registration.triggers?.length
    ? [...registration.triggers]
    : registration.trigger
      ? [registration.trigger]
      : ['@'];
  const next = [...new Set(raw.filter((char): char is PluginMentionTrigger => MENTION_TRIGGER_SET.has(char)))];
  return next.length > 0 ? next : ['@'];
}

function mentionSearchContextFromBody(body: unknown): PluginMentionSearchContext {
  const record = body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {};
  const query = typeof record.query === 'string' ? record.query : '';
  const trigger = typeof record.trigger === 'string' ? record.trigger : '@';
  const projectId = typeof record.projectId === 'string' ? record.projectId.trim() : '';
  const threadId = typeof record.threadId === 'string' ? record.threadId.trim() : '';
  return {
    query,
    trigger,
    ...(projectId ? { projectId } : {}),
    ...(threadId ? { threadId } : {})
  };
}

async function invokeMentionSearch(
  search: PluginMentionProviderRegistration['search'],
  ctx: PluginMentionSearchContext
): Promise<PluginMentionSuggestion[]> {
  const result = await search(ctx);
  return Array.isArray(result) ? result : [];
}

export function createPluginApi(
  pluginId: string,
  kvDir: string,
  options?: {
    requestPluginInteraction?: (args: {
      pluginId: string;
      threadId: string;
      rendererId: string;
      title: string;
      payload: JsonValue;
      timeoutMs: number;
      signal?: AbortSignal;
    }) => Promise<PluginInteractionResult>;
    interruptPluginInteractions?: (pluginId: string) => void;
    /** Consumes a host-signed approval for this plugin; absent means every token is refused. */
    consumePluginApproval?: (args: { pluginId: string; token: string; binding: unknown }) => boolean;
    getInteraction?: (args: { pluginId: string; interactionId: string }) => Promise<InteractionContract | null>;
    upsertInteraction?: (args: {
      pluginId: string;
      projectId: string;
      correlationId: string;
      kind: string;
      payload: ContractJson;
    }) => Promise<InteractionContract>;
    acknowledgeInteraction?: (args: { pluginId: string } & InteractionAcknowledgement) => Promise<InteractionContract>;
    cancelInteraction?: (args: { pluginId: string } & InteractionAcknowledgement) => Promise<InteractionContract>;
    onNeedsConfiguration?: (message: string) => void;
    spawnThread?: (args: PluginSdkThreadSpawnArgs & { pluginId: string }) => Promise<{ id: string }>;
    getThread?: (args: { pluginId: string; threadId: string }) => Promise<PluginSdkThreadSummary | null>;
    listThreadEvents?: (args: {
      pluginId: string;
      threadId: string;
      limit?: number;
      types?: readonly string[];
      order?: 'asc' | 'desc';
    }) => Promise<PluginSdkThreadEventRow[]>;
    sendThread?: (args: {
      pluginId: string;
      threadId: string;
      prompt: string;
      visibility?: 'visible' | 'agent-only';
      mode?: 'start' | 'auto' | 'steer' | 'queue-if-active' | 'steer-if-active';
    }) => Promise<{ id: string }>;
    stopThread?: (args: { pluginId: string; threadId: string }) => Promise<{ ok: true }>;
    threadOutput?: (args: { pluginId: string; threadId: string }) => Promise<PluginSdkThreadOutput>;
    defaultExecutionOptions?: (args: { pluginId: string; threadId: string }) => Promise<PluginSdkExecutionOptions>;
    getEnvironment?: (args: { pluginId: string; environmentId: string }) => Promise<PluginSdkEnvironment>;
    readWorkspaceFile?: (args: {
      pluginId: string;
      hostId: string;
      path: string;
      rootPath: string;
    }) => Promise<PluginSdkFileReadResult>;
    listProviders?: (args: { pluginId: string; environmentId?: string }) => Promise<PluginSdkProviderInfo[]>;
    loadProviderModels?: (args: {
      pluginId: string;
      environmentId?: string;
      hostId?: string;
      providerId: string;
    }) => Promise<PluginSdkModelCatalog>;
    archiveThread?: (args: { pluginId: string; threadId: string }) => Promise<{ id: string }>;
    forkThread?: (args: {
      pluginId: string;
      threadId: string;
      sourceSeqEnd?: number;
      visibility?: 'visible' | 'hidden';
      agentContextSeed?: unknown[];
      title?: string;
    }) => Promise<{ id: string }>;
    listThreads?: (args: {
      pluginId: string;
      includeHidden?: boolean;
      originKind?: 'fork';
      originPluginId?: string;
      archived?: boolean;
      limit?: number;
      offset?: number;
    }) => Promise<PluginSdkThreadSummary[]>;
    listQueuedMessages?: (args: { pluginId: string; threadId: string }) => Promise<Array<{ id: string }>>;
    createQueuedMessage?: (args: {
      pluginId: string;
      threadId: string;
      input: unknown[];
      senderThreadId?: string;
    }) => Promise<{ id: string }>;
    unarchiveThread?: (args: { pluginId: string; threadId: string }) => Promise<{ id: string }>;
    getPluginMetadata?: (args: { pluginId: string; threadId: string }) => Promise<JsonObject>;
    updatePluginMetadata?: (args: {
      pluginId: string;
      threadId: string;
      set: JsonObject;
      remove: readonly string[];
    }) => Promise<JsonObject>;
    pushInbox?: (args: { pluginId: string; projectId: string; comments: string }) => Promise<{ id: string }>;
    listProjects?: (args: { pluginId: string }) => Promise<Array<{ id: string; name: string; path?: string; icon?: ProjectIcon }>>;
    productContext?: import('../http/product-context.js').ProductHttpContext;
    /** Names the manifest allows this plugin to set on remote machines (`zcc.extra.remoteEnvironment`). */
    remoteEnvironmentNames?: readonly string[];
    hostEntryPath?: string | null;
    providerUnavailableReason?: string;
    hostCall?: (method: string, input?: unknown, hostId?: string, signal?: AbortSignal, timeoutMs?: number, projectId?: string) => Promise<unknown>;
    dataDir?: string;
    services?: PluginServicesRegistry;
     isAgentToolNameTaken?: (name: string) => string | undefined;
     registerPersonas?: (pluginId: string, personas: readonly import('@zana-ai/zcc-domain/product').PersonaInput[]) => void;
     registerTeams?: (pluginId: string, teams: readonly import('@zana-ai/zcc-domain/product').TeamInput[]) => void;
    onToolPolicyRegister?: (handler: PluginHandle['toolPolicyHandlers'][number]) => void;
    toolPolicyRegistrationAllowed?: () => boolean;
  }
): PluginHandle {
  mkdirSync(kvDir, { recursive: true });
  const kvPath = join(kvDir, 'kv.json');
  const settingsPath = join(kvDir, 'settings.json');
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const providerDeclarations: PluginProviderDeclaration[] = [];
  const extraSkillRoots: string[] = [];
  const extraInstructions: string[] = [];
  const extraInstructionProviders: PluginHandle['extraInstructionProviders'] = [];
  const agentConfigurers: PluginHandle['agentConfigurers'] = [];
  const mentionProviders: PluginHandle['mentionProviders'] = [];
  const projectTabAvailability: PluginHandle['projectTabAvailability'] = [];
  const hostMethods = new Map<string, (input: unknown) => unknown | Promise<unknown>>();
  const hostSignalHandlers = new Map<string, Set<(event: { hostId: string; payload: unknown }) => void | Promise<void>>>();
  const hostWorkerExitHandlers: Array<(event: { readonly hostId: string }) => void | Promise<void>> = [];
  let hostEntryLoaded: Promise<void> | null = null;
  const settingListeners: Array<(next: Record<string, PluginSettingValue | undefined>) => void> = [];
  const realtimeListeners = new Set<(event: string, payload: unknown) => void>();
  let settingDescriptors: Record<string, PluginSettingDescriptor> = {};
  let stale = false;
  let disposal: Promise<void> | undefined;
  const disposalErrors: unknown[] = [];
  const quiesceHooks: Array<() => void | Promise<void>> = [];
  const assistantLifecycle = new AbortController();
  const peerLifecycle = new AbortController();
  const cliRecord: { registration: PluginCliRegistration | null } = { registration: null };
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const peerHandlers = new Map<string, (request: PluginPeerRequest) => unknown | Promise<unknown>>();
  const agentTools: PluginAgentToolRecord[] = [];
  const dispatchAdmissionHandlers: PluginHandle['dispatchAdmissionHandlers'] = [];
  const toolPolicyHandlers: PluginHandle['toolPolicyHandlers'] = [];
  const threadEventHandlers: Array<{
    name: PluginThreadEventName;
    handler: (event: PluginThreadEvent) => void | Promise<void>;
  }> = [];
  const sqliteHandles: Array<{ close(): void }> = [];
  let sharedDatabase: PluginDatabase | null = null;
  let sharedSqlite: ReturnType<typeof createSqliteDatabase> | null = null;
  const storageLifecycle = new AbortController();
  const assertLive = (): void => {
    if (stale) throw new Error(`plugin context is stale: ${pluginId}`);
  };
  let remoteEnvironmentRegistration: { refresh(): void; dispose(): void } | null = null;
  const peerContext = () => {
    assertLive();
    if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
    return options.productContext;
  };
  const peerArgs = (peerId: string, args: { scope: string }, allowed: readonly string[]) => {
    if (typeof peerId !== 'string' || !PEER_ID.test(peerId) || peerId === peerContext().productInstanceId ||
      !args || !validScope(args.scope) || Object.keys(args).some(key => !allowed.includes(key))) throw new Error('invalid peer lifecycle request');
  };
  // ---- Invitations: bound to this plugin id; whitelist projections so no internal field can reach a plugin ----
  const invitationsOf = () => {
    const ctx = peerContext();
    if (!ctx.peerInvitations) throw new InvitationError('unavailable');
    return ctx.peerInvitations;
  };
  const publicInvitation = (status: PublicInvitationStatus) => ({
    invitationId: status.invitationId, role: status.role, scope: status.scope ?? '', state: status.state,
    ...(status.reason ? { reason: status.reason } : {}), localFingerprint: status.localFingerprint,
    ...(status.peer ? { peer: { instanceId: status.peer.instanceId, name: status.peer.name, fingerprint: status.peer.fingerprint } } : {}),
    inviterDecision: status.inviterDecision, redeemerDecision: status.redeemerDecision,
    ...(status.pairingId ? { pairingId: status.pairingId } : {}), generation: status.generation, expiresAt: status.expiresAt,
    ...(status.consentExpiresAt !== undefined ? { consentExpiresAt: status.consentExpiresAt } : {})
  });
  const publicLink = (link: PeerLinkView) => ({
    pairingId: link.pairingId, peerInstanceId: link.peerInstanceId, scope: link.scope ?? '', role: link.role, phase: link.phase, state: link.state,
    ...(link.peerName ? { peerName: link.peerName } : {}),
    ...(link.reason ? { reason: link.reason } : {}), ...(link.failure ? { failure: link.failure } : {}),
    ...(link.retryInMs !== undefined ? { retryInMs: link.retryInMs } : {})
  });
  /**
   * A peer's display name on this app. A plugin-link host's stored name is the Connect label
   * (`Zana peer link: …`), so prefer the owner store's peer name; an execution host keeps its machine name.
   */
  const peerHostName = (ctx: ProductHttpContext, host: HostRow): string =>
    host.purpose.kind === 'plugin-link' ? (ctx.peerLinkDirectory?.describe(host.id)?.peerName || host.name) : host.name;
  /** A plugin link claimed only by other plugins is not this plugin's peer; unclaimed (legacy) links stay visible. */
  const visibleToPlugin = (host: HostRow): boolean =>
    host.purpose.kind !== 'plugin-link' || host.purpose.uses.length === 0 || host.purpose.uses.some(use => use.pluginId === pluginId);
  const SSH_REASON_CODES: ReadonlySet<string> = new Set(SSH_REASONS);
  /** Server-side only: name, code and top frame. The message is never logged; it may embed a token or key. */
  const logInviteFailure = (error: unknown): void => {
    const err = error as { name?: unknown; code?: unknown; stack?: unknown } | null;
    const frame = typeof err?.stack === 'string' ? err.stack.split('\n').find(line => line.trimStart().startsWith('at '))?.trim() : undefined;
    console.error(`[plugin:${pluginId}] invitation call failed (reported as unavailable): name=${typeof err?.name === 'string' ? err.name : typeof error}` +
      `${typeof err?.code === 'string' || typeof err?.code === 'number' ? ` code=${err.code}` : ''}${frame ? ` at=${frame}` : ''}`);
  };
  /** Only fixed-message InvitationErrors (or caller aborts) escape; any other failure may embed a token or key. */
  const inviteGuard = async <T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> => {
    assertLive();
    signal.throwIfAborted();
    let result: T;
    try { result = await run(); }
    catch (error) {
      assertLive();
      signal.throwIfAborted();
      if (error instanceof InvitationError && SSH_REASON_CODES.has(error.code)) {
        // The Design Docs setup cards key their guidance on the exact ssh_* code, so the code is the message.
        throw Object.assign(new InvitationError(error.code), { message: error.code });
      }
      if (error instanceof InvitationError) throw error;
      logInviteFailure(error);
      throw new InvitationError('unavailable');
    }
    assertLive();
    signal.throwIfAborted();
    return result;
  };
  const inviteArgs = (args: unknown, allowed: readonly string[]): Record<string, unknown> => {
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !allowed.includes(key))) throw new InvitationError('invalid_invitation');
    return args as Record<string, unknown>;
  };
  const inviteId = (value: unknown): string => {
    if (typeof value !== 'string' || !PEER_ID.test(value)) throw new InvitationError('invalid_invitation');
    return value;
  };
  const ownLinks = async (peerId?: string) => {
    const ctx = peerContext();
    if (!ctx.peerLinks) throw new InvitationError('unavailable');
    return (await ctx.peerLinks.links(peerId)).filter(link => link.pluginId === pluginId);
  };
  /** Every linked computer, one row each; the plugin's own use flag is the only per-plugin field. */
  const connectionList = async () => {
    const ctx = peerContext();
    if (!ctx.peerLinks) throw new InvitationError('unavailable');
    const byComputer = new Map<string, PeerLinkView[]>();
    for (const link of await ctx.peerLinks.links()) {
      if (link.phase !== 'linked') continue;
      byComputer.set(link.peerInstanceId, [...(byComputer.get(link.peerInstanceId) ?? []), link]);
    }
    const rows = [];
    for (const [computerId, links] of byComputer) {
      const best = links.find(link => link.state === 'connected') ?? links[0]!;
      const used = links.some(link => link.pluginId === pluginId) || (await ctx.peerConnectionUses?.has(pluginId, computerId)) === true;
      rows.push({ computerId, hostname: links.find(link => link.peerName)?.peerName ?? 'Computer', state: best.state, usedByThisPlugin: used });
    }
    return rows;
  };
  const requireConnection = async (computerId: unknown): Promise<void> => {
    peerContext();
    if (typeof computerId !== 'string' || !PEER_ID.test(computerId)) throw new InvitationError('unknown_connection');
    if (!(await connectionList()).some(row => row.computerId === computerId)) throw new InvitationError('unknown_connection');
  };
  const peerSignal = (signal?: AbortSignal) => AbortSignal.any([peerLifecycle.signal, AbortSignal.timeout(30_000), ...(signal ? [signal] : [])]);
  const resolvePeerHost = async (peerId: string, signal: AbortSignal, hosts?: HostRow[]) => {
    const ctx = peerContext();
    signal.throwIfAborted();
    const channel = await ctx.peerChannels.remote(peerId);
    signal.throwIfAborted();
    if (!channel || !linkCapable(channel.capability)) throw new Error('mutual enrollment unavailable');
    const hostIds = (hosts ?? listAllHosts(ctx.db)).filter(host => host.enrollmentCapability === channel.capability && ctx.hostHub.getSession(host.id)).map(host => host.id);
    const hostId = await ctx.peerAuthority.resolveHost(peerId, hostIds, signal);
    assertLive();
    signal.throwIfAborted();
    if (!hostId) throw new Error('verified peer app unavailable');
    return hostId;
  };
  const resolveSdkPluginId = (requested: unknown): string => {
    const value = typeof requested === 'string' && requested.trim() ? requested.trim() : pluginId;
    const parsed = pluginIdSchema.safeParse(value);
    if (!parsed.success) throw new Error('pluginId is invalid');
    return parsed.data;
  };
  const services = bindPluginServices(
    pluginId,
    options?.services ?? createPluginServicesRegistry(),
    (hook) => {
      disposeHooks.push(hook);
    }
  );
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const kv = openAsyncJsonStore(kvPath);
  quiesceHooks.push(() => kv.dispose({ drain: true }));
  // Plugin link notes are in memory and plugin-reported: they die with this plugin generation (stop, reload, uninstall).
  disposeHooks.push(() => options?.productContext?.peerLinkNotes?.clearPlugin(pluginId));
  disposeHooks.push(() => options?.productContext?.peerConnections?.clearPlugin(pluginId));
  const readSettings = (): Record<string, PluginSettingValue | undefined> =>
    mergeSecretSettings(
      kvDir,
      settingDescriptors,
      readJsonFile<Record<string, PluginSettingValue | undefined>>(settingsPath, {})
    );

  const ensureHostEntry = async (): Promise<void> => {
    if (hostEntryLoaded) {
      await hostEntryLoaded;
      return;
    }
    const path = options?.hostEntryPath;
    if (!path) return;
    hostEntryLoaded = (async () => {
      const href = `${pathToFileURL(path).href}?v=${Date.now()}`;
      const mod = (await import(href)) as { default?: unknown };
      const methodsApi = {
        methods: {
          register(name: string, handler: (input: unknown) => unknown | Promise<unknown>) {
            hostMethods.set(name, handler);
          }
        }
      };
      if (isPluginHostEntryDefinition(mod.default)) {
        await mod.default.setup(methodsApi);
        return;
      }
      if (typeof mod.default === 'function') {
        await (mod.default as (api: typeof methodsApi) => unknown)(methodsApi);
      }
    })();
    await hostEntryLoaded;
  };

  function emitLog(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const line = `[plugin:${pluginId}] ${message.slice(0, 8192)}`;
    if (level === 'debug') console.debug(line);
    else if (level === 'info') console.info(line);
    else if (level === 'warn') console.warn(line);
    else console.error(line);
    if (options?.dataDir) appendPluginLogLine(options.dataDir, pluginId, level, message);
  }

  /**
   * Every descriptor is derived from this handle's own `options` wiring (real
   * registered host state), never from the `providerId` the caller passes in —
   * a plugin/renderer can pick WHICH thread to ask about but cannot make a
   * capability answer `available: true` that main's wiring doesn't back.
   */
  function capabilityDescriptors(providerId: string | null, modernSquad = false): CapabilityDescriptor[] {
    const family = providerId ? threadProviderFamily(providerId) : null;
    const nativeToolCapable = !modernSquad && (family === 'claude' || family === 'codex');
    return [
      { id: 'message-admission', available: Boolean(options?.productContext) },
      { id: 'lifecycle-delivery', available: Boolean(options?.productContext) },
      {
        id: 'tool-before-native',
        available: nativeToolCapable,
        ...(nativeToolCapable ? {} : { reason: modernSquad ? 'Modern squad provider-native tool policy is not wired' : providerId ? `provider "${providerId}" has no native tool hook adapter` : 'no thread resolved' })
      },
      {
        id: 'tool-after-native',
        available: nativeToolCapable,
        ...(nativeToolCapable ? {} : { reason: modernSquad ? 'Modern squad provider-native tool policy is not wired' : providerId ? `provider "${providerId}" has no native tool hook adapter` : 'no thread resolved' })
      },
      { id: 'project-rpc', available: Boolean(options?.hostCall) },
      { id: 'interactions', available: Boolean(options?.upsertInteraction) }
    ];
  }

  // Backups read through the plugin's own live handle so its in-flight writes land in the copy.
  const databaseBackup = createPluginDatabaseBackup({
    pluginId,
    pluginDir: kvDir,
    lifetime: storageLifecycle.signal,
    source: () => {
      api.storage.database();
      return sharedSqlite!;
    },
    openCopy: (file) => backupCopyHandle(createSqliteDatabase(file))
  });

  const api: ZccPluginApi = {
    pluginId,
    log: {
      debug: (message) => emitLog('debug', message),
      info: (message) => emitLog('info', message),
      warn: (message) => emitLog('warn', message),
      error: (message) => emitLog('error', message)
    },
    settings: {
      define: (descriptors) => {
        settingDescriptors = descriptors;
        return {
          get: async () => {
            const stored = readSettings();
            const next: Record<string, PluginSettingValue | undefined> = {};
            for (const [key, descriptor] of Object.entries(descriptors)) {
              next[key] = stored[key] ?? descriptor.default;
            }
            return next;
          },
          onChange: (listener) => {
            settingListeners.push(listener);
          }
        };
      }
    },
    storage: {
      kv: {
        get: async <T>(key: string) => { assertLive(); return kv.get<T>(key); },
        set: async (key, value) => {
          assertLive();
          await kv.set(key, value);
        },
        delete: async (key) => {
          assertLive();
          await kv.delete(key);
        },
        list: async (prefix) => { assertLive(); return kv.list(prefix); }
      },
      database: (): PluginDatabase => {
        assertLive();
        if (sharedDatabase) return sharedDatabase;
        const dbPath = join(kvDir, 'data.db');
        const db = createSqliteDatabase(dbPath);
        sqliteHandles.push(db);
        sharedSqlite = db;
        const runBatch = Reflect.get(db, 'exec') as (source: string) => unknown;
        const beginTxn = Reflect.get(db, 'transaction') as <T>(fn: () => T) => () => T;
        const runScript = (sql: string) => {
          runBatch.call(db, sql);
        };
        sharedDatabase = {
          runScript,
          prepare: (sql) => db.prepare(sql),
          migrate: (statements) => {
            applyPluginSqliteMigrations(
              runScript,
              (sql) => db.prepare(sql),
              <T>(fn: () => T): T => beginTxn.call(db, fn)() as T,
              statements
            );
          },
          transaction: <T>(fn: () => T): T => beginTxn.call(db, fn)() as T
        };
        return sharedDatabase;
      },
      backupDatabase: (backupOptions) => {
        assertLive();
        return databaseBackup(backupOptions);
      }
    },
    http: {
      route: (method, path, handler) => {
        assertLive();
        if (!path.startsWith('/')) throw new Error('http route path must start with /');
        httpRoutes.push({ method, path, handler });
      }
    },
    cli: {
      register: (registration) => {
        assertLive();
        if (cliRecord.registration !== null) {
          throw new Error('cli command is already registered');
        }
        const name = registration?.name;
        if (typeof name !== 'string' || !PLUGIN_CLI_COMMAND_NAME_PATTERN.test(name)) {
          throw new Error(
            `invalid cli command name ${JSON.stringify(name)} — use lowercase letters, digits, and "-"`
          );
        }
        if (RESERVED_ZCC_CLI_COMMANDS.includes(name)) {
          throw new Error(`cli command name "${name}" is reserved by the zcc CLI — pick another name`);
        }
        if (typeof registration.summary !== 'string' || registration.summary.trim().length === 0) {
          throw new Error(`cli command "${name}" must provide a summary`);
        }
        if (typeof registration.run !== 'function') {
          throw new Error(`cli command "${name}" must provide a run(argv, ctx) function`);
        }
        const commands: PluginCliCommandInfo[] = (registration.commands ?? []).map((command, index) => {
          if (
            typeof command?.name !== 'string'
            || !PLUGIN_CLI_COMMAND_NAME_PATTERN.test(command.name)
            || typeof command.summary !== 'string'
            || typeof command.usage !== 'string'
          ) {
            throw new Error(
              `cli command "${name}" commands[${index}] must be { name: [a-z0-9-]+, summary, usage }`
            );
          }
          return { name: command.name, summary: command.summary, usage: command.usage };
        });
        cliRecord.registration = {
          name,
          summary: registration.summary.trim(),
          commands,
          run: registration.run
        };
      }
    },
    events: {
      on: (name, handler) => {
        threadEventHandlers.push({ name, handler });
      }
    },
    hooks: {
      on: (handler) => {
        assertLive();
        if (typeof handler !== 'function') throw new Error('dispatch admission handler must be a function');
        if (dispatchAdmissionHandlers.length > 0) throw new Error('only one dispatch admission handler is allowed per plugin');
        dispatchAdmissionHandlers.push(handler);
      },
      onToolPolicy: (handler) => {
        assertLive();
        if (typeof handler !== 'function') throw new Error('tool policy handler must be a function');
        if (toolPolicyHandlers.length > 0) throw new Error('only one tool policy handler is allowed per plugin');
        if (options?.toolPolicyRegistrationAllowed && !options.toolPolicyRegistrationAllowed()) {
          const error = new Error('tool policy handler cannot be registered after activation');
          options.onToolPolicyRegister?.(handler);
          throw error;
        }
        toolPolicyHandlers.push(handler);
        options?.onToolPolicyRegister?.(handler);
      }
    } satisfies PluginHooks,
    sdk: {
      experimental_promptHistory: {
        list: async (args: { scope: 'thread' | 'project' | 'all'; threadId?: string; projectId?: string; cursor?: string; query?: string }) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          if (!['thread', 'project', 'all'].includes(args?.scope)) throw new Error('Invalid history scope');
          return pagedConversationPromptHistory(options.productContext, args);
        }
      },
      assistant: {
        complete: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const result = await completePluginAssistant(options.productContext, { ...args, signal: args.signal ? AbortSignal.any([args.signal, assistantLifecycle.signal]) : assistantLifecycle.signal });
          assertLive();
          return result;
        }
      },
      system: {
        defaultHost: async () => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const host = getPrimaryHost(options.productContext.db);
          return host ? { id: host.id } : null;
        }
      },
      hosts: {
        list: async (args) => {
          assertLive();
          args?.signal?.throwIfAborted();
          if (!options?.productContext) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          // Execution machines only: forward-only peer links are not machines a plugin can run on.
          return listExecutionHosts(options.productContext.db).map(({ id, name }) => ({ id, name }));
        }
      },
      peers: {
        connections: {
          list: async (args) => {
            const signal = peerSignal(args?.signal);
            signal.throwIfAborted();
            const list = await connectionList();
            assertLive();
            signal.throwIfAborted();
            return list;
          },
          requestUse: async (computerId, args) => {
            const ctx = peerContext(), signal = peerSignal(args?.signal);
            await requireConnection(computerId);
            const uses = ctx.peerConnectionUses;
            if (!uses) throw new InvitationError('use_unavailable');
            const status = await uses.request(pluginId, computerId, signal);
            assertLive();
            signal.throwIfAborted();
            ctx.peerConnections?.notifyChanged();
            return { status };
          },
          stopUsing: async (computerId, args) => {
            const ctx = peerContext(), signal = peerSignal(args?.signal);
            await requireConnection(computerId);
            await ctx.peerConnectionUses?.confirmStop?.(pluginId, computerId, signal);
            // Releases this plugin's scoped uses and any approved use; the link itself is never removed here.
            for (const link of await ownLinks(computerId)) {
              if (link.scope !== undefined) await ctx.peerLinks!.release(computerId, pluginId, link.scope);
              assertLive();
            }
            await ctx.peerConnectionUses?.stop(pluginId, computerId);
            assertLive();
            signal.throwIfAborted();
            ctx.peerConnections?.setStatus(pluginId, computerId, null);
            ctx.peerConnections?.notifyChanged();
          },
          onChange: (callback) => {
            const registry = peerContext().peerConnections;
            if (typeof callback !== 'function') throw new Error('connection change callback must be a function');
            if (!registry) return () => undefined;
            const off = registry.onChange(() => {
              if (stale) return;
              void connectionList().then(list => { if (!stale) callback(list); }).catch(() => undefined);
            });
            disposeHooks.push(off);
            return off;
          },
          onConnectionRemoving: (handler) => {
            const registry = peerContext().peerConnections;
            if (!registry) throw new InvitationError('unavailable');
            // Stale generations are inert: the wrapper checks liveness so a handler outliving its plugin never runs.
            const off = registry.onRemoving(pluginId, async (computerId) => { if (!stale) await handler(computerId); });
            disposeHooks.push(off);
            return off;
          },
          setStatus: (computerId, note) => {
            const registry = peerContext().peerConnections;
            if (!registry || !registry.setStatus(pluginId, computerId, note)) throw new InvitationError('invalid_invitation');
          }
        },
        localIdentity: async () => ({ id: peerContext().productInstanceId }),
        storageEpoch: async () => {
          const epochs = peerContext().pluginStorageEpochs;
          if (!epochs) return null;
          const epoch = await epochs.current(pluginId);
          assertLive();
          return epoch;
        },
        advanceStorageEpoch: async (expected) => {
          const epochs = peerContext().pluginStorageEpochs;
          if (!epochs) throw new Error('plugin storage epoch unavailable');
          // Checked under the epoch lock: a disposed generation never advances its successor's fence.
          return epochs.advance(pluginId, expected, () => !stale);
        },
        features: async () => {
          assertLive();
          const available = Boolean(options?.productContext?.peerAuthority);
          return { lifecycle: available, introductions: available, installer: available && Boolean(options?.productContext?.peerInstaller), invitations: available && Boolean(options?.productContext?.peerInvitations) };
        },
        enrolled: async (args) => {
          const ctx = peerContext(), signal = peerSignal(args?.signal);
          signal.throwIfAborted();
          const channels = await ctx.peerChannels.list();
          const peers = [];
          // One host snapshot for the whole listing instead of two full host scans per channel.
          const hosts = listAllHosts(ctx.db);
          for (const channel of channels) {
            if (!linkCapable(channel.capability)) continue;
            try {
              const hostId = await resolvePeerHost(channel.remoteInstanceId, signal, hosts);
              const host = hosts.find(host => host.id === hostId);
              if (host && visibleToPlugin(host)) peers.push({ id: channel.remoteInstanceId, hostId, name: peerHostName(ctx, host), connected: true });
            } catch (error) {
              assertLive();
              signal.throwIfAborted();
              // Enrollment is not reachability; offline or mismatched apps stay hidden. Anything else is unexpected:
              // log name/code only (messages may embed key material) and keep listing the remaining peers.
              const message = error instanceof Error ? error.message : '';
              if (message !== 'mutual enrollment unavailable' && message !== 'verified peer app unavailable') {
                const err = error as { name?: unknown; code?: unknown } | null;
                console.warn(`[plugin:${pluginId}] peer listing skipped a peer: name=${typeof err?.name === 'string' ? err.name : typeof error}` +
                  `${typeof err?.code === 'string' || typeof err?.code === 'number' ? ` code=${err.code}` : ''}`);
              }
            }
          }
          assertLive();
          signal.throwIfAborted();
          return peers;
        },
        enable: async (peerId, args) => {
          const ctx = peerContext();
          peerArgs(peerId, args, ['scope', 'signal']);
          const signal = peerSignal(args.signal);
          signal.throwIfAborted();
          const targetHostId = await resolvePeerHost(peerId, signal);
          const proposal = await ctx.peerAuthority.ensureProposal({ pluginId, remoteInstanceId: peerId, targetHostId, scope: args.scope }, signal);
          assertLive();
          signal.throwIfAborted();
          const existing = await ctx.peerPairs.grant(proposal.pairId);
          const grant = existing ?? await ctx.peerAuthority.activate(proposal, signal);
          assertLive();
          signal.throwIfAborted();
          return { id: grant.remoteInstanceId, pairId: grant.pairId, proposalId: grant.proposalId, scope: grant.scope, grantEpoch: grant.epoch };
        },
        revoke: async (peerId, args) => {
          const ctx = peerContext();
          peerArgs(peerId, args, ['scope']);
          // Include tombstones so retries also finish uncertain writes, without touching other scopes/plugins.
          const proposals = await ctx.peerAuthority.proposals(pluginId, peerId, args.scope, true);
          assertLive();
          for (const proposal of proposals) {
            await ctx.peerAuthority.revoke(proposal.pairId);
            assertLive();
          }
          // Release this plugin scope's use of the invitation-founded transport link. The link itself stays, even with
          // no uses left; only an explicit owner removal tears it down.
          if (ctx.peerLinks) {
            await ctx.peerLinks.release(peerId, pluginId, args.scope as string);
            assertLive();
          }
          ctx.peerLinkNotes?.clear(pluginId, peerId, args.scope as string);
        },
        createInvitation: async (args) => {
          const a = inviteArgs(args, ['scope', 'signal']);
          if (typeof a.scope !== 'string' || !validScope(a.scope)) throw new InvitationError('invalid_invitation');
          const signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          let minted: { invitationId: string } | undefined;
          try {
            const created = await inviteGuard(signal, async () => {
              const value = await invitations.create({ pluginId, scope: a.scope as string });
              minted = value;
              return value;
            });
            return { invitationId: created.invitationId, token: created.token, expiresAt: created.expiresAt, code: created.code };
          } catch (error) {
            // A stale or aborted caller must not leave a live invitation whose token it never received; this covers
            // every post-create rejection inside inviteGuard, not only aborts observed before create resolved.
            if (minted) await invitations.cancel({ pluginId, invitationId: minted.invitationId }).catch(logInviteFailure);
            throw error;
          }
        },
        redeemInvitation: async (args) => {
          const a = inviteArgs(args, ['token', 'code', 'signal']);
          if (typeof a.token !== 'string' || a.token.length === 0 || a.token.length > 4096) throw new InvitationError('invalid_invitation');
          if (typeof a.code !== 'string' || a.code.length === 0 || a.code.length > 32) throw new InvitationError('identity_mismatch');
          const signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          return publicInvitation(await inviteGuard(signal, () => invitations.redeem({ pluginId, token: a.token as string, code: a.code as string })));
        },
        invitationStatus: async (args) => {
          const a = inviteArgs(args, ['invitationId', 'refresh', 'signal']);
          const invitationId = inviteId(a.invitationId), signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          return publicInvitation(await inviteGuard(signal, () => a.refresh === true
            ? invitations.refresh({ pluginId, invitationId }) : invitations.status({ pluginId, invitationId })));
        },
        listInvitations: async (args) => {
          const a = inviteArgs(args ?? {}, ['limit', 'signal']);
          if (a.limit !== undefined && (!Number.isInteger(a.limit) || (a.limit as number) < 1)) throw new InvitationError('invalid_invitation');
          const signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          return (await inviteGuard(signal, () => invitations.list({ pluginId, ...(a.limit !== undefined ? { limit: a.limit as number } : {}) }))).map(publicInvitation);
        },
        invitationApproval: async (args) => {
          const a = inviteArgs(args, ['invitationId', 'signal']);
          const invitationId = inviteId(a.invitationId), signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          // Title, summary and binding come from core's own record; the plugin supplies only which invitation.
          return inviteGuard(signal, () => invitations.approvalRequest({ pluginId, invitationId }));
        },
        decideInvitation: async (args) => {
          const a = inviteArgs(args, ['invitationId', 'decision', 'ownerProof', 'signal']);
          const invitationId = inviteId(a.invitationId);
          if (a.decision !== 'approved' && a.decision !== 'denied') throw new InvitationError('not_ready');
          if (a.decision === 'approved' && (typeof a.ownerProof !== 'string' || a.ownerProof.length === 0 || a.ownerProof.length > 4096)) throw new InvitationError('owner_proof_required');
          const signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          return publicInvitation(await inviteGuard(signal, () => invitations.decide({ pluginId, invitationId, decision: a.decision as 'approved' | 'denied',
            ...(a.decision === 'approved' ? { ownerProof: a.ownerProof as string } : {}) })));
        },
        cancelInvitation: async (args) => {
          const a = inviteArgs(args, ['invitationId', 'signal']);
          const invitationId = inviteId(a.invitationId), signal = peerSignal(a.signal as AbortSignal | undefined), invitations = invitationsOf();
          await inviteGuard(signal, () => invitations.cancel({ pluginId, invitationId }));
        },
        peerLinks: async (args) => {
          const a = inviteArgs(args ?? {}, ['peerId', 'signal']);
          const peerId = a.peerId === undefined ? undefined : inviteId(a.peerId);
          return (await inviteGuard(peerSignal(a.signal as AbortSignal | undefined), () => ownLinks(peerId))).map(publicLink);
        },
        setPeerLinkNote: async (peerId, args) => {
          const a = inviteArgs(args, ['scope', 'note', 'signal']);
          const id = inviteId(peerId), ctx = peerContext();
          if (typeof a.scope !== 'string' || !validScope(a.scope)) throw new InvitationError('invalid_invitation');
          const note = a.note === null ? null : parsePluginLinkNote(a.note);
          if (a.note !== null && !note) throw new InvitationError('invalid_invitation');
          const scope = a.scope;
          await inviteGuard(peerSignal(a.signal as AbortSignal | undefined), async () => {
            // Only a live link this plugin owns in this scope may carry its note; another plugin's links read as absent.
            if (!(await ownLinks(id)).some(link => link.scope === scope && link.phase !== 'removed')) {
              ctx.peerLinkNotes?.clear(pluginId, id, scope);
              throw new InvitationError('not_found');
            }
            if (!ctx.peerLinkNotes) throw new InvitationError('unavailable');
            if (note === null) ctx.peerLinkNotes.clear(pluginId, id, scope);
            else if (!ctx.peerLinkNotes.set(pluginId, id, scope, note)) throw new InvitationError('capacity');
          });
        },
        reconnectPeer: async (peerId, args) => {
          const a = inviteArgs(args ?? {}, ['signal']);
          const id = inviteId(peerId), ctx = peerContext();
          return (await inviteGuard(peerSignal(a.signal as AbortSignal | undefined), async () => {
            if (!(await ownLinks(id)).some(link => link.phase === 'linked')) throw new InvitationError('not_found');
            return (await ctx.peerLinks!.rotate(id)).filter(link => link.pluginId === pluginId);
          })).map(publicLink);
        },
        introduce: async (peerId, args) => {
          const ctx = peerContext();
          peerArgs(peerId, args, ['scope', 'sponsorPeerId', 'signal']);
          if (typeof args.sponsorPeerId !== 'string' || !PEER_ID.test(args.sponsorPeerId) || args.sponsorPeerId === peerId) throw new Error('invalid peer introduction');
          const signal = peerSignal(args.signal);
          signal.throwIfAborted();
          const grants = await ctx.peerPairs.list(pluginId);
          const sponsors = grants.filter(grant => grant.remoteInstanceId === args.sponsorPeerId && grant.scope === args.scope);
          const targets = grants.filter(grant => grant.remoteInstanceId === peerId && grant.scope === args.scope);
          if (sponsors.length !== 1 || targets.length !== 1) throw new Error('introduction scope or recipient mismatch');
          const sponsor = sponsors[0]!, target = targets[0]!;
          const introductionId = createHash('sha256').update(JSON.stringify(['peer-introduction-v1', pluginId, args.scope, sponsor.pairId, target.pairId])).digest('hex');
          assertLive();
          signal.throwIfAborted();
          await ctx.peerAuthority.introduce({ introductionId, sponsorPairId: sponsor.pairId, targetPairId: target.pairId,
            peerInstanceId: args.sponsorPeerId, pluginId, scope: args.scope, status: 'pending' });
          const status = await ctx.peerAuthority.introductionStatus(introductionId);
          assertLive();
          signal.throwIfAborted();
          return { introductionId, status };
        },
        list: async (args) => {
          assertLive();
          args?.signal?.throwIfAborted();
          if (!options?.productContext) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const ctx = options.productContext;
          const connected = new Set(ctx.hostHub?.connectedHostIds() ?? []);
          const hosts = new Map(listAllHosts(ctx.db).map(host => [host.id, peerHostName(ctx, host)]));
          const grants = await ctx.peerPairs.list(pluginId);
          assertLive();
          args?.signal?.throwIfAborted();
          return grants.map(grant => ({ id: grant.remoteInstanceId, name: hosts.get(grant.targetHostId) ?? grant.remoteInstanceId,
            scope: grant.scope, grantEpoch: grant.epoch, connected: connected.has(grant.targetHostId) }));
        },
        call: async (peerId, method, body, args) => {
          assertLive();
          args?.signal?.throwIfAborted();
          if (!options?.productContext || !/^[a-z][a-z0-9-]{0,63}$/.test(method)) throw new Error('invalid peer request');
          const ctx = options.productContext;
          const grants = (await ctx.peerPairs.list(pluginId)).filter(grant => grant.remoteInstanceId === peerId &&
            (args?.scope === undefined || grant.scope === args.scope));
          if (grants.length !== 1) throw new Error('peer link is not authorized');
          const grant = grants[0]!;
          const encoded = JSON.stringify(body ?? {});
          if (typeof encoded !== 'string') throw new Error('invalid peer body');
          if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw new Error('peer request exceeds 8 MiB');
          const timeoutMs = args?.timeoutMs ?? 30_000;
          if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) throw new Error('invalid peer timeout');
          const envelope = await ctx.peerPairs.signRequest(grant.pairId, { pluginId, scope: grant.scope, method, body: Buffer.from(encoded) });
          if (!envelope) throw new Error('peer link was revoked');
          const lease = await ctx.peerPairs.acquireGrant(grant.pairId, envelope.epoch, pluginId, grant.scope);
          if (!lease) throw new Error('peer link was revoked');
          const signal = AbortSignal.any([lease.signal, AbortSignal.timeout(timeoutMs), ...(args?.signal ? [args.signal] : [])]);
          let cancel: (() => void) | undefined;
          try {
            assertLive();
            signal.throwIfAborted();
            const operation = ctx.hostHub.callHostOnlineRpc<{ status: number; body: string }>({
              hostId: grant.targetHostId, timeoutMs: timeoutMs + 5_000,
              command: { type: 'peer.forward', ...envelope, method, body: encoded, timeoutMs }
            });
            const result = await Promise.race([operation, new Promise<never>((_resolve, reject) => {
              cancel = () => reject(signal.reason);
              signal.addEventListener('abort', cancel, { once: true });
              if (signal.aborted) cancel();
            })]);
            assertLive();
            signal.throwIfAborted();
            await lease.assertActive();
            if (Buffer.byteLength(result.body) > 8 * 1024 * 1024) throw new Error('peer response exceeds 8 MiB');
            if (result.status < 200 || result.status >= 300) throw new Error(`peer request failed: ${result.status}`);
            let response: { ok?: unknown; result?: unknown } | null;
            // Never surface the parser message: it can quote fragments of the peer's body.
            try { response = JSON.parse(result.body) as typeof response; } catch { throw new Error('invalid peer response'); }
            if (!response || typeof response !== 'object' || response.ok !== true) throw new Error('peer request was rejected');
            // Core-observed active use: only a call that completed counts; every failure above threw first.
            ctx.peerActiveUse?.recordSuccess(pluginId, peerId);
            return response.result;
          } finally {
            if (cancel) signal.removeEventListener('abort', cancel);
            lease.release();
          }
        },
        handle: (method, handler) => {
          assertLive();
          if (!/^[a-z][a-z0-9-]{0,63}$/.test(method) || typeof handler !== 'function') {
            throw new Error('invalid peer handler');
          }
          if (peerHandlers.has(method)) throw new Error(`peer handler already registered: ${method}`);
          peerHandlers.set(method, handler);
        }
      },
      threads: {
        search: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const limit = Number.isSafeInteger(args.limit) ? Math.max(1, Math.min(25, args.limit!)) : 25;
          const { db } = options.productContext;
          return (await conversationHistoryAsync(db, {
            query: typeof args.query === 'string' ? args.query : '',
            ...(typeof args.archived === 'boolean' ? { archived: args.archived ? 'archived' as const : 'active' as const } : {})
          })).rows.slice(0, limit).flatMap(({ id }) => {
            const row = getConversationThread(db, id);
            return row ? [threadSummary(row)] : [];
          });
        },
        spawn: async (args) => {
          assertLive();
          if (!options?.spawnThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
          const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
          if (!projectId) throw new Error('projectId is required');
          if (!prompt.trim()) throw new Error('prompt is required');
          const spawnProviderId = typeof args?.providerId === 'string' && args.providerId.trim() ? args.providerId.trim() : undefined;
          const spawnHarness = args?.harness !== undefined && args?.harness !== null ? parseSpawnHarness(args.harness) : undefined;
          return options.spawnThread({
            pluginId,
            projectId,
            prompt,
            ...(spawnProviderId ? { providerId: spawnProviderId } : {}),
            ...(spawnHarness ? { harness: spawnHarness } : {}),
            ...(typeof args?.parentThreadId === 'string' && args.parentThreadId.trim()
              ? { parentThreadId: args.parentThreadId.trim() }
              : {}),
            ...(typeof args?.title === 'string' && args.title.trim() ? { title: args.title.trim() } : {}),
            ...(typeof args?.model === 'string' && args.model.trim() ? { model: args.model.trim() } : {}),
            ...(typeof args?.reasoningLevel === 'string' && args.reasoningLevel.trim()
              ? { reasoningLevel: args.reasoningLevel.trim() }
              : {}),
            ...(args?.permissionMode === 'accept-edits' || args?.permissionMode === 'auto' || args?.permissionMode === 'full'
              ? { permissionMode: args.permissionMode }
              : {}),
            ...(args?.visibility === 'hidden' || args?.visibility === 'visible' ? { visibility: args.visibility } : {}),
            ...(args?.environment ? { environment: spawnEnvironmentChoiceSchema.parse(args.environment) } : {}),
            ...(args?.hostId ? { hostId: args.hostId } : {}),
            ...(typeof args?.serviceTier === 'string' ? { serviceTier: args.serviceTier } : {}),
            ...(args?.pluginMetadata !== undefined
              ? { pluginMetadata: validatePluginMetadata(args.pluginMetadata) }
              : {})
          });
        },
        get: async (args) => {
          assertLive();
          if (!options?.getThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.getThread({ pluginId, threadId });
        },
        events: {
          list: async (args) => {
            assertLive();
            if (!options?.listThreadEvents) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
            if (!threadId) throw new Error('threadId is required');
            return options.listThreadEvents({
              pluginId,
              threadId,
              limit: args?.limit,
              types: args?.types,
              order: args?.order
            });
          }
        },
        send: async (args) => {
          assertLive();
          if (!options?.sendThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          const prompt = typeof args?.prompt === 'string' ? args.prompt : '';
          if (!threadId) throw new Error('threadId is required');
          if (!prompt.trim()) throw new Error('prompt is required');
          const visibility = args?.visibility === 'agent-only' || args?.visibility === 'visible'
            ? args.visibility
            : undefined;
          const mode = args?.mode === 'start'
            || args?.mode === 'auto'
            || args?.mode === 'steer'
            || args?.mode === 'queue-if-active'
            || args?.mode === 'steer-if-active'
            ? args.mode
            : undefined;
          return options.sendThread({
            pluginId,
            threadId,
            prompt,
            ...(visibility ? { visibility } : {}),
            ...(mode ? { mode } : {})
          });
        },
        stop: async (args) => {
          assertLive();
          if (!options?.stopThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.stopThread({ pluginId, threadId });
        },
        output: async (args) => {
          assertLive();
          if (!options?.threadOutput) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.threadOutput({ pluginId, threadId });
        },
        defaultExecutionOptions: async (args) => {
          assertLive();
          if (!options?.defaultExecutionOptions) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.defaultExecutionOptions({ pluginId, threadId });
        },
        archive: async (args) => {
          assertLive();
          if (!options?.archiveThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.archiveThread({ pluginId, threadId });
        },
        fork: async (args) => {
          assertLive();
          if (!options?.forkThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const record = (args ?? {}) as {
            threadId?: string;
            sourceThreadId?: string;
            sourceSeqEnd?: number;
            visibility?: 'visible' | 'hidden';
            title?: string;
            agentContextSeed?: unknown[];
          };
          const threadId = typeof record.sourceThreadId === 'string' && record.sourceThreadId.trim()
            ? record.sourceThreadId.trim()
            : typeof record.threadId === 'string' ? record.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          const sourceSeqEnd = typeof record.sourceSeqEnd === 'number' && Number.isInteger(record.sourceSeqEnd) && record.sourceSeqEnd >= 0
            ? record.sourceSeqEnd
            : undefined;
          const visibility = record.visibility === 'hidden' || record.visibility === 'visible'
            ? record.visibility
            : undefined;
          const title = typeof record.title === 'string' && record.title.trim() ? record.title.trim() : undefined;
          const agentContextSeed = Array.isArray(record.agentContextSeed) ? record.agentContextSeed : undefined;
          return options.forkThread({
            pluginId,
            threadId,
            ...(sourceSeqEnd !== undefined ? { sourceSeqEnd } : {}),
            ...(visibility ? { visibility } : {}),
            ...(agentContextSeed ? { agentContextSeed } : {}),
            ...(title ? { title } : {})
          });
        },
        list: async (args) => {
          assertLive();
          if (!options?.listThreads) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.listThreads({
            pluginId,
            includeHidden: args?.includeHidden === true,
            originKind: args?.originKind === 'fork' ? 'fork' : undefined,
            originPluginId: typeof args?.originPluginId === 'string' ? args.originPluginId : undefined,
            archived: typeof args?.archived === 'boolean' ? args.archived : undefined,
            limit: typeof args?.limit === 'number' ? args.limit : undefined,
            offset: typeof args?.offset === 'number' ? args.offset : undefined
          });
        },
        queuedMessages: {
          list: async (args) => {
            assertLive();
            if (!options?.listQueuedMessages) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
            if (!threadId) throw new Error('threadId is required');
            return options.listQueuedMessages({ pluginId, threadId });
          },
          create: async (args) => {
            assertLive();
            if (!options?.createQueuedMessage) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
            if (!threadId) throw new Error('threadId is required');
            const input = Array.isArray(args?.input) ? args.input : [];
            const senderThreadId = typeof args?.senderThreadId === 'string' && args.senderThreadId.trim()
              ? args.senderThreadId.trim()
              : undefined;
            return options.createQueuedMessage({
              pluginId,
              threadId,
              input,
              ...(senderThreadId ? { senderThreadId } : {})
            });
          }
        },
        unarchive: async (args) => {
          assertLive();
          if (!options?.unarchiveThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.unarchiveThread({ pluginId, threadId });
        },
        getPluginMetadata: async (args) => {
          assertLive();
          if (!options?.getPluginMetadata) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          return options.getPluginMetadata({
            pluginId: resolveSdkPluginId(args?.pluginId),
            threadId
          });
        },
        updatePluginMetadata: async (args) => {
          assertLive();
          if (!options?.updatePluginMetadata) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const threadId = typeof args?.threadId === 'string' ? args.threadId.trim() : '';
          if (!threadId) throw new Error('threadId is required');
          const set = args?.set === undefined ? {} : validatePluginMetadata(args.set);
          const remove = Array.isArray(args?.remove)
            ? args.remove.filter((key): key is string => typeof key === 'string')
            : [];
          if (new Set(remove).size !== remove.length) {
            throw new Error('remove contains duplicate keys');
          }
          if (remove.some((key) => Object.hasOwn(set, key))) {
            throw new Error('set and remove overlap');
          }
          return options.updatePluginMetadata({
            pluginId: resolveSdkPluginId(args?.pluginId),
            threadId,
            set,
            remove
          });
        }
      },
      inbox: {
        search: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const result = await searchPluginInbox(options.productContext, args);
          assertLive();
          return result;
        },
        read: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const result = await readPluginInbox(options.productContext, args);
          assertLive();
          return result;
        },
        push: async (args) => {
          assertLive();
          if (!options?.pushInbox) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
          const comments = typeof args?.comments === 'string' ? args.comments : '';
          if (!projectId) throw new Error('projectId is required');
          if (!comments.trim()) throw new Error('comments is required');
          return options.pushInbox({ pluginId, projectId, comments });
        }
      },
      projects: {
        list: async () => {
          assertLive();
          if (!options?.listProjects) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.listProjects({ pluginId });
        },
        setIcon: async (args) => {
          assertLive();
          const ctx = options?.productContext;
          if (!ctx) throw new Error('zcc.sdk is not available in this runtime');
          const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
          if (!projectId) throw new Error('projectId is required');
          if (!isProjectIcon(args?.icon)) throw new Error('unsupported project icon');
          const project = await ctx.projects.update(projectId, { icon: args.icon });
          if (!project) throw new Error('unrecognized projectId');
          ctx.hub.emit('projects:changed', ctx.projects.list());
        }
      },
      environments: {
        pullRequest: async ({ environmentId }) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return await environmentPullRequest(options.productContext, environmentId) as Awaited<ReturnType<ZccPluginApi['sdk']['environments']['pullRequest']>>;
        },
        get: async (args) => {
          assertLive();
          if (!options?.getEnvironment) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const environmentId = typeof args?.environmentId === 'string' ? args.environmentId.trim() : '';
          if (!environmentId) throw new Error('environmentId is required');
          return options.getEnvironment({ pluginId, environmentId });
        }
      },
      files: {
        readProject: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return readPluginProjectFile(options.productContext, args);
        },
        writeProject: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return writePluginProjectFile(options.productContext, args);
        },
        write: async (args) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          await writeHostFile(options.productContext, args);
        },
        read: async (args) => {
          assertLive();
          if (!options?.readWorkspaceFile) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const hostId = typeof args?.hostId === 'string' ? args.hostId.trim() : '';
          const path = typeof args?.path === 'string' ? args.path : '';
          const rootPath = typeof args?.rootPath === 'string' ? args.rootPath : '';
          if (!path.trim()) throw new Error('path is required');
          if (!hostId && options.productContext) return readHostFile(options.productContext, { path, ...(rootPath ? { rootPath } : {}) });
          if (!hostId) throw new Error('hostId is required');
          return options.readWorkspaceFile({ pluginId, hostId, path, rootPath });
        }
      },
      library: {
        list: async (args) => {
          assertLive();
          if (!options?.productContext) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const projectId = typeof args?.projectId === 'string' ? args.projectId.trim() : '';
          const hostId = typeof args?.hostId === 'string' && args.hostId.trim() ? args.hostId.trim() : undefined;
          const docs = await listLibraryDocs(options.productContext, hostId);
          const scoped = projectId
            ? docs.filter((doc) => doc.scope === 'global' || doc.projectId === projectId)
            : docs;
          return scoped.map(toSdkLibraryDoc);
        },
        read: async (args) => {
          assertLive();
          if (!options?.productContext) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const scope = parseLibraryScope(args?.scope);
          const relPath = typeof args?.relPath === 'string' ? args.relPath.trim() : '';
          if (!scope) throw new Error('scope must be "project" or "global"');
          if (!relPath) throw new Error('relPath is required');
          const projectId = typeof args?.projectId === 'string' && args.projectId.trim()
            ? args.projectId.trim()
            : undefined;
          if (scope === 'project' && !projectId) throw new Error('projectId is required');
          const hostId = typeof args?.hostId === 'string' && args.hostId.trim() ? args.hostId.trim() : undefined;
          const result = await readLibraryDoc(options.productContext, scope, relPath, projectId, hostId);
          if (!result.ok) return { ok: false as const, message: result.message ?? 'read failed' };
          return { ok: true as const, content: result.content ?? '', sha256: result.sha256 };
        },
        write: async (args) => {
          assertLive();
          if (!options?.productContext) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const scope = parseLibraryScope(args?.scope);
          const relPath = typeof args?.relPath === 'string' ? args.relPath.trim() : '';
          const content = typeof args?.content === 'string' ? args.content : null;
          if (!scope) throw new Error('scope must be "project" or "global"');
          if (!relPath) throw new Error('relPath is required');
          if (content === null) throw new Error('content is required');
          const projectId = typeof args?.projectId === 'string' && args.projectId.trim()
            ? args.projectId.trim()
            : undefined;
          if (scope === 'project' && !projectId) throw new Error('projectId is required');
          const hostId = typeof args?.hostId === 'string' && args.hostId.trim() ? args.hostId.trim() : undefined;
          return writeLibraryDoc(options.productContext, scope, relPath, content, projectId, hostId, args.expectedSha256);
        }
      },
      providers: {
        list: async (args) => {
          assertLive();
          if (!options?.listProviders) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const environmentId = typeof args?.environmentId === 'string' && args.environmentId.trim()
            ? args.environmentId.trim()
            : undefined;
          return options.listProviders({ pluginId, ...(environmentId ? { environmentId } : {}) });
        },
        models: async (args) => {
          assertLive();
          if (!options?.loadProviderModels) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const providerId = typeof args?.providerId === 'string' ? args.providerId.trim() : '';
          if (!providerId) throw new Error('providerId is required');
          const environmentId = typeof args?.environmentId === 'string' && args.environmentId.trim()
            ? args.environmentId.trim()
            : undefined;
          return options.loadProviderModels({
            pluginId,
            providerId,
            ...(args.hostId ? { hostId: args.hostId } : {}),
            ...(environmentId ? { environmentId } : {})
          });
        }
      },
      experimental_desktopBrowsers: {
        listInstances: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return listDesktopBrowserInstances(options.productContext, input.hostId);
        },
        listTabs: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return listDesktopBrowserTabs(options.productContext, input);
        },
        createTab: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return createDesktopBrowserTab(options.productContext, {
            ...input,
            url: input.url ?? 'about:blank',
            presentation: input.presentation ?? 'hidden'
          });
        },
        acquireControl: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return acquireDesktopBrowserControl(options.productContext, {
            ...input,
            ttlMs: input.ttlMs ?? 300000,
            allowPersonal: input.allowPersonal ?? false
          });
        },
        openConnection: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return openDesktopBrowserConnection(options.productContext, input);
        },
        releaseControl: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return releaseDesktopBrowserControl(options.productContext, input);
        },
        revealTab: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          await desktopBrowserTabAction(options.productContext, input, 'reveal');
          return { ok: true as const };
        },
        closeTab: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          await desktopBrowserTabAction(options.productContext, input, 'close');
          return { ok: true as const };
        },
        captureTab: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const result = await captureDesktopBrowserTab(options.productContext, input);
          return { base64: result.base64, mimeType: result.mimeType };
        },
        listImportSources: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return listDesktopBrowserImportSources(options.productContext, input);
        },
        importCookies: async (input) => {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          return importDesktopBrowserCookies(options.productContext, {
            hostId: input.hostId,
            instanceId: input.instanceId,
            generation: input.generation,
            sourceId: desktopBrowserImportSourceIdSchema.parse(input.sourceId),
            sourceProfileDirectory: input.sourceProfileDirectory,
            profile: input.profile ?? { kind: 'personal' }
          });
        },
        subscribe(input) {
          assertLive();
          if (!options?.productContext) throw new Error('zcc.sdk is not available in this runtime');
          const product = options.productContext;
          let disposed = false;
          let timer: ReturnType<typeof setTimeout> | undefined;
          let previous = '';
          const scope = {
            hostId: input.hostId,
            instanceId: input.instanceId,
            generation: input.generation,
            threadId: input.threadId
          };
          const poll = async () => {
            try {
              const result = await listDesktopBrowserTabs(product, scope);
              const serialized = JSON.stringify(result);
              if (!disposed && serialized !== previous) {
                previous = serialized;
                input.onChange(result);
              }
            } catch (error) {
              if (!disposed) input.onError(error instanceof Error ? error : new Error(String(error)));
            } finally {
              if (!disposed) {
                timer = setTimeout(() => {
                  void poll();
                }, 2000);
              }
            }
          };
          void poll();
          return {
            dispose() {
              disposed = true;
              clearTimeout(timer);
            }
          };
        }
      },
      capabilities: {
        forThread: async ({ threadId }) => {
          assertLive();
          const id = typeof threadId === 'string' ? threadId.trim() : '';
          if (!id) throw new Error('threadId is required');
          const thread = options?.productContext ? getConversationThread(options.productContext.db, id) : null;
          return { capabilities: capabilityDescriptors(thread?.providerId ?? null, thread?.originPluginId === MODERN_SQUAD_THREAD_ORIGIN) };
        },
        forExecution: async ({ executionId }) => {
          assertLive();
          if (typeof executionId !== 'string' || !executionId.trim()) {
            throw new Error('executionId is required');
          }
          // An execution can span multiple provider slots, so there is no single
          // resolved provider to gate provider-specific descriptors on.
          return { capabilities: capabilityDescriptors(null) };
        }
      }
    },
    host: {
      projectCall: async (request) => {
        assertLive();
        const projectId = typeof request?.projectId === 'string' ? request.projectId.trim() : '';
        const method = typeof request?.method === 'string' ? request.method.trim() : '';
        if (!projectId || !method || !options?.hostCall) throw new Error('invalid project host call');
        const result = await options.hostCall(method, request.input, request.hostId, undefined, undefined, projectId);
        return { result: (result ?? null) as import('@zana-ai/zcc-domain').ContractJson };
      },
      experimental_call: async (method, input) => {
        assertLive();
        if (options?.hostCall) return options.hostCall(method, input);
        await ensureHostEntry();
        const handler = hostMethods.get(method);
        if (!handler) {
          throw new Error(`zcc.host method is not available: ${method}`);
        }
        return handler(input);
      },
      experimental_client(clientOptions) {
        return {
          call: async (method, input, callOptions) => {
            assertLive();
            const contract = clientOptions?.contract as Record<string, { input: unknown; output: unknown }> | undefined;
            const descriptor = contract && Object.hasOwn(contract, method) ? contract[method] : undefined;
            if (contract && !descriptor) throw new Error('Unknown plugin host method');
            const parsed = descriptor ? await validatePluginHostValue(descriptor.input, input) : input;
            if (options?.hostCall) {
              const result = await options.hostCall(method, parsed, callOptions?.hostId, callOptions?.signal, callOptions?.timeoutMs);
              return descriptor ? validatePluginHostValue(descriptor.output, result) : result;
            }
            if (callOptions?.hostId) throw new Error('Selected plugin host is unavailable in this runtime');
            await ensureHostEntry();
            const handler = hostMethods.get(method);
            if (!handler) {
              throw new Error(`zcc.host method is not available: ${method}`);
            }
            return handler(input);
          },
          experimental_onSignal(signal, handler) {
            assertLive();
            const handlers = hostSignalHandlers.get(signal) ?? new Set();
            handlers.add(handler); hostSignalHandlers.set(signal, handlers);
            return () => { handlers.delete(handler); if (!handlers.size) hostSignalHandlers.delete(signal); };
          },
          experimental_onWorkerExit(handler) {
            assertLive();
            hostWorkerExitHandlers.push(handler);
            return () => {
              const index = hostWorkerExitHandlers.indexOf(handler);
              if (index >= 0) hostWorkerExitHandlers.splice(index, 1);
            };
          }
        };
      }
    },
    rpc: {
      method: (name, handler) => {
        assertLive();
        rpc.set(name, handler);
      },
      register: (_contract, handlers) => {
        assertLive();
        for (const [name, handler] of Object.entries(handlers)) {
          if (typeof handler === 'function') {
            rpc.set(name, handler as (args: unknown) => unknown);
          }
        }
      }
    },
    realtime: {
      publish: (event, payload) => {
        assertLive();
        for (const listener of realtimeListeners) listener(event, payload);
        // Realtime payloads cross only from trusted plugin server code to the
        // renderer; renderer listeners receive no authority from this signal.
        options?.productContext?.hub.emit('plugin-signal', { pluginId, channel: event, payload: payload ?? null });
      }
    },
    background: {
      service: (_name, start) => {
        void Promise.resolve(start()).then((stop) => {
          if (typeof stop === 'function') { if (stale) return stop(); disposeHooks.push(stop); }
        }).catch(error => console.error(`[plugin:${pluginId}] background service failed`, error));
      },
      schedule: (cronOrName, jobOrCron, maybeJob?) => {
        assertLive();
        const named = typeof jobOrCron === 'string';
        const name = named ? cronOrName : '';
        const cron = named ? jobOrCron : cronOrName;
        const job = named ? maybeJob : jobOrCron;
        if (typeof job !== 'function') throw new Error('background.schedule requires a job function');
        const persistKey = name ? `schedule:${name}:last` : '';
        let running = false;
        const timer = setInterval(() => {
          if (running || stale) return;
          if (!cronMatches(cron)) return;
          running = true;
          void (async () => {
            const minute = cronMinuteKey();
            if (persistKey) {
              if (await kv.get(persistKey) === minute || stale) return;
              await kv.set(persistKey, minute);
            }
            if (!stale) await job();
          })().catch((error) => {
            console.error(`[plugin:${pluginId}] schedule ${name || cron} failed`, error);
          }).finally(() => { running = false; });
        }, 60_000);
        disposeHooks.push(() => clearInterval(timer));
      },
    },
    remoteEnvironment: {
      provide: (resolve) => {
        assertLive();
        if (typeof resolve !== 'function') throw new Error('remoteEnvironment.provide requires a function');
        const service = options?.productContext?.remoteEnvironment;
        if (!service) throw new Error('remoteEnvironment is not available in this runtime');
        if (remoteEnvironmentRegistration) throw new Error('remoteEnvironment.provide is already registered');
        const allowedNames = options?.remoteEnvironmentNames ?? [];
        if (allowedNames.length === 0) {
          throw new Error('declare zcc.extra.remoteEnvironment names in the plugin manifest to use remoteEnvironment');
        }
        const registration = service.register({ pluginId, allowedNames, resolve });
        remoteEnvironmentRegistration = registration;
        disposeHooks.push(() => {
          if (remoteEnvironmentRegistration === registration) remoteEnvironmentRegistration = null;
          registration.dispose();
        });
      },
      refresh: () => {
        assertLive();
        remoteEnvironmentRegistration?.refresh();
      }
    },
    agents: {
      contributeInstructions: (textOrProvider) => {
        if (typeof textOrProvider === 'function') {
          if (extraInstructionProviders.length > 0) {
            throw new Error('contributeInstructions is already registered');
          }
          extraInstructionProviders.push(textOrProvider);
          return;
        }
        extraInstructions.length = 0;
        const trimmed = typeof textOrProvider === 'string' ? textOrProvider.trim() : '';
        if (trimmed) extraInstructions.push(trimmed);
      },
      contributeSkills: (rootPaths) => {
        extraSkillRoots.push(...rootPaths);
      },
      registerTool: (registration) => {
        assertLive();
        const record = normalizeRegisteredAgentTool({
          pluginId,
          tool: registration
        });
        const owner = options?.isAgentToolNameTaken?.(record.name);
        if (owner !== undefined && owner !== pluginId) {
          options?.onNeedsConfiguration?.(
            `tool "${record.name}" is already registered by plugin "${owner}" — not registered`
          );
          return;
        }
        if (agentTools.some((existing) => existing.name === record.name)) {
          throw new Error(`tool "${record.name}" is already registered`);
        }
        agentTools.push(record);
      },
      registerPersonas: (personas) => {
        assertLive();
        options?.registerPersonas?.(pluginId, personas);
      },
      registerTeams: (teams) => {
        assertLive();
        options?.registerTeams?.(pluginId, teams);
      },
      experimental_registerProvider: (declaration) => {
        assertLive();
        providerDeclarations.push(declaration);
        const handle = registerThreadProvider(pluginId, declaration, options?.hostEntryPath, options?.providerUnavailableReason);
        disposeHooks.push(() => handle.unregister());
        return handle;
      },
      experimental_registerPtyHarness: (declaration) => {
        assertLive();
        if (!declaration?.id?.trim() || !declaration?.displayName?.trim()) {
          throw new Error('agents.experimental_registerPtyHarness requires id and displayName');
        }
        return {
          id: declaration.id,
          unregister() {
            /* Host-daemon binds the family in-process; unregister is a no-op here. */
          }
        };
      },
      configure: (provider) => {
        assertLive();
        agentConfigurers.push(provider);
      }
    },
    ui: {
      requestInput: async (request, requestOptions) => {
        assertLive();
        const parsed = validatePluginRequestInput(request);
        if (!options?.requestPluginInteraction) {
          throw new Error('ui.requestInput is not available in this runtime');
        }
        return options.requestPluginInteraction({
          pluginId,
          threadId: parsed.threadId,
          rendererId: parsed.rendererId,
          title: parsed.title,
          payload: parsed.payload,
          timeoutMs: parsed.timeoutMs,
          signal: requestOptions?.signal
        });
      },
      experimental_consumeApproval: async (request) => {
        assertLive();
        // Fail closed: a missing verifier, a malformed request or a reused token all refuse.
        if (!request || typeof request !== 'object' || typeof request.token !== 'string') return false;
        return options?.consumePluginApproval?.({ pluginId, token: request.token, binding: request.binding }) ?? false;
      },
      registerMentionProvider: (registration) => {
        assertLive();
        if (
          !registration?.id
          || typeof registration.label !== 'string'
          || !registration.label.trim()
          || typeof registration.search !== 'function'
          || typeof registration.resolve !== 'function'
        ) {
          throw new Error('ui.registerMentionProvider requires id, label, search, and resolve');
        }
        const triggers = mentionTriggersOf(registration);
        mentionProviders.push({ ...registration, triggers, pluginId });
        httpRoutes.push({
          method: 'POST',
          path: `/mentions/${registration.id}/search`,
          handler: async (request) => {
            const ctx = mentionSearchContextFromBody(request.body);
            const items: PluginMentionSuggestion[] = await invokeMentionSearch(registration.search, ctx);
            return { json: { items } };
          }
        });
      },
      registerProjectTabAvailability: (registration) => {
        assertLive();
        if (
          !registration
          || typeof registration.tabId !== 'string'
          || !registration.tabId.trim()
          || typeof registration.evaluate !== 'function'
        ) {
          throw new Error('ui.registerProjectTabAvailability requires tabId and evaluate');
        }
        const index = projectTabAvailability.findIndex((row) => row.tabId === registration.tabId);
        const next = { ...registration, pluginId };
        if (index >= 0) projectTabAvailability[index] = next;
        else projectTabAvailability.push(next);
      },
      interactions: {
        get: async (interactionId) => {
          assertLive();
          if (typeof interactionId !== 'string' || !interactionId.trim()) {
            throw new Error('ui.interactions.get requires interactionId');
          }
          if (!options?.getInteraction) {
            throw new Error('ui.interactions.get is not available in this runtime');
          }
          return options.getInteraction({ pluginId, interactionId });
        },
        upsert: async (input) => {
          assertLive();
          if (!input || typeof input.projectId !== 'string' || !input.projectId.trim()) {
            throw new Error('ui.interactions.upsert requires projectId');
          }
          if (typeof input.correlationId !== 'string' || !input.correlationId.trim()) {
            throw new Error('ui.interactions.upsert requires correlationId');
          }
          if (typeof input.kind !== 'string' || !input.kind.trim()) {
            throw new Error('ui.interactions.upsert requires kind');
          }
          if (!options?.upsertInteraction) {
            throw new Error('ui.interactions.upsert is not available in this runtime');
          }
          return options.upsertInteraction({
            pluginId,
            projectId: input.projectId,
            correlationId: input.correlationId,
            kind: input.kind,
            payload: input.payload
          });
        },
        acknowledge: async (request) => {
          assertLive();
          if (!request || typeof request.interactionId !== 'string' || !request.interactionId.trim()) {
            throw new Error('ui.interactions.acknowledge requires interactionId');
          }
          if (!options?.acknowledgeInteraction) {
            throw new Error('ui.interactions.acknowledge is not available in this runtime');
          }
          return options.acknowledgeInteraction({
            pluginId,
            interactionId: request.interactionId,
            generation: request.generation
          });
        },
        cancel: async (request) => {
          assertLive();
          if (!request || typeof request.interactionId !== 'string' || !request.interactionId.trim()) {
            throw new Error('ui.interactions.cancel requires interactionId');
          }
          if (!options?.cancelInteraction) {
            throw new Error('ui.interactions.cancel is not available in this runtime');
          }
          return options.cancelInteraction({
            pluginId,
            interactionId: request.interactionId,
            generation: request.generation
          });
        }
      }
    },
    status: {
      needsConfiguration: (message) => {
        options?.onNeedsConfiguration?.(message);
      }
    },
    services,
    onDispose: (hook) => {
      disposeHooks.push(hook);
    }
  };
  return {
    api,
    onQuiesce(hook: () => void | Promise<void>) { quiesceHooks.push(hook); },
    providerDeclarations,
    extraSkillRoots,
    extraInstructions,
    extraInstructionProviders,
    agentConfigurers,
    mentionProviders,
    projectTabAvailability,
    cli: cliRecord,
    httpRoutes,
    peerHandlers,
    agentTools,
    dispatchAdmissionHandlers,
    toolPolicyHandlers,
    async emitHostEvent(event) {
      if (stale) return;
      const handlers = event.kind === 'plugin.host.worker-exited'
        ? hostWorkerExitHandlers.map(handler => () => handler({ hostId: event.hostId }))
        : [...(hostSignalHandlers.get(event.signal ?? '') ?? [])].map(handler => () => handler({ hostId: event.hostId, payload: event.payload }));
      await Promise.allSettled(handlers.map(handler => Promise.resolve().then(handler)));
    },
    async emitThreadEvent(event) {
      for (const record of threadEventHandlers) {
        if (record.name === event.name) {
          try {
            await record.handler(event);
          } catch (error) {
            console.error(`[plugin:${pluginId}] events.on ${event.name} failed`, error);
          }
        }
      }
    },
    getSettings() {
      const stored = readSettings();
      const values: Record<string, PluginSettingValue | undefined> = {};
      for (const [key, descriptor] of Object.entries(settingDescriptors)) {
        values[key] = stored[key] ?? descriptor.default;
      }
      return { descriptors: { ...settingDescriptors }, values };
    },
    async setSettings(values) {
      assertLive();
      const next = { ...readSettings(), ...values };
      await persistSecretSettings(kvDir, settingDescriptors, next);
      writeJsonFile(settingsPath, publicSettingsValues(settingDescriptors, next));
      const projected: Record<string, PluginSettingValue | undefined> = {};
      for (const [key, descriptor] of Object.entries(settingDescriptors)) {
        projected[key] = next[key] ?? descriptor.default;
      }
      await Promise.allSettled(settingListeners.map(listener => Promise.resolve().then(() => listener(projected))));
    },
    subscribeRealtime(listener) {
      realtimeListeners.add(listener);
      return () => {
        realtimeListeners.delete(listener);
      };
    },
    async dispose(disposeOptions) {
      if (!disposal) {
        disposal = (async () => {
          stale = true;
          assistantLifecycle.abort();
          peerLifecycle.abort(new Error(`plugin context is stale: ${pluginId}`));
          hostWorkerExitHandlers.length = 0; hostSignalHandlers.clear();
          options?.interruptPluginInteractions?.(pluginId);
          for (const handle of sqliteHandles) {
            try { handle.close(); } catch (error) { disposalErrors.push(error); }
          }
          storageLifecycle.abort();
          sqliteHandles.length = 0;
          sharedDatabase = null;
          sharedSqlite = null;
          for (const hook of [...disposeHooks].reverse()) {
            try { await hook(); } catch { /* Plugin cleanup is best effort; host teardown below proves quiescence. */ }
          }
          disposeHooks.length = 0;
          for (const hook of [...quiesceHooks].reverse()) {
            try { await hook(); } catch (error) { disposalErrors.push(error); }
          }
          quiesceHooks.length = 0;
        })();
      }
      await disposal;
      if (disposeOptions?.strict && disposalErrors.length) throw new AggregateError(disposalErrors, 'Plugin writers could not be quiesced');
    }
  };
}

export async function runPluginCli(
  handle: PluginHandle,
  argv: string[],
  context?: { projectId?: string; threadId?: string; cwd?: string }
): Promise<PluginCliExecutionResult> {
  const registration = handle.cli.registration;
  if (!registration) {
    return { exitCode: 1, stdout: '', stderr: 'plugin has no CLI command\n' };
  }
  const result = await registration.run(argv, {
    pluginId: handle.api.pluginId,
    argv,
    ...(context?.projectId ? { projectId: context.projectId } : {}),
    ...(context?.threadId ? { threadId: context.threadId } : {}),
    ...(context?.cwd ? { cwd: context.cwd } : {})
  });
  return enforcePluginCliOutputLimit(result);
}

export function validatePluginRequestInput(request: PluginInteractionRequest): {
  threadId: string;
  rendererId: string;
  title: string;
  payload: JsonValue;
  timeoutMs: number;
} {
  if (!request || typeof request !== 'object') {
    throw new Error('ui.requestInput requires an options object');
  }
  if (typeof request.threadId !== 'string' || request.threadId.length === 0) {
    throw new Error('ui.requestInput threadId must be a non-empty string');
  }
  if (typeof request.rendererId !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(request.rendererId)) {
    throw new Error("ui.requestInput rendererId must use letters, digits, '-' or '_'");
  }
  if (
    typeof request.title !== 'string'
    || request.title.trim().length === 0
    || request.title.trim().length > PLUGIN_INTERACTION_MAX_TITLE_LENGTH
  ) {
    throw new Error(`ui.requestInput title must be 1-${PLUGIN_INTERACTION_MAX_TITLE_LENGTH} characters`);
  }
  let payload: JsonValue;
  try {
    const json = JSON.stringify(request.payload);
    if (json === undefined) throw new Error();
    if (Buffer.byteLength(json, 'utf8') > PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES) {
      throw new Error('ui.requestInput payload exceeds 64 KiB');
    }
    payload = JSON.parse(json) as JsonValue;
  } catch (error) {
    if (error instanceof Error && error.message.includes('64 KiB')) throw error;
    throw new Error('ui.requestInput payload must be JSON-serializable');
  }
  const timeoutMs = request.timeoutMs ?? 10 * 60 * 1000;
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > PLUGIN_INTERACTION_MAX_TIMEOUT_MS) {
    throw new Error(`ui.requestInput timeoutMs must be between 1 and ${PLUGIN_INTERACTION_MAX_TIMEOUT_MS}`);
  }
  return {
    threadId: request.threadId,
    rendererId: request.rendererId,
    title: request.title.trim(),
    payload,
    timeoutMs
  };
}

function isMainModuleExport(value: unknown): value is { setup: (ctx: unknown) => unknown } {
  return typeof value === 'object' && value !== null && typeof (value as { setup?: unknown }).setup === 'function';
}

type CreateJitiFn = (
  id: string,
  opts?: { moduleCache?: boolean; fsCache?: boolean }
) => { import: (id: string) => Promise<unknown> };

/**
 * Electron's CJS interop for `import('jiti')` often yields `{ default: fn }`
 * (or the CJS function itself) and drops the named `createJiti` export.
 * Calling that missing binding is the `createJiti is not a function` failure
 * that leaves TypeScript plugin servers `degraded` with no sidebar panel.
 */
export function resolveCreateJiti(mod: unknown): CreateJitiFn {
  const candidates: unknown[] = [mod];
  if (mod && typeof mod === 'object' && 'default' in mod) {
    candidates.push((mod as { default: unknown }).default);
  }
  for (const candidate of candidates) {
    if (typeof candidate === 'function') {
      const fn = candidate as CreateJitiFn & { createJiti?: unknown };
      if (typeof fn.createJiti === 'function') return fn.createJiti as CreateJitiFn;
      return fn;
    }
    if (
      candidate &&
      typeof candidate === 'object' &&
      typeof (candidate as { createJiti?: unknown }).createJiti === 'function'
    ) {
      return (candidate as { createJiti: CreateJitiFn }).createJiti;
    }
  }
  throw new Error('jiti createJiti is unavailable');
}

/** Require specifiers that can see `jiti` from Electron `out/main` and a packed asar. */
export function jitiRequireIds(cwd = process.cwd(), metaUrl = import.meta.url): string[] {
  const ids = [
    metaUrl,
    pathToFileURL(join(cwd, 'package.json')).href,
    pathToFileURL(join(cwd, 'apps', 'server', 'package.json')).href
  ];
  try {
    ids.push(pathToFileURL(join(dirname(fileURLToPath(metaUrl)), '..', '..', 'package.json')).href);
  } catch {
    /* import.meta.url may not be a file URL */
  }
  return [...new Set(ids)];
}

export async function loadCreateJiti(
  importJiti: () => Promise<unknown> = () => import('jiti'),
  requireIds: readonly string[] = jitiRequireIds(),
  bundledJiti: unknown = jitiModule
): Promise<CreateJitiFn> {
  const attempts: unknown[] = [bundledJiti];
  try {
    attempts.push(await importJiti());
  } catch {
    /* CJS utility-process bundles may not expose the ESM named export */
  }
  for (const id of requireIds) {
    try {
      attempts.push(createRequire(id)('jiti'));
    } catch {
      /* try the next lookup root */
    }
  }
  for (const attempt of attempts) {
    try {
      return resolveCreateJiti(attempt);
    } catch {
      /* try the next module shape */
    }
  }
  throw new Error('jiti createJiti is unavailable');
}

export async function importServerFactory(
  entryPath: string,
  cacheBust?: string | number,
  _options?: { fromSource?: boolean }
): Promise<ZccPluginFactory> {
  const loadFromSource = /\.tsx?$/.test(entryPath);
  if (loadFromSource) {
    const createJiti = await loadCreateJiti();
    const jiti = createJiti(import.meta.url, { moduleCache: false, fsCache: false });
    const mod = (await jiti.import(entryPath)) as { default?: unknown };
    if (typeof mod.default === 'function') return mod.default as ZccPluginFactory;
    if (isMainModuleExport(mod.default)) {
      return async () => undefined;
    }
    throw new Error(`plugin server entry must default-export a factory: ${entryPath}`);
  }
  const href = `${pathToFileURL(entryPath).href}${cacheBust != null ? `?v=${cacheBust}` : ''}`;
  const mod = (await import(href)) as { default?: unknown };
  if (typeof mod.default === 'function') return mod.default as ZccPluginFactory;
  if (isMainModuleExport(mod.default)) {
    // Legacy MainModule: the desktop host loads setup() in-process with a full
    // ctx. The server provenance row still records the entry.
    return async () => undefined;
  }
  throw new Error(`plugin server entry must default-export a factory: ${entryPath}`);
}

export async function runFactoryTimeBoxed(
  factory: ZccPluginFactory,
  api: ZccPluginApi,
  timeoutMs = FACTORY_TIMEOUT_MS
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve(runInNewContext('factory(api)', { factory, api }, { timeout: Math.max(1, Math.min(timeoutMs, 100)) })),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`plugin factory timed out after ${timeoutMs}ms`)),
          timeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function containsNativeAddon(rootDir: string, entries: string[]): boolean {
  return entries.some((rel) => {
    const normalized = rel.replace(/\\/g, '/');
    const parts = normalized.split('/');
    // Dev-time trees (local extension working dirs) ship rollup/fsevents
    // binaries under node_modules. Those are not the plugin's runtime image.
    if (parts.includes('node_modules') || parts.includes('.git')) return false;
    return normalized.endsWith('.node') || normalized.endsWith('.node.js');
  });
}

export function resolveContainedEntry(rootDir: string, relative: string): string {
  if (!relative || relative.includes('\0')) throw new Error('invalid plugin entry');
  const root = realpathSync(rootDir);
  const candidate = resolve(root, relative);
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
    throw new Error(`plugin entry escapes root: ${relative}`);
  }
  if (!existsSync(candidate)) throw new Error(`plugin entry missing: ${relative}`);
  const real = realpathSync(candidate);
  if (real !== root && !real.startsWith(`${root}${sep}`)) {
    throw new Error(`plugin entry escapes root: ${relative}`);
  }
  return real;
}
