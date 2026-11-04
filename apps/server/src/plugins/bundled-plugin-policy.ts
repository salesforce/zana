import { parsePluginSource, type PluginManifest } from '@zana-ai/zcc-domain';
import { BUNDLED_PLUGINS, EXTERNALIZED_PLUGINS, bundledPluginByName } from './builtin-registry.js';
import type { InstalledPluginRow, PluginSourceKind } from './plugin-store.js';

export function bundledPluginById(id: string) {
  return BUNDLED_PLUGINS.find(plugin => plugin.pluginId === id);
}

export function assertBundledPluginInstall(args: {
  id: string;
  sourceKind: PluginSourceKind;
  source: string;
  development: boolean;
}): void {
  const external = EXTERNALIZED_PLUGINS.find(plugin => plugin.pluginId === args.id);
  if (external) {
    if (args.sourceKind === 'path' || (args.sourceKind === 'builtin' && args.source === `builtin:${external.name}`)) return;
    if (args.sourceKind === 'git') {
      const parsed = parsePluginSource(args.source);
      if (parsed.kind === 'git' && parsed.url.replace(/\.git$/, '') === external.url.replace(/\.git$/, '')) return;
    }
    throw new Error(`Plugin id "${args.id}" is reserved for its independent repository: ${external.url}`);
  }
  if (args.sourceKind === 'builtin') {
    const definition = bundledPluginByName(args.source.slice('builtin:'.length));
    if (!definition || definition.pluginId !== args.id) {
      throw new Error(`bundled plugin identity mismatch: ${args.source} declares ${args.id}`);
    }
    return;
  }
  const definition = bundledPluginById(args.id);
  if (!definition) return;
  if (args.sourceKind === 'path' && args.development) return;
  throw new Error(
    `Plugin id "${args.id}" is reserved by a bundled plugin. Install "builtin:${definition.name}"; ` +
    'official plugins update with Zana releases. Local development requires Bundled plugin development in Settings > Development, or ZCC_MANAGED_DEV_BUILTIN_PLUGIN_HOT_RELOAD=1 on the host.'
  );
}

/** Keep pre-policy installations usable until their data can be migrated deliberately. */
export function bundledPluginSourceNotice(
  row: Pick<InstalledPluginRow, 'id' | 'sourceKind'>,
  development: boolean
): string | null {
  if (row.sourceKind === 'builtin' || (row.sourceKind === 'path' && development)) return null;
  const definition = bundledPluginById(row.id);
  if (!definition) return null;
  return `This independent installation uses bundled plugin id "${row.id}". Its current code and data are retained, ` +
    `but remote updates are blocked. Back up and migrate its data before switching to "builtin:${definition.name}", ` +
    'or use a different id for a fork. Bundled plugins update with Zana releases.';
}

export function reconcileBundledPluginMetadata(
  row: InstalledPluginRow,
  rootDir: string,
  manifest: PluginManifest,
  timestamp: number
): InstalledPluginRow {
  assertBundledPluginInstall({ id: manifest.id, sourceKind: 'builtin', source: row.source, development: false });
  if (manifest.id !== row.id) throw new Error(`bundled plugin identity changed: expected ${row.id}, received ${manifest.id}`);
  const patch = {
    bundledRecoveryVersion: undefined,
    rootDir,
    version: manifest.version,
    name: manifest.name,
    description: manifest.description,
    icon: manifest.branding.icon ?? 'Puzzle',
    serverEntry: manifest.serverEntry,
    appEntry: manifest.appEntry,
    npmResolvedVersion: null,
    npmIntegrity: null,
    gitResolvedCommit: null,
    sourceIntent: undefined,
    catalogMarketplace: null,
    catalogEntryId: null
  };
  if (Object.entries(patch).every(([key, value]) => row[key as keyof InstalledPluginRow] === value)) return row;
  return { ...row, ...patch, updatedAt: timestamp };
}
