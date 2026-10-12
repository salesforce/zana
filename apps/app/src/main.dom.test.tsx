// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  bridge: false,
  mode: 'ready' as string,
  target: null as null | { pluginId: string; tabId: string; projectId: string },
  mirror: vi.fn()
}));
vi.mock('./lib/app-surface.js', () => ({ hasDesktopBridge: () => fixtures.bridge }));
vi.mock('./lib/pluginViewSurface.js', () => ({ getPluginViewTarget: () => fixtures.target }));
vi.mock('./plugins/plugin-view-windows.js', () => ({ startPluginViewMirror: fixtures.mirror }));
vi.mock('./App.js', () => ({ App: () => <p>main shell</p> }));
vi.mock('./views/plugin-view/PluginViewApp.js', () => ({
  PluginViewApp: ({ target }: { target: { pluginId: string; tabId: string } }) => <p>{`plugin view ${target.pluginId}/${target.tabId}`}</p>
}));
vi.mock('./components/StartupRepair.js', () => ({ StartupRepair: () => <p>repair</p>, StartupError: () => <p>startup error</p> }));

beforeEach(() => {
  vi.resetModules();
  fixtures.mirror.mockClear();
  document.body.innerHTML = '<div id="root"></div>';
});
afterEach(() => {
  fixtures.bridge = false;
  fixtures.mode = 'ready';
  fixtures.target = null;
  delete (window as { cc?: unknown }).cc;
});

const mounted = async (text: string) => {
  await import('./main.js');
  await vi.waitFor(() => expect(document.getElementById('root')!.textContent).toBe(text));
};

it('mounts the main shell and mirrors open plugin view windows', async () => {
  await mounted('main shell');
  expect(fixtures.mirror).toHaveBeenCalledTimes(1);
});

it('mounts only the plugin tab in a plugin view window', async () => {
  fixtures.target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p1' };
  await mounted('plugin view salesforce/studio');
  expect(fixtures.mirror).toHaveBeenCalledTimes(1);
});

it('keeps repair mode away from plugin views and their mirror', async () => {
  fixtures.bridge = true;
  fixtures.target = { pluginId: 'salesforce', tabId: 'studio', projectId: 'p1' };
  (window as { cc?: unknown }).cc = { startup: { state: async () => ({ mode: 'repair-required' }) } };
  await mounted('repair');
  expect(fixtures.mirror).not.toHaveBeenCalled();
});
