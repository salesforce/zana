import { pathToFileURL } from 'node:url';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import type {
  PluginAgentConfigureContext,
  PluginAgentConfigureResult,
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
  PluginMentionProviderRegistration,
  PluginMentionSearchContext,
  PluginMentionSuggestion,
  PluginMentionTrigger,
  PluginSettingDescriptor,
  PluginSettingValue,
  PluginSdkThreadEventRow,
  PluginSdkThreadSummary,
  PluginThreadEvent,
  PluginThreadEventName,
  ZccPluginApi,
  ZccPluginFactory
} from '@zana-ai/zcc-plugin-sdk/server';
import {
  PLUGIN_MENTION_TRIGGERS,
  enforcePluginCliOutputLimit,
  isPluginHostEntryDefinition,
  parsePluginAgentToolPresentation
} from '@zana-ai/zcc-plugin-sdk/server';
import {
  PLUGIN_INTERACTION_MAX_PAYLOAD_BYTES,
  PLUGIN_INTERACTION_MAX_TITLE_LENGTH,
  PLUGIN_CLI_COMMAND_NAME_PATTERN,
  RESERVED_ZCC_CLI_COMMANDS,
  type JsonValue
} from '@zana-ai/zcc-domain/thread-runtime';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';
import { cronMatches, cronMinuteKey } from '@zana-ai/zcc-plugin-sdk';
import {
  bindPluginServices,
  createPluginServicesRegistry,
  type PluginServicesRegistry
} from '@zana-ai/zcc-plugin-sdk/server';
import { appendPluginLogLine } from './plugin-log.js';
import {
  mergeSecretSettings,
  persistSecretSettings,
  publicSettingsValues
} from './plugin-secret-settings.js';

export const HOST_ZCC_VERSION = '2.1.0';
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
  extraInstructionProviders: Array<(ctx: { threadId: string; projectId: string }) => string | null>;
  agentConfigurers: Array<
    (
      ctx: PluginAgentConfigureContext
    ) => PluginAgentConfigureResult | void | Promise<PluginAgentConfigureResult | void>
  >;
  mentionProviders: Array<PluginMentionProviderRegistration & { pluginId: string }>;
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
    onNeedsConfiguration?: (message: string) => void;
    spawnThread?: (args: {
      pluginId: string;
      projectId: string;
      prompt: string;
      providerId?: string;
      parentThreadId?: string;
    }) => Promise<{ id: string }>;
    getThread?: (args: { pluginId: string; threadId: string }) => Promise<PluginSdkThreadSummary | null>;
    listThreadEvents?: (args: {
      pluginId: string;
      threadId: string;
      limit?: number;
      types?: readonly string[];
      order?: 'asc' | 'desc';
    }) => Promise<PluginSdkThreadEventRow[]>;
    sendThread?: (args: { pluginId: string; threadId: string; prompt: string }) => Promise<{ id: string }>;
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
    pushInbox?: (args: { pluginId: string; projectId: string; comments: string }) => Promise<{ id: string }>;
    listProjects?: (args: { pluginId: string }) => Promise<Array<{ id: string; name: string; path?: string }>>;
    hostEntryPath?: string | null;
    hostCall?: (method: string, input?: unknown, hostId?: string) => Promise<unknown>;
    dataDir?: string;
    services?: PluginServicesRegistry;
  }
): PluginHandle {
  mkdirSync(kvDir, { recursive: true });
  const kvPath = join(kvDir, 'kv.json');
  const settingsPath = join(kvDir, 'settings.json');
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const extraSkillRoots: string[] = [];
  const extraInstructions: string[] = [];
  const extraInstructionProviders: PluginHandle['extraInstructionProviders'] = [];
  const agentConfigurers: PluginHandle['agentConfigurers'] = [];
  const mentionProviders: PluginHandle['mentionProviders'] = [];
  const hostMethods = new Map<string, (input: unknown) => unknown | Promise<unknown>>();
  let hostEntryLoaded: Promise<void> | null = null;
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
  let sharedDatabase: PluginDatabase | null = null;
  const assertLive = (): void => {
    if (stale) throw new Error(`plugin context is stale: ${pluginId}`);
  };
  const services = bindPluginServices(
    pluginId,
    options?.services ?? createPluginServicesRegistry(),
    (hook) => {
      disposeHooks.push(hook);
    }
  );
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const readKv = (): Record<string, unknown> => readJsonFile<Record<string, unknown>>(kvPath, {});
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
    const line = `[plugin:${pluginId}] ${message}`;
    if (level === 'debug') console.debug(line);
    else if (level === 'info') console.info(line);
    else if (level === 'warn') console.warn(line);
    else console.error(line);
    if (options?.dataDir) appendPluginLogLine(options.dataDir, pluginId, level, message);
  }

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
        if (sharedDatabase) return sharedDatabase;
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
        const runBatch = Reflect.get(db, 'exec') as (source: string) => unknown;
        const beginTxn = Reflect.get(db, 'transaction') as <T>(fn: () => T) => () => T;
        const runScript = (sql: string) => {
          runBatch.call(db, sql);
        };
        sharedDatabase = {
          runScript,
          prepare: (sql) => db.prepare(sql),
          migrate: (statements) => {
            for (const statement of statements) runScript(statement);
          },
          transaction: <T>(fn: () => T): T => beginTxn.call(db, fn)() as T
        };
        return sharedDatabase;
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
          return options.sendThread({ pluginId, threadId, prompt });
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
        }
      },
      inbox: {
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
        }
      }
    },
    host: {
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
      experimental_client() {
        return {
          call: async (method, input, callOptions) => {
            assertLive();
            if (options?.hostCall) return options.hostCall(method, input, callOptions.hostId);
            await ensureHostEntry();
            const handler = hostMethods.get(method);
            if (!handler) {
              throw new Error(`zcc.host method is not available: ${method}`);
            }
            return handler(input);
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
          if (typeof handler === 'function') rpc.set(name, handler);
        }
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
      schedule: (cronOrName, jobOrCron, maybeJob?) => {
        assertLive();
        const named = typeof jobOrCron === 'string';
        const name = named ? cronOrName : '';
        const cron = named ? jobOrCron : cronOrName;
        const job = named ? maybeJob : jobOrCron;
        if (typeof job !== 'function') throw new Error('background.schedule requires a job function');
        const persistKey = name ? `schedule:${name}:last` : '';
        const timer = setInterval(() => {
          if (!cronMatches(cron)) return;
          const minute = cronMinuteKey();
          if (persistKey) {
            const last = readKv()[persistKey];
            if (last === minute) return;
            const next = readKv();
            next[persistKey] = minute;
            writeJsonFile(kvPath, next);
          }
          void Promise.resolve(job()).catch((error) => {
            console.error(`[plugin:${pluginId}] schedule ${name || cron} failed`, error);
          });
        }, 60_000);
        disposeHooks.push(() => clearInterval(timer));
      },
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
        if (!registration?.name || typeof registration.execute !== 'function') {
          throw new Error('agents.registerTool requires name and execute');
        }
        const presentation = parsePluginAgentToolPresentation(registration.name, registration.presentation);
        agentTools.push(presentation ? { ...registration, presentation } : registration);
      },
      experimental_registerProvider: (declaration) => {
        assertLive();
        const handle = registerThreadProvider(pluginId, declaration, options?.hostEntryPath);
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
    extraSkillRoots,
    extraInstructions,
    extraInstructionProviders,
    agentConfigurers,
    mentionProviders,
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
      await persistSecretSettings(kvDir, settingDescriptors, next);
      writeJsonFile(settingsPath, publicSettingsValues(settingDescriptors, next));
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
      sharedDatabase = null;
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

/** Require specifiers that can see `apps/server`'s jiti from Electron `out/main`. */
export function jitiRequireIds(cwd = process.cwd(), metaUrl = import.meta.url): string[] {
  return [
    metaUrl,
    pathToFileURL(join(cwd, 'package.json')).href,
    pathToFileURL(join(cwd, 'apps', 'server', 'package.json')).href
  ];
}

export async function loadCreateJiti(
  importJiti: () => Promise<unknown> = () => import('jiti'),
  requireIds: readonly string[] = jitiRequireIds()
): Promise<CreateJitiFn> {
  const attempts: unknown[] = [];
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
