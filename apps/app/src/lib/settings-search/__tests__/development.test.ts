import { expect, it } from 'vitest';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { entries } from '../entries/development.js';
import { entries as experimental } from '../entries/experimental.js';
import { searchSettings } from '../index.js';
import { settingsHitPath } from '../links.js';

it.each([undefined, false, true])('finds bundled plugin development with its effective value: %s', enabled => {
  const snapshot = { config: { pluginDevelopmentEnabled: enabled } as AppConfig };
  const entry = entries.find(row => row.id === 'development.plugin-development')!;
  expect(entry.value!(snapshot)).toBe(enabled ? 'On' : 'Off');
  expect(searchSettings('bundled plugin development', snapshot, { entries })[0]!.entry.id).toBe(entry.id);
});

it.each(['developer mode', 'hot reload', 'local override', 'reserved plugin', 'source watching'])
  ('routes %s searches to the Development setting', query => {
    const hit = searchSettings(query, { config: {} as AppConfig }, { entries })
      .find(row => row.entry.id === 'development.plugin-development')!;
    expect(hit).toBeDefined();
    expect(hit.entry.anchor).toBe('bundled-plugins');
    expect(settingsHitPath(hit)).toBe('/settings/development#development.plugin-development');
  });

it('removes development results from Experimental', () => {
  expect(experimental.some(row => row.id.includes('development'))).toBe(false);
});

it.each([['host daemon', 'development.restart-daemon'], ['hard plugin reload', 'development.hard-plugin-reload'], ['corrupted', 'development.hard-plugin-reload']])('finds recovery through %s', (query, id) => {
  const hit = searchSettings(query, { config: {} as AppConfig }, { entries }).find(row => row.entry.id === id)!;
  expect(hit).toBeDefined();
  expect(hit.entry.anchor).toBe('recovery');
});
