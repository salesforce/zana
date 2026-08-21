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
    name: 'slack',
    pluginId: 'slack',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Agent interaction'
  },
  {
    name: 'docs',
    pluginId: 'docs',
    autoInstall: true,
    defaultEnabled: true,
    category: 'Context & knowledge'
  }
];

/** Bundled but store-only until `zcc plugin install <name>`. */
export const OFFICIAL_PLUGINS: BundledPluginDefinition[] = [
  {
    name: 'zana',
    pluginId: 'zana',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Workflow management'
  },
  {
    name: 'zana-hub',
    pluginId: 'zana-hub',
    autoInstall: false,
    defaultEnabled: true,
    category: 'Workflow management'
  }
];

export function bundledPluginByName(name: string): BundledPluginDefinition | undefined {
  return [...BUILTIN_PLUGINS, ...OFFICIAL_PLUGINS].find((plugin) => plugin.name === name);
}
