import { prepareThreadReads } from './services/threads/thread-reads.js';
import { discoverProjectCli } from './services/launch/cli-discovery.js';
import { createProductCliCallbackAuthority } from './services/launch/cli-callback-authority.js';
import { projectFeed } from './services/feed/project-feed.js';
import { readProjectCatalogs } from './services/projects/project-catalogs.js';
import { invokeHostLibraryTool } from './services/threads/host-library-tools.js';
import { libraryDocumentOperation } from './services/library/library-documents.js';
import { forwardRuntimeProductEvent } from './runtime-product-events.js';
import { dispatchRuntimeMessage } from './runtime-request-boundary.js';
import { projectMetadataRecords } from './services/projects/project-metadata-records.js';
import { readProjectHistory } from './services/projects/project-history.js';
import type { ProductHttpContext } from './http/product-context.js';
import { installRuntimeLog } from '@zana-ai/zcc-process-utils';
import { startStaticHost } from './static-host.js';
import { toBrowserProjectSummaries } from './browser-bootstrap.js';
import { createProductHttpContext } from './http/product-context.js';
import type { ProductHub } from './http/product-hub.js';
import { DEFAULT_DEV_APP_PORT, serverPortFromEnv } from './http/ports.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION, type ServerRuntimeInbound } from '@zana-ai/zcc-contracts/runtime';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTeamOpsViaControl } from './http/team-ops-via-control.js';
import { createCliAgentOpsViaControl, retainProductServerCredential } from './http/cli-agent-ops.js';
import { createProjectStore, type ProjectStore } from './project-store.js';
import { createProjectSettingsStore, type ProjectSettingsStore } from './project-settings-store.js';
import { createTerminalExecutionService, type TerminalExecutionService } from './terminal-execution-service.js';
import { TerminalSessionService } from './terminal-session-service.js';
import { createRuntimeDatabase, type TerminalSessionRepository } from './runtime-database.js';
import { createTerminalLaunchAuthority } from './terminal-launch-authority.js';
import { createModernTeamLaunchConfigSource } from './services/agents/modern-team-launch-config.js';
import { createRuntimeMcpConfig } from './services/agents/runtime-mcp-config.js';
import { isThreadLiveInProject } from './services/agents/thread-liveness.js';
import { getConversationThread } from '@zana-ai/zcc-db';
import type { ZccDatabase } from '@zana-ai/zcc-db';
import type { PluginService } from './plugins/plugin-service.js';
import { createMenubarThreadSource } from './services/threads/menubar-thread-source.js';
import {
  attachProductPluginService,
  bundledPluginsRootFromDataDir,
  pluginAssetRootFromService,
  toPluginAppSnapshot
} from './http/product-plugins.js';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const utilityParentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!utilityParentPort) throw new Error('server utility entry requires an Electron utility process');
const parentPort: ParentPortLike = utilityParentPort;
const uiSendSecret = process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;
retainProductServerCredential(uiSendSecret);
delete process.env.ZCC_PRODUCT_SERVER_CREDENTIAL;

let close: (() => Promise<void>) | null = null;
let version = '';
let terminalExecution: TerminalExecutionService | null = null;
let terminalSessions: TerminalSessionService | null = null;
let terminalLaunchAuthority: ReturnType<typeof createTerminalLaunchAuthority> | null = null;
let runtimeDatabase: TerminalSessionRepository | null = null;
let projects: ProjectStore | null = null;
let productHub: ProductHub | null = null;
let productContext: ProductHttpContext | null = null;
let projectSettings: ProjectSettingsStore | null = null;
let hostConnectionRenewal: NodeJS.Timeout | null = null;
let plugins: PluginService | null = null;
// Electron-main's loopback MCP base URL + gate, pushed post-boot (mcp-ready).
// Read lazily by the Modern team-launch forwarder each tool call.
const runtimeMcpConfig = createRuntimeMcpConfig();
// Captured from the product context at start so the `thread-live` liveness probe
// can read the conversation-thread store (main asks before honoring a loopback
// launch_team from a Modern/ACP thread).
let threadDb: ZccDatabase | null = null;
let menubarThreads: ReturnType<typeof createMenubarThreadSource> | null = null;
let disposeMenubarThreadHints: (() => void) | null = null;
let menubarThreadHintTimer: NodeJS.Timeout | null = null;
parentPort.on('message', ({ data }) => {
  void dispatchRuntimeMessage(data, reply => parentPort.postMessage(reply), handleRuntimeMessage);
});

async function handleRuntimeMessage(message: ServerRuntimeInbound): Promise<void> {
  if (message.type === 'start' && message.rendererRoot && !close) {
    try {
      installRuntimeLog(message.dataDir, 'server', import.meta.url);
      version = message.version ?? '';
      projects = createProjectStore({
        projectsFile: join(message.dataDir, 'projects.json'),
        remotePlaceholderRoot: join(message.dataDir, 'remote-projects')
      });
      projectSettings = createProjectSettingsStore({
        projectSettingsFile: join(message.dataDir, 'project-settings.json')
      });
      const preferredPort = serverPortFromEnv();
      await prepareThreadReads(message.dataDir);
      const product = createProductHttpContext({
        dataDir: message.dataDir,
        uiSendSecret,
        origins: { serverPort: preferredPort, devAppPort: DEFAULT_DEV_APP_PORT },
        onLibraryChanged: () => parentPort.postMessage({ type: 'library-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION }),
        onProjectsChanged: () => parentPort.postMessage({ type: 'projects-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION }),
        projects: projects ?? undefined
      });
      productHub = product.hub;
      productContext = product;
      product.teamOps = createTeamOpsViaControl(message.dataDir);
      product.cliAgentOps = createCliAgentOpsViaControl(message.dataDir);
      product.cliCallbacks = createProductCliCallbackAuthority(product, () => runtimeMcpConfig.get().mcpBaseUrl ?? null);
      threadDb = product.db;
      menubarThreads = createMenubarThreadSource({
        db: product.db,
        projects,
        hub: product.hub,
        viewContext: product
      });
      disposeMenubarThreadHints = product.hub.subscribe('threads:updated', () => {
        if (menubarThreadHintTimer) clearTimeout(menubarThreadHintTimer);
        menubarThreadHintTimer = setTimeout(() => {
          menubarThreadHintTimer = null;
          parentPort.postMessage({
            type: 'menubar-threads-changed',
            protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION
          });
        }, 100);
      });
      plugins = await attachProductPluginService(product, {
        bundledRoot: bundledPluginsRootFromDataDir(message.dataDir, message.bundledPluginsRoot),
        hostAgentToolSource: createModernTeamLaunchConfigSource({
          getMcpBaseUrl: () => runtimeMcpConfig.get().mcpBaseUrl,
          getAppConfig: () => runtimeMcpConfig.get()
        }),
        onAgentCapabilitiesChanged: (contributors) => {
          parentPort.postMessage({
            type: 'plugin-capabilities',
            protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
            contributors
          });
        },
        onAppsChanged: (apps) => {
          parentPort.postMessage({
            type: 'plugin-apps-changed',
            protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
            apps: apps.map(toPluginAppSnapshot)
          });
        }
      });
      const host = await startStaticHost({
        rootDir: message.rendererRoot,
        port: preferredPort,
        browserBootstrap: () => ({
          appVersion: version,
          // A browser never needs filesystem paths to render this landing view.
          projects: toBrowserProjectSummaries(projects?.list() ?? [])
        }),
        pluginAssetRoot: (pluginId) => pluginAssetRootFromService(plugins ?? undefined, pluginId),
        product
      });
      close = host.close;
      terminalExecution = createTerminalExecutionService({
        hostUrl: message.hostUrl,
        token: message.hostToken,
        signingKey: message.hostSigningKey,
        binding: {
          hostId: message.hostBinding.hostId,
          instanceId: message.hostBinding.instanceId,
          hostConnectionId: randomUUID()
        }
      });
      runtimeDatabase = createRuntimeDatabase(join(message.dataDir, 'runtime.sqlite'));
      terminalSessions = new TerminalSessionService(terminalExecution, runtimeDatabase);
      terminalLaunchAuthority = createTerminalLaunchAuthority({
        projects,
        binding: terminalExecution.binding,
        getSession: (sessionId) => terminalSessions!.get(sessionId),
        execute: (command) => terminalSessions!.execute(command)
      });
      await terminalSessions.refreshHostConnection();
      hostConnectionRenewal = setInterval(() => {
        void terminalSessions?.refreshHostConnection().catch(() => {
          // The lease expires naturally if the paired host is unavailable; no
          // stale events can regain authority without a fresh signed handshake.
        });
      }, 10_000);
      parentPort.postMessage({ type: 'ready', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, url: host.url });
      runtimeMcpConfig.started();
    } catch (error) {
      if (hostConnectionRenewal) {
        clearInterval(hostConnectionRenewal);
        hostConnectionRenewal = null;
      }
      runtimeDatabase?.close();
      runtimeDatabase = null;
      await close?.();
      close = null;
      parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'mcp-ready') {
    const next = {
      mcpBaseUrl: message.mcpBaseUrl,
      teamLaunchEnabled: message.teamLaunchEnabled,
      teamJobLaunchEnabled: message.teamJobLaunchEnabled === true
    };
    runtimeMcpConfig.receive(next, close !== null);
    return;
  }
  if (message.type === 'request') {
    if (Date.parse(message.deadlineAt) <= Date.now()) {
      parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'server runtime request expired' });
      return;
    }
    if (message.operation === 'app-version') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: version });
    }
    if (message.operation === 'library-agent') {
      if (!productContext) throw new Error('Library runtime is unavailable');
      const { action, projectId, sessionId, ...input } = message.request;
      const value = await invokeHostLibraryTool(productContext, { name: `library_${action}`, projectId, threadId: sessionId, input }, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'library-document') {
      if (!productContext) throw new Error('Library runtime is unavailable');
      const value = await libraryDocumentOperation(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'project-catalogs') {
      if (!productContext) throw new Error('Project catalogue runtime is unavailable');
      const value = await readProjectCatalogs(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'project-feed') {
      if (!productContext) throw new Error('Activity feed runtime is unavailable');
      const value = await projectFeed(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'cli-discovery') {
      if (!productContext) throw new Error('CLI discovery runtime is unavailable');
      const value = await discoverProjectCli(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'cli-callback-grant') {
      const authority = productContext?.cliCallbacks;
      if (!authority) throw new Error('CLI callback runtime is unavailable');
      if (message.request.action === 'register') authority.register(message.request.grant);
      else authority.revoke(message.request.sessionId);
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: { ok: true } });
    }
    if (message.operation === 'project-history') {
      if (!productContext) throw new Error('Project history runtime is unavailable');
      const value = await readProjectHistory(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'project-metadata') {
      if (!productContext) throw new Error('Project metadata runtime is unavailable');
      const value = await projectMetadataRecords(productContext, message.request, Date.parse(message.deadlineAt));
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
    }
    if (message.operation === 'thread-live') {
      // Live owner = non-archived thread still usable in the asserted project.
      // Idle is rest between turns, not death. Any lookup miss / mismatch /
      // error ⇒ false (never throw). Cohort verbs stay pty-only.
      let live = false;
      try {
        const row = threadDb ? getConversationThread(threadDb, message.threadId) : null;
        live = isThreadLiveInProject(row, message.projectId);
      } catch {
        live = false;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: live });
    }
    if (message.operation === 'menubar-threads-list') {
      const agents = menubarThreads?.list(message.limit) ?? [];
      parentPort.postMessage({
        type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id,
        value: {
          agents,
          needsYou: agents.filter((agent) => agent.state === 'blocked').length,
          working: agents.filter((agent) => agent.state === 'working').length
        }
      });
    }
    if (message.operation === 'menubar-thread-open') {
      parentPort.postMessage({
        type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id,
        value: menubarThreads?.open(message.threadId, message.projectId) ?? { ok: false, reason: 'thread service unavailable' }
      });
    }
    if (message.operation === 'projects-list') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: projects?.list() ?? [] });
    }
    if (message.operation === 'projects-add') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      const added = await projects.add(message.path);
      productHub?.emit('projects:changed', projects.list());
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: added });
    }
    if (message.operation === 'projects-update') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      const updated = await projects.update(message.projectId, message.patch);
      // The renderer subscribes over product HTTP even when the mutation arrived via IPC.
      if (updated) productHub?.emit('projects:changed', projects.list());
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: updated });
    }
    if (message.operation === 'projects-reorder') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      const reordered = await projects.reorder(message.orderedIds);
      productHub?.emit('projects:changed', projects.list());
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: reordered });
    }
    if (message.operation === 'projects-touch') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      const touched = await projects.touch(message.projectId);
      if (touched) productHub?.emit('projects:changed', projects.list());
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: touched });
    }
    if (message.operation === 'projects-remove') {
      if (!projects || !projectSettings) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      // Preserve legacy ordering: a settings-cleanup failure can leave an
      // orphaned row, but never a live project without its launch settings.
      const removed = await projects.remove(message.projectId);
      await projectSettings.remove(message.projectId);
      if (removed) productHub?.emit('projects:changed', projects.list());
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: removed });
    }
    if (message.operation === 'project-settings-get') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: projectSettings?.get(message.projectId) ?? {} });
    }
    if (message.operation === 'project-settings-set') {
      if (!projectSettings) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project settings storage is unavailable' });
        return;
      }
      const value = await projectSettings.set(message.projectId, message.patch);
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value });
      parentPort.postMessage({ type: 'project-settings-changed', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, projectId: message.projectId });
    }
    if (message.operation === 'terminal-execute') {
      if (!message.command || !terminalLaunchAuthority) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'terminal execution is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await terminalLaunchAuthority.execute(message.command) });
    }
    if (message.operation === 'product-event') {
      if (message.channel === 'config:onChanged' || message.channel === 'product:reset') {
        // Read the owner's config; the forwarded renderer snapshot is advisory.
        await productContext?.plugins?.refreshSafeMode();
        if (productContext) productHub?.emit('config:changed', productContext.config.getConfig());
      }
      if (productHub) forwardRuntimeProductEvent(productHub, message.channel, message.args);
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: true });
    }
    if (message.operation === 'terminal-record') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: terminalSessions?.record(message.event) ?? false });
    }
    if (message.operation === 'terminal-events-since') {
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: terminalSessions?.eventsSince(message.sessionId, message.afterSequence) ?? []
      });
    }
    if (message.operation === 'plugins-list') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: plugins?.list() ?? [] });
    }
    if (message.operation === 'plugins-install') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.install(message.source) });
    }
    if (message.operation === 'plugins-enable') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.enable(message.pluginId) });
    }
    if (message.operation === 'plugins-disable') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.disable(message.pluginId) });
    }
    if (message.operation === 'plugins-remove') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      await plugins.remove(message.pluginId);
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: { ok: true } });
    }
    if (message.operation === 'plugins-reload') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.reload(message.pluginId) });
    }
    if (message.operation === 'plugins-logs') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: await plugins.readLogs(message.pluginId, message.n)
      });
    }
    if (message.operation === 'plugins-snapshot') {
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: (plugins?.snapshot() ?? []).map(toPluginAppSnapshot)
      });
    }
    if (message.operation === 'plugins-search') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.searchCatalog(message.query ?? '') });
    }
    if (message.operation === 'plugins-outdated') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.checkUpdates() });
    }
    if (message.operation === 'plugins-update') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.applyUpdate(message.pluginId) });
    }
    if (message.operation === 'plugins-call-rpc') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: await plugins.callRpc(message.pluginId, message.method, message.args)
      });
    }
    if (message.operation === 'plugins-settings-get') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: plugins.getSettings(message.pluginId)
      });
    }
    if (message.operation === 'plugins-settings-set') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      const values: Record<string, string | boolean | undefined> = {};
      for (const [key, value] of Object.entries(message.values ?? {})) {
        values[key] = value === null ? undefined : value;
      }
      await plugins.setSettings(message.pluginId, values);
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: plugins.getSettings(message.pluginId)
      });
    }
    if (message.operation === 'marketplace-list') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: plugins?.listMarketplaces() ?? [] });
    }
    if (message.operation === 'marketplace-add') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.addMarketplace(message.url) });
    }
    if (message.operation === 'marketplace-refresh') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.refreshMarketplace(message.url) });
    }
    if (message.operation === 'marketplace-remove') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await plugins.removeMarketplace(message.url) });
    }
    if (message.operation === 'plugins-cli-contributions') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: plugins?.cliContributions() ?? [] });
    }
    if (message.operation === 'plugins-cli-run') {
      if (!plugins) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'plugin host is unavailable' });
        return;
      }
      parentPort.postMessage({
        type: 'result',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        id: message.id,
        value: await plugins.runCliCommand(message.pluginId, message.argv ?? [], {
          ...(typeof message.projectId === 'string' ? { projectId: message.projectId } : {}),
          ...(typeof message.threadId === 'string' ? { threadId: message.threadId } : {}),
          ...(typeof message.cwd === 'string' ? { cwd: message.cwd } : {})
        })
      });
    }
  }
  if (message.type === 'stop') {
    disposeMenubarThreadHints?.();
    disposeMenubarThreadHints = null;
    if (menubarThreadHintTimer) clearTimeout(menubarThreadHintTimer);
    menubarThreadHintTimer = null;
    if (hostConnectionRenewal) clearInterval(hostConnectionRenewal);
    await close?.();
    runtimeDatabase?.close();
    parentPort.postMessage({ type: 'stopped', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION });
    process.exit(0);
  }
}
