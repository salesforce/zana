// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  config: {} as Record<string, unknown>,
  plugins: [] as Array<{ id: string; enabled: boolean; peers?: boolean }>,
  configFails: false,
  pluginsFail: false,
  emitConfig: null as ((c: Record<string, unknown>) => void) | null,
  emitPlugins: null as ((p: unknown[]) => void) | null,
  offConfig: vi.fn(),
  offPlugins: vi.fn()
}));

vi.mock('./product-client.js', () => ({
  product: {
    config: {
      get: () => (h.configFails ? Promise.reject(new Error('boom')) : Promise.resolve(h.config)),
      onChanged: (cb: (c: Record<string, unknown>) => void) => { h.emitConfig = cb; return h.offConfig; }
    },
    pluginApps: {
      list: () => (h.pluginsFail ? Promise.reject(new Error('boom')) : Promise.resolve(h.plugins)),
      onChanged: (cb: (p: unknown[]) => void) => { h.emitPlugins = cb; return h.offPlugins; }
    }
  }
}));

import {
  PEERS_SETTINGS_SECTION,
  hiddenSettingsSections,
  isPeersSettingsVisible,
  pluginSupportsPeers,
  usePeersSettingsVisibility
} from './peers-visibility.js';
import { visibleSettingsSections } from '../views/settings/settings-navigation.js';

beforeEach(() => {
  h.config = {};
  h.plugins = [];
  h.configFails = false;
  h.pluginsFail = false;
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('pluginSupportsPeers', () => {
  it('requires the peers declaration and an enabled plugin', () => {
    expect(pluginSupportsPeers({ enabled: true, peers: true })).toBe(true);
    expect(pluginSupportsPeers({ enabled: false, peers: true })).toBe(false);
    expect(pluginSupportsPeers({ enabled: true, peers: false })).toBe(false);
    expect(pluginSupportsPeers({ enabled: true })).toBe(false);
  });
});

describe('isPeersSettingsVisible (all four combinations)', () => {
  const capable = [{ enabled: true, peers: true }];
  const incapable = [{ enabled: true }, { enabled: false, peers: true }];
  it.each([
    ['toggle off, no capable plugin', false, incapable, false],
    ['toggle off, capable plugin', false, capable, false],
    ['toggle on, no capable plugin', true, incapable, false],
    ['toggle on, capable plugin', true, capable, true]
  ])('%s', (_name, enabled, plugins, expected) => {
    expect(isPeersSettingsVisible({ peersSettingsEnabled: enabled }, plugins)).toBe(expected);
  });

  it('treats missing config or plugins as hidden', () => {
    expect(isPeersSettingsVisible(null, [{ enabled: true, peers: true }])).toBe(false);
    expect(isPeersSettingsVisible({}, [{ enabled: true, peers: true }])).toBe(false);
    expect(isPeersSettingsVisible({ peersSettingsEnabled: true }, null)).toBe(false);
  });
});

describe('settings navigation gating', () => {
  it('hides only the peers section when the gate is closed', () => {
    const hidden = hiddenSettingsSections(false);
    expect([...hidden]).toEqual([PEERS_SETTINGS_SECTION]);
    const ids = visibleSettingsSections(hidden).map((s) => s.id);
    expect(ids).not.toContain('peers');
    expect(ids).toContain('machines');
    expect(ids).toContain('experimental');
  });

  it('keeps every section when the gate is open', () => {
    const hidden = hiddenSettingsSections(true);
    expect(hidden.size).toBe(0);
    expect(visibleSettingsSections(hidden).map((s) => s.id)).toContain('peers');
  });
});

describe('usePeersSettingsVisibility', () => {
  it('is not ready until config and plugins resolve, then reflects both gates', async () => {
    h.config = { peersSettingsEnabled: true };
    h.plugins = [{ id: 'a', enabled: true, peers: true }];
    const { result, unmount } = renderHook(() => usePeersSettingsVisibility());
    expect(result.current).toEqual({ visible: false, ready: false });
    await waitFor(() => expect(result.current).toEqual({ visible: true, ready: true }));
    unmount();
    expect(h.offConfig).toHaveBeenCalled();
    expect(h.offPlugins).toHaveBeenCalled();
  });

  it('stays hidden but ready when the toggle is off or the plugin lacks peers', async () => {
    h.config = { peersSettingsEnabled: false };
    h.plugins = [{ id: 'a', enabled: true, peers: true }];
    const { result } = renderHook(() => usePeersSettingsVisibility());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.visible).toBe(false);
  });

  it('settles as hidden when loading fails', async () => {
    h.configFails = true;
    h.pluginsFail = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result } = renderHook(() => usePeersSettingsVisibility());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.visible).toBe(false);
    expect(warn).toHaveBeenCalledWith('[peers] visibility config load failed', expect.any(Error));
    expect(warn).toHaveBeenCalledWith('[peers] visibility plugin list load failed', expect.any(Error));
    warn.mockRestore();
  });

  it('reacts to live config and plugin changes', async () => {
    const { result } = renderHook(() => usePeersSettingsVisibility());
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.visible).toBe(false);
    act(() => h.emitConfig?.({ peersSettingsEnabled: true }));
    expect(result.current.visible).toBe(false);
    act(() => h.emitPlugins?.([{ id: 'a', enabled: true, peers: true }]));
    expect(result.current.visible).toBe(true);
    act(() => h.emitPlugins?.([{ id: 'a', enabled: false, peers: true }]));
    expect(result.current.visible).toBe(false);
  });
});

describe('usePeersSettingsVisibility after unmount', () => {
  it('ignores late resolutions, rejections and change events once cancelled', async () => {
    const deferred = <T,>() => {
      let resolve!: (v: T) => void; let reject!: (e: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    };
    const cfg = deferred<Record<string, unknown>>();
    const pl = deferred<unknown[]>();
    const { product } = await import('./product-client.js');
    const cfgSpy = vi.spyOn(product.config, 'get').mockReturnValue(cfg.promise as never);
    const plSpy = vi.spyOn(product.pluginApps, 'list').mockReturnValue(pl.promise as never);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { result, unmount } = renderHook(() => usePeersSettingsVisibility());
    const emitConfig = h.emitConfig; const emitPlugins = h.emitPlugins;
    unmount();
    cfg.resolve({ peersSettingsEnabled: true });
    pl.reject(new Error('late'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    emitConfig?.({ peersSettingsEnabled: true });
    emitPlugins?.([{ id: 'a', enabled: true, peers: true }]);
    expect(result.current).toEqual({ visible: false, ready: false });
    cfgSpy.mockRestore(); plSpy.mockRestore(); warn.mockRestore();
  });
});
