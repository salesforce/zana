import type {
  PluginProviderOptionsContext,
  PluginSettingValue
} from '@zana-ai/zcc-plugin-sdk/server';
import { getThreadProvider } from './thread-provider-catalog.js';

export interface PluginSettingsReader {
  getSettings(pluginId: string): {
    descriptors: Record<string, { secret?: true } | undefined | { type?: string; secret?: true }>;
    values: Record<string, PluginSettingValue | undefined>;
  };
}

export interface DerivedProviderOptionsArgs {
  providerId: string;
  threadId: string;
  projectId: string;
  model?: string;
  permissionMode: string;
  promptMode?: 'plan';
  plugins?: PluginSettingsReader;
}

function settingsWithoutSecrets(
  pluginId: string,
  plugins: PluginSettingsReader
): Record<string, PluginSettingValue | undefined> {
  const snapshot = plugins.getSettings(pluginId);
  const next: Record<string, PluginSettingValue | undefined> = {};
  for (const [key, value] of Object.entries(snapshot.values)) {
    if (snapshot.descriptors[key]?.secret === true) continue;
    next[key] = value;
  }
  return next;
}

export function derivedProviderOptionsForCommand(
  args: DerivedProviderOptionsArgs
): Record<string, unknown> | undefined {
  const provider = getThreadProvider(args.providerId);
  if (!provider?.deriveProviderOptions) return undefined;
  const context: PluginProviderOptionsContext = {
    threadId: args.threadId,
    projectId: args.projectId,
    permissionMode: args.permissionMode,
    settings: args.plugins ? settingsWithoutSecrets(provider.pluginId, args.plugins) : {},
    ...(args.model ? { model: args.model } : {}),
    ...(args.promptMode ? { promptMode: args.promptMode } : {})
  };
  const derived = provider.deriveProviderOptions(context);
  if (!derived || typeof derived !== 'object' || Array.isArray(derived)) return undefined;
  return derived;
}
