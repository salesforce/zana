import type { MarketplaceEntry } from '@zana-ai/zcc-domain/product';
import type { HubRow } from './installed-plugins.js';

/** Only capabilities published by the host or catalogue; never infer from a name. */
export function installedCapabilities(row: HubRow): string[] {
  const plugin = row.plugin;
  const caps: string[] = [];
  if (plugin?.projectTab || row.module.projectTab || row.module.panel) caps.push('Panel');
  else if (plugin?.appUrl) caps.push('Interface');
  if (plugin?.skillNames?.length) caps.push('Skills');
  if (plugin?.mcpServers?.length) caps.push('MCP');
  if (plugin?.cliNames?.length) caps.push('CLI');
  if (plugin?.collection === 'coding-agents') caps.push('CLI agent');
  return caps;
}

export function catalogCapabilities(entry: MarketplaceEntry): string[] {
  return [entry.skillNames?.length ? 'Skills' : null, entry.mcpServers?.length ? 'MCP' : null]
    .filter((value): value is string => value !== null);
}

export function installedSource(row: HubRow): string {
  const source = row.plugin?.sourceKind ?? row.entry?.source;
  if (source === 'path' || source === 'local') return 'Local folder';
  if (source === 'git') return 'Git repository';
  if (source === 'npm') return 'npm package';
  if (source === 'builtin' || row.plugin?.provenance === 'builtin') return 'Bundled';
  if (row.plugin?.provenance === 'catalog') return 'Marketplace';
  return 'Direct install';
}
