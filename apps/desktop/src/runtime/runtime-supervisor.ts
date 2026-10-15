import type { CliDiscoveryRequest, CliDiscoveryResult } from '@zana-ai/zcc-contracts/cli-discovery';
import type { CliCallbackControl } from '@zana-ai/zcc-contracts/cli-callbacks';
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
import { utilityProcess } from 'electron';
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
  MenubarThreadsListResultSchema,
  PairingTargetSchema,
  RuntimeOutboundSchema,
  SERVER_RUNTIME_PROTOCOL_VERSION,
  type NativeToolPolicyRequest,
  type PairingTarget,
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
  listMenubarThreads(limit?: number): Promise<{
    agents: MenubarThreadAgent[];
    needsYou: number;
    working: number;
  }>;
  openMenubarThread(threadId: string, projectId: string): Promise<{ ok: boolean; reason?: string }>;
  onMenubarThreadsChanged(listener: () => void): () => void;
  relaunchEnrolledHost(): Promise<{ ok: true } | { ok: false; message: string }>;
  /**
   * The server runtime's join target for a remote host daemon. Never rejects:
   * an unreachable runtime or malformed reply resolves to a tunnel fallback.
   */
  pairingTarget(): Promise<PairingTarget>;
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
  onPluginAppsChanged(listener: (apps: RuntimePluginApp[]) => void): () => void;
  installPlugin(source: string): Promise<unknown>;
  enablePlugin(id: string): Promise<unknown>;
  disablePlugin(id: string): Promise<unknown>;
  removePlugin(id: string): Promise<unknown>;
  reloadPlugin(id: string): Promise<unknown>;
  pluginLogs(id: string, n?: number): Promise<unknown>;
  searchPlugins(query: string): Promise<unknown>;
  outdatedPlugins(): Promise<unknown>;
  updatePlugin(id: string): Promise<unknown>;
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
    listMenubarThreads: async () => ({ agents: [], needsYou: 0, working: 0 }),
    openMenubarThread: async () => ({ ok: false, reason: 'thread service unavailable' }),
    onMenubarThreadsChanged: () => () => {},
    async relaunchEnrolledHost() {
      return {
        ok: false as const,
        message: 'This session does not run a packaged host daemon'
      };
    },
    pairingTarget: async () => ({ ...PAIRING_TARGET_FALLBACK }),
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
    onPluginAppsChanged: () => () => {},
    installPlugin: async () => { throw new Error('plugin host is unavailable'); },
    enablePlugin: async () => { throw new Error('plugin host is unavailable'); },
    disablePlugin: async () => { throw new Error('plugin host is unavailable'); },
    removePlugin: async () => { throw new Error('plugin host is unavailable'); },
    reloadPlugin: async () => { throw new Error('plugin host is unavailable'); },
    pluginLogs: async () => [],
    searchPlugins: async () => [],
    outdatedPlugins: async () => [],
    updatePlugin: async () => { throw new Error('plugin host is unavailable'); },
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
  request(operation: 'app-version' | 'projects-list' | 'pairing-target'): Promise<unknown>;
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
  request(operation: 'plugins-install', source: string): Promise<unknown>;
  request(operation: 'plugins-enable', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-disable', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-remove', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-reload', pluginId: string): Promise<unknown>;
  request(operation: 'plugins-logs', pluginId: string, n?: number): Promise<unknown>;
  request(operation: 'plugins-search', query: string): Promise<unknown>;
  request(operation: 'plugins-outdated'): Promise<unknown>;
  request(operation: 'plugins-update', pluginId: string): Promise<unknown>;
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

const PAIRING_TARGET_FALLBACK: PairingTarget = { kind: 'tunnel', reason: 'relay_offline' };

/** Ask for the pairing target; a failed request or unexpected reply means tunnel. */
export async function requestPairingTarget(request: () => Promise<unknown>): Promise<PairingTarget> {
  try {
    const parsed = PairingTargetSchema.safeParse(await request());
    return parsed.success ? parsed.data : { ...PAIRING_TARGET_FALLBACK };
  } catch {
    return { ...PAIRING_TARGET_FALLBACK };
  }
}

function processEnvRecord(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

function startUtility(
  entry: string,
  startMessage: unknown,
  extraEnv?: Record<string, string>
): Promise<{ child: UtilityChild; url: string; hostId?: string; instanceId?: string }> {
  return new Promise((resolveReady, rejectReady) => {
    const child = utilityProcess.fork(entry, [], {
      serviceName: `zcc-${entry}`,
      env: { ...processEnvRecord(), ...extraEnv }
    });
    let ready = false;
    let settled = false;
    const finish = (
      error?: Error,
      value?: { child: UtilityChild; url: string; hostId?: string; instanceId?: string }
    ) => {
      if (settled) return;
      settled = true;
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
    child.once('spawn', () => child.postMessage(startMessage));
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
    }, options.extraEnv);
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
    pairingTarget: () => requestPairingTarget(() => server.request('pairing-target')),
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
    enablePlugin: (id) => server.request('plugins-enable', id),
    disablePlugin: (id) => server.request('plugins-disable', id),
    removePlugin: (id) => server.request('plugins-remove', id),
    reloadPlugin: (id) => server.request('plugins-reload', id),
    pluginLogs: (id, n) => server.request('plugins-logs', id, n),
    searchPlugins: (query) => server.request('plugins-search', query),
    outdatedPlugins: () => server.request('plugins-outdated'),
    updatePlugin: (id) => server.request('plugins-update', id),
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
    else request.reject(new Error(parsed.data.message));
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
      operation: 'cli-callback-grant' | 'cli-discovery' | 'library-agent' | 'library-document' | 'project-metadata' | 'project-catalogs' | 'project-history' | 'project-feed' | 'product-event' | 'app-version' | 'pairing-target' | 'thread-live' | 'menubar-threads-list' | 'menubar-thread-open' | 'projects-list' | 'projects-add' | 'projects-update' | 'projects-reorder' | 'projects-touch' | 'projects-remove' | 'project-settings-get' | 'project-settings-set' | 'terminal-execute' | 'terminal-record' | 'terminal-events-since' | 'plugins-snapshot' | 'plugins-install' | 'plugins-enable' | 'plugins-disable' | 'plugins-remove' | 'plugins-reload' | 'plugins-logs' | 'plugins-search' | 'plugins-outdated' | 'plugins-update' | 'plugins-call-rpc' | 'plugins-settings-get' | 'plugins-settings-set' | 'plugins-cli-contributions' | 'plugins-cli-run' | 'plugins-tool-policy' | 'marketplace-list' | 'marketplace-add' | 'marketplace-refresh' | 'marketplace-remove',
       ...args: [number] | [CliCallbackControl] | [CliDiscoveryRequest] | [LibraryAgentRequest] | [LibraryDocumentRequest] | [ProjectMetadataRequest] | [ProjectCatalogRequest] | [NativeToolPolicyRequest] | [string, unknown[]] | [TerminalRequestCommand] | [TerminalHostEvent] | [string] | [string[]] | [string, number?] | [string, RuntimeProjectPatch] | [string, RuntimeProjectSettings] | [string, string, unknown?] | [string, Record<string, string | number | boolean | null>] | [string, string[]] | [string, string[], { projectId?: string; threadId?: string; cwd?: string }?] | []
    ) {
      if (stopped || stopping) return Promise.reject(new Error('Background service stopped. Restart Zana to reconnect.'));
      const id = randomUUID();
      // Plugin CLI runs and RPCs may wrap slow external CLIs (e.g. `sf agent preview start`, up to 120s), so they get the long budget.
      const timeoutMs = operation === 'plugins-cli-run' || operation === 'plugins-call-rpc' ? 300_000 : 20_000;
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
          ...(operation === 'plugins-install' ? { source: args[0] as string } : {}),
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
