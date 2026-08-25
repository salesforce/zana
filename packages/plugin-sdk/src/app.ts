import type { PluginAppDefinition, PluginAppSetup } from './app-contract.js';
import type { PluginSettingValue, PluginSettingsSnapshot } from './server.js';

export interface PluginHostBridge {
  callRpc(pluginId: string, method: string, args?: unknown): Promise<unknown>;
  getSettings(pluginId: string): Promise<PluginSettingsSnapshot>;
  setSettings(
    pluginId: string,
    values: Record<string, PluginSettingValue | undefined>
  ): Promise<void>;
}

function pluginHost(): PluginHostBridge {
  const host = (globalThis as { __ZCC_PLUGIN_HOST__?: PluginHostBridge }).__ZCC_PLUGIN_HOST__;
  if (!host) throw new Error('plugin host is not available');
  return host;
}

/** Call a server `zcc.rpc.method` from a plugin app bundle. */
export async function callPluginRpc(pluginId: string, method: string, args?: unknown): Promise<unknown> {
  return pluginHost().callRpc(pluginId, method, args);
}

export async function getPluginSettings(pluginId: string): Promise<PluginSettingsSnapshot> {
  return pluginHost().getSettings(pluginId);
}

export async function setPluginSettings(
  pluginId: string,
  values: Record<string, PluginSettingValue | undefined>
): Promise<void> {
  return pluginHost().setSettings(pluginId, values);
}

export function definePluginApp(setup: PluginAppSetup): PluginAppDefinition {
  return { __zccPluginApp: true, setup };
}

export function isPluginAppDefinition(value: unknown): value is PluginAppDefinition {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as PluginAppDefinition).__zccPluginApp === true &&
    typeof (value as PluginAppDefinition).setup === 'function'
  );
}
