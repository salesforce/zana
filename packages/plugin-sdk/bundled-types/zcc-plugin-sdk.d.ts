/**
 * Public plugin SDK types vendored for authors who cannot resolve unpublished
 * workspace packages. `zcc plugin types` copies a host-stamped variant of this
 * contract into a plugin's `types/` dir.
 */

declare module '@zana-ai/zcc-plugin-sdk' {
  export const PLUGIN_SDK_VERSION: string;
  export const PLUGIN_SDK_API_MAJOR: number;
  export function definePluginApp(
    setup: (app: { slots: Record<string, (registration: Record<string, unknown>) => void> }) => void
  ): unknown;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
}

declare module '@zana-ai/zcc-plugin-sdk/server' {
  export interface PluginSettingsSnapshot {
    descriptors: Record<string, { type: string; label: string; default?: string | boolean }>;
    values: Record<string, string | boolean | undefined>;
  }
  export interface ZccPluginApi {
    readonly pluginId: string;
    readonly log: { debug(m: string): void; info(m: string): void; warn(m: string): void; error(m: string): void };
    readonly settings: {
      define(descriptors: Record<string, { type: string; label: string; default?: string | boolean }>): {
        get(): Promise<Record<string, string | boolean | undefined>>;
        onChange(listener: (next: Record<string, string | boolean | undefined>) => void): void;
      };
    };
    readonly storage: {
      kv: {
        get<T>(key: string): Promise<T | undefined>;
        set(key: string, value: unknown): Promise<void>;
        delete(key: string): Promise<void>;
        list(prefix?: string): Promise<string[]>;
      };
    };
    readonly rpc: { method(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void };
    readonly realtime: { publish(event: string, payload: unknown): void };
    readonly background: {
      service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
      schedule(cron: string, job: () => void | Promise<void>): void;
    };
    readonly agents: {
      contributeInstructions(text: string): void;
      contributeSkills(rootPaths: string[]): void;
    };
    readonly ui: {
      requestInput(request: { threadId: string; rendererId: string; title: string; payload: unknown }): Promise<unknown>;
    };
    readonly status: { needsConfiguration(message: string): void };
    onDispose(hook: () => void | Promise<void>): void;
  }
}

declare module '@zana-ai/zcc-plugin-sdk/app' {
  export function definePluginApp(
    setup: (app: { slots: Record<string, (registration: Record<string, unknown>) => void> }) => void
  ): unknown;
  export function isPluginAppDefinition(value: unknown): boolean;
  export function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  export function getPluginSettings(pluginId: string): Promise<{
    descriptors: Record<string, { type: string; label: string }>;
    values: Record<string, string | boolean | undefined>;
  }>;
  export function setPluginSettings(
    pluginId: string,
    values: Record<string, string | boolean | undefined>
  ): Promise<void>;
}

declare module '@zana-ai/zcc-plugin-sdk/testing' {
  export function createFakePluginHost(options?: { pluginId?: string }): {
    zcc: import('@zana-ai/zcc-plugin-sdk/server').ZccPluginApi;
    harness: {
      callRpc(name: string, args?: unknown): Promise<unknown>;
      setSettings(values: Record<string, string | boolean | undefined>): void;
      dispose(): Promise<void>;
    };
  };
}

declare module '@zana-ai/zcc-plugin-sdk/testing/app' {
  export function collectTestPluginApp(
    definition: unknown,
    pluginId?: string,
    generation?: number
  ): {
    pluginId: string;
    generation: number;
    navPanels: Array<{ id: string; title: string }>;
  };
}
