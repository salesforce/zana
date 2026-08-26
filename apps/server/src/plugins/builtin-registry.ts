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
  }
];

export function bundledPluginByName(name: string): BundledPluginDefinition | undefined {
  return [...BUILTIN_PLUGINS, ...OFFICIAL_PLUGINS].find((plugin) => plugin.name === name);
}
