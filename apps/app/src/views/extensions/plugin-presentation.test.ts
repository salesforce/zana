import { expect, it } from 'vitest';
import { buildHubRows, type HubRow } from './installed-plugins.js';
import { catalogCapabilities, installedCapabilities, installedSource } from './plugin-presentation.js';
const row = (over = {}) => buildHubRows([], [], [{ id: 'example', name: 'Example', description: '', icon: 'Box', enabled: true, provenance: 'direct' as const, status: 'running' as const, appUrl: null, ...over }])[0]!;
it('uses declared capabilities, including disabled plugins, without guessing from identity', () => {
  expect(installedCapabilities(row())).toEqual([]);
  expect(installedCapabilities(row({ appUrl: '/app.js' }))).toEqual(['Interface']);
  expect(installedCapabilities(row({ enabled: false, projectTab: {}, appUrl: '/app.js', skillNames: ['example'], mcpServers: [{ name: 'service' }], cliNames: ['tool'], collection: 'coding-agents' }))).toEqual(['Panel', 'Skills', 'MCP', 'CLI', 'CLI agent']);
  expect(installedCapabilities({ ...row(), module: { ...row().module, panel: () => null } })).toEqual(['Panel']);
  expect(catalogCapabilities({ skillNames: [], mcpServers: [] } as any)).toEqual([]);
  expect(catalogCapabilities({ skillNames: ['example'], mcpServers: [{ name: 'service' }] } as any)).toEqual(['Skills', 'MCP']);
});
it.each([['path', 'Local folder'], ['git', 'Git repository'], ['npm', 'npm package'], ['builtin', 'Bundled']])('labels %s installation sources separately from authorship', (sourceKind, label) => {
  expect(installedSource(row({ sourceKind }))).toBe(label);
});
it('handles legacy installs and snapshots without a source kind', () => {
  expect(installedSource({ ...row(), plugin: null, entry: { source: 'local' } } as HubRow)).toBe('Local folder');
  expect(installedSource(row({ provenance: 'builtin' }))).toBe('Bundled');
  expect(installedSource(row({ provenance: 'catalog' }))).toBe('Marketplace');
  expect(installedSource(row())).toBe('Direct install');
});
