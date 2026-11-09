// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PluginContentScriptContext } from '@zana-ai/zcc-plugin-sdk/app';
const h = vi.hoisted(() => ({ scripts: [] as any[], sync: () => {}, observe: vi.fn(), subscribe: vi.fn(), providers: [] as any[], config: {} as any, changed: (_: any) => {}, get: vi.fn() }));
vi.mock('./plugin-slots.js', () => ({ listContentScripts: () => h.scripts, listNotificationSoundProviders: () => h.providers, subscribePluginSlots: (fn: () => void) => { h.sync = fn; return vi.fn(); } }));
vi.mock('./agent-activity.js', () => ({ observeAgentActivity: h.observe }));
vi.mock('../lib/product-ws.js', () => ({ subscribeProductEvent: h.subscribe }));
vi.mock('../lib/product-client.js', () => ({ product: { config: { get: h.get, onChanged: (fn: any) => { h.changed = fn; return vi.fn(); } } } }));
import { PluginContentScriptsHost } from './PluginContentScriptsHost.js';
const flush = async () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
beforeEach(() => { h.scripts = []; h.providers = []; h.config = {}; h.get.mockReset().mockResolvedValue(h.config); h.observe.mockReset(); h.subscribe.mockReset(); });
afterEach(() => cleanup());
it('mounts once, filters signals to this plugin/channel, isolates listeners and disposes on reload', async () => {
  let context!: PluginContentScriptContext;
  const dispose = vi.fn(), agentOff = vi.fn(), signalOff = vi.fn(), listener = vi.fn();
  h.observe.mockReturnValue(agentOff); h.subscribe.mockReturnValue(signalOff);
  const mount = vi.fn((ctx: PluginContentScriptContext) => { context = ctx; return dispose; });
  h.scripts = [{ pluginId: 'one', id: 'background', generation: 1, mount }]; render(<PluginContentScriptsHost/>); await flush();
  act(() => h.sync()); await flush(); expect(mount).toHaveBeenCalledTimes(1);
  context.experimental_observeAgents!(listener); context.experimental_onSignal!('changed', listener);
  const signal = h.subscribe.mock.calls[0]![1]; signal({ pluginId: 'two', channel: 'changed', payload: 1 }); signal({ pluginId: 'one', channel: 'other', payload: 2 }); expect(listener).not.toHaveBeenCalled();
  signal({ pluginId: 'one', channel: 'changed', payload: 3 }); expect(listener).toHaveBeenCalledWith(3);
  listener.mockImplementation(() => { throw new Error('bad plugin'); }); expect(() => h.observe.mock.calls[0]![0]({ ready: true, agents: [] })).not.toThrow(); expect(() => signal({ pluginId: 'one', channel: 'changed', payload: 4 })).not.toThrow();
  h.scripts = []; act(() => h.sync()); expect(context.signal.aborted).toBe(true); expect(dispose).toHaveBeenCalledOnce(); expect(agentOff).toHaveBeenCalledOnce(); expect(signalOff).toHaveBeenCalledOnce();
  context.experimental_observeAgents!(listener)(); context.experimental_onSignal!('changed', listener)(); expect(h.observe).toHaveBeenCalledTimes(1); expect(h.subscribe).toHaveBeenCalledTimes(1);
});
it('releases explicitly removed subscriptions and aborts pending async mounts', async () => {
  let context!: PluginContentScriptContext, finish!: (value: () => void) => void;
  const off = vi.fn(), lateDispose = vi.fn(); h.observe.mockReturnValue(off);
  h.scripts = [{ pluginId: 'one', id: 'x', generation: 1, mount: (ctx: PluginContentScriptContext) => { context = ctx; return new Promise(resolve => { finish = resolve; }); } }];
  const view = render(<PluginContentScriptsHost/>); await flush(); context.experimental_observeAgents!(() => {})(); expect(off).toHaveBeenCalledTimes(1);
  view.unmount(); expect(context.signal.aborted).toBe(true); expect(off).toHaveBeenCalledTimes(1); finish(lateDispose); await flush(); expect(lateDispose).toHaveBeenCalledOnce();
});
it('isolates synchronous failures and skips mounts aborted before their turn', async () => {
  const broken = vi.fn(() => { throw new Error('broken'); }), okay = vi.fn();
  h.scripts = [{ pluginId: 'one', id: 'x', generation: 1, mount: broken }, { pluginId: 'two', id: 'x', generation: 1, mount: okay }]; render(<PluginContentScriptsHost/>); await flush(); expect(okay).toHaveBeenCalledOnce(); cleanup();
  h.scripts = [{ pluginId: 'one', id: 'x', generation: 2, mount: okay }]; const view = render(<PluginContentScriptsHost/>); view.unmount(); await flush(); expect(okay).toHaveBeenCalledTimes(1);
});

it('mounts one selected sound provider and aborts it on master disable, switch, reload and removal', async () => {
  const one = vi.fn(), two = vi.fn(), dispose = vi.fn();
  let signal!: AbortSignal;
  one.mockImplementation((ctx: PluginContentScriptContext) => { signal = ctx.signal; return dispose; });
  h.providers = [{ pluginId: 'one', id: 'voice', generation: 1, mount: one }, { pluginId: 'two', id: 'voice', generation: 1, mount: two }];
  render(<PluginContentScriptsHost/>); await flush(); expect(one).not.toHaveBeenCalled();
  act(() => h.changed({ notificationSoundProvider: 'one/voice', notificationSoundsEnabled: true })); await flush();
  expect(one).toHaveBeenCalledTimes(1); expect(two).not.toHaveBeenCalled();
  act(() => h.changed({ notificationSoundProvider: 'two/voice', notificationSoundsEnabled: false })); await flush();
  expect(signal.aborted).toBe(true); expect(dispose).toHaveBeenCalledTimes(1); expect(two).not.toHaveBeenCalled();
  act(() => h.changed({ notificationSoundProvider: 'two/voice', notificationSoundsEnabled: true })); await flush(); expect(two).toHaveBeenCalledTimes(1);
  h.providers[1] = { ...h.providers[1], generation: 2 }; act(() => h.sync()); await flush(); expect(two).toHaveBeenCalledTimes(2);
  h.providers = []; act(() => h.sync()); await flush();
  act(() => h.changed({ notificationSoundProvider: 'missing/voice', notificationSoundsEnabled: true })); await flush();
  expect(one).toHaveBeenCalledTimes(1); expect(two).toHaveBeenCalledTimes(2);
});
it('does not overwrite newer sound config with a stale initial read or mount after shutdown', async () => {
  let resolve!: (config: any) => void;
  h.get.mockImplementation(() => new Promise(done => { resolve = done; }));
  const mount = vi.fn(); h.providers = [{ pluginId: 'one', id: 'voice', generation: 1, mount }];
  const view = render(<PluginContentScriptsHost/>); await flush();
  act(() => h.changed({ notificationSoundProvider: 'one/voice', notificationSoundsEnabled: false }));
  resolve({ notificationSoundProvider: 'one/voice', notificationSoundsEnabled: true }); await flush(); expect(mount).not.toHaveBeenCalled();
  view.unmount(); render(<PluginContentScriptsHost/>); await flush(); cleanup();
  resolve({ notificationSoundProvider: 'one/voice', notificationSoundsEnabled: true }); await flush(); expect(mount).not.toHaveBeenCalled();
});
it('keeps sound providers off if the config read fails', async () => {
  h.get.mockRejectedValue(new Error('offline'));
  const mount = vi.fn(); h.providers = [{ pluginId: 'one', id: 'voice', generation: 1, mount }];
  render(<PluginContentScriptsHost/>); await flush(); expect(mount).not.toHaveBeenCalled();
});
