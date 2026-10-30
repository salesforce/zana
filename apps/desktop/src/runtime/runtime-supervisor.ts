import type { CliDiscoveryRequest, CliDiscoveryResult } from '@zana-ai/zcc-contracts/cli-discovery';
import type { CliCallbackControl } from '@zana-ai/zcc-contracts/cli-callbacks';
import { rpcErrorFrom } from '@zana-ai/zcc-contracts/rpc-error';
import type { ProjectFeedRequest, ProjectFeedResult } from '@zana-ai/zcc-contracts/project-feed';
import type { LibraryAgentRequest } from '@zana-ai/zcc-contracts/library-agent';
import type { ToolCallResponse } from '@zana-ai/zcc-domain/thread-runtime';
import type { LibraryDocumentRequest } from '@zana-ai/zcc-contracts/library-documents';
import { enrollHostUtility } from './enroll-host-utility.js';
import { createProductEventForwarder } from './product-event-forwarder.js';
import type { ProjectMetadataRequest, ProjectMetadataResult, ProjectCatalogRequest, ProjectCatalogResult } from '@zana-ai/zcc-contracts/project-metadata-records';
import type { ProjectHistoryRequest, ProjectHistoryResult } from '@zana-ai/zcc-contracts/project-history';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { utilityProcess, safeStorage } from 'electron';
import { createProtectedPeerKeyProvider, PEER_BOOT_KEY_ENV, PEER_KEY_REASON_ENV, PeerKeyReasonError } from '@zana-ai/zcc-server/services/peers/protected-key';
import { join } from 'node:path';
import { startStaticHost, type StaticHost } from '@zana-ai/zcc-server/static-host';
import { serverPortFromEnv } from '@zana-ai/zcc-server/http/ports';
import { startHostDaemon, type HostDaemon } from '@zana-ai/zcc-host-daemon';
import { createLocalPtyTerminalManager } from '@zana-ai/zcc-host-daemon';
import { readEnrollToken } from '@zana-ai/zcc-host-daemon/enroll-runtime';
import { createTerminalExecutionService } from '@zana-ai/zcc-server/terminal-execution-service';
import { TerminalSessionService } from '@zana-ai/zcc-server/terminal-session-service';
import { defaultBundledRoot } from '@zana-ai/zcc-server/plugins/plugin-service';
import {
  PluginAppSnapshotSchema,
  MenubarThreadOpenResultSchema,
  ThreadQueueTurnResultSchema,
  MenubarThreadsListResultSchema,
  RuntimeOutboundSchema,
  SERVER_RUNTIME_PROTOCOL_VERSION,
  SquadMemberControlRequestSchema,
  SquadMemberDeliveryRequestSchema,
  SquadMemberDeliveryResultSchema,
  SquadMemberDeliveryCompletionSchema,
  SquadMemberRuntimeRequestSchema,
  SquadMemberStatusSchema,
  SquadRuntimePreflightRequestSchema,
  SquadRuntimePreflightResultSchema,
  SquadRuntimeOperationSchema,
  SQUAD_RUNTIME_OPERATION_PATH,
  type NativeToolPolicyRequest,
  type SquadMemberDeliveryRequest,
  type SquadMemberRuntimeRequest,
  type SquadMemberControlRequest,
  type SquadMemberDeliveryResult,
  type SquadMemberDeliveryCompletion,
  type SquadMemberStatus,
  type SquadRuntimePreflightRequest,
  type SquadRuntimePreflightResult,
  type ProjectMutationPatchSchema,
  type ProjectRecordSchema,
  type RuntimeOutbound
} from '@zana-ai/zcc-contracts/runtime';
import type { ProjectSettingsPatch } from '@zana-ai/zcc-contracts/project-settings';
import type { TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import type { TerminalRequestCommand } from '@zana-ai/zcc-contracts/terminal-execution';
import type { z } from 'zod';
import { z as zod } from 'zod';
import type { MenubarThreadAgent } from '@zana-ai/zcc-domain';
import type { PluginPackCatalogEntry, PluginPackIdentity, PluginPackInstallation, PluginPackInstallRequest, PluginPackPlan } from '@zana-ai/zcc-domain';
import { NATIVE_TOOL_POLICY_PROOF_HEADER, signNativeToolPolicyRequest } from '@zana-ai/zcc-server/http/native-tool-policy-proof';

export type RuntimeProject = z.infer<typeof ProjectRecordSchema>;
export type RuntimeProjectPatch = z.infer<typeof ProjectMutationPatchSchema>;
export type RuntimeProjectSettings = ProjectSettingsPatch;
export type RuntimePluginContribution = Extract<
  RuntimeOutbound,
  { type: 'plugin-capabilities' }
>['contributors'][number];
export type RuntimePluginApp = Extract<RuntimeOutbound, { type: 'plugin-apps-changed' }>['apps'][number];

export interface RuntimeSupervisor {
  /** Product registry identity, unavailable until enrollment is acknowledged. */
  readonly hostId: string | undefined;
  readonly rendererUrl: string;
  readonly hostUrl: string;
  readonly hostToken: string;
  readonly hostSigningKey: string;
  /**
   * Push Electron-main's loopback MCP base URL down to the server-runtime once
   * `startMcpServer` resolves (its port is unknown at fork time). Fire-and-forget.
   */
  setMcpBaseUrl(url: string, teamLaunchEnabled: boolean, teamJobLaunchEnabled?: boolean): void;
  /**
   * Ask the server-runtime whether a Modern (ACP) conversation thread is live in
   * a project — the liveness half of the loopback launch_team identity check for
   * an ACP thread (the credential proves "trusted local process", not liveness).
   * Never rejects for a dead/unknown thread; resolves `false`.
   */
  isThreadLive(threadId: string, projectId: string): Promise<boolean>;
  createSquadMember(request: SquadMemberRuntimeRequest): Promise<{ threadId: string }>;
  activateSquadMember(request: SquadMemberRuntimeRequest): Promise<{ threadId: string }>;
  preflightSquadRuntime(request: SquadRuntimePreflightRequest): Promise<SquadRuntimePreflightResult>;
  deliverSquadMember(request: SquadMemberDeliveryRequest): Promise<SquadMemberDeliveryResult>;
  completeSquadMemberDelivery(request: SquadMemberDeliveryCompletion): Promise<SquadMemberDeliveryResult>;
  getSquadMemberStatus(request: SquadMemberControlRequest): Promise<SquadMemberStatus>;
  isSquadMemberLive(threadId: string, projectId: string, generation: number): Promise<boolean>;
  stopSquadMember(threadId: string, projectId: string, generation: number): Promise<boolean>;
  /**
   * Queue a text turn into a live Modern thread. Never rejects for a dead
   * thread or a missing runtime; resolves `{ ok: false, reason }`.
   */
  queueThreadTurn(threadId: string, projectId: string, text: string): Promise<{ ok: boolean; queued?: boolean; reason?: string }>;
  listMenubarThreads(limit?: number): Promise<{
    agents: MenubarThreadAgent[];
    needsYou: number;
    working: number;
  }>;
  openMenubarThread(threadId: string, projectId: string): Promise<{ ok: boolean; reason?: string }>;
  onMenubarThreadsChanged(listener: () => void): () => void;
  relaunchEnrolledHost(): Promise<{ ok: true } | { ok: false; message: string }>;
  appVersion(): Promise<string>;
  listProjects(): Promise<RuntimeProject[]>;
  projectMetadata(request: ProjectMetadataRequest): Promise<ProjectMetadataResult>;
  projectCatalogs(request: ProjectCatalogRequest): Promise<ProjectCatalogResult>;
  projectFeed(request: ProjectFeedRequest): Promise<ProjectFeedResult>;
  cliDiscovery(request: CliDiscoveryRequest): Promise<CliDiscoveryResult>;
  cliCallbackGrant(request: CliCallbackControl): Promise<{ ok: true }>;
  projectHistory(request: ProjectHistoryRequest): Promise<ProjectHistoryResult>;
  libraryAgent(request: LibraryAgentRequest): Promise<ToolCallResponse>;
  libraryDocument(request: LibraryDocumentRequest): Promise<unknown>;
  addProject(path: string): Promise<RuntimeProject>;
  updateProject(id: string, patch: RuntimeProjectPatch): Promise<RuntimeProject | null>;
  reorderProjects(orderedIds: string[]): Promise<RuntimeProject[]>;
  touchProject(id: string): Promise<RuntimeProject | null>;
  removeProject(id: string): Promise<RuntimeProject | null>;
  publishProductEvent(channel: string, args: unknown[]): Promise<void>;
  getProjectSettings(id: string): Promise<RuntimeProjectSettings>;
  setProjectSettings(id: string, patch: RuntimeProjectSettings): Promise<RuntimeProjectSettings>;
  executeTerminal(command: TerminalRequestCommand): Promise<TerminalHostEvent[]>;
  recordTerminalEvent(event: TerminalHostEvent): Promise<boolean>;
  terminalEventsSince(sessionId: string, afterSequence?: number): Promise<TerminalHostEvent[]>;
  onTerminalEvent(listener: (event: TerminalHostEvent) => void): () => void;
  onProjectSettingsChanged(listener: (projectId: string) => void): () => void;
  onLibraryChanged(listener: () => void): () => void;
  onProjectsChanged(listener: () => void): () => void;
  onPluginCapabilitiesChanged(
    listener: (contributors: RuntimePluginContribution[]) => void
  ): () => void;
  listPluginApps(): Promise<RuntimePluginApp[]>;
  listPluginPacks(): Promise<PluginPackCatalogEntry[]>;
  planPluginPack(identity: PluginPackIdentity): Promise<PluginPackPlan>;
  installPluginPack(request: PluginPackInstallRequest): Promise<PluginPackInstallation>;
  listInstalledPluginPacks(): Promise<PluginPackInstallation[]>;
  forgetPluginPack(identity: PluginPackIdentity): Promise<boolean>;
  onPluginAppsChanged(listener: (apps: RuntimePluginApp[]) => void): () => void;
  installPlugin(source: string): Promise<unknown>;
  enablePlugin(id: string): Promise<unknown>;
  disablePlugin(id: string): Promise<unknown>;
  removePlugin(id: string): Promise<unknown>;
  reloadPlugin(id: string): Promise<unknown>;
  repairPlugin(id: string, path?: string): Promise<unknown>;
  pluginLogs(id: string, n?: number): Promise<unknown>;
  searchPlugins(query: string): Promise<unknown>;
  outdatedPlugins(): Promise<unknown>;
  updatePlugin(id: string): Promise<unknown>;
  updateAllPlugins(): Promise<import('@zana-ai/zcc-domain/product').PluginUpdateAllResult>;
  listMarketplaces(): Promise<unknown>;
  addMarketplace(url: string): Promise<unknown>;
  refreshMarketplace(url: string): Promise<unknown>;
  removeMarketplace(url: string): Promise<unknown>;
  pluginCliContributions(): Promise<unknown>;
  runPluginCli(
    id: string,
    argv: string[],
    context?: { projectId?: string; threadId?: string; cwd?: string }
  ): Promise<unknown>;
  callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  getPluginSettings(pluginId: string): Promise<unknown>;
  setPluginSettings(pluginId: string, values: Record<string, string | number | boolean | null>): Promise<unknown>;
  /**
   * Ask the plugin policy about one native tool call from a PTY main owns
   * (OBL-004). Main asserts the session identity in `request`; the caller
   * validates the reply, and this never authorizes anything by itself.
   */
  decideToolPolicy(request: NativeToolPolicyRequest): Promise<unknown>;
  close(): Promise<void>;
}

export interface StartRuntimeSupervisorOptions {
  rendererRoot: string;
  dataDir?: string;
  runtimeDir?: string;
  version?: string;
  /** Env vars for the product-server utility only — never the host-daemon, never process.env. */
  extraEnv?: Record<string, string>;
  onUnexpectedExit?: (service: string) => void;
}

type SquadOperation = 'squad-runtime-preflight' | 'squad-member-create' | 'squad-member-activate' | 'squad-member-deliver' | 'squad-member-delivery-complete' | 'squad-member-status' | 'squad-member-stop';
type SquadRequest = SquadRuntimePreflightRequest | SquadMemberRuntimeRequest | SquadMemberDeliveryRequest | SquadMemberControlRequest | SquadMemberDeliveryCompletion;

/** Main-only adapter; every response must retain the requested binding/correlation. */
export function createSquadMemberRuntimeAdapter(call: (operation: SquadOperation, request: SquadRequest) => Promise<unknown>) {
  const status = async (input: SquadMemberControlRequest) => {
    const request = SquadMemberControlRequestSchema.parse(input);
    const value = SquadMemberStatusSchema.parse(await call('squad-member-status', request));
    if (value.bindingId !== request.bindingId || value.projectId !== request.projectId || value.generation !== request.generation) {
      throw new Error('invalid squad member status correlation');
    }
    return value;
  };
  return {
    async preflightSquadRuntime(input: SquadRuntimePreflightRequest) {
      const request = SquadRuntimePreflightRequestSchema.parse(input);
      const value = SquadRuntimePreflightResultSchema.parse(await call('squad-runtime-preflight', request));
      if (request.hostId && request.hostId !== value.hostId) throw new Error('invalid squad preflight host correlation');
      return value;
    },
    async createSquadMember(input: SquadMemberRuntimeRequest) {
      const request = SquadMemberRuntimeRequestSchema.parse(input);
      const value = zod.object({ threadId: zod.string().uuid() }).strict().parse(await call('squad-member-create', request));
      if (value.threadId !== request.bindingId) throw new Error('invalid squad member create correlation');
      return value;
    },
    async activateSquadMember(input: SquadMemberRuntimeRequest) {
      const request = SquadMemberRuntimeRequestSchema.parse(input);
      const value = zod.object({ threadId: zod.string().uuid() }).strict().parse(await call('squad-member-activate', request));
      if (value.threadId !== request.bindingId) throw new Error('invalid squad member activate correlation');
      return value;
    },
    async deliverSquadMember(input: SquadMemberDeliveryRequest) {
      const request = SquadMemberDeliveryRequestSchema.parse(input);
      const value = SquadMemberDeliveryResultSchema.parse(await call('squad-member-deliver', request));
      for (const field of ['bindingId', 'generation', 'projectId', 'assignmentId', 'idempotencyKey'] as const) {
        if (value[field] !== request[field]) throw new Error('invalid squad member delivery correlation');
      }
      return value;
    },
    async completeSquadMemberDelivery(input: SquadMemberDeliveryCompletion) {
      const request = SquadMemberDeliveryCompletionSchema.parse(input);
      const value = SquadMemberDeliveryResultSchema.parse(await call('squad-member-delivery-complete', request));
      for (const field of ['bindingId', 'generation', 'projectId', 'assignmentId', 'idempotencyKey'] as const) {
        if (value[field] !== request[field]) throw new Error('invalid squad member completion correlation');
      }
      return value;
    },
    getSquadMemberStatus: status,
    async isSquadMemberLive(threadId: string, projectId: string, generation: number) {
      try { return (await status({ bindingId: threadId, projectId, generation })).live; }
      catch { return false; }
    },
    async stopSquadMember(threadId: string, projectId: string, generation: number) {
      const request = SquadMemberControlRequestSchema.parse({ bindingId: threadId, projectId, generation });
      return zod.boolean().parse(await call('squad-member-stop', request));
    }
  };
}

/** Development main uses its existing boot credential, never renderer or daemon credentials. */
export function createProductRouteSquadRuntime(options: { serverUrl(): string; credential(): string }) {
  return createSquadMemberRuntimeAdapter(async (operation, request) => {
    const url = new URL(SQUAD_RUNTIME_OPERATION_PATH, options.serverUrl());
    if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
      throw new Error('squad runtime requires a loopback product server');
    }
    const credential = options.credential();
    if (credential.length < 32) throw new Error('squad runtime requires the product server credential');
    const body = JSON.stringify(SquadRuntimeOperationSchema.parse({ operation, request }));
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20_000),
      headers: { 'content-type': 'application/json', [NATIVE_TOOL_POLICY_PROOF_HEADER]: signNativeToolPolicyRequest(credential, body) }, body });
    const reader = response.body?.getReader();
    if (!reader) throw new Error('invalid squad runtime response');
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        if (bytes > 64 * 1024) throw new Error('squad runtime response exceeds limit');
        chunks.push(next.value);
      }
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    // A server without this route answers with an empty body; report the status, not a parse error.
    let value: { value?: unknown; error?: unknown } | undefined;
    try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { value?: unknown; error?: unknown }; }
    catch { if (response.ok) throw new Error('invalid squad runtime response'); }
    if (!response.ok) throw new Error(typeof value?.error === 'string' ? value.error : `squad runtime HTTP ${response.status}`);
    return value?.value;
  });
}

function persistentHostId(dataDir?: string): string {
  if (!dataDir) return randomUUID();
  const file = join(dataDir, 'runtime-host.json');
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { hostId?: unknown };
    if (zod.string().uuid().safeParse(value.hostId).success) return value.hostId as string;
  } catch {}
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  const hostId = randomUUID();
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  writeFileSync(temporary, JSON.stringify({ hostId }), { mode: 0o600 });
  // Rename is atomic on the same filesystem. A concurrent bootstrap may win;
  // both processes still use only a valid durable identity on their next start.
  try { renameSync(temporary, file); } catch { try { unlinkSync(temporary); } catch {} }
  try {
    const value = JSON.parse(readFileSync(file, 'utf8')) as { hostId?: string };
    return zod.string().uuid().safeParse(value.hostId).success ? value.hostId! : hostId;
  } catch { return hostId; }
}

/**
 * Starts the local runtime in dependency order. Renderer assets are served by
 * the server package; the host daemon has a separate execution boundary and a
 * unique bearer token plus command-signing key. It owns neither renderer
 * privileges nor process-launch authority; those remain in their respective
 * server and host boundaries.
 */
export async function startRuntimeSupervisor(options: StartRuntimeSupervisorOptions): Promise<RuntimeSupervisor> {
  const token = randomBytes(32).toString('base64url');
  const signingKey = randomBytes(32).toString('base64url');
  const hostId = persistentHostId(options.dataDir);
  if (options.runtimeDir) {
    return startUtilityRuntime({ ...options, token, signingKey, hostId });
  }
  const terminalListeners = new Set<(event: TerminalHostEvent) => void>();
  let terminalSessions: TerminalSessionService | null = null;
  const instanceId = randomUUID();
  const host = await startHostDaemon({
    token,
    signingKey,
    hostId,
    instanceId,
    terminalManager: createLocalPtyTerminalManager((event) => {
      if (!terminalSessions?.record(event)) return;
      for (const listener of terminalListeners) listener(event);
    })
  });
  const execution = createTerminalExecutionService({
    hostUrl: host.url,
    token,
    signingKey,
    binding: { hostId, instanceId, hostConnectionId: randomUUID() }
  });
  let hostConnectionRenewal: NodeJS.Timeout | null = null;
  let renderer: StaticHost | null = null;
  try {
    terminalSessions = new TerminalSessionService(execution);
    await terminalSessions.refreshHostConnection();
    hostConnectionRenewal = setInterval(() => {
      void terminalSessions?.refreshHostConnection().catch(() => {});
    }, 10_000);
    renderer = await startStaticHost({
      rootDir: options.rendererRoot,
      port: serverPortFromEnv()
    });
  } catch (error) {
    if (hostConnectionRenewal) clearInterval(hostConnectionRenewal);
    await host.close();
    throw error;
  }
  return {
    rendererUrl: renderer.url,
    hostId,
    hostUrl: host.url,
    hostToken: token,
    hostSigningKey: signingKey,
    // No packaged server-runtime child in this fallback; nothing to notify.
    setMcpBaseUrl: () => {},
    isThreadLive: async () => false,
    createSquadMember: async () => { throw new Error('Modern squad runtime is unavailable'); },
    activateSquadMember: async () => { throw new Error('Modern squad runtime is unavailable'); },
    preflightSquadRuntime: async () => { throw new Error('Modern squad runtime is unavailable'); },
    deliverSquadMember: async () => { throw new Error('Modern squad runtime is unavailable'); },
    completeSquadMemberDelivery: async () => { throw new Error('Modern squad runtime is unavailable'); },
    getSquadMemberStatus: async () => { throw new Error('Modern squad runtime is unavailable'); },
    isSquadMemberLive: async () => false,
    stopSquadMember: async () => false,
    queueThreadTurn: async () => ({ ok: false, reason: 'runtime-unavailable' }),
    listMenubarThreads: async () => ({ agents: [], needsYou: 0, working: 0 }),
    openMenubarThread: async () => ({ ok: false, reason: 'thread service unavailable' }),
    onMenubarThreadsChanged: () => () => {},
    async relaunchEnrolledHost() {
      return {
        ok: false as const,
        message: 'This session does not run a packaged host daemon'
      };
    },
    appVersion: async () => options.version ?? '',
    listProjects: async () => [],
    projectCatalogs: async () => { throw new Error('Project catalogues require the product runtime'); },
    projectFeed: async () => { throw new Error('Activity feed runtime is unavailable'); },
    cliDiscovery: async () => { throw new Error('CLI discovery requires the product runtime'); },
    cliCallbackGrant: async () => { throw new Error('CLI callbacks require the product runtime'); },
    projectHistory: async () => { throw new Error('Project history requires the product runtime'); },
    projectMetadata: async () => { throw new Error('Project metadata requires the product runtime'); },
    libraryAgent: async () => { throw new Error('Library requires the product runtime'); },
    libraryDocument: async () => { throw new Error('Library requires the product runtime'); },
    addProject: async () => { throw new Error('runtime project storage is unavailable'); },
    updateProject: async () => { throw new Error('runtime project storage is unavailable'); },
    reorderProjects: async () => { throw new Error('runtime project storage is unavailable'); },
    touchProject: async () => { throw new Error('runtime project storage is unavailable'); },
    removeProject: async () => { throw new Error('runtime project storage is unavailable'); },
    publishProductEvent: async () => { throw new Error('Shared product events require the product runtime'); },
    getProjectSettings: async () => { throw new Error('runtime project settings storage is unavailable'); },
    setProjectSettings: async () => { throw new Error('runtime project settings storage is unavailable'); },
    executeTerminal: (command) => terminalSessions!.execute(command),
    recordTerminalEvent: async (event) => terminalSessions!.record(event),
    terminalEventsSince: async (sessionId, afterSequence) => terminalSessions!.eventsSince(sessionId, afterSequence),
    onTerminalEvent(listener) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    onProjectSettingsChanged: () => () => {},
    onLibraryChanged: () => () => {},
    onProjectsChanged: () => () => {},
    onPluginCapabilitiesChanged: () => () => {},
    listPluginApps: async () => [],
    listPluginPacks: async () => [],
    planPluginPack: async () => { throw new Error('plugin host is unavailable'); },
    installPluginPack: async () => { throw new Error('plugin host is unavailable'); },
    listInstalledPluginPacks: async () => [],
    forgetPluginPack: async () => { throw new Error('plugin host is unavailable'); },
    onPluginAppsChanged: () => () => {},
    installPlugin: async () => { throw new Error('plugin host is unavailable'); },
    enablePlugin: async () => { throw new Error('plugin host is unavailable'); },
    disablePlugin: async () => { throw new Error('plugin host is unavailable'); },
    removePlugin: async () => { throw new Error('plugin host is unavailable'); },
    reloadPlugin: async () => { throw new Error('plugin host is unavailable'); },
    repairPlugin: async () => { throw new Error('plugin host is unavailable'); },
    pluginLogs: async () => [],
    searchPlugins: async () => [],
    outdatedPlugins: async () => [],
    updatePlugin: async () => { throw new Error('plugin host is unavailable'); },
    updateAllPlugins: async () => { throw new Error('plugin host is unavailable'); },
    listMarketplaces: async () => [],
    addMarketplace: async () => { throw new Error('plugin host is unavailable'); },
    refreshMarketplace: async () => { throw new Error('plugin host is unavailable'); },
    removeMarketplace: async () => { throw new Error('plugin host is unavailable'); },
    pluginCliContributions: async () => [],
    runPluginCli: async () => { throw new Error('plugin host is unavailable'); },
    callPluginRpc: async () => { throw new Error('plugin host is unavailable'); },
    getPluginSettings: async () => ({ descriptors: {}, values: {} }),
    setPluginSettings: async () => { throw new Error('plugin host is unavailable'); },
    decideToolPolicy: async () => { throw new Error('plugin host is unavailable'); },
    async close(): Promise<void> {
      if (hostConnectionRenewal) clearInterval(hostConnectionRenewal);
      await Promise.allSettled([renderer.close(), host.close()]);
    }
  };
}

interface UtilityChild {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  off?(event: 'message', listener: (message: unknown) => void): void;
  on(event: 'error', listener: (type: string, location: string, report: string) => void): void;
  once(event: 'exit', listener: () => void): void;
  once(event: 'spawn', listener: () => void): void;
  kill(): void;
}

interface UtilityRuntime {
  child: UtilityChild;
  url: string;
  request(operation: 'app-version' | 'projects-list'): Promise<unknown>;
  request(operation: 'project-metadata', request: ProjectMetadataRequest): Promise<unknown>;
  request(operation: 'project-catalogs', request: ProjectCatalogRequest): Promise<unknown>;
  request(operation: 'project-feed', request: ProjectFeedRequest): Promise<unknown>;
  request(operation: 'cli-discovery', request: CliDiscoveryRequest): Promise<unknown>;
  request(operation: 'cli-callback-grant', request: CliCallbackControl): Promise<unknown>;
  request(operation: 'project-history', request: ProjectHistoryRequest): Promise<unknown>;
  request(operation: 'library-agent', request: LibraryAgentRequest): Promise<unknown>;
  request(operation: 'library-document', request: LibraryDocumentRequest): Promise<unknown>;
  request(operation: 'product-event', channel: string, args: unknown[]): Promise<unknown>;
  request(operation: 'thread-live', threadId: string, projectId: string): Promise<unknown>;
  request(operation: 'squad-member-create' | 'squad-member-activate', request: SquadMemberRuntimeRequest): Promise<unknown>;
  request(operation: 'squad-member-deliver', request: SquadMemberDeliveryRequest): Promise<unknown>;
  request(operation: 'squad-member-delivery-complete', request: SquadMemberDeliveryCompletion): Promise<unknown>;
  request(operation: 'squad-runtime-preflight', request: SquadRuntimePreflightRequest): Promise<unknown>;
  request(operation: 'squad-member-status' | 'squad-member-stop', request: SquadMemberControlRequest): Promise<unknown>;
  request(operation: 'thread-queue-turn', threadId: string, projectId: string, text: string): Promise<unknown>;
  request(operation: 'menubar-threads-list', limit: number): Promise<unknown>;
  request(operation: 'menubar-thread-open', threadId: string, projectId: string): Promise<unknown>;
  request(operation: 'projects-add', path: string): Promise<unknown>;
  request(operation: 'projects-update', projectId: string, patch: RuntimeProjectPatch): Promise<unknown>;
  request(operation: 'projects-reorder', orderedIds: string[]): Promise<unknown>;
  request(operation: 'projects-touch', projectId: string): Promise<unknown>;
  request(operation: 'projects-remove', projectId: string): Promise<unknown>;
  request(operation: 'project-settings-get', projectId: string): Promise<unknown>;
  request(operation: 'project-settings-set', projectId: string, patch: RuntimeProjectSettings): Promise<unknown>;
  request(operation: 'terminal-execute', command: TerminalRequestCommand): Promise<unknown>;
  request(operation: 'terminal-record', event: TerminalHostEvent): Promise<unknown>;
  request(operation: 'terminal-events-since', sessionId: string, afterSequence?: number): Promise<unknown>;
  request(operation: 'plugins-snapshot'): Promise<unknown>;
  request(operation: 'plugin-packs-list' | 'plugin-packs-installed'): Promise<unknown>;
  request(operation: 'plugin-packs-plan' | 'plugin-packs-forget', identity: PluginPackIdentity): Promise<unknown>;
  request(operation: 'plugin-packs-install', request: PluginPackInstallRequest): Promise<unknown>;
  request(operation: 'plugins-install', source: string): Promise<unknown>;
  request(operation: 'plugins-enable', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-disable', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-remove', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-reload', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-repair', pluginId: string, path?: string): Promise<unknown>;
  request(operation: 'plugins-logs', pluginId: string, n?: number): Promise<unknown>;
  request(operation: 'plugins-search', query: string): Promise<unknown>;
  request(operation: 'plugins-outdated'): Promise<unknown>;
  request(operation: 'plugins-update', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-update-all'): Promise<unknown>;
  request(operation: 'plugins-call-rpc', pluginId: string, method: string, args?: unknown): Promise<unknown>;
  request(operation: 'plugins-settings-get', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-settings-set', pluginId: string, values: Record<string, string | number | boolean | null>): Promise<unknown>;
  request(operation: 'plugins-cli-contributions'): Promise<unknown>;
  request(operation: 'plugins-cli-run', pluginId: string, argv: string[], context?: { projectId?: string; threadId?: string; cwd?: string }): Promise<unknown>;
  request(operation: 'plugins-tool-policy', request: NativeToolPolicyRequest): Promise<unknown>;
  request(operation: 'marketplace-list'): Promise<unknown>;
  request(operation: 'marketplace-add', url: string): Promise<unknown>;
  request(operation: 'marketplace-refresh', url: string): Promise<unknown>;
  request(operation: 'marketplace-remove', url: string): Promise<unknown>;
  stop(): Promise<void>;
}

function processEnvRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string' && key !== PEER_BOOT_KEY_ENV) env[key] = value;
  }
  return env;
}

function startUtility(
  entry: string,
  startMessage: unknown,
  extraEnv?: Record<string, string>,
  peerBootKey?: Uint8Array | null
): Promise<{ child: UtilityChild; url: string; hostId?: string; instanceId?: string }> {
  return new Promise((resolveReady, rejectReady) => {
    const env = { ...processEnvRecord(), ...extraEnv };
    delete env[PEER_BOOT_KEY_ENV];
    const child = utilityProcess.fork(entry, [], {
      serviceName: `zcc-${entry}`,
      env
    });
    let ready = false;
    let settled = false;
    const finish = (
      error?: Error,
      value?: { child: UtilityChild; url: string; hostId?: string; instanceId?: string }
    ) => {
      if (settled) return;
      settled = true;
      peerBootKey?.fill(0);
      clearTimeout(timer);
      if (error) {
        child.kill();
        rejectReady(error);
        return;
      }
      ready = true;
      resolveReady(value!);
    };
    const timer = setTimeout(() => finish(new Error('runtime child start timed out')), 15_000);
    child.once('exit', () => {
      if (!ready) finish(new Error('runtime child exited before ready'));
    });
    child.on('error', (type, location, report) => {
      finish(new Error(`runtime child fatal error (${type}) at ${location}: ${report}`));
    });
    child.on('message', (message: unknown) => {
      if (ready || settled) return;
      const data = message as { type?: string; protocolVersion?: number; url?: string; message?: string; hostId?: string; instanceId?: string };
      if (data.type === 'error') {
        finish(new Error(data.message ?? 'runtime child failed'));
        return;
      }
      if (data.protocolVersion !== SERVER_RUNTIME_PROTOCOL_VERSION) {
        finish(new Error('runtime child protocol version mismatch'));
        return;
      }
      if (data.type === 'ready' && data.url) {
        finish(undefined, { child, url: data.url, hostId: data.hostId, instanceId: data.instanceId });
      }
    });
    child.once('spawn', () => {
      if (settled) return;
      try {
        // Electron structured-clones bytes; unlike env, this payload is not exposed by process listings.
        child.postMessage(peerBootKey ? { ...startMessage as object, peerBootKey } : startMessage);
      } catch {
        finish(new Error('runtime child boot delivery failed'));
      } finally { peerBootKey?.fill(0); }
    });
  });
}

async function startUtilityRuntime(options: StartRuntimeSupervisorOptions & { token: string; signingKey: string; hostId: string }): Promise<RuntimeSupervisor> {
  const runtimeDir = options.runtimeDir!;
  const host = await startUtility(join(runtimeDir, 'host-runtime.js'), {
    dataDir: options.dataDir,
    type: 'start',
    protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
    token: options.token,
    signingKey: options.signingKey,
    hostId: options.hostId,
    path: process.env.PATH,
    ghBinary: process.env.ZCC_GH_BINARY
  });
  let renderer: { child: UtilityChild; url: string; hostId?: string; instanceId?: string };
  try {
    if (!host.hostId || !host.instanceId) throw new Error('host runtime did not return its identity');
    // Never touch the real Keychain in isolated E2E, and never use its insecure substitutes.
    let peerKeyReason = '';
    const peerKey = options.dataDir && !process.env.ZCC_E2E_HOME
      ? await createProtectedPeerKeyProvider(options.dataDir, {
        isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
        encryptString: value => safeStorage.encryptString(value),
        decryptString: value => safeStorage.decryptString(value),
        ...(process.platform === 'linux' ? { getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend() } : {})
      }).getKey().catch((error: unknown) => {
        // Reason code only (no key material, paths or OS text); the server surfaces it to the Peers UI.
        peerKeyReason = error instanceof PeerKeyReasonError ? error.reason : 'unknown';
        console.warn(`[peers] protected peer key unavailable: ${peerKeyReason}; peer links and invitations are off`);
        return null;
      })
      // Isolated E2E substitutes a fixture-provided key for the Keychain, via the same boot-key path.
      : process.env.ZCC_E2E_HOME && /^[0-9a-f]{64}$/.test(process.env.ZCC_E2E_PEER_BOOT_KEY_HEX ?? '')
         ? Buffer.from(process.env.ZCC_E2E_PEER_BOOT_KEY_HEX!, 'hex')
         : null;
    const peerEnv = { ...options.extraEnv,
      [PEER_KEY_REASON_ENV]: peerKeyReason };
    try {
      renderer = await startUtility(join(runtimeDir, 'server-runtime.js'), {
        type: 'start',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        rendererRoot: options.rendererRoot,
        dataDir: options.dataDir ?? '',
        hostUrl: host.url,
        hostToken: options.token,
        hostSigningKey: options.signingKey,
        hostBinding: { hostId: host.hostId, instanceId: host.instanceId },
        bundledPluginsRoot: defaultBundledRoot(),
        version: options.version ?? ''
      }, peerEnv, peerKey);
    } finally { peerKey?.fill(0); }
  } catch (error) {
    host.child.kill();
    throw error;
  }
  if (!options.dataDir) {
    host.child.kill();
    renderer.child.kill();
    throw new Error('runtime dataDir is required to enroll the host daemon');
  }
  let closing = false;
  let failed = false;
  let enrollRetry: NodeJS.Timeout | null = null;
  const unexpectedExit = (service: string) => {
    if (closing || failed) return;
    failed = true;
    if (enrollRetry) { clearInterval(enrollRetry); enrollRetry = null; }
    options.onUnexpectedExit?.(service);
  };
  const server = createUtilityRuntime(renderer, () => unexpectedExit('server'));
  const hostRuntime = createUtilityRuntime(host, () => unexpectedExit('daemon'));
  const enrollInput = {
    serverUrl: renderer.url,
    token: readEnrollToken(options.dataDir!),
    dataDir: options.dataDir!
  };
  let enrolledHostId: string | undefined;
  const enrollOnce = async (type: 'enroll' | 'relaunch' = 'enroll') => {
    if (failed || closing) throw new Error('Background service unavailable');
    const identity = await enrollHostUtility(host.child, enrollInput, type);
    if (!failed && !closing) enrolledHostId = identity;
  };
  try {
    await enrollOnce();
  } catch (error) {
    // The renderer can still boot; thread spawn surfaces host-unavailable if
    // the handshake never completes. Blocking the window here makes Electron
    // E2E hang in firstWindow() with no diagnostic. Keep retrying so this
    // machine is not stuck Offline after a transient enroll failure.
    console.error('host daemon enroll failed', error);
    if (!failed && !closing) enrollRetry = setInterval(() => {
      void enrollOnce().then(() => {
        if (enrollRetry) {
          clearInterval(enrollRetry);
          enrollRetry = null;
        }
      }).catch(() => undefined);
    }, 5_000);
  }
  const productEvents = createProductEventForwarder((channel, args) => server.request('product-event', channel, args));
  const terminalListeners = new Set<(event: TerminalHostEvent) => void>();
  const projectSettingsListeners = new Set<(projectId: string) => void>();
  const libraryListeners = new Set<() => void>();
  const projectsListeners = new Set<() => void>();
  const pluginCapabilitiesListeners = new Set<(contributors: RuntimePluginContribution[]) => void>();
  const pluginAppsListeners = new Set<(apps: RuntimePluginApp[]) => void>();
  const menubarThreadListeners = new Set<() => void>();
  let terminalEventChain = Promise.resolve();
  host.child.on('message', (message: unknown) => {
    const parsed = RuntimeOutboundSchema.safeParse(message);
    if (!parsed.success || parsed.data.type !== 'terminal-event') return;
    const event = parsed.data.event;
    terminalEventChain = terminalEventChain
      .then(async () => {
        const accepted = await server.request('terminal-record', event);
        if (accepted !== true) return;
        for (const listener of terminalListeners) listener(event);
      })
      .catch(() => {
        // A host event without a live server session is not safe to forward.
      });
  });
  renderer.child.on('message', (message: unknown) => {
    const parsed = RuntimeOutboundSchema.safeParse(message);
    if (!parsed.success) return;
    if (parsed.data.type === 'projects-changed') {
      for (const listener of projectsListeners) listener();
      return;
    }
    if (parsed.data.type === 'library-changed') {
      for (const listener of libraryListeners) listener();
      return;
    }
    if (parsed.data.type === 'project-settings-changed') {
      for (const listener of projectSettingsListeners) listener(parsed.data.projectId);
      return;
    }
    if (parsed.data.type === 'menubar-threads-changed') {
      for (const listener of menubarThreadListeners) listener();
      return;
    }
    if (parsed.data.type === 'plugin-capabilities') {
      for (const listener of pluginCapabilitiesListeners) listener(parsed.data.contributors);
      return;
    }
    if (parsed.data.type === 'plugin-apps-changed') {
      for (const listener of pluginAppsListeners) listener(parsed.data.apps);
      return;
    }
  });
  return {
    rendererUrl: renderer.url,
    get hostId() { return enrolledHostId; },
    hostUrl: host.url,
    hostToken: options.token,
    hostSigningKey: options.signingKey,
    setMcpBaseUrl(url, teamLaunchEnabled, teamJobLaunchEnabled = false) {
      renderer.child.postMessage({
        type: 'mcp-ready',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        mcpBaseUrl: url,
        teamLaunchEnabled,
        teamJobLaunchEnabled
      });
    },
    isThreadLive: async (threadId, projectId) =>
      (await server.request('thread-live', threadId, projectId)) === true,
    ...createSquadMemberRuntimeAdapter((operation, request) => server.request(operation as 'squad-member-status', request as SquadMemberControlRequest)),
    // Never rejects: a request timeout, a dead child or a stopped service resolve to ok:false.
    queueThreadTurn: async (threadId, projectId, text) => {
      try {
        const parsed = ThreadQueueTurnResultSchema.safeParse(
          await server.request('thread-queue-turn', threadId, projectId, text)
        );
        return parsed.success ? parsed.data : { ok: false, reason: 'invalid thread response' };
      } catch (error) {
        // server.request only rejects with Error (error reply, timeout, exited child, stopped service).
        return { ok: false, reason: (error as Error).message };
      }
    },
    listMenubarThreads: async (limit = 100) => {
      const parsed = MenubarThreadsListResultSchema.safeParse(
        await server.request('menubar-threads-list', Math.max(1, Math.min(limit, 100)))
      );
      return parsed.success
        ? parsed.data as { agents: MenubarThreadAgent[]; needsYou: number; working: number }
        : { agents: [], needsYou: 0, working: 0 };
    },
    openMenubarThread: async (threadId, projectId) => {
      const parsed = MenubarThreadOpenResultSchema.safeParse(
        await server.request('menubar-thread-open', threadId, projectId)
      );
      return parsed.success ? parsed.data : { ok: false, reason: 'invalid thread response' };
    },
    onMenubarThreadsChanged(listener) {
      menubarThreadListeners.add(listener);
      return () => menubarThreadListeners.delete(listener);
    },
    appVersion: async () => {
      const value = await server.request('app-version');
      return typeof value === 'string' ? value : '';
    },
    listProjects: async () => {
      const value = await server.request('projects-list');
      return Array.isArray(value) ? value as RuntimeProject[] : [];
    },
    addProject: (path) => server.request('projects-add', path) as Promise<RuntimeProject>,
    projectCatalogs: (request) => server.request('project-catalogs', request) as Promise<ProjectCatalogResult>,
    projectFeed: (request) => server.request('project-feed', request) as Promise<ProjectFeedResult>,
    cliDiscovery: (request) => server.request('cli-discovery', request) as Promise<CliDiscoveryResult>,
    cliCallbackGrant: (request) => server.request('cli-callback-grant', request) as Promise<{ ok: true }>,
    projectHistory: (request) => server.request('project-history', request) as Promise<ProjectHistoryResult>,
    projectMetadata: (request) => server.request('project-metadata', request) as Promise<ProjectMetadataResult>,
    libraryAgent: request => server.request('library-agent', request) as Promise<ToolCallResponse>,
    libraryDocument: request => server.request('library-document', request),
    updateProject: (id, patch) => server.request('projects-update', id, patch) as Promise<RuntimeProject | null>,
    reorderProjects: (orderedIds) => server.request('projects-reorder', orderedIds) as Promise<RuntimeProject[]>,
    touchProject: (id) => server.request('projects-touch', id) as Promise<RuntimeProject | null>,
    removeProject: (id) => server.request('projects-remove', id) as Promise<RuntimeProject | null>,
    publishProductEvent: async (channel, args) => { productEvents.publish(channel, args); },
    getProjectSettings: async (id) => {
      const value = await server.request('project-settings-get', id);
      return value && typeof value === 'object' ? value as RuntimeProjectSettings : {};
    },
    setProjectSettings: (id, patch) => server.request('project-settings-set', id, patch) as Promise<RuntimeProjectSettings>,
    executeTerminal: async (command) => {
      const value = await server.request('terminal-execute', command);
      return Array.isArray(value) ? value as TerminalHostEvent[] : [];
    },
    recordTerminalEvent: async (event) => {
      const accepted = await server.request('terminal-record', event);
      return accepted === true;
    },
    terminalEventsSince: async (sessionId, afterSequence) => {
      const value = await server.request('terminal-events-since', sessionId, afterSequence);
      return Array.isArray(value) ? value as TerminalHostEvent[] : [];
    },
    onTerminalEvent(listener) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    onProjectSettingsChanged(listener) {
      projectSettingsListeners.add(listener);
      return () => projectSettingsListeners.delete(listener);
    },
    onLibraryChanged(listener) {
      libraryListeners.add(listener);
      return () => libraryListeners.delete(listener);
    },
    onProjectsChanged(listener) {
      projectsListeners.add(listener);
      return () => projectsListeners.delete(listener);
    },
    onPluginCapabilitiesChanged(listener) {
      pluginCapabilitiesListeners.add(listener);
      return () => pluginCapabilitiesListeners.delete(listener);
    },
    async listPluginApps() {
      const value = await server.request('plugins-snapshot');
      if (!Array.isArray(value)) return [];
      return value.flatMap((item) => {
        const parsed = PluginAppSnapshotSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      });
    },
    onPluginAppsChanged(listener) {
      pluginAppsListeners.add(listener);
      return () => pluginAppsListeners.delete(listener);
    },
    installPlugin: (source) => server.request('plugins-install', source),
    listPluginPacks: () => server.request('plugin-packs-list') as Promise<PluginPackCatalogEntry[]>,
    planPluginPack: (identity) => server.request('plugin-packs-plan', identity) as Promise<PluginPackPlan>,
    installPluginPack: (request) => server.request('plugin-packs-install', request) as Promise<PluginPackInstallation>,
    listInstalledPluginPacks: () => server.request('plugin-packs-installed') as Promise<PluginPackInstallation[]>,
    forgetPluginPack: (identity) => server.request('plugin-packs-forget', identity) as Promise<boolean>,
    enablePlugin: (id) => server.request('plugins-enable', id),
    disablePlugin: (id) => server.request('plugins-disable', id),
    removePlugin: (id) => server.request('plugins-remove', id),
    reloadPlugin: (id) => server.request('plugins-reload', id),
    repairPlugin: (id, path) => server.request('plugins-repair', id, path),
    pluginLogs: (id, n) => server.request('plugins-logs', id, n),
    searchPlugins: (query) => server.request('plugins-search', query),
    outdatedPlugins: () => server.request('plugins-outdated'),
    updatePlugin: (id) => server.request('plugins-update', id),
    updateAllPlugins: () => server.request('plugins-update-all') as Promise<import('@zana-ai/zcc-domain/product').PluginUpdateAllResult>,
    listMarketplaces: () => server.request('marketplace-list'),
    addMarketplace: (url) => server.request('marketplace-add', url),
    refreshMarketplace: (url) => server.request('marketplace-refresh', url),
    removeMarketplace: (url) => server.request('marketplace-remove', url),
    pluginCliContributions: () => server.request('plugins-cli-contributions'),
    runPluginCli: (id, argv, context) => server.request('plugins-cli-run', id, argv, context),
    callPluginRpc: (pluginId, method, args) => server.request('plugins-call-rpc', pluginId, method, args),
    getPluginSettings: (pluginId) => server.request('plugins-settings-get', pluginId),
    setPluginSettings: (pluginId, values) => server.request('plugins-settings-set', pluginId, values),
    /* v8 ignore next -- the packaged utility child runs only at the built-Electron boundary (e2e/native-tool-policy-pty.spec.ts) */
    decideToolPolicy: (request) => server.request('plugins-tool-policy', request),
    async relaunchEnrolledHost() {
      if (failed || closing) return { ok: false as const, message: 'Background service stopped. Restart Zana to reconnect.' };
      if (enrollRetry) {
        clearInterval(enrollRetry);
        enrollRetry = null;
      }
      try {
        await enrollOnce('relaunch');
        return { ok: true as const };
      } catch (error) {
        if (!failed && !closing) enrollRetry = setInterval(() => {
          void enrollOnce().then(() => {
            if (enrollRetry) {
              clearInterval(enrollRetry);
              enrollRetry = null;
            }
          }).catch(() => undefined);
        }, 5_000);
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : 'Could not relaunch this machine'
        };
      }
    },
    async close(): Promise<void> {
      closing = true;
      productEvents.dispose();
      libraryListeners.clear();
      projectsListeners.clear();
      menubarThreadListeners.clear();
      if (enrollRetry) {
        clearInterval(enrollRetry);
        enrollRetry = null;
      }
      await Promise.allSettled([server.stop(), hostRuntime.stop()]);
    }
  };
}

export function createUtilityRuntime(runtime: { child: UtilityChild; url: string }, onUnexpectedExit?: () => void): UtilityRuntime {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  let stopped = false;
  let stopping = false;
  let resolveStopped: (() => void) | null = null;
  const stoppedPromise = new Promise<void>((resolve) => { resolveStopped = resolve; });
  runtime.child.on('message', (message: unknown) => {
    const parsed = RuntimeOutboundSchema.safeParse(message);
    if (!parsed.success) return;
    if (parsed.data.type === 'stopped') {
      stopped = true;
      resolveStopped?.();
      return;
    }
    if (!('id' in parsed.data) || !parsed.data.id) return;
    const request = pending.get(parsed.data.id);
    if (!request) return;
    pending.delete(parsed.data.id);
    clearTimeout(request.timer);
    if (parsed.data.type === 'result') request.resolve(parsed.data.value);
    else request.reject(rpcErrorFrom(parsed.data.message, parsed.data.code));
  });
  runtime.child.once('exit', () => {
    stopped = true;
    resolveStopped?.();
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error('server utility process exited'));
    }
    pending.clear();
    if (!stopping) onUnexpectedExit?.();
  });
  return {
    ...runtime,
    request(
      operation: 'cli-callback-grant' | 'cli-discovery' | 'library-agent' | 'library-document' | 'project-metadata' | 'project-catalogs' | 'project-history' | 'project-feed' | 'product-event' | 'app-version' | 'thread-live' | 'thread-queue-turn' | 'squad-runtime-preflight' | 'squad-member-create' | 'squad-member-activate' | 'squad-member-deliver' | 'squad-member-delivery-complete' | 'squad-member-status' | 'squad-member-stop' | 'menubar-threads-list' | 'menubar-thread-open' | 'projects-list' | 'projects-add' | 'projects-update' | 'projects-reorder' | 'projects-touch' | 'projects-remove' | 'projects-touch' | 'project-settings-get' | 'project-settings-set' | 'terminal-execute' | 'terminal-record' | 'terminal-events-since' | 'plugins-snapshot' | 'plugin-packs-list' | 'plugin-packs-installed' | 'plugin-packs-plan' | 'plugin-packs-install' | 'plugin-packs-forget' | 'plugins-install' | 'plugins-enable' | 'plugins-disable' | 'plugins-remove' | 'plugins-reload' | 'plugins-repair' | 'plugins-logs' | 'plugins-search' | 'plugins-outdated' | 'plugins-update' | 'plugins-update-all' | 'plugins-call-rpc' | 'plugins-tool-policy' | 'plugins-settings-get' | 'plugins-settings-set' | 'plugins-cli-contributions' | 'plugins-cli-run' | 'marketplace-list' | 'marketplace-add' | 'marketplace-refresh' | 'marketplace-remove',
        ...args: [PluginPackIdentity] | [PluginPackInstallRequest] | [number] | [CliCallbackControl] | [CliDiscoveryRequest] | [LibraryAgentRequest] | [LibraryDocumentRequest] | [ProjectMetadataRequest] | [ProjectCatalogRequest] | [NativeToolPolicyRequest] | [SquadMemberRuntimeRequest] | [SquadMemberDeliveryRequest] | [SquadMemberDeliveryCompletion] | [SquadMemberControlRequest] | [SquadRuntimePreflightRequest] | [string, unknown[]] | [TerminalRequestCommand] | [TerminalHostEvent] | [string] | [string[]] | [string, string?] | [string, number?] | [string, RuntimeProjectPatch] | [string, RuntimeProjectSettings] | [string, string, unknown?] | [string, string, string] | [string, Record<string, string | number | boolean | null>] | [string, string[]] | [string, string[], { projectId?: string; threadId?: string; cwd?: string }?] | []
    ) {
      if (stopped || stopping) return Promise.reject(new Error('Background service stopped. Restart Zana to reconnect.'));
      const id = randomUUID();
      // Plugin CLI runs and RPCs may wrap slow external CLIs (e.g. `sf agent preview start`, up to 120s), so they get the long budget.
      const timeoutMs = operation === 'plugins-repair' || operation === 'plugin-packs-install' || operation === 'plugins-cli-run' || operation === 'plugins-call-rpc' || operation === 'plugins-install' || operation === 'plugins-update' || operation === 'plugins-update-all' || operation === 'plugins-outdated' ? 300_000 : 20_000;
      return new Promise<unknown>((resolveResult, rejectResult) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectResult(new Error(`server ${operation} request timed out`));
        }, timeoutMs);
        pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
        try { runtime.child.postMessage({
          type: 'request', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id, operation, deadlineAt: new Date(Date.now() + timeoutMs).toISOString(),
          ...(operation === 'project-catalogs' ? { request: args[0] as ProjectCatalogRequest } : {}),
          ...(operation === 'project-feed' ? { request: args[0] as ProjectFeedRequest } : {}),
          ...(operation === 'cli-discovery' ? { request: args[0] as CliDiscoveryRequest } : {}),
          ...(operation === 'cli-callback-grant' ? { request: args[0] as CliCallbackControl } : {}),
          ...(operation === 'project-history' ? { request: args[0] as ProjectHistoryRequest } : {}),
          ...(operation === 'project-metadata' ? { request: args[0] as ProjectMetadataRequest } : {}),
          ...(operation === 'library-agent' ? { request: args[0] as LibraryAgentRequest } : {}),
          ...(operation === 'library-document' ? { request: args[0] as LibraryDocumentRequest } : {}),
          ...(operation === 'plugins-tool-policy' ? { request: args[0] as NativeToolPolicyRequest } : {}),
           ...(operation === 'thread-live' ? { threadId: args[0] as string, projectId: args[1] as string } : {}),
             ...((operation === 'squad-member-create' || operation === 'squad-member-activate') ? { request: args[0] as SquadMemberRuntimeRequest } : {}),
            ...(operation === 'squad-member-deliver' ? { request: args[0] as SquadMemberDeliveryRequest } : {}),
            ...(operation === 'squad-member-delivery-complete' ? { request: args[0] as SquadMemberDeliveryCompletion } : {}),
           ...(operation === 'squad-runtime-preflight' ? { request: args[0] as SquadRuntimePreflightRequest } : {}),
           ...((operation === 'squad-member-status' || operation === 'squad-member-stop') ? { request: args[0] as SquadMemberControlRequest } : {}),
          ...(operation === 'thread-queue-turn' ? { threadId: args[0] as string, projectId: args[1] as string, text: args[2] as string } : {}),
          ...(operation === 'menubar-threads-list' ? { limit: args[0] as number } : {}),
          ...(operation === 'menubar-thread-open' ? { threadId: args[0] as string, projectId: args[1] as string } : {}),
          ...(operation === 'terminal-execute' ? { command: args[0] as TerminalRequestCommand } : {}),
          ...(operation === 'product-event' ? { channel: args[0] as string, args: args[1] as unknown[] } : {}),
          ...(operation === 'terminal-record' ? { event: args[0] as TerminalHostEvent } : {}),
          ...(operation === 'terminal-events-since' ? {
            sessionId: args[0] as string,
            afterSequence: args[1] as number | undefined
          } : {}),
          ...(operation === 'projects-add' ? { path: args[0] as string } : {}),
          ...(operation === 'projects-update' ? {
            projectId: args[0] as string,
            patch: args[1] as RuntimeProjectPatch
          } : {}),
          ...(operation === 'projects-reorder' ? { orderedIds: args[0] as string[] } : {}),
          ...(operation === 'projects-touch' ? { projectId: args[0] as string } : {}),
          ...(operation === 'projects-remove' ? { projectId: args[0] as string } : {}),
          ...(operation === 'project-settings-get' ? { projectId: args[0] as string } : {}),
          ...(operation === 'project-settings-set' ? {
            projectId: args[0] as string,
            patch: args[1] as RuntimeProjectSettings
          } : {}),
          ...(operation === 'plugins-repair' ? { pluginId: args[0] as string, path: args[1] as string | undefined } : {}),
          ...(operation === 'plugins-install' ? { source: args[0] as string } : {}),
          ...(operation === 'plugin-packs-plan' || operation === 'plugin-packs-forget' ? { identity: args[0] as PluginPackIdentity } : {}),
          ...(operation === 'plugin-packs-install' ? { request: args[0] as PluginPackInstallRequest } : {}),
          ...(operation === 'plugins-enable' || operation === 'plugins-disable' || operation === 'plugins-remove' || operation === 'plugins-reload' || operation === 'plugins-update' || operation === 'plugins-settings-get' ? { pluginId: args[0] as string } : {}),
          ...(operation === 'plugins-logs' ? { pluginId: args[0] as string, n: args[1] as number | undefined } : {}),
          ...(operation === 'plugins-search' ? { query: args[0] as string } : {}),
          ...(operation === 'plugins-call-rpc' ? { pluginId: args[0] as string, method: args[1] as string, args: args[2] } : {}),
          ...(operation === 'plugins-settings-set' ? { pluginId: args[0] as string, values: args[1] as Record<string, string | number | boolean | null> } : {}),
          ...(operation === 'plugins-cli-run' ? {
            pluginId: args[0] as string,
            argv: args[1] as string[],
            ...(((args[2] as { projectId?: string; threadId?: string; cwd?: string } | undefined)?.projectId)
              ? { projectId: (args[2] as { projectId?: string }).projectId }
              : {}),
            ...(((args[2] as { threadId?: string } | undefined)?.threadId)
              ? { threadId: (args[2] as { threadId?: string }).threadId }
              : {}),
            ...(((args[2] as { cwd?: string } | undefined)?.cwd)
              ? { cwd: (args[2] as { cwd?: string }).cwd }
              : {})
          } : {}),
          ...(operation === 'marketplace-add' || operation === 'marketplace-refresh' || operation === 'marketplace-remove' ? { url: args[0] as string } : {})
        }); } catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          rejectResult(error);
        }
      });
    },
    async stop() {
      if (stopped) return;
      stopping = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        runtime.child.postMessage({ type: 'stop', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION });
        await Promise.race([stoppedPromise, new Promise<void>(resolve => { timer = setTimeout(resolve, 3_000); })]);
      } finally {
        clearTimeout(timer);
        if (!stopped) runtime.child.kill();
      }
    }
  };
}
