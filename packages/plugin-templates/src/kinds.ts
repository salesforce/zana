export const PLUGIN_STARTER_KINDS = ['panel', 'main-panel', 'mcp-consumer', 'agent-preset'] as const;

export type PluginStarterKind = (typeof PLUGIN_STARTER_KINDS)[number];

export const VALID_PLUGIN_STARTER_KINDS: ReadonlySet<PluginStarterKind> = new Set(PLUGIN_STARTER_KINDS);

export function clampPluginStarterKind(kind: unknown): PluginStarterKind {
  return typeof kind === 'string' && VALID_PLUGIN_STARTER_KINDS.has(kind as PluginStarterKind)
    ? (kind as PluginStarterKind)
    : 'panel';
}

export function pluginPackageName(id: string): string {
  return id.startsWith('zcc-plugin-') ? id : `zcc-plugin-${id}`;
}
