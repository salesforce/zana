import { randomBytes, randomUUID } from 'node:crypto';
import { utilityProcess } from 'electron';
import { join } from 'node:path';
import { startStaticHost, type StaticHost } from '@zana-ai/zcc-server/static-host';
import { startHostDaemon, type HostDaemon } from '@zana-ai/zcc-host-daemon';
import { createLocalPtyTerminalManager } from '@zana-ai/zcc-host-daemon';
import { createTerminalExecutionService } from '../../apps/server/src/terminal-execution-service.js';
import { TerminalSessionService } from '../../apps/server/src/terminal-session-service.js';
import {
  RuntimeOutboundSchema,
  type ProjectMutationPatchSchema,
  type ProjectRecordSchema
} from '@zana-ai/zcc-contracts/runtime';
import type { ProjectSettingsPatch } from '@zana-ai/zcc-contracts/project-settings';
import type { TerminalHostEvent } from '@zana-ai/zcc-contracts/terminal-execution';
import type { TerminalHostCommand } from '@zana-ai/zcc-contracts/terminal-execution';
import type { z } from 'zod';

export type RuntimeProject = z.infer<typeof ProjectRecordSchema>;
export type RuntimeProjectPatch = z.infer<typeof ProjectMutationPatchSchema>;
export type RuntimeProjectSettings = ProjectSettingsPatch;

export interface RuntimeSupervisor {
  readonly rendererUrl: string;
  readonly hostUrl: string;
  readonly hostToken: string;
  readonly hostSigningKey: string;
  appVersion(): Promise<string>;
  listProjects(): Promise<RuntimeProject[]>;
  addProject(path: string): Promise<RuntimeProject>;
  updateProject(id: string, patch: RuntimeProjectPatch): Promise<RuntimeProject | null>;
  reorderProjects(orderedIds: string[]): Promise<RuntimeProject[]>;
  touchProject(id: string): Promise<RuntimeProject | null>;
  removeProject(id: string): Promise<RuntimeProject | null>;
  getProjectSettings(id: string): Promise<RuntimeProjectSettings>;
  setProjectSettings(id: string, patch: RuntimeProjectSettings): Promise<RuntimeProjectSettings>;
  executeTerminal(command: TerminalHostCommand): Promise<TerminalHostEvent[]>;
  recordTerminalEvent(event: TerminalHostEvent): Promise<boolean>;
  onTerminalEvent(listener: (event: TerminalHostEvent) => void): () => void;
  onProjectSettingsChanged(listener: (projectId: string) => void): () => void;
  close(): Promise<void>;
}

export interface StartRuntimeSupervisorOptions {
  rendererRoot: string;
  dataDir?: string;
  runtimeDir?: string;
  version?: string;
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
  if (options.runtimeDir) {
    return startUtilityRuntime({ ...options, token, signingKey });
  }
  const terminalListeners = new Set<(event: TerminalHostEvent) => void>();
  let terminalSessions: TerminalSessionService | null = null;
  const [renderer, host] = await Promise.all([
    startStaticHost({ rootDir: options.rendererRoot }),
    startHostDaemon({
      token,
      signingKey,
      terminalManager: createLocalPtyTerminalManager((event) => {
        if (!terminalSessions?.record(event)) return;
        for (const listener of terminalListeners) listener(event);
      })
    })
  ]);
  terminalSessions = new TerminalSessionService(
    createTerminalExecutionService({ hostUrl: host.url, token, signingKey })
  );
  return {
    rendererUrl: renderer.url,
    hostUrl: host.url,
    hostToken: token,
    hostSigningKey: signingKey,
    appVersion: async () => options.version ?? '',
    listProjects: async () => [],
    addProject: async () => { throw new Error('runtime project storage is unavailable'); },
    updateProject: async () => { throw new Error('runtime project storage is unavailable'); },
    reorderProjects: async () => { throw new Error('runtime project storage is unavailable'); },
    touchProject: async () => { throw new Error('runtime project storage is unavailable'); },
    removeProject: async () => { throw new Error('runtime project storage is unavailable'); },
    getProjectSettings: async () => { throw new Error('runtime project settings storage is unavailable'); },
    setProjectSettings: async () => { throw new Error('runtime project settings storage is unavailable'); },
    executeTerminal: (command) => terminalSessions!.execute(command),
    recordTerminalEvent: async (event) => terminalSessions!.record(event),
    onTerminalEvent(listener) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    onProjectSettingsChanged: () => () => {},
    async close(): Promise<void> {
      await Promise.allSettled([renderer.close(), host.close()]);
    }
  };
}

interface UtilityChild {
  postMessage(message: unknown): void;
  on(event: 'message', listener: (message: unknown) => void): void;
  once(event: 'exit', listener: () => void): void;
  once(event: 'spawn', listener: () => void): void;
  kill(): void;
}

interface UtilityRuntime {
  child: UtilityChild;
  url: string;
  request(operation: 'app-version' | 'projects-list'): Promise<unknown>;
  request(operation: 'projects-add', path: string): Promise<unknown>;
  request(operation: 'projects-update', projectId: string, patch: RuntimeProjectPatch): Promise<unknown>;
  request(operation: 'projects-reorder', orderedIds: string[]): Promise<unknown>;
  request(operation: 'projects-touch', projectId: string): Promise<unknown>;
  request(operation: 'projects-remove', projectId: string): Promise<unknown>;
  request(operation: 'project-settings-get', projectId: string): Promise<unknown>;
  request(operation: 'project-settings-set', projectId: string, patch: RuntimeProjectSettings): Promise<unknown>;
  request(operation: 'terminal-execute', command: TerminalHostCommand): Promise<unknown>;
  request(operation: 'terminal-record', event: TerminalHostEvent): Promise<unknown>;
  stop(): Promise<void>;
}

function startUtility(
  entry: string,
  startMessage: unknown
): Promise<{ child: UtilityChild; url: string }> {
  return new Promise((resolveReady, rejectReady) => {
    const child = utilityProcess.fork(entry, [], { serviceName: `zcc-${entry}` });
    let ready = false;
    const timer = setTimeout(() => reject(new Error('runtime child start timed out')), 15_000);
    const reject = (error: Error) => {
      clearTimeout(timer);
      child.kill();
      rejectReady(error);
    };
    child.once('exit', () => {
      if (!ready) reject(new Error('runtime child exited before ready'));
    });
    child.on('message', (message: unknown) => {
      const data = message as { type?: string; url?: string; message?: string };
      if (data.type === 'ready' && data.url) {
        ready = true;
        clearTimeout(timer);
        resolveReady({ child, url: data.url });
      } else if (data.type === 'error') {
        reject(new Error(data.message ?? 'runtime child failed'));
      }
    });
    child.once('spawn', () => child.postMessage(startMessage));
  });
}

async function startUtilityRuntime(options: StartRuntimeSupervisorOptions & { token: string; signingKey: string }): Promise<RuntimeSupervisor> {
  const runtimeDir = options.runtimeDir!;
  const host = await startUtility(join(runtimeDir, 'host-runtime.js'), {
    type: 'start', token: options.token, signingKey: options.signingKey
  });
  const renderer = await startUtility(join(runtimeDir, 'server-runtime.js'), {
    type: 'start',
    rendererRoot: options.rendererRoot,
    dataDir: options.dataDir ?? '',
    hostUrl: host.url,
    hostToken: options.token,
    hostSigningKey: options.signingKey,
    version: options.version ?? ''
  });
  const server = createUtilityRuntime(renderer);
  const hostRuntime = createUtilityRuntime(host);
  const terminalListeners = new Set<(event: TerminalHostEvent) => void>();
  const projectSettingsListeners = new Set<(projectId: string) => void>();
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
    if (!parsed.success || parsed.data.type !== 'project-settings-changed') return;
    for (const listener of projectSettingsListeners) listener(parsed.data.projectId);
  });
  return {
    rendererUrl: renderer.url,
    hostUrl: host.url,
    hostToken: options.token,
    hostSigningKey: options.signingKey,
    appVersion: async () => {
      const value = await server.request('app-version');
      return typeof value === 'string' ? value : '';
    },
    listProjects: async () => {
      const value = await server.request('projects-list');
      return Array.isArray(value) ? value as RuntimeProject[] : [];
    },
    addProject: (path) => server.request('projects-add', path) as Promise<RuntimeProject>,
    updateProject: (id, patch) => server.request('projects-update', id, patch) as Promise<RuntimeProject | null>,
    reorderProjects: (orderedIds) => server.request('projects-reorder', orderedIds) as Promise<RuntimeProject[]>,
    touchProject: (id) => server.request('projects-touch', id) as Promise<RuntimeProject | null>,
    removeProject: (id) => server.request('projects-remove', id) as Promise<RuntimeProject | null>,
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
    onTerminalEvent(listener) {
      terminalListeners.add(listener);
      return () => terminalListeners.delete(listener);
    },
    onProjectSettingsChanged(listener) {
      projectSettingsListeners.add(listener);
      return () => projectSettingsListeners.delete(listener);
    },
    async close(): Promise<void> {
      await Promise.allSettled([server.stop(), hostRuntime.stop()]);
    }
  };
}

function createUtilityRuntime(runtime: { child: UtilityChild; url: string }): UtilityRuntime {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: NodeJS.Timeout }>();
  let stopped = false;
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
  });
  return {
    ...runtime,
    request(
      operation: 'app-version' | 'projects-list' | 'projects-add' | 'projects-update' | 'projects-reorder' | 'projects-touch' | 'projects-remove' | 'project-settings-get' | 'project-settings-set' | 'terminal-execute' | 'terminal-record',
      ...args: [TerminalHostCommand] | [TerminalHostEvent] | [string] | [string[]] | [string, RuntimeProjectPatch] | [string, RuntimeProjectSettings] | []
    ) {
      const id = randomUUID();
      return new Promise<unknown>((resolveResult, rejectResult) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          rejectResult(new Error(`server ${operation} request timed out`));
        }, 5_000);
        pending.set(id, { resolve: resolveResult, reject: rejectResult, timer });
        runtime.child.postMessage({
          type: 'request', id, operation, deadlineAt: new Date(Date.now() + 5_000).toISOString(),
          ...(operation === 'terminal-execute' ? { command: args[0] as TerminalHostCommand } : {}),
          ...(operation === 'terminal-record' ? { event: args[0] as TerminalHostEvent } : {}),
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
          } : {})
        });
      });
    },
    async stop() {
      if (stopped) return;
      runtime.child.postMessage({ type: 'stop' });
      await Promise.race([
        stoppedPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3_000))
      ]);
      if (!stopped) runtime.child.kill();
    }
  };
}
