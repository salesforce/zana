import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsSearchWarnings, warnSettingsSearchOnce } from '../diagnostics';
import { searchSettings } from '../index';
import type { SettingsSearchEntry } from '../types';

afterEach(() => {
  resetSettingsSearchWarnings();
  vi.restoreAllMocks();
});

describe('settings-search diagnostics', () => {
  it('warns once per key, with context, and separately per key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = new Error('boom');
    warnSettingsSearchOnce('plugins:settings:a', 'reading settings of plugin "a" failed', error);
    warnSettingsSearchOnce('plugins:settings:a', 'reading settings of plugin "a" failed', error);
    warnSettingsSearchOnce('plugins:settings:b', 'reading settings of plugin "b" failed', error);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith('[settings-search] reading settings of plugin "a" failed', error);
  });

  it('a broken value accessor is reported once, not on every rebuild, and search still works', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entries: SettingsSearchEntry[] = [
      { id: 'x.boom', section: 'terminal', label: 'Boom field', kind: 'setting', value: () => { throw new Error('bad'); } }
    ];
    for (let i = 0; i < 3; i += 1) {
      expect(searchSettings('boom', { config: { n: i } as never }, { entries }).map((h) => h.entry.id)).toEqual(['x.boom']);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('x.boom');
  });
});
