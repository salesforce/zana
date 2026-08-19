import { startStaticHost } from './static-host.js';
import { ServerRuntimeInboundSchema } from '@zana-ai/zcc-contracts/runtime';
import { join } from 'node:path';
import { createProjectStore, type ProjectStore } from './project-store.js';
import { createProjectSettingsStore, type ProjectSettingsStore } from './project-settings-store.js';
import { createTerminalExecutionService, type TerminalExecutionService } from './terminal-execution-service.js';
import { TerminalSessionService } from './terminal-session-service.js';

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
let projects: ProjectStore | null = null;
let projectSettings: ProjectSettingsStore | null = null;
parentPort.on('message', async ({ data }) => {
  const parsed = ServerRuntimeInboundSchema.safeParse(data);
  if (!parsed.success) {
    parentPort.postMessage({ type: 'error', message: 'invalid server runtime message' });
    return;
  }
  const message = parsed.data;
  if (message.type === 'start' && message.rendererRoot && !close) {
    try {
      const host = await startStaticHost({ rootDir: message.rendererRoot });
      close = host.close;
      version = message.version ?? '';
      projects = createProjectStore({
        projectsFile: join(message.dataDir, 'projects.json'),
        remotePlaceholderRoot: join(message.dataDir, 'remote-projects')
      });
      projectSettings = createProjectSettingsStore({ projectSettingsFile: join(message.dataDir, 'project-settings.json') });
      terminalExecution = createTerminalExecutionService({
        hostUrl: message.hostUrl,
        token: message.hostToken,
        signingKey: message.hostSigningKey
      });
      terminalSessions = new TerminalSessionService(terminalExecution);
      parentPort.postMessage({ type: 'ready', url: host.url });
    } catch (error) {
      parentPort.postMessage({ type: 'error', message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'request') {
    if (Date.parse(message.deadlineAt) <= Date.now()) {
      parentPort.postMessage({ type: 'error', id: message.id, message: 'server runtime request expired' });
      return;
    }
    if (message.operation === 'app-version') {
      parentPort.postMessage({ type: 'result', id: message.id, value: version });
    }
    if (message.operation === 'projects-list') {
      parentPort.postMessage({ type: 'result', id: message.id, value: projects?.list() ?? [] });
    }
    if (message.operation === 'projects-add') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await projects.add(message.path) });
    }
    if (message.operation === 'projects-update') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await projects.update(message.projectId, message.patch) });
    }
    if (message.operation === 'projects-reorder') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await projects.reorder(message.orderedIds) });
    }
    if (message.operation === 'projects-touch') {
      if (!projects) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project storage is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await projects.touch(message.projectId) });
    }
    if (message.operation === 'projects-remove') {
      if (!projects || !projectSettings) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project storage is unavailable' });
        return;
      }
      // Preserve legacy ordering: a settings-cleanup failure can leave an
      // orphaned row, but never a live project without its launch settings.
      const removed = await projects.remove(message.projectId);
      await projectSettings.remove(message.projectId);
      parentPort.postMessage({ type: 'result', id: message.id, value: removed });
    }
    if (message.operation === 'project-settings-get') {
      parentPort.postMessage({ type: 'result', id: message.id, value: projectSettings?.get(message.projectId) ?? {} });
    }
    if (message.operation === 'project-settings-set') {
      if (!projectSettings) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'project settings storage is unavailable' });
        return;
      }
      const value = await projectSettings.set(message.projectId, message.patch);
      parentPort.postMessage({ type: 'result', id: message.id, value });
      parentPort.postMessage({ type: 'project-settings-changed', projectId: message.projectId });
    }
    if (message.operation === 'terminal-execute') {
      if (!message.command || !terminalSessions) {
        parentPort.postMessage({ type: 'error', id: message.id, message: 'terminal execution is unavailable' });
        return;
      }
      parentPort.postMessage({ type: 'result', id: message.id, value: await terminalSessions.execute(message.command) });
    }
    if (message.operation === 'terminal-record') {
      parentPort.postMessage({ type: 'result', id: message.id, value: terminalSessions?.record(message.event) ?? false });
    }
  }
  if (message.type === 'stop') {
    await close?.();
    parentPort.postMessage({ type: 'stopped' });
    process.exit(0);
  }
});
