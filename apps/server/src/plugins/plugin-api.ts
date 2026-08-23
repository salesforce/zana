import { pathToFileURL } from 'node:url';
import { existsSync, realpathSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { ZccPluginApi, ZccPluginFactory } from '@zana-ai/zcc-plugin-sdk/server';
import { registerThreadProvider } from '../services/threads/thread-provider-catalog.js';

export const HOST_ZCC_VERSION = '1.0.10';
export const HOST_PLUGIN_SDK_VERSION = '0.1.0';
export const FACTORY_TIMEOUT_MS = 10_000;

export type PluginRuntimeStatus =
  | 'running'
  | 'disabled'
  | 'degraded'
  | 'needs-configuration';

export interface PluginHandle {
  api: ZccPluginApi;
  dispose(): Promise<void>;
}

export function createPluginApi(pluginId: string, kvDir: string): PluginHandle {
  const disposeHooks: Array<() => void | Promise<void>> = [];
  const kv = new Map<string, unknown>();
  let stale = false;
  const assertLive = (): void => {
    if (stale) throw new Error(`plugin context is stale: ${pluginId}`);
  };
  const rpc = new Map<string, (args: unknown) => unknown | Promise<unknown>>();
  const api: ZccPluginApi = {
    pluginId,
    log: {
      debug: (message) => console.debug(`[plugin:${pluginId}] ${message}`),
      info: (message) => console.info(`[plugin:${pluginId}] ${message}`),
      warn: (message) => console.warn(`[plugin:${pluginId}] ${message}`),
      error: (message) => console.error(`[plugin:${pluginId}] ${message}`)
    },
    settings: {
      define: () => ({
        get: async () => ({}),
        onChange: () => undefined
      })
    },
    storage: {
      kv: {
        get: async <T>(key: string) => kv.get(key) as T | undefined,
        set: async (key, value) => {
          assertLive();
          kv.set(key, value);
        },
        delete: async (key) => {
          kv.delete(key);
        },
        list: async (prefix) =>
          [...kv.keys()].filter((key) => (prefix ? key.startsWith(prefix) : true))
      }
    },
    rpc: {
      method: (name, handler) => {
        assertLive();
        rpc.set(name, handler);
      }
    },
    realtime: {
      publish: () => {
        assertLive();
      }
    },
    background: {
      service: (_name, start) => {
        void Promise.resolve(start()).then((stop) => {
          if (typeof stop === 'function') disposeHooks.push(stop);
        });
      },
      schedule: () => undefined
    },
    agents: {
      contributeInstructions: () => undefined,
      contributeSkills: () => undefined,
      experimental_registerProvider: (declaration) => {
        assertLive();
        return registerThreadProvider(pluginId, declaration);
      }
    },
    ui: {
      requestInput: async () => {
        throw new Error('ui.requestInput is not available in this runtime');
      }
    },
    status: {
      needsConfiguration: () => undefined
    },
    onDispose: (hook) => {
      disposeHooks.push(hook);
    }
  };
  void kvDir;
  return {
    api,
    async dispose() {
      stale = true;
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

function isMainModuleExport(value: unknown): value is { setup: (ctx: unknown) => unknown } {
  return typeof value === 'object' && value !== null && typeof (value as { setup?: unknown }).setup === 'function';
}

export async function importServerFactory(entryPath: string): Promise<ZccPluginFactory> {
  const href = pathToFileURL(entryPath).href;
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
