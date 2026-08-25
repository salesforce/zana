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
      }
    },
    rpc: {
      method(name, handler) {
        assertLive();
        if (!name.trim()) throw new Error('rpc method name is required');
        rpc.set(name, handler);
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
      schedule(cron, job) {
        assertLive();
        schedules.push({ cron, job });
      }
    },
    agents: {
      contributeInstructions(text) {
        extraInstructions.push(text);
      },
      contributeSkills(rootPaths) {
        extraSkillRoots.push(...rootPaths);
      },
      experimental_registerProvider: () => ({
        id: 'fake',
        unregister() {
          /* no-op in the harness */
        }
      })
    },
    ui: {
      requestInput(_request: PluginInteractionRequest) {
        assertLive();
        return new Promise<PluginInteractionResult>((resolve) => {
          pendingInteraction = { resolve };
        });
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
