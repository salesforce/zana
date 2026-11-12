import type {
  PluginProviderOptionsContext,
  PluginSettingValue
} from '@zana-ai/zcc-plugin-sdk/server';
import { getThreadProvider } from './thread-provider-catalog.js';
import { providerSkillAllowlist } from './persona-skill-selection.js';

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
  /** Main-authorized selection (squad metadata); both absent = unrestricted. */
  skillSelection?: {
    automatedSkillIds?: readonly string[];
    allowedSkillNames?: readonly string[];
    /** Persona MCP allowlist (includes `zcc-inbox`); absent = unrestricted. */
    mcpAllowlist?: readonly string[];
  };
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

export async function derivedProviderOptionsForCommand(
  args: DerivedProviderOptionsArgs
): Promise<Record<string, unknown> | undefined> {
  const provider = getThreadProvider(args.providerId);
  const skillAllowlist = providerSkillAllowlist(
    args.skillSelection?.automatedSkillIds, args.skillSelection?.allowedSkillNames
  );
  const mcpAllowlist = args.skillSelection?.mcpAllowlist;
  const withSkills = (options: Record<string, unknown> | undefined): Record<string, unknown> | undefined =>
    skillAllowlist === undefined && mcpAllowlist === undefined
      ? options
      : {
          ...options,
          ...(skillAllowlist === undefined ? {} : { skillAllowlist }),
          ...(mcpAllowlist === undefined ? {} : { mcpAllowlist: [...mcpAllowlist] })
        };
  if (!provider?.deriveProviderOptions) return withSkills(undefined);
  const context: PluginProviderOptionsContext = {
    threadId: args.threadId,
    projectId: args.projectId,
    permissionMode: args.permissionMode,
    settings: args.plugins ? settingsWithoutSecrets(provider.pluginId, args.plugins) : {},
    ...(args.model ? { model: args.model } : {}),
    ...(args.promptMode ? { promptMode: args.promptMode } : {})
  };
  // A synchronous plugin hook still crosses an asynchronous worker transport.
  const derived = await provider.deriveProviderOptions(context);
  if (!derived || typeof derived !== 'object' || Array.isArray(derived)) return withSkills(undefined);
  return withSkills(derived);
}
