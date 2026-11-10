import { expect, it, vi } from 'vitest';
import { collectPluginApp } from './app-contract.js';
import { definePluginApp } from './app.js';
import { collectPluginAppRegistrations } from './internal/plugin-app-collector.js';
const provider = { id: 'voice', title: 'Custom voices', description: 'Choose a voice', component: () => null, mount: vi.fn() };
it('validates and captures sound providers without mounting them during collection', () => {
  const app = definePluginApp(app => app.slots.notificationSoundProvider(provider));
  const set = collectPluginApp('custom-plugin', 7, app);
  expect(set.notificationSoundProviders).toEqual([{ ...provider, pluginId: 'custom-plugin', generation: 7 }]);
  expect(collectPluginAppRegistrations(app).notificationSoundProviders).toEqual([provider]);
  expect(set.contentScripts).toEqual([]); expect(provider.mount).not.toHaveBeenCalled();
});
it.each([{ id: '../bad' }, { title: '' }, { component: null }, { mount: 1 }, { description: 2 }])('rejects invalid sound registration %j', patch => {
  const app = definePluginApp(app => app.slots.notificationSoundProvider({ ...provider, ...patch } as any));
  expect(() => collectPluginApp('custom-plugin', 1, app)).toThrow();
  expect(() => collectPluginAppRegistrations(app)).toThrow();
});
it('rejects duplicate ids in a generation', () => {
  const app = definePluginApp(app => { app.slots.notificationSoundProvider(provider); app.slots.notificationSoundProvider(provider); });
  expect(() => collectPluginApp('custom-plugin', 1, app)).toThrow(); expect(() => collectPluginAppRegistrations(app)).toThrow();
});
