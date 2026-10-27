// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { PluginAppEntry } from '@zana-ai/zcc-domain/product';
import { buildHubRows } from './installed-plugins.js';
vi.mock('./InstalledPluginCard.js', () => ({ InstalledPluginCard: ({ row, onOpen }: { row: { module: { id: string; title: string } }; onOpen: () => void }) =>
  <div role="listitem"><button onClick={onOpen}>{row.module.title}</button></div> }));
import { InstalledPluginCollection } from './InstalledPluginCollection.js';

const plugin = (id: string, over: Partial<PluginAppEntry> = {}): PluginAppEntry => ({ id, name: id, description: `${id} tool`, icon: 'Box', enabled: true,
  provenance: 'builtin', status: 'running', appUrl: null, ...over });
const entries = [plugin('Alpha', { availableVersion: '2.0' }), plugin('Beta', { enabled: false, provenance: 'direct', sourceKind: 'path' }),
  plugin('Gamma', { collection: 'coding-agents', availableVersion: '2.0' }), plugin('Delta', { collection: 'coding-agents', enabled: false })];
const rows = () => buildHubRows([], [], entries);
const setup = (input = rows()) => {
  const onOpen = vi.fn(), onBrowse = vi.fn();
  return { ...render(<InstalledPluginCollection rows={input} onOpen={onOpen} onBrowse={onBrowse} headerActions={<button>Add plugin</button>} mobileHeader={<span>Mobile controls</span>} />), onOpen, onBrowse };
};
const collectionButton = (name: string) => within(screen.getByRole('navigation', { name: 'Plugin collections' })).getByRole('button', { name: new RegExp(`^${name}`) });
afterEach(cleanup);

it('keeps saved packs in Installed and hides them while reviewing plugin updates', () => {
  render(<InstalledPluginCollection rows={rows()} onOpen={vi.fn()} onBrowse={vi.fn()}
    packs={<section aria-label="Saved plugin packs">Starter pack</section>} />);
  expect(screen.getByRole('region', { name: 'Saved plugin packs' })).toBeTruthy();
  fireEvent.click(collectionButton('Updates'));
  expect(screen.queryByRole('region', { name: 'Saved plugin packs' })).toBeNull();
  fireEvent.click(collectionButton('Installed'));
  expect(screen.getByRole('region', { name: 'Saved plugin packs' })).toBeTruthy();
});

it('renders cards and counts with a collapsible coding-agent section and real navigation callbacks', () => {
  const { onOpen, onBrowse } = setup();
  expect(screen.getByRole('heading', { name: 'Plugins' })).toBeTruthy();
  expect(screen.getByText('Mobile controls')).toBeTruthy();
  expect(screen.getByText('2 plugins enabled')).toBeTruthy();
  expect(screen.getByText('4 of 4 plugins')).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Installed coding agents' })).toBeNull();
  const group = screen.getByRole('button', { name: /^Coding agents/ });
  expect(group.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(group);
  expect(screen.getByRole('list', { name: 'Installed coding agents' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Gamma' }));
  expect(onOpen).toHaveBeenCalledWith('Gamma');
  fireEvent.click(group);
  expect(screen.queryByRole('list', { name: 'Installed coding agents' })).toBeNull();
  fireEvent.click(collectionButton('Browse'));
  expect(onBrowse).toHaveBeenCalledOnce();
});

it('searches and automatically reveals coding-agent matches without suppressing manual collapse', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search installed plugins'), { target: { value: 'Gamma' } });
  expect(screen.getByRole('list', { name: 'Installed coding agents' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Installed plugins' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /^Coding agents/ }));
  expect(screen.queryByRole('list', { name: 'Installed coding agents' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Search installed plugins'), { target: { value: 'missing' } });
  expect(screen.getByRole('status').textContent).toContain('No plugins match “missing”');
});

it('combines enabled/disabled, source and sorting filters', () => {
  setup();
  const status = within(screen.getByRole('group', { name: 'Filter by status' }));
  fireEvent.click(status.getByRole('button', { name: 'Disabled', exact: true }));
  expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delta' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Alpha' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'Local folder' } });
  expect(screen.queryByRole('button', { name: 'Delta' })).toBeNull();
  fireEvent.click(status.getByRole('button', { name: 'Enabled', exact: true }));
  expect(screen.getByRole('status').textContent).toContain('No plugins match these filters');
  fireEvent.click(status.getByRole('button', { name: 'All', exact: true }));
  fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'all' } });
  const sort = screen.getByRole('button', { name: 'Sort by name descending' });
  fireEvent.click(sort);
  expect(screen.getByRole('button', { name: 'Sort by name ascending' }).getAttribute('title')).toBe('Name Z–A');
  expect(within(screen.getByRole('list', { name: 'Installed coding agents' })).getAllByRole('button').map(b => b.textContent)).toEqual(['Gamma', 'Delta']);
  fireEvent.click(screen.getByRole('button', { name: 'Sort by name ascending' }));
});

it('shows updates across both groups and clears filters when switching collections', () => {
  setup();
  fireEvent.change(screen.getByLabelText('Search installed plugins'), { target: { value: 'Beta' } });
  fireEvent.click(collectionButton('Updates'));
  expect(screen.getByRole('heading', { name: 'Ready for a refresh' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Gamma' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Beta' })).toBeNull();
  expect((screen.getByLabelText('Search installed plugins') as HTMLInputElement).value).toBe('');
  fireEvent.click(collectionButton('Installed'));
  expect(screen.getByRole('button', { name: 'Beta' })).toBeTruthy();
});

it('explains empty installations, current plugins, and a single enabled plugin', () => {
  const { rerender } = setup([]);
  expect(screen.getByRole('status').textContent).toContain('No plugins installed');
  expect(screen.queryByLabelText('Filter by source')).toBeNull();
  rerender(<InstalledPluginCollection rows={buildHubRows([], [], [plugin('Only')])} onOpen={vi.fn()} onBrowse={vi.fn()} />);
  expect(screen.getByText('1 plugin enabled')).toBeTruthy();
  fireEvent.click(collectionButton('Updates'));
  expect(screen.getByRole('status').textContent).toContain('Check for updates from the More menu');
});

it('recovers when a source disappears after uninstall', () => {
  const { rerender } = setup();
  fireEvent.change(screen.getByLabelText('Filter by source'), { target: { value: 'Local folder' } });
  rerender(<InstalledPluginCollection rows={buildHubRows([], [], [plugin('Only')])} onOpen={vi.fn()} onBrowse={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Only' })).toBeTruthy();
});

it('reviews unhealthy plugins without replacing descriptions, and clears the attention filter', () => {
  setup(buildHubRows([], [], [plugin('Healthy'), plugin('Broken', { status: 'degraded' }), plugin('Agent', { status: 'needs-configuration', collection: 'coding-agents' })]));
  expect(screen.getByText('2 plugins need attention')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review 2' }));
  expect(screen.queryByRole('button', { name: 'Healthy' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Agent' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Show all', exact: true }));
  expect(screen.getByRole('button', { name: 'Healthy' })).toBeTruthy();
});

it('filters by capabilities and recovers when the last matching plugin is removed', () => {
  const { rerender } = setup(buildHubRows([], [], [plugin('Skills', { skillNames: ['test'] }), plugin('Panel', { projectTab: {} })]));
  fireEvent.change(screen.getByLabelText('Filter by capability'), { target: { value: 'Skills' } });
  expect(screen.queryByRole('button', { name: 'Panel' })).toBeNull();
  rerender(<InstalledPluginCollection rows={buildHubRows([], [], [plugin('Panel', { projectTab: {} })])} onOpen={vi.fn()} onBrowse={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Panel' })).toBeTruthy();
});

it('opens directly to Updates and explains distinct update policies', () => {
  render(<InstalledPluginCollection rows={buildHubRows([], [], [plugin('Local', { sourceKind: 'path' }), plugin('Bundled', { sourceKind: 'builtin' }), plugin('Remote', { sourceKind: 'git' })])}
    onOpen={vi.fn()} onBrowse={vi.fn()} defaultUpdates />);
  expect(screen.getByRole('heading', { name: 'No pending updates' })).toBeTruthy();
  expect(screen.getByText('Local development')).toBeTruthy();
  expect(screen.getByText('Updates with Zana releases')).toBeTruthy();
  expect(screen.getByText('Automatic checks; manual updates')).toBeTruthy();
});
