import { PLUGIN_STORE_CATEGORY_NAMES } from '@zana-ai/zcc-domain';

export interface BundledPluginDefinition {
  name: string;
  pluginId: string;
  autoInstall: boolean;
  defaultEnabled: boolean;
  category?: string;
}

export const PLUGIN_CATALOG_CATEGORIES = PLUGIN_STORE_CATEGORY_NAMES;

/** Auto-reconciled on startup. */
export const BUILTIN_PLUGINS: BundledPluginDefinition[] = [
  { name: 'thread-list', pluginId: 'thread-list', autoInstall: true, defaultEnabled: true, category: 'Agent interaction' },
  {
    name: 'docs',
    pluginId: 'docs',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Context & knowledge'
  },
  {
    name: 'provider-claude-code',
    pluginId: 'provider-claude-code',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'provider-codex',
    pluginId: 'provider-codex',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'provider-pi',
    pluginId: 'provider-pi',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'provider-acp',
    pluginId: 'provider-acp',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-claude',
    pluginId: 'harness-claude',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-cursor',
    pluginId: 'harness-cursor',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-codex',
    pluginId: 'harness-codex',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-opencode',
    pluginId: 'harness-opencode',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-pi',
    pluginId: 'harness-pi',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-grok',
    pluginId: 'harness-grok',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'harness-mastracode',
    pluginId: 'harness-mastracode',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'custom-instructions',
    pluginId: 'custom-instructions',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Context & knowledge'
  },
  {
    name: 'memory',
    pluginId: 'memory',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Context & knowledge'
  },
  {
    name: 'ask-user-question',
    pluginId: 'ask-user-question',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'plugin-guide',
    pluginId: 'plugin-guide',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Developer tools'
  },
  {
    name: 'posthog-analytics',
    pluginId: 'posthog-analytics',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Host access'
  }
];

/** Bundled but store-only until `zcc plugin install <name>`. */
export const OFFICIAL_PLUGINS: BundledPluginDefinition[] = [
  {
    name: 'provider-afcode',
    pluginId: 'provider-afcode',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'tasks',
    pluginId: 'tasks',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Workflow management'
  },
  {
    name: 'github',
    pluginId: 'github',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Developer tools'
  },
  {
    name: 'pr-monitor',
    pluginId: 'pr-monitor',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Developer tools'
  },
  {
    name: 'salesforce',
    pluginId: 'salesforce',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Developer tools'
  },
  {
    name: 'automations',
    pluginId: 'automations',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Workflow management'
  },
  {
    name: 'workflows',
    pluginId: 'workflows',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Workflow management'
  },
  {
    name: 'side-chat',
    pluginId: 'side-chat',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'inline-vis',
    pluginId: 'inline-vis',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Interface'
  },
  {
    name: 'provider-retry',
    pluginId: 'provider-retry',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'monaco-editor',
    pluginId: 'monaco-editor',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Interface'
  },
  {
    name: 'pdf-preview',
    pluginId: 'pdf-preview',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Interface'
  },
  {
    name: 'keep-awake',
    pluginId: 'keep-awake',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Host access'
  },
  {
    name: 'secrets',
    pluginId: 'secrets',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Host access'
  },
  {
    name: 'connect',
    pluginId: 'connect',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Host access'
  },
  {
    name: 'browser-automation',
    pluginId: 'browser-automation',
    autoInstall: false,
    defaultEnabled: false,
    category: 'Host access'
  }
];

export const BUNDLED_PLUGINS: readonly BundledPluginDefinition[] = [
  ...BUILTIN_PLUGINS,
  ...OFFICIAL_PLUGINS
];

export function bundledPluginByName(name: string): BundledPluginDefinition | undefined {
  return BUNDLED_PLUGINS.find((plugin) => plugin.name === name);
}

/**
 * First-party plugins we used to seed into `~/.zcc/extensions` / PluginService
 * and no longer ship. Start() uninstalls them so leftover hub rows cannot
 * come back. Local-authored working dirs (local.json) are left alone.
 */
export const RETIRED_FIRST_PARTY_PLUGIN_IDS = [
  'browsercode',
  'consensus',
  'slack',
  'zana',
  'zana-hub'
] as const;

/**
 * Experimental installs later promoted to autoInstall builtins. Forget a leftover
 * uninstall tombstone once so the builtin can land; a later user uninstall sticks.
 */
export const RECLAIM_UNINSTALLED_AUTOINSTALL_IDS = [
  'memory',
  'provider-claude-code',
  'provider-codex'
] as const;

export function isRetiredFirstPartyPluginId(id: string): boolean {
  return (RETIRED_FIRST_PARTY_PLUGIN_IDS as readonly string[]).includes(id);
}
