import { startStaticHost } from './static-host.js';
import { toBrowserProjectSummaries } from './browser-bootstrap.js';
import { createProductHttpContext } from './http/product-context.js';
import { DEFAULT_DEV_APP_PORT } from './http/ports.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION, ServerRuntimeInboundSchema } from '@zana-ai/zcc-contracts/runtime';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createProjectStore, type ProjectStore } from './project-store.js';
import { createProjectSettingsStore, type ProjectSettingsStore } from './project-settings-store.js';
import { createTerminalExecutionService, type TerminalExecutionService } from './terminal-execution-service.js';
import { TerminalSessionService } from './terminal-session-service.js';
import { createRuntimeDatabase, type TerminalSessionRepository } from './runtime-database.js';
import { createTerminalLaunchAuthority } from './terminal-launch-authority.js';
import type { PluginService } from './plugins/plugin-service.js';
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

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) throw new Error('server utility entry requires an Electron utility process');

let close: (() => Promise<void>) | null = null;
let version = '';
let terminalExecution: TerminalExecutionService | null = null;
let terminalSessions: TerminalSessionService | null = null;
let terminalLaunchAuthority: ReturnType<typeof createTerminalLaunchAuthority> | null = null;
let runtimeDatabase: TerminalSessionRepository | null = null;
let projects: ProjectStore | null = null;
let projectSettings: ProjectSettingsStore | null = null;
let hostConnectionRenewal: NodeJS.Timeout | null = null;
let plugins: PluginService | null = null;
parentPort.on('message', async ({ data }) => {
  const parsed = ServerRuntimeInboundSchema.safeParse(data);
  if (!parsed.success) {
    parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, message: 'invalid server runtime message' });
    return;
  }
  const message = parsed.data;
  if (message.type === 'start' && message.rendererRoot && !close) {
    try {
      version = message.version ?? '';
      projects = createProjectStore({
        projectsFile: join(message.dataDir, 'projects.json'),
        remotePlaceholderRoot: join(message.dataDir, 'remote-projects')
      });
      projectSettings = createProjectSettingsStore({
        projectSettingsFile: join(message.dataDir, 'project-settings.json')
      });
      const product = createProductHttpContext({
        dataDir: message.dataDir,
        origins: { serverPort: 0, devAppPort: DEFAULT_DEV_APP_PORT },
        projects: projects ?? undefined
      });
      plugins = await attachProductPluginService(product, {
        bundledRoot: bundledPluginsRootFromDataDir(message.dataDir, message.bundledPluginsRoot),
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
  if (message.type === 'request') {
    if (Date.parse(message.deadlineAt) <= Date.now()) {
      parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'server runtime request expired' });
      return;
    }
    if (message.operation === 'app-version') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: version });
    }
    if (message.operation === 'projects-list') {
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: projects?.list() ?? [] });
    }
    if (message.operation === 'projects-add') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await projects.add(message.path) });
    }
    if (message.operation === 'projects-update') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await projects.update(message.projectId, message.patch) });
    }
    if (message.operation === 'projects-reorder') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await projects.reorder(message.orderedIds) });
    }
    if (message.operation === 'projects-touch') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, id: message.id, value: await projects.touch(message.projectId) });
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
        value: await plugins.runCliCommand(message.pluginId, message.argv ?? [])
      });
    }
  }
  if (message.type === 'stop') {
    if (hostConnectionRenewal) clearInterval(hostConnectionRenewal);
    await close?.();
    runtimeDatabase?.close();
    parentPort.postMessage({ type: 'stopped', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION });
    process.exit(0);
  }
});
