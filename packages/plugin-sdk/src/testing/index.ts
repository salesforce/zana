import type {
  PluginInteractionRequest,
  PluginInteractionResult,
  PluginSettingDescriptor,
  PluginSettingValue,
  ZccPluginApi,
  ZccPluginFactory
} from '../server.js';

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
  schedules: Array<{ cron: string; job: () => void | Promise<void> }>;
  extraSkillRoots: string[];
  extraInstructions: string[];
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
  agentTools: import('../server.js').PluginAgentToolRegistration[];
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
  needsConfiguration: string | null;
  setSettings(values: Record<string, PluginSettingValue | undefined>): void;
  callRpc(name: string, args?: unknown): Promise<unknown>;
  submitInteraction(value: unknown): void;
  cancelInteraction(): void;
  reload(factory: ZccPluginFactory): Promise<void>;
  dispose(): Promise<void>;
}

export interface FakePluginHost {
  zcc: ZccPluginApi;
  harness: FakePluginHarness;
}

export function createFakePluginHost(options?: { pluginId?: string }): FakePluginHost {
  const pluginId = options?.pluginId ?? 'test';
  const kv = new Map<string, unknown>();
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const settings: Record<string, PluginSettingDescriptor> = {};
  let settingValues: Record<string, PluginSettingValue | undefined> = {};
  const settingListeners: Array<(next: Record<string, PluginSettingValue | undefined>) => void> = [];
  const published: Array<{ event: string; payload: unknown }> = [];
  const schedules: Array<{ cron: string; job: () => void | Promise<void> }> = [];
  const extraSkillRoots: string[] = [];
  const extraInstructions: string[] = [];
  const mentionProviders: FakePluginHarness['mentionProviders'] = [];
  const agentConfigurers: FakePluginHarness['agentConfigurers'] = [];
  const agentTools: import('../server.js').PluginAgentToolRegistration[] = [];
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
        async spawn() {
          throw new Error('zcc.sdk is not available in this runtime');
        }
      }
    },
    host: {
      async experimental_call() {
        throw new Error('zcc.host is not available in this runtime');
      },
      experimental_client() {
        return {
          async call() {
            throw new Error('zcc.host is not available in this runtime');
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
        if (typeof job === 'function') schedules.push({ cron, job });
      }
    },
    agents: {
      contributeInstructions(text) {
        extraInstructions.length = 0;
        const trimmed = typeof text === 'string' ? text.trim() : '';
        if (trimmed) extraInstructions.push(trimmed);
      },
      contributeSkills(rootPaths) {
        extraSkillRoots.push(...rootPaths);
      },
      registerTool(registration) {
        agentTools.push(registration);
      },
      experimental_registerProvider: () => ({
        id: 'fake',
        unregister() {
          /* no-op in the harness */
        }
      }),
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
    mentionProviders,
    agentConfigurers,
    get cli() {
      return cliRegistration;
    },
    agentTools,
    httpRoutes,
    events,
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
        if (descriptor.type !== 'boolean' && value !== undefined && typeof value !== 'string') {
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

  return { zcc: api, harness };
}
