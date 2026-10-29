import { describe, expect, it } from 'vitest';
import {
  PLUGIN_VIEW_BOUNDS_CAP,
  authorizePluginView,
  listPluginViews,
  parseMainWindowPath,
  parsePluginViewTarget,
  pluginViewKey,
  pluginViewMenuRoute,
  pluginViewRendererParams,
  pluginViewWindowGeometry,
  readPluginViewBounds,
  samePluginView,
  writePluginViewBounds
} from './plugin-view-windows.js';

const target = { pluginId: 'salesforce', tabId: 'salesforce', projectId: 'p-1' };
const app = { id: 'salesforce', enabled: true, status: 'running', appUrl: '/plugins/salesforce/app.js' };

describe('parsePluginViewTarget', () => {
  it('accepts a well-formed target and drops extra fields', () => {
    expect(parsePluginViewTarget({ ...target, extra: 'x' })).toEqual(target);
  });

  it.each([
    null,
    'salesforce',
    { ...target, pluginId: 'Salesforce' },
    { ...target, pluginId: '-x' },
    { ...target, pluginId: 'a'.repeat(129) },
    { ...target, tabId: '' },
    { ...target, tabId: 'a/b' },
    { ...target, tabId: 'a'.repeat(65) },
    { ...target, projectId: '' },
    { ...target, projectId: '   ' },
    { ...target, projectId: 'p'.repeat(257) },
    { ...target, projectId: 'p\n1' },
    { ...target, projectId: 7 },
    { ...target, resourceId: '' },
    { ...target, resourceId: '  ' },
    { ...target, resourceId: 7 },
    { ...target, resourceId: 'a'.repeat(2049) },
    { ...target, resourceId: 'a\nb' },
    { ...target, resourceId: 'a\x7fb' }
  ])('rejects %j', (input) => {
    expect(parsePluginViewTarget(input)).toBeNull();
  });
});

describe('authorizePluginView', () => {
  const known = { projectIds: ['p-1'], apps: [app] };

  it('allows an enabled plugin with an app bundle on a registered project', () => {
    expect(authorizePluginView(target, known)).toEqual({ ok: true, target });
  });

  it('names the reason it refuses', () => {
    expect(authorizePluginView({ pluginId: 'x' }, known)).toEqual({ ok: false, reason: 'invalid' });
    expect(authorizePluginView({ ...target, projectId: 'p-2' }, known)).toEqual({ ok: false, reason: 'unknown-project' });
    expect(authorizePluginView({ ...target, pluginId: 'other' }, known)).toEqual({ ok: false, reason: 'unknown-plugin' });
    expect(authorizePluginView(target, { ...known, apps: [{ ...app, enabled: false }] })).toEqual({ ok: false, reason: 'plugin-disabled' });
    expect(authorizePluginView(target, { ...known, apps: [{ ...app, status: 'disabled' }] })).toEqual({ ok: false, reason: 'plugin-disabled' });
    expect(authorizePluginView(target, { ...known, apps: [{ ...app, appUrl: null }] })).toEqual({ ok: false, reason: 'no-app' });
  });

  it('accepts any iterable of project ids', () => {
    expect(authorizePluginView(target, { projectIds: new Set(['p-1']), apps: [app] }).ok).toBe(true);
  });
});

describe('view identity', () => {
  it('preserves opaque resources and isolates identities, geometry keys and renderer params', () => {
    const a = { ...target, resourceId: 'agents/Help #1.agent' };
    const b = { ...target, resourceId: 'agents/Quote.agent' };
    expect(parsePluginViewTarget({ ...a, extra: true })).toEqual(a);
    expect(parsePluginViewTarget({ ...a, resourceId: 'a'.repeat(2048) })).not.toBeNull();
    expect(samePluginView(a, { ...a })).toBe(true);
    expect(samePluginView(a, b)).toBe(false);
    expect(samePluginView(a, target)).toBe(false);
    expect(pluginViewKey(a)).not.toBe(pluginViewKey(b));
    expect(pluginViewKey(a)).not.toBe(pluginViewKey(target));
    expect(pluginViewRendererParams(a)).toMatchObject({ resourceId: a.resourceId });
    const record = writePluginViewBounds(undefined, pluginViewKey(a), { windowBounds: { width: 900, height: 600 } }, 1);
    expect(readPluginViewBounds(record, pluginViewKey(b)).bounds).toBeUndefined();
    expect(readPluginViewBounds(record, pluginViewKey(a)).bounds?.width).toBe(900);
  });
  it('keys and compares on plugin, tab and project', () => {
    expect(pluginViewKey(target)).toBe('salesforce/salesforce@p-1');
    expect(samePluginView(target, { ...target })).toBe(true);
    expect(samePluginView(undefined, target)).toBe(false);
    expect(samePluginView({ ...target, tabId: 'other' }, target)).toBe(false);
    expect(samePluginView({ ...target, projectId: 'p-2' }, target)).toBe(false);
  });

  it('builds scoped renderer params', () => {
    expect(pluginViewRendererParams(target)).toEqual({
      projectId: 'p-1',
      surface: 'plugin-view',
      pluginId: 'salesforce',
      tabId: 'salesforce'
    });
  });

  it('lists only live view windows, as copies', () => {
    const views = listPluginViews([
      { live: true },
      { view: target, live: true },
      { view: { ...target, projectId: 'p-2' }, live: false }
    ]);
    expect(views).toEqual([target]);
    expect(views[0]).not.toBe(target);
  });
});

describe('parseMainWindowPath', () => {
  it('accepts relative in-app paths', () => {
    expect(parseMainWindowPath('/projects/p-1/threads/t-1?x=1#h')).toBe('/projects/p-1/threads/t-1?x=1#h');
    const resourceUrl = `/projects/p-1/studio?${new URLSearchParams({ pluginResourceId: '界'.repeat(2048) })}`;
    expect(parseMainWindowPath(resourceUrl)).toBe(resourceUrl);
  });

  it.each(['', 'projects', '//evil.example', '/a\\b', 'https://x', '/a\nb', 7, `/${'a'.repeat(32768)}`])(
    'rejects %j',
    (input) => {
      expect(parseMainWindowPath(input)).toBeNull();
    }
  );
});

describe('plugin view bounds', () => {
  const bounds = { x: 1500, y: 40, width: 1200, height: 800 };

  it('reads nothing for an unknown key', () => {
    expect(readPluginViewBounds(undefined, 'k')).toEqual({ bounds: undefined, maximized: false });
  });

  it('round-trips bounds and maximize state', () => {
    const record = writePluginViewBounds(undefined, 'k', { windowBounds: bounds, windowMaximized: true }, 10);
    expect(readPluginViewBounds(record, 'k')).toEqual({ bounds, maximized: true });
  });

  it('keeps earlier bounds when only maximize state changes', () => {
    const first = writePluginViewBounds(undefined, 'k', { windowBounds: bounds, windowMaximized: false }, 10);
    const second = writePluginViewBounds(first, 'k', { windowMaximized: true }, 20);
    expect(second.k).toEqual({ bounds, maximized: true, at: 20 });
  });

  it('records a window with no bounds yet', () => {
    expect(writePluginViewBounds(undefined, 'k', { windowMaximized: false }, 5)).toEqual({ k: { at: 5 } });
  });

  it('does not mutate the stored record', () => {
    const first = writePluginViewBounds(undefined, 'k', { windowBounds: bounds }, 10);
    const snapshot = structuredClone(first);
    writePluginViewBounds(first, 'k', { windowBounds: { ...bounds, width: 900 } }, 20);
    expect(first).toEqual(snapshot);
  });

  it('keeps only the newest entries', () => {
    let record: ReturnType<typeof writePluginViewBounds> | undefined;
    for (let i = 0; i < PLUGIN_VIEW_BOUNDS_CAP + 3; i += 1) {
      record = writePluginViewBounds(record, `k${i}`, { windowBounds: bounds }, i);
    }
    expect(Object.keys(record!)).toHaveLength(PLUGIN_VIEW_BOUNDS_CAP);
    expect(record!.k0).toBeUndefined();
    expect(record![`k${PLUGIN_VIEW_BOUNDS_CAP + 2}`]).toBeDefined();
    expect(Object.keys(writePluginViewBounds(record, 'z', { windowBounds: bounds }, 99, 0))).toEqual(['z']);
  });
});

describe('pluginViewWindowGeometry', () => {
  const primary = { id: 1, workArea: { x: 0, y: 25, width: 1440, height: 875 } };
  const external = { id: 2, workArea: { x: 1440, y: 0, width: 2560, height: 1440 } };

  it('opens a new view at the default size and lets Electron center it', () => {
    expect(pluginViewWindowGeometry({ maximized: false }, [primary], primary)).toEqual({
      options: { width: 1280, height: 820, minWidth: 720, minHeight: 480 },
      maximized: false
    });
  });

  it('fits the default size to a small display', () => {
    const small = { id: 3, workArea: { x: 0, y: 0, width: 700, height: 460 } };
    expect(pluginViewWindowGeometry({ maximized: false }, [small], small).options).toEqual({
      width: 700,
      height: 460,
      minWidth: 700,
      minHeight: 460
    });
  });

  it('keeps a saved size that has no position', () => {
    const geometry = pluginViewWindowGeometry({ bounds: { width: 900, height: 600 }, maximized: true }, [primary], primary);
    expect(geometry.options).toMatchObject({ width: 900, height: 600 });
    expect(geometry.options.x).toBeUndefined();
    expect(geometry.bounds).toBeUndefined();
    expect(geometry.maximized).toBe(true);
  });

  it('restores saved bounds on the display they were on', () => {
    const bounds = { x: 1600, y: 100, width: 1200, height: 800 };
    expect(pluginViewWindowGeometry({ bounds, maximized: true }, [primary, external], primary)).toEqual({
      options: { ...bounds, minWidth: 720, minHeight: 480 },
      bounds,
      maximized: true
    });
  });

  it('moves bounds from a disconnected display back onto the primary one', () => {
    const geometry = pluginViewWindowGeometry({ bounds: { x: 5000, y: 100, width: 1200, height: 800 }, maximized: false }, [primary], primary);
    expect(geometry.bounds).toEqual({ x: 0, y: 25, width: 1200, height: 800 });
  });
});

describe('pluginViewMenuRoute', () => {
  it('closes the view window for Close Tab and sends everything else to the main window', () => {
    expect(pluginViewMenuRoute('app:closeTab')).toBe('close');
    for (const channel of ['app:openSettings', 'app:openPalette', 'app:newClaudeTab', 'app:toggleInbox']) {
      expect(pluginViewMenuRoute(channel)).toBe('main');
    }
  });
});
