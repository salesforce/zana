export interface BundledPluginDefinition {
  name: string;
  pluginId: string;
  autoInstall: boolean;
  defaultEnabled: boolean;
  category?: string;
}

export const PLUGIN_CATALOG_CATEGORIES = [
  'Workflow management',
  'Agent interaction',
  'Context & knowledge',
  'Developer tools',
  'Host access',
  'Interface'
] as const;

/** Auto-reconciled on startup. */
export const BUILTIN_PLUGINS: BundledPluginDefinition[] = [
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
    name: 'custom-instructions',
    pluginId: 'custom-instructions',
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
  }
];

/** Bundled but store-only until `zcc plugin install <name>`. */
export const OFFICIAL_PLUGINS: BundledPluginDefinition[] = [
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
    name: 'memory',
    pluginId: 'memory',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Context & knowledge'
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
  }
];

export function bundledPluginByName(name: string): BundledPluginDefinition | undefined {
  return [...BUILTIN_PLUGINS, ...OFFICIAL_PLUGINS].find((plugin) => plugin.name === name);
}
