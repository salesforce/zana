import { expect, it } from 'vitest';
import { decodeRoutePath } from '../decode-route';
import { getPluginSettingsRoutePath, isRoutePath, legacyPluginSettingsRoute, resolveRouteHref } from '../route-paths';

it('encodes plugin identities and accepts canonical Settings links through host navigation', () => {
  const path = getPluginSettingsRoutePath('sample:a b', { setting: 'A&B' });
  expect(path).toBe('/settings/plugins/sample%3Aa%20b?setting=A%26B');
  expect(isRoutePath({ path })).toBe(true);
  expect(resolveRouteHref({ currentOrigin: 'http://local', href: path })).toEqual({ path });
  expect(resolveRouteHref({ currentOrigin: 'http://local', href: `https://other${path}` })).toBeNull();
});

it('decodes nested plugin configuration as Settings without selecting a hub detail', () => {
  expect(decodeRoutePath('/settings/plugins/sample', '#plugin-configure'))
    .toMatchObject({ nav: 'settings', settingsTab: 'plugins', settingsAnchor: 'plugin-configure', settingsExtensionId: null });
});

it('translates saved field and setup links, retaining plugin parameters and ordinary management URLs', () => {
  expect(legacyPluginSettingsRoute({ pathname: '/extensions/plugins/sample%3Aa', search: '?view=installed&setting=token&tag=a&tag=b', hash: '#plugin-configure' }))
    .toBe('/settings/plugins/sample%3Aa?setting=token&tag=a&tag=b&area=configuration#plugin-configure');
  expect(legacyPluginSettingsRoute({ pathname: '/extensions/plugins/sample', search: '?view=installed&setup=connect', hash: '#plugin-configure' }))
    .toBe('/settings/plugins/sample?setup=connect&area=plugin#plugin-configure');
  expect(legacyPluginSettingsRoute({ pathname: '/extensions/plugins/sample', search: '?setting=name&area=plugin', hash: '' }))
    .toBe('/settings/plugins/sample?setting=name&area=plugin');
  expect(legacyPluginSettingsRoute({ pathname: '/extensions/plugins/sample', search: '?view=installed', hash: '' })).toBeNull();
  expect(legacyPluginSettingsRoute({ pathname: '/settings/plugins/sample', search: '', hash: '#plugin-configure' })).toBeNull();
});
