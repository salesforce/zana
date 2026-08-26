import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import type {
  PluginAgentToolRegistration,
  PluginCliExecutionResult,
  PluginCliRegistration,
  PluginCliCommandInfo,
  PluginDatabase,
  PluginHttpMethod,
  PluginHttpRequest,
  PluginHttpResponse,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginSettingDescriptor,
  PluginSettingValue,
  PluginThreadEvent,
  PluginThreadEventName,
  ZccPluginApi,
  ZccPluginFactory
} from '@zana-ai/zcc-plugin-sdk/server';
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  PLUGIN_CLI_COMMAND_NAME_PATTERN,
  RESERVED_ZCC_CLI_COMMANDS,
  type JsonValue
} from '@zana-ai/zcc-domain/thread-runtime';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { enforcePluginCliOutputLimit } from '@zana-ai/zcc-plugin-sdk/server';

export const HOST_ZCC_VERSION = '1.0.10';
export const HOST_PLUGIN_SDK_VERSION = '0.1.0';
export const FACTORY_TIMEOUT_MS = 10_000;

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

export interface PluginHandle {
  api: ZccPluginApi;
  extraSkillRoots: string[];
  extraInstructions: string[];
  cli: { registration: PluginCliRegistration | null };
  httpRoutes: PluginHttpRouteRecord[];
  agentTools: PluginAgentToolRegistration[];
  emitThreadEvent(event: PluginThreadEvent): Promise<void>;
  getSettings(): {
    descriptors: Record<string, PluginSettingDescriptor>;
    values: Record<string, PluginSettingValue | undefined>;
  };
  setSettings(values: Record<string, PluginSettingValue | undefined>): Promise<void>;
  subscribeRealtime(listener: (event: string, payload: unknown) => void): () => void;
  dispose(): Promise<void>;
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
    onNeedsConfiguration?: (message: string) => void;
    spawnThread?: (args: { pluginId: string; projectId: string; prompt: string; providerId?: string }) => Promise<{ id: string }>;
  }
): PluginHandle {
  mkdirSync(kvDir, { recursive: true });
  const kvPath = join(kvDir, 'kv.json');
  const settingsPath = join(kvDir, 'settings.json');
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const extraSkillRoots: string[] = [];
  const extraInstructions: string[] = [];
  const settingListeners: Array<(next: Record<string, PluginSettingValue | undefined>) => void> = [];
  const realtimeListeners = new Set<(event: string, payload: unknown) => void>();
  let settingDescriptors: Record<string, PluginSettingDescriptor> = {};
  let stale = false;
  const cliRecord: { registration: PluginCliRegistration | null } = { registration: null };
  const httpRoutes: PluginHttpRouteRecord[] = [];
  const agentTools: PluginAgentToolRegistration[] = [];
  const threadEventHandlers: Array<{
    name: PluginThreadEventName;
    handler: (event: PluginThreadEvent) => void | Promise<void>;
  }> = [];
  const sqliteHandles: Array<{ close(): void }> = [];
  const assertLive = (): void => {
    if (stale) throw new Error(`plugin context is stale: ${pluginId}`);
  };
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const readKv = (): Record<string, unknown> => readJsonFile<Record<string, unknown>>(kvPath, {});
  const readSettings = (): Record<string, PluginSettingValue | undefined> =>
    readJsonFile<Record<string, PluginSettingValue | undefined>>(settingsPath, {});

  const api: ZccPluginApi = {
    pluginId,
    log: {
      debug: (message) => console.debug(`[plugin:${pluginId}] ${message}`),
      info: (message) => console.info(`[plugin:${pluginId}] ${message}`),
      warn: (message) => console.warn(`[plugin:${pluginId}] ${message}`),
      error: (message) => console.error(`[plugin:${pluginId}] ${message}`)
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
        get: async <T>(key: string) => readKv()[key] as T | undefined,
        set: async (key, value) => {
          assertLive();
          const next = readKv();
          next[key] = value;
          writeJsonFile(kvPath, next);
        },
        delete: async (key) => {
          const next = readKv();
          delete next[key];
          writeJsonFile(kvPath, next);
        },
        list: async (prefix) =>
          Object.keys(readKv()).filter((key) => (prefix ? key.startsWith(prefix) : true))
      },
      database: (): PluginDatabase => {
        assertLive();
        const dbPath = join(kvDir, 'data.db');
        // Lazy require keeps plugin-api importable in tests that never open a database.
        const require = createRequire(import.meta.url);
        const Database = require('better-sqlite3') as new (path: string) => {
          prepare: (sql: string) => {
            all: (...params: unknown[]) => unknown[];
            get: (...params: unknown[]) => unknown;
            run: (...params: unknown[]) => { changes: number };
          };
          close: () => void;
        };
        const db = new Database(dbPath);
        sqliteHandles.push(db);
        const runScript = (sql: string) => {
          for (const statement of sql.split(';').map((part) => part.trim()).filter(Boolean)) {
            db.prepare(statement).run();
          }
        };
        return {
          runScript,
          prepare: (sql) => db.prepare(sql),
          migrate: (statements) => {
            for (const statement of statements) runScript(statement);
          }
        };
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
    sdk: {
      threads: {
        spawn: async (args) => {
          assertLive();
          if (!options?.spawnThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.spawnThread({ pluginId, ...args });
        }
      }
    },
    host: {
      experimental_call: async () => {
        throw new Error('zcc.host is not available in this runtime');
      }
    },
    rpc: {
      method: (name, handler) => {
        assertLive();
        rpc.set(name, handler);
      }
    },
    realtime: {
      publish: (event, payload) => {
        assertLive();
        for (const listener of realtimeListeners) listener(event, payload);
      }
    },
    background: {
      service: (_name, start) => {
        void Promise.resolve(start()).then((stop) => {
          if (typeof stop === 'function') disposeHooks.push(stop);
        });
      },
      schedule: (cron, job) => {
        assertLive();
        const timer = setInterval(() => {
          void Promise.resolve(job()).catch((error) => {
            console.error(`[plugin:${pluginId}] schedule ${cron} failed`, error);
          });
        }, 60_000);
        disposeHooks.push(() => clearInterval(timer));
      }
    },
    agents: {
      contributeInstructions: (text) => {
        extraInstructions.length = 0;
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed) extraInstructions.push(trimmed);
      },
      contributeSkills: (rootPaths) => {
        extraSkillRoots.push(...rootPaths);
      },
      registerTool: (registration) => {
        assertLive();
        if (!registration?.name || typeof registration.execute !== 'function') {
          throw new Error('agents.registerTool requires name and execute');
        }
        agentTools.push(registration);
      },
      experimental_registerProvider: (declaration) => {
        assertLive();
        const handle = registerThreadProvider(pluginId, declaration);
        disposeHooks.push(() => handle.unregister());
        return handle;
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
      }
    },
    status: {
      needsConfiguration: (message) => {
        options?.onNeedsConfiguration?.(message);
      }
    },
    onDispose: (hook) => {
      disposeHooks.push(hook);
    }
  };
  return {
    api,
    extraSkillRoots,
    extraInstructions,
    cli: cliRecord,
    httpRoutes,
    agentTools,
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
      const next = { ...readSettings(), ...values };
      writeJsonFile(settingsPath, next);
      const projected: Record<string, PluginSettingValue | undefined> = {};
      for (const [key, descriptor] of Object.entries(settingDescriptors)) {
        projected[key] = next[key] ?? descriptor.default;
      }
      for (const listener of settingListeners) listener(projected);
    },
    subscribeRealtime(listener) {
      realtimeListeners.add(listener);
      return () => {
        realtimeListeners.delete(listener);
      };
    },
    async dispose() {
      stale = true;
      options?.interruptPluginInteractions?.(pluginId);
      for (const handle of sqliteHandles) {
        try {
          handle.close();
        } catch {
          /* isolated */
        }
      }
      sqliteHandles.length = 0;
      for (const hook of [...disposeHooks].reverse()) {
        try {
          await hook();
        } catch {
          /* isolated */
        }
      }
      disposeHooks.length = 0;
    }
  };
}

export async function runPluginCli(
  handle: PluginHandle,
  argv: string[]
): Promise<PluginCliExecutionResult> {
  const registration = handle.cli.registration;
  if (!registration) {
    return { exitCode: 1, stdout: '', stderr: 'plugin has no CLI command\n' };
  }
  const result = await registration.run(argv, {
    pluginId: handle.api.pluginId,
    argv
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
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60 * 60 * 1000) {
    throw new Error('ui.requestInput timeoutMs must be between 1 and 3600000');
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

export async function importServerFactory(
  entryPath: string,
  cacheBust?: string | number
): Promise<ZccPluginFactory> {
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
      Promise.resolve(factory(api)),
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
  return entries.some((rel) => rel.endsWith('.node') || rel.endsWith('.node.js'));
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
