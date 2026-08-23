/**
 * Server-side plugin API — the `zcc` object handed to a plugin's server factory:
 * `export default function plugin(zcc: ZccPluginApi)`.
 *
 * Types only. The host implements this in `apps/server` PluginService.
 * Plugins are full-trust in the server process after install; they never
 * receive host-daemon tokens or signing keys.
 */

export interface PluginLogger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export type PluginSettingDescriptor =
  | {
      type: 'string';
      label: string;
      description?: string;
      secret?: true;
      default?: string;
    }
  | { type: 'boolean'; label: string; description?: string; default?: boolean }
  | {
      type: 'select';
      label: string;
      description?: string;
      options: string[];
      default?: string;
    }
  | { type: 'project'; label: string; description?: string; default?: string };

export type PluginSettingValue = string | boolean;

export interface PluginSettingsHandle {
  get(): Promise<Record<string, PluginSettingValue | undefined>>;
  onChange(listener: (next: Record<string, PluginSettingValue | undefined>) => void): void;
}

export interface PluginSettings {
  define(descriptors: Record<string, PluginSettingDescriptor>): PluginSettingsHandle;
}

export interface PluginKvStorage {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface PluginStorage {
  kv: PluginKvStorage;
}

export interface PluginRpc {
  method(name: string, handler: (args: unknown) => unknown | Promise<unknown>): void;
}

export interface PluginRealtime {
  publish(event: string, payload: unknown): void;
}

export interface PluginBackground {
  service(name: string, start: () => void | (() => void) | Promise<void | (() => void)>): void;
  schedule(cron: string, job: () => void | Promise<void>): void;
}

export interface PluginProviderCapabilities {
  supportsServiceTier: boolean;
  supportsNativeUserQuestion?: boolean;
  fork: string;
  supportsManualCompaction?: boolean;
  supportsThreadArchive: boolean;
  supportsThreadRename: boolean;
  supportsWorkflows?: boolean;
  permissionModes: string[];
  reasoningLevels?: string[];
}

export interface PluginProviderDeclaration {
  id: string;
  displayName: string;
  icon?: string;
  capabilities: PluginProviderCapabilities;
  composerActions?: string[];
}

export interface PluginProviderHandle {
  id: string;
  unregister(): void;
}

export interface PluginAgents {
  contributeInstructions(text: string): void;
  contributeSkills(rootPaths: string[]): void;
  experimental_registerProvider(declaration: PluginProviderDeclaration): PluginProviderHandle;
}

export interface PluginUi {
  requestInput(rendererId: string, payload: unknown): Promise<unknown>;
}

export interface PluginStatusApi {
  needsConfiguration(message: string): void;
}

export interface ZccPluginApi {
  readonly pluginId: string;
  readonly log: PluginLogger;
  readonly settings: PluginSettings;
  readonly storage: PluginStorage;
  readonly rpc: PluginRpc;
  readonly realtime: PluginRealtime;
  readonly background: PluginBackground;
  readonly agents: PluginAgents;
  readonly ui: PluginUi;
  readonly status: PluginStatusApi;
  onDispose(hook: () => void | Promise<void>): void;
}

export type ZccPluginFactory = (zcc: ZccPluginApi) => void | Promise<void>;
