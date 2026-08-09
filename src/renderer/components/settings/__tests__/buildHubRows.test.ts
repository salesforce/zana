import { describe, it, expect } from 'vitest';
import type { AppModule } from '@shared/module-api';
import type { ExtensionEntry } from '@shared/types';
import { buildHubRows } from '../ExtensionsHub';

/**
 * Regression guard for the "extension vanishes from the Installed list when its
 * consent prompt opens" bug. The hub used to build its rows by mapping ONLY over
 * the loaded/merged module set, so an extension that `reconcileExtensionModules`
 * drops (unconsented / widened / disabled / version-incompatible) lost its row
 * entirely — the user could neither see it nor grant consent / re-enable /
 * uninstall it. `buildHubRows` now unions the loaded modules with ALL discovered
 * disk entries, synthesizing a display-only placeholder for the ones with no
 * loaded module.
 */

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

describe('buildHubRows — union of loaded modules + discovered entries', () => {
  it('keeps a row for an unconsented extension that is NOT in the module set (the bug)', () => {
    // The extension is discovered (in entries) but reconcile dropped it from the
    // loaded modules because it needs consent — it must still get a row.
    const modules = [mod('slack', 'Slack')]; // built-in only
    const entries = [
      entry('acme.widget-a1b2', {
        consented: false,
        needsConsent: 'widened',
        manifest: {
          id: 'acme.widget-a1b2',
          title: 'Widget',
          icon: 'Box',
          engines: { zccApi: '^1.0.0' },
          entry: { renderer: 'renderer.js' },
          permissions: ['storage', 'net']
        }
      } as unknown as Partial<ExtensionEntry>)
    ];

    const rows = buildHubRows(modules, entries);
    const ids = rows.map((r) => r.module.id);
    expect(ids).toContain('acme.widget-a1b2');

    const widget = rows.find((r) => r.module.id === 'acme.widget-a1b2');
    // The placeholder carries the manifest's display metadata…
    expect(widget?.module.title).toBe('Widget');
    // …its disk entry rides along (so About + Permissions cards + status render)…
    expect(widget?.entry?.needsConsent).toBe('widened');
    // …and it carries NO executable contribution, so no unconsented code mounts.
    expect(widget?.module.panel).toBeUndefined();
    expect(widget?.module.settingsPanel).toBeUndefined();
  });

  it('keeps a row for a disabled extension so its Enable action is reachable', () => {
    const rows = buildHubRows(
      [mod('slack', 'Slack')],
      [entry('foo-0001', { enabled: false })]
    );
    expect(rows.map((r) => r.module.id)).toContain('foo-0001');
  });

  it('uses the real (executable) module for a consented, loaded extension', () => {
    const panel = () => null;
    const modules = [mod('slack', 'Slack'), mod('foo-0001', 'Foo', { panel })];
    const rows = buildHubRows(modules, [entry('foo-0001')]);
    const foo = rows.find((r) => r.module.id === 'foo-0001');
    // The loaded module wins — not a placeholder — so its panel is preserved.
    expect(foo?.module.panel).toBe(panel);
    expect(foo?.entry?.id).toBe('foo-0001');
  });

  it('does not duplicate a row when an entry is also a loaded module', () => {
    const modules = [mod('foo-0001', 'Foo', { panel: () => null })];
    const rows = buildHubRows(modules, [entry('foo-0001')]);
    expect(rows.filter((r) => r.module.id === 'foo-0001')).toHaveLength(1);
  });

  it('keeps built-ins (no entry) alongside extension rows, sorted by title', () => {
    const rows = buildHubRows(
      [mod('slack', 'Slack')],
      [entry('aaa-0001', { manifest: { id: 'aaa-0001', title: 'Aardvark', icon: 'Box', engines: { zccApi: '^1' }, entry: { renderer: 'r.js' } } } as unknown as Partial<ExtensionEntry>)]
    );
    expect(rows.map((r) => r.module.title)).toEqual(['Aardvark', 'Slack']);
    // The built-in row has no disk entry.
    expect(rows.find((r) => r.module.id === 'slack')?.entry).toBeNull();
  });
});
