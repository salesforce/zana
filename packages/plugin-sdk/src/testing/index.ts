import type {
  PluginCliExecutionResult,
  PluginDatabase,
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginSettingDescriptor,
  PluginSettingValue,
  ZccPluginApi,
  ZccPluginFactory
} from '../server.js';
import { bindPluginServices, createPluginServicesRegistry } from '../server.js';
import type { PluginServicesRegistry } from '../server.js';
import { enforcePluginCliOutputLimit } from '../server.js';
import { normalizeRegisteredAgentTool } from '../internal/host-policy.js';

export { scanPublicSdkOnly as experimental_scanPublicSdkOnly } from './public-sdk-only.js';
export type {
  PublicSdkOnlyScan,
  PublicSdkOnlyScanOptions,
  PublicSdkOnlyViolation
} from './public-sdk-only.js';

export function makeThreadResponse(over: { id?: string } = {}): import('../server.js').PluginSdkThreadSummary {
  return {
    id: over.id ?? 'thr-1',
    projectId: 'project-1',
    hostId: 'host-1',
    environmentId: null,
    providerId: 'claude',
    status: 'idle'
  };
}

export class PluginContextStaleError extends Error {
  constructor(pluginId: string) {
    super(`plugin context is stale: ${pluginId}`);
    this.name = 'PluginContextStaleError';
  }
}

export interface FakePluginHarness {
  rpc: Map<string, (args: unknown) => unknown | Promise<unknown>>;
  settings: Record<string, PluginSettingDescriptor>;
  kv: Map<string, unknown>;
  published: Array<{ event: string; payload: unknown }>;
  schedules: Array<{ name: string; cron: string; job: () => void | Promise<void> }>;
  extraSkillRoots: string[];
  extraInstructions: string[];
  extraInstructionProviders: Array<(ctx: { threadId: string; projectId: string }) => string | null>;
  providers: import('../server.js').PluginProviderDeclaration[];
  ptyHarnesses: import('../server.js').PluginPtyHarnessDeclaration[];
  registrations: {
    providerRegistrations: import('../server.js').PluginProviderDeclaration[];
    agentTools: import('../server.js').PluginAgentToolRecord[];
  };
  mentionProviders: import('../server.js').PluginMentionProviderRegistration[];
  agentConfigurers: Array<
    (
      ctx: import('../server.js').PluginAgentConfigureContext
    ) =>
      | import('../server.js').PluginAgentConfigureResult
      | void
      | Promise<import('../server.js').PluginAgentConfigureResult | void>
  >;
  cli: import('../server.js').PluginCliRegistration | null;
  agentTools: import('../server.js').PluginAgentToolRecord[];
  httpRoutes: Array<{
    method: import('../server.js').PluginHttpMethod;
    path: string;
    handler: (request: import('../server.js').PluginHttpRequest) =>
      | import('../server.js').PluginHttpResponse
      | Promise<import('../server.js').PluginHttpResponse>;
  }>;
  events: Array<{
    name: import('../server.js').PluginThreadEventName;
    handler: (event: import('../server.js').PluginThreadEvent) => void | Promise<void>;
  }>;
  sdk: {
    stub(path: string, implementation: (...args: never[]) => unknown): void;
    callsTo(path: string): unknown[][];
  };
  behavior: {
    callRpc(name: string, args?: unknown): Promise<unknown>;
    runCli(
      argv: string[],
      context?: { projectId?: string; threadId?: string; cwd?: string }
    ): Promise<PluginCliExecutionResult>;
    emitThreadEvent(
      name: import('../server.js').PluginThreadEventName,
      payload: {
        thread?: import('../server.js').PluginSdkThreadSummary;
        lastAssistantText?: string | null;
        error?: string | null;
      }
    ): Promise<{ errors: unknown[] }>;
  };
  lifecycle: {
    dispose(): Promise<void>;
  };
  needsConfiguration: string | null;
  setSettings(values: Record<string, PluginSettingValue | undefined>): void;
  callRpc(name: string, args?: unknown): Promise<unknown>;
  runSchedule(name?: string): Promise<void>;
  runCli(
    argv: string[],
    context?: { projectId?: string; threadId?: string; cwd?: string }
  ): Promise<PluginCliExecutionResult>;
  emitThreadEvent(
    name: import('../server.js').PluginThreadEventName,
    payload: {
      thread?: import('../server.js').PluginSdkThreadSummary;
      lastAssistantText?: string | null;
      error?: string | null;
    }
  ): Promise<{ errors: unknown[] }>;
  callAgentTool(
    name: string,
    input: unknown,
    ctx?: { threadId?: string; projectId?: string }
  ): Promise<unknown>;
  submitInteraction(value: unknown): void;
  cancelInteraction(): void;
  reload(factory: ZccPluginFactory): Promise<void>;
  dispose(): Promise<void>;
}

export interface FakePluginHost {
  zcc: ZccPluginApi;
  /** Alias of `zcc` for leftover BB-shaped plugin tests. */
  bb: ZccPluginApi;
  harness: FakePluginHarness;
}

export interface FakePluginHostOptions {
  pluginId?: string;
  agentSkillIds?: readonly string[];
  spawnThread?: (args: import('../server.js').PluginSdkThreadSpawnArgs) => Promise<{ id: string }>;
  getThread?: (args: { threadId: string }) => Promise<
    import('../server.js').PluginSdkThreadSummary | null
  >;
  listThreadEvents?: (args: {
    threadId: string;
    limit?: number;
    types?: readonly string[];
    order?: 'asc' | 'desc';
  }) => Promise<import('../server.js').PluginSdkThreadEventRow[]>;
  sendThread?: (args: import('../server.js').PluginSdkThreadSendArgs) => Promise<{ id: string }>;
  stopThread?: (args: { threadId: string }) => Promise<{ ok: true }>;
  threadOutput?: (args: { threadId: string }) => Promise<import('../server.js').PluginSdkThreadOutput>;
  defaultExecutionOptions?: (args: { threadId: string }) => Promise<
    import('../server.js').PluginSdkExecutionOptions
  >;
  getEnvironment?: (args: { environmentId: string }) => Promise<
    import('../server.js').PluginSdkEnvironment
  >;
  readWorkspaceFile?: (args: import('../server.js').PluginSdkFileReadArgs) => Promise<
    import('../server.js').PluginSdkFileReadResult
  >;
  listProviders?: (args?: { environmentId?: string }) => Promise<
    import('../server.js').PluginSdkProviderInfo[]
  >;
  loadProviderModels?: (args: { environmentId?: string; providerId: string }) => Promise<
    import('../server.js').PluginSdkModelCatalog
  >;
  archiveThread?: (args: { threadId: string }) => Promise<{ id: string }>;
  forkThread?: (args: {
    threadId: string;
    sourceSeqEnd?: number;
    visibility?: 'visible' | 'hidden';
    agentContextSeed?: unknown[];
    title?: string;
  }) => Promise<{ id: string }>;
  listThreads?: (args: {
    includeHidden?: boolean;
    originKind?: 'fork';
    originPluginId?: string;
    archived?: boolean;
    limit?: number;
    offset?: number;
  }) => Promise<import('../server.js').PluginSdkThreadSummary[]>;
  listQueuedMessages?: (args: { threadId: string }) => Promise<Array<{ id: string }>>;
  createQueuedMessage?: (args: {
    threadId: string;
    input: unknown[];
    senderThreadId?: string;
  }) => Promise<{ id: string }>;
  unarchiveThread?: (args: { threadId: string }) => Promise<{ id: string }>;
  getPluginMetadata?: (args: {
    threadId: string;
    pluginId?: string;
  }) => Promise<import('@zana-ai/zcc-domain/thread-runtime').JsonObject>;
  updatePluginMetadata?: (args: {
    threadId: string;
    pluginId?: string;
    set?: import('@zana-ai/zcc-domain/thread-runtime').JsonObject;
    remove?: readonly string[];
  }) => Promise<import('@zana-ai/zcc-domain/thread-runtime').JsonObject>;
  pushInbox?: (args: { projectId: string; comments: string }) => Promise<{ id: string }>;
  listProjects?: () =>
    | Array<{ id: string; name: string; path?: string }>
    | Promise<Array<{ id: string; name: string; path?: string }>>;
  database?: PluginDatabase;
  experimental_callHostRpc?: (call: {
    method: string;
    input: unknown;
    hostId: string;
    signal?: AbortSignal;
  }) => unknown | Promise<unknown>;
  /** Shared registry so two fake hosts can provide/use each other. */
  services?: PluginServicesRegistry;
}

export function createFakePluginHost(options?: FakePluginHostOptions): FakePluginHost {
  const pluginId = options?.pluginId ?? 'test';
  const kv = new Map<string, unknown>();
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const settings: Record<string, PluginSettingDescriptor> = {};
  let settingValues: Record<string, PluginSettingValue | undefined> = {};
  const settingListeners: Array<(next: Record<string, PluginSettingValue | undefined>) => void> = [];
  const published: Array<{ event: string; payload: unknown }> = [];
  const schedules: Array<{ name: string; cron: string; job: () => void | Promise<void> }> = [];
  const extraSkillRoots: string[] = [];
  const extraInstructions: string[] = [];
  const extraInstructionProviders: FakePluginHarness['extraInstructionProviders'] = [];
  const providers: FakePluginHarness['providers'] = [];
  const ptyHarnesses: FakePluginHarness['ptyHarnesses'] = [];
  const mentionProviders: FakePluginHarness['mentionProviders'] = [];
  const agentConfigurers: FakePluginHarness['agentConfigurers'] = [];
  const agentTools: import('../server.js').PluginAgentToolRecord[] = [];
  const httpRoutes: FakePluginHarness['httpRoutes'] = [];
  const events: FakePluginHarness['events'] = [];
  let cliRegistration: import('../server.js').PluginCliRegistration | null = null;
  const disposeHooks: Array<() => void | Promise<void>> = [];
  let needsConfiguration: string | null = null;
  let stale = false;
  let pendingInteraction:
    | { resolve: (result: PluginInteractionResult) => void }
    | null = null;

  const assertLive = (): void => {
    if (stale) throw new PluginContextStaleError(pluginId);
  };
  const sdkStubs = new Map<string, (...args: unknown[]) => unknown>();
  const sdkCalls: Array<{ path: string; args: unknown[] }> = [];
  function invokeSdk(path: string, fallback: (() => unknown) | undefined, ...args: unknown[]): unknown {
    sdkCalls.push({ path, args });
    const stub = sdkStubs.get(path);
    if (stub) return stub(...args);
    if (fallback) return fallback();
    throw new Error(`zcc.sdk.${path} is not stubbed`);
  }

  const servicesRegistry = options?.services ?? createPluginServicesRegistry();
  const services = bindPluginServices(pluginId, servicesRegistry, (hook) => {
    disposeHooks.push(hook);
  });

  const api: ZccPluginApi = {
    pluginId,
    log: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    },
    settings: {
      define(descriptors) {
        Object.assign(settings, descriptors);
        return {
          async get() {
            const next: Record<string, PluginSettingValue | undefined> = {};
            for (const [key, descriptor] of Object.entries(descriptors)) {
              next[key] = settingValues[key] ?? descriptor.default;
            }
            return next;
          },
          onChange(listener) {
            settingListeners.push(listener);
          }
        };
      }
    },
    storage: {
      kv: {
        async get<T>(key: string) {
          return kv.get(key) as T | undefined;
        },
        async set(key, value) {
          assertLive();
          kv.set(key, value);
        },
        async delete(key) {
          kv.delete(key);
        },
        async list(prefix) {
          return [...kv.keys()].filter((key) => (prefix ? key.startsWith(prefix) : true));
        }
      },
      database() {
        if (options?.database) return options.database;
        const rows = new Map<string, unknown[]>();
        return {
          runScript() {
            /* no-op in harness */
          },
          prepare(sql: string) {
            return {
              all: () => rows.get(sql) ?? [],
              get: () => (rows.get(sql) ?? [])[0],
              run: () => ({ changes: 0 })
            };
          },
          migrate() {
            /* no-op in harness */
          },
          transaction(fn) {
            return fn();
          }
        };
      }
    },
    http: {
      route(method, path, handler) {
        assertLive();
        httpRoutes.push({ method, path, handler });
      }
    },
    cli: {
      register(registration) {
        assertLive();
        if (cliRegistration) throw new Error('cli command is already registered');
        cliRegistration = registration;
      }
    },
    events: {
      on(name, handler) {
        events.push({ name, handler });
      }
    },
    sdk: {
      threads: {
        async spawn(args) {
          if (!options?.spawnThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.spawnThread(args);
        },
        async get(args) {
          return invokeSdk(
            'threads.get',
            options?.getThread ? () => options.getThread!(args) : undefined,
            args
          ) as Promise<import('../server.js').PluginSdkThreadSummary | null>;
        },
        events: {
          async list(args) {
            if (!options?.listThreadEvents) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            return options.listThreadEvents(args);
          }
        },
        async send(args) {
          if (!options?.sendThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.sendThread(args);
        },
        async stop(args) {
          if (!options?.stopThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.stopThread(args);
        },
        async output(args) {
          if (!options?.threadOutput) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.threadOutput(args);
        },
        async defaultExecutionOptions(args) {
          if (!options?.defaultExecutionOptions) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.defaultExecutionOptions(args);
        },
        async archive(args) {
          if (!options?.archiveThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.archiveThread(args);
        },
        async fork(args) {
          if (!options?.forkThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          const record = args as {
            sourceThreadId?: string;
            threadId?: string;
            sourceSeqEnd?: number;
            visibility?: 'visible' | 'hidden';
            agentContextSeed?: unknown[];
            title?: string;
          };
          const threadId = typeof record.sourceThreadId === 'string' && record.sourceThreadId.trim()
            ? record.sourceThreadId.trim()
            : record.threadId ?? '';
          return options.forkThread({
            threadId,
            ...(typeof record.sourceSeqEnd === 'number' ? { sourceSeqEnd: record.sourceSeqEnd } : {}),
            ...(record.visibility ? { visibility: record.visibility } : {}),
            ...(record.agentContextSeed ? { agentContextSeed: record.agentContextSeed } : {}),
            ...(record.title ? { title: record.title } : {})
          });
        },
        async list(args) {
          if (!options?.listThreads) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.listThreads(args ?? {});
        },
        queuedMessages: {
          async list(args) {
            if (!options?.listQueuedMessages) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            return options.listQueuedMessages(args);
          },
          async create(args) {
            if (!options?.createQueuedMessage) {
              throw new Error('zcc.sdk is not available in this runtime');
            }
            return options.createQueuedMessage(args);
          }
        },
        async unarchive(args) {
          if (!options?.unarchiveThread) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.unarchiveThread(args);
        },
        async getPluginMetadata(args) {
          if (!options?.getPluginMetadata) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.getPluginMetadata(args);
        },
        async updatePluginMetadata(args) {
          if (!options?.updatePluginMetadata) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.updatePluginMetadata(args);
        }
      },
      inbox: {
        async push(args) {
          if (!options?.pushInbox) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.pushInbox(args);
        }
      },
      projects: {
        async list() {
          if (!options?.listProjects) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.listProjects();
        }
      },
      environments: {
        async get(args) {
          if (!options?.getEnvironment) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.getEnvironment(args);
        }
      },
      files: {
        async read(args) {
          return invokeSdk(
            'files.read',
            options?.readWorkspaceFile ? () => options.readWorkspaceFile!(args) : undefined,
            args
          ) as Promise<import('../server.js').PluginSdkFileReadResult>;
        }
      },
      library: {
        async list(args) {
          return invokeSdk('library.list', undefined, args) as Promise<
            import('../server.js').PluginSdkLibraryDoc[]
          >;
        },
        async read(args) {
          return invokeSdk('library.read', undefined, args) as Promise<
            { ok: true; content: string } | { ok: false; message: string }
          >;
        },
        async write(args) {
          return invokeSdk('library.write', undefined, args) as Promise<
            { ok: true } | { ok: false; message: string }
          >;
        }
      },
      providers: {
        async list(args) {
          if (!options?.listProviders) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.listProviders(args);
        },
        async models(args) {
          if (!options?.loadProviderModels) {
            throw new Error('zcc.sdk is not available in this runtime');
          }
          return options.loadProviderModels(args);
        }
      },
      experimental_desktopBrowsers: {
        listInstances: (input) => invokeSdk('experimental_desktopBrowsers.listInstances', undefined, input),
        listTabs: (input) => invokeSdk('experimental_desktopBrowsers.listTabs', undefined, input),
        createTab: (input) => invokeSdk('experimental_desktopBrowsers.createTab', undefined, input),
        acquireControl: (input) => invokeSdk('experimental_desktopBrowsers.acquireControl', undefined, input),
        openConnection: (input) => invokeSdk('experimental_desktopBrowsers.openConnection', undefined, input),
        releaseControl: (input) => invokeSdk('experimental_desktopBrowsers.releaseControl', undefined, input),
        revealTab: (input) => invokeSdk('experimental_desktopBrowsers.revealTab', undefined, input),
        closeTab: (input) => invokeSdk('experimental_desktopBrowsers.closeTab', undefined, input),
        captureTab: (input) => invokeSdk('experimental_desktopBrowsers.captureTab', undefined, input),
        listImportSources: (input) => invokeSdk('experimental_desktopBrowsers.listImportSources', undefined, input),
        importCookies: (input) => invokeSdk('experimental_desktopBrowsers.importCookies', undefined, input),
        subscribe(input) {
          return invokeSdk('experimental_desktopBrowsers.subscribe', undefined, input) as { dispose(): void };
        }
      }
    },
    host: {
      async experimental_call(method, input) {
        if (!options?.experimental_callHostRpc) {
          throw new Error('zcc.host is not available in this runtime');
        }
        return options.experimental_callHostRpc({ method, input, hostId: 'test' });
      },
      experimental_client() {
        return {
          async call(method, input, callOptions) {
            if (!options?.experimental_callHostRpc) {
              throw new Error('zcc.host is not available in this runtime');
            }
            return options.experimental_callHostRpc({
              method,
              input,
              hostId: callOptions?.hostId ?? 'test',
              signal: callOptions?.signal
            });
          },
          experimental_onWorkerExit() {
            return () => undefined;
          }
        };
      }
    },
    rpc: {
      method(name, handler) {
        assertLive();
        if (!name.trim()) throw new Error('rpc method name is required');
        rpc.set(name, handler);
      },
      register(_contract, handlers) {
        assertLive();
        for (const [name, handler] of Object.entries(handlers)) {
          if (typeof handler === 'function') rpc.set(name, handler);
        }
      }
    },
    realtime: {
      publish(event, payload) {
        assertLive();
        published.push({ event, payload });
      }
    },
    background: {
      service(_name, start) {
        void Promise.resolve(start()).then((stop) => {
          if (typeof stop === 'function') disposeHooks.push(stop);
        });
      },
      schedule(cronOrName, jobOrCron, maybeJob?) {
        assertLive();
        const named = typeof jobOrCron === 'string';
        const cron = named ? jobOrCron : cronOrName;
        const job = named ? maybeJob : jobOrCron;
        if (typeof job === 'function') {
          schedules.push({
            name: named ? cronOrName : '',
            cron,
            job: job as () => void | Promise<void>
          });
        }
      }
    },
    agents: {
      contributeInstructions(textOrProvider) {
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
      contributeSkills(rootPaths) {
        extraSkillRoots.push(...rootPaths);
      },
      registerTool(registration) {
        const record = normalizeRegisteredAgentTool({
          pluginId,
          tool: registration
        });
        if (agentTools.some((existing) => existing.name === record.name)) {
          throw new Error(`tool "${record.name}" is already registered`);
        }
        agentTools.push(record);
      },
      experimental_registerProvider: (declaration) => {
        assertLive();
        providers.push(declaration);
        return {
          id: declaration.id,
          unregister() {
            const index = providers.indexOf(declaration);
            if (index >= 0) providers.splice(index, 1);
          }
        };
      },
      experimental_registerPtyHarness: (declaration) => {
        assertLive();
        ptyHarnesses.push(declaration);
        return {
          id: declaration.id,
          unregister() {
            const index = ptyHarnesses.indexOf(declaration);
            if (index >= 0) ptyHarnesses.splice(index, 1);
          }
        };
      },
      configure(provider) {
        agentConfigurers.push(provider);
      }
    },
    ui: {
      requestInput(_request: PluginInteractionRequest) {
        assertLive();
        return new Promise<PluginInteractionResult>((resolve) => {
          pendingInteraction = { resolve };
        });
      },
      registerMentionProvider(registration) {
        assertLive();
        mentionProviders.push(registration);
      }
    },
    status: {
      needsConfiguration(message) {
        needsConfiguration = message;
      }
    },
    services,
    onDispose(hook) {
      disposeHooks.push(hook);
    }
  };

  const harness: FakePluginHarness = {
    rpc,
    settings,
    kv,
    published,
    schedules,
    extraSkillRoots,
    extraInstructions,
    extraInstructionProviders,
    providers,
    ptyHarnesses,
    get registrations() {
      return { providerRegistrations: providers, agentTools };
    },
    mentionProviders,
    agentConfigurers,
    get cli() {
      return cliRegistration;
    },
    agentTools,
    httpRoutes,
    events,
    sdk: {
      stub(path, implementation) {
        sdkStubs.set(path, implementation as (...args: unknown[]) => unknown);
      },
      callsTo(path) {
        return sdkCalls.filter((call) => call.path === path).map((call) => call.args);
      }
    },
    get behavior() {
      return this;
    },
    get lifecycle() {
      return this;
    },
    get needsConfiguration() {
      return needsConfiguration;
    },
    setSettings(values) {
      for (const [key, value] of Object.entries(values)) {
        const descriptor = settings[key];
        if (!descriptor) throw new Error(`unknown setting ${key}`);
        if (descriptor.type === 'boolean' && value !== undefined && typeof value !== 'boolean') {
          throw new Error(`setting ${key} expected boolean`);
        }
        if (descriptor.type === 'number' && value !== undefined && typeof value !== 'number') {
          throw new Error(`setting ${key} expected number`);
        }
        if (descriptor.type !== 'boolean' && descriptor.type !== 'number' && value !== undefined && typeof value !== 'string') {
          throw new Error(`setting ${key} expected string`);
        }
      }
      settingValues = { ...settingValues, ...values };
      for (const listener of settingListeners) listener(settingValues);
    },
    async callRpc(name, args) {
      const handler = rpc.get(name);
      if (!handler) throw new Error(`unknown rpc ${name}`);
      return handler(args);
    },
    async emitThreadEvent(name, payload) {
      const thread = payload.thread;
      const event: import('../server.js').PluginThreadEvent = {
        name,
        threadId: thread?.id ?? '',
        ...(thread?.projectId ? { projectId: thread.projectId } : {}),
        ...(thread ? { thread } : {}),
        ...(payload.lastAssistantText !== undefined ? { lastAssistantText: payload.lastAssistantText } : {}),
        ...(payload.error !== undefined ? { error: payload.error } : {})
      };
      const errors: unknown[] = [];
      for (const record of events) {
        if (record.name !== name) continue;
        try {
          await record.handler(event);
        } catch (error) {
          errors.push(error);
        }
      }
      return { errors };
    },
    async runSchedule(name) {
      const jobs = typeof name === 'string'
        ? schedules.filter((row) => row.name === name)
        : schedules;
      if (typeof name === 'string' && jobs.length === 0) {
        throw new Error(`unknown schedule ${name}`);
      }
      for (const row of jobs) await row.job();
    },
    async runCli(argv, context) {
      if (!cliRegistration) throw new Error('no cli command registered');
      return enforcePluginCliOutputLimit(
        await cliRegistration.run(argv, {
          pluginId,
          argv,
          signal: new AbortController().signal,
          ...(context?.projectId ? { projectId: context.projectId } : {}),
          ...(context?.threadId ? { threadId: context.threadId } : {}),
          ...(context?.cwd ? { cwd: context.cwd } : {})
        })
      );
    },
    async callAgentTool(name, input, ctx) {
      const tool = agentTools.find((row) => row.name === name);
      if (!tool) throw new Error(`unknown agent tool ${name}`);
      const parsed = tool.parse(input);
      if (!parsed.ok) throw new Error(parsed.error);
      return tool.execute(parsed.value, {
        threadId: ctx?.threadId ?? 'thread-1',
        projectId: ctx?.projectId ?? 'project-1',
        signal: new AbortController().signal
      });
    },
    submitInteraction(value) {
      pendingInteraction?.resolve({ outcome: 'submitted', value: value as PluginInteractionResult extends { value: infer V } ? V : never } as PluginInteractionResult);
      pendingInteraction = null;
    },
    cancelInteraction() {
      pendingInteraction?.resolve({ outcome: 'cancelled', reason: 'user' });
      pendingInteraction = null;
    },
    async reload(factory) {
      try {
        await factory(api);
      } catch {
        /* keep current host */
      }
    },
    async dispose() {
      stale = true;
      for (const hook of [...disposeHooks].reverse()) {
        try {
          await hook();
        } catch {
          /* isolated */
        }
      }
    }
  };

  return { zcc: api, bb: api, harness };
}
