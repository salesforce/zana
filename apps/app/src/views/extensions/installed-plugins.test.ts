import { describe, expect, it } from 'vitest';
import type { AppModule } from '@zana-ai/zcc-extension-sdk/renderer';
import type { ExtensionEntry, PluginAppEntry } from '@zana-ai/zcc-domain/product';
import {
  buildHubRows,
  displayIcon,
  filterInstalledRows,
  hostSettingsPanelOf,
  installedPublisher,
  moduleHostCallReady,
  publisherLabel,
  rowEnabled,
  shouldMountHostSettings,
  type HubRow
} from './installed-plugins.js';

function mod(id: string, title: string, extra: Partial<AppModule> = {}): AppModule {
  return { id, title, icon: 'Box', ...extra };
}

function entry(id: string, over: Partial<ExtensionEntry> = {}): ExtensionEntry {
  return {
    id,
    enabled: true,
    loaded: true,
    consented: true,
    needsConsent: null,
    manifest: {
      id,
      title: id,
      icon: 'Box',
      engines: { zccApi: '^1.0.0' },
      entry: { renderer: 'renderer.js' }
    },
    path: `/ext/${id}`,
    ...over
  } as unknown as ExtensionEntry;
}

function plugin(id: string, over: Partial<PluginAppEntry> = {}): PluginAppEntry {
  return {
    id,
    name: id,
    description: `${id} description`,
    icon: 'Puzzle',
    enabled: true,
    provenance: 'builtin',
    status: 'running',
    appUrl: null,
    ...over
  };
}

describe('buildHubRows — PluginService snapshot union', () => {
  it('lists a PluginService plugin that is not a loaded module (disabled / no UI)', () => {
    const rows = buildHubRows([], [], [plugin('provider-pi', { name: 'Pi provider', enabled: false, status: 'disabled' })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.module.id).toBe('provider-pi');
    expect(rows[0]?.module.title).toBe('Pi provider');
    expect(rows[0]?.module.panel).toBeUndefined();
    expect(rows[0]?.plugin?.enabled).toBe(false);
    expect(rowEnabled(rows[0]!)).toBe(false);
  });

  it('dedupes a plugin that is also a loaded module and a disk entry', () => {
    const panel = () => null;
    const rows = buildHubRows(
      [mod('docs', 'Docs', { panel })],
      [entry('docs')],
      [plugin('docs', { name: 'Docs' })]
    );
    expect(rows.filter((row) => row.module.id === 'docs')).toHaveLength(1);
    expect(rows[0]?.module.panel).toBe(panel);
    expect(rows[0]?.plugin?.id).toBe('docs');
    expect(rows[0]?.entry?.id).toBe('docs');
  });

  it('keeps a disk-only placeholder so a local extension stays manageable', () => {
    const rows = buildHubRows(
      [mod('slack', 'Slack')],
      [entry('foo-0001', { enabled: false, source: 'local' })],
      []
    );
    const local = rows.find((row) => row.module.id === 'foo-0001');
    expect(local?.entry?.enabled).toBe(false);
    expect(local?.plugin).toBeNull();
    expect(installedPublisher(local!)).toBe('local');
    expect(publisherLabel('local')).toBe('Local');
    expect(rows.find((row) => row.module.id === 'slack')).toBeUndefined();
  });
});

describe('filterInstalledRows', () => {
  const rows: HubRow[] = [
    {
      module: mod('docs', 'Docs'),
      entry: null,
      plugin: plugin('docs', { name: 'Docs', description: 'Project knowledge', enabled: true })
    },
    {
      module: mod('pi', 'Pi provider'),
      entry: null,
      plugin: plugin('pi', {
        name: 'Pi provider',
        description: 'Run threads with Pi',
        enabled: false,
        status: 'disabled'
      })
    },
    {
      module: mod('acme', 'Acme'),
      entry: entry('acme', { source: 'local' }),
      plugin: null
    }
  ];

  it('searches title and description, keeps disabled plugins visible', () => {
    const found = filterInstalledRows(rows, 'pi', 'all', 'asc');
    expect(found.map((row) => row.module.id)).toEqual(['pi']);
    expect(rowEnabled(found[0]!)).toBe(false);
  });

  it('filters by publisher chip and sorts by name, not enabled state', () => {
    const official = filterInstalledRows(rows, '', 'official', 'asc');
    expect(official.map((row) => row.module.id)).toEqual(['docs', 'pi']);
    const local = filterInstalledRows(rows, '', 'local', 'asc');
    expect(local.map((row) => row.module.id)).toEqual(['acme']);
    expect(filterInstalledRows(rows, '', 'all', 'asc').map((row) => row.module.id)).toEqual([
      'acme',
      'docs',
      'pi'
    ]);
  });

  it('reverses name order when sortDir is desc without grouping by enabled', () => {
    const desc = filterInstalledRows(rows, '', 'all', 'desc');
    expect(desc.map((row) => row.module.id)).toEqual(['pi', 'docs', 'acme']);
    const asc = filterInstalledRows(rows, '', 'all', 'asc');
    expect(asc.map((row) => row.module.id)).toEqual(['acme', 'docs', 'pi']);
  });

  it('keeps a disabled plugin in alphabetic position instead of appending it', () => {
    const mixed: HubRow[] = [
      {
        module: mod('salesforce', 'Salesforce'),
        entry: null,
        plugin: plugin('salesforce', { name: 'Salesforce', enabled: true })
      },
      {
        module: mod('pi', 'Pi provider'),
        entry: null,
        plugin: plugin('pi', { name: 'Pi provider', enabled: false, status: 'disabled' })
      },
      {
        module: mod('pr-monitor', 'PR Monitor'),
        entry: null,
        plugin: plugin('pr-monitor', { name: 'PR Monitor', enabled: false, status: 'disabled' })
      }
    ];
    expect(filterInstalledRows(mixed, '', 'all', 'asc').map((row) => row.module.title)).toEqual([
      'Pi provider',
      'PR Monitor',
      'Salesforce'
    ]);
  });
});

describe('moduleHostCallReady', () => {
  it('does not mount a host.call settings panel unless a live disk-ext main can answer', () => {
    const panel = () => null;
    const leftover: HubRow = {
      module: { ...mod('salesforce', 'Salesforce'), settingsPanel: panel, panel },
      entry: null,
      plugin: plugin('salesforce', { name: 'Salesforce', provenance: 'direct' })
    };
    expect(moduleHostCallReady(leftover)).toBe(false);
    expect(shouldMountHostSettings(leftover)).toBe(false);
    expect(hostSettingsPanelOf(leftover)).toBe(panel);

    const inactive: HubRow = {
      module: { ...mod('salesforce', 'Salesforce'), settingsPanel: panel },
      entry: entry('salesforce', { mainActive: false }),
      plugin: null
    };
    expect(moduleHostCallReady(inactive)).toBe(false);
    expect(shouldMountHostSettings(inactive)).toBe(false);

    const live: HubRow = {
      module: { ...mod('salesforce', 'Salesforce'), settingsPanel: panel },
      entry: entry('salesforce', { mainActive: true }),
      plugin: null
    };
    expect(moduleHostCallReady(live)).toBe(true);
    expect(shouldMountHostSettings(live)).toBe(true);

    const official: HubRow = {
      module: mod('docs', 'Docs'),
      entry: null,
      plugin: plugin('docs', { name: 'Docs' })
    };
    expect(moduleHostCallReady(official)).toBe(false);
    expect(shouldMountHostSettings(official)).toBe(false);
    expect(hostSettingsPanelOf(official)).toBeUndefined();
  });
});

describe('displayIcon', () => {
  it('falls back for path-like branding icons', () => {
    expect(displayIcon('./icons/claude-code.svg')).toBe('Puzzle');
    expect(displayIcon('Library')).toBe('Library');
  });
});

describe('installedPublisher', () => {
  it('maps builtin provenance to Official', () => {
    expect(
      publisherLabel(
        installedPublisher({
          module: mod('docs', 'Docs'),
          entry: null,
          plugin: plugin('docs')
        })
      )
    ).toBe('Official');
  });
});
