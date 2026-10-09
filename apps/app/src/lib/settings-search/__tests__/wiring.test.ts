// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../product-client.js', () => ({ product: { pluginApps: { list: async () => [], getSettings: async () => ({ descriptors: {}, values: {} }) } } }));

import { getSettingsSearchProviders, mergeStaticEntries } from '../registry';
import { settingsHitPath } from '../links';
import { ensureSettingsSearchProviders } from '../runtime';
import { searchSettings } from '../index';
import type { SettingsSearchEntry, SettingsSearchHit } from '../types';

const e = (over: Partial<SettingsSearchEntry>): SettingsSearchEntry => ({ id: 'x', section: 'terminal', label: 'X', kind: 'setting', ...over });
const hit = (entry: SettingsSearchEntry): SettingsSearchHit => ({ entry, breadcrumb: '', score: 1, tier: 1 });

describe('mergeStaticEntries', () => {
  it('drops a derived subsection a page entry already titles, keeps derived sections and other pages', () => {
    const derived = [
      e({ id: 'terminal.section', label: 'Terminal', kind: 'section' }),
      e({ id: 'terminal.terminal-tmux', label: 'tmux', kind: 'subsection' }),
      e({ id: 'terminal.terminal-shell', label: 'Shell', kind: 'subsection' }),
      e({ id: 'editor.editor-tmux', section: 'editor', label: 'tmux', kind: 'subsection' })
    ];
    const page = [e({ id: 'terminal.tmux-intro', label: 'TMUX', kind: 'subsection' }), e({ id: 'terminal.terminal', label: 'Terminal', kind: 'setting' })];
    expect(mergeStaticEntries(derived, page).map((x) => x.id)).toEqual([
      'terminal.section', 'terminal.terminal-shell', 'editor.editor-tmux', 'terminal.tmux-intro', 'terminal.terminal'
    ]);
  });
});

describe('settingsHitPath', () => {
  it('prefers an explicit href, then project routes, then the section hash', () => {
    expect(settingsHitPath(hit(e({ href: '/extensions/plugins/p#plugin-configure' })))).toBe('/extensions/plugins/p#plugin-configure');
    expect(settingsHitPath(hit(e({ id: 'project.a', section: 'project' })), 'p1')).toBe('/projects/p1/settings#project.a');
    expect(settingsHitPath(hit(e({ section: 'project', kind: 'section' })), 'p1')).toBe('/projects/p1/settings');
    expect(settingsHitPath(hit(e({ id: 'terminal.a' })))).toBe('/settings/terminal#terminal.a');
    expect(settingsHitPath(hit(e({ kind: 'section' })))).toBe('/settings/terminal');
  });
});

describe('ensureSettingsSearchProviders', () => {
  it('registers every runtime provider once and disposes them all', () => {
    const before = getSettingsSearchProviders().length;
    const a = ensureSettingsSearchProviders();
    expect(ensureSettingsSearchProviders()).toBe(a);
    expect(getSettingsSearchProviders().length).toBe(before + 5);
    const hits = searchSettings('shortcut palette', { config: {} as never, machines: [{ name: 'Studio Mac', host: 'studio.local' }] });
    expect(hits.some((h) => h.entry.id.startsWith('keyboard.'))).toBe(true);
    expect(searchSettings('studio.local', { config: {} as never, machines: [{ name: 'Studio Mac', host: 'studio.local' }] })[0].entry.section).toBe('machines');
    return a.prefetchPluginSettings().then(() => {
      a.dispose();
      expect(getSettingsSearchProviders().length).toBe(before);
      expect(ensureSettingsSearchProviders()).not.toBe(a);
      ensureSettingsSearchProviders().dispose();
    });
  });
});
