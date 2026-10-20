/**
 * @vitest-environment happy-dom
 */
import { cleanup, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginSdkApp, ZccDeepLinks } from '@zana-ai/zcc-plugin-sdk/app';
import { emptyRegistrationSet } from '@zana-ai/zcc-plugin-sdk';
import { registerAppNavigate } from '../lib/app-navigate.js';
import { useUi } from '../store.js';
import {
  DEEP_LINK_QUEUE_LIMIT,
  DEEP_LINK_QUEUE_TTL_MS,
  deepLinksFor,
  deliverDeepLink,
  getDeepLinkBase,
  installDeepLinkBridge,
  onPluginDeepLink,
  openDeepLink,
  resetDeepLinksForTests,
  routeDeepLink
} from './plugin-deep-links.js';
import { installPluginRuntime } from './plugin-runtime.js';
import { PluginRuntimeContext } from './PluginSlotBoundary.js';
import { clearPluginSlots, replacePluginSlots } from './plugin-slots.js';

const navPanel = (pluginId: string) =>
  ({ pluginId, id: 'home', path: 'home', title: 'Home', icon: 'x', component: () => null }) as never;

function loadPlugin(pluginId: string, extra: Record<string, unknown> = {}) {
  replacePluginSlots(pluginId, { ...emptyRegistrationSet(pluginId, 1), ...extra });
}

type Cc = NonNullable<Window['cc']>;
function installCc(deepLinks: Cc['deepLinks']) {
  (window as unknown as { cc: unknown }).cc = { deepLinks };
}

const navigate = vi.fn();

beforeEach(() => {
  resetDeepLinksForTests();
  navigate.mockReset();
  registerAppNavigate(navigate);
  useUi.setState({ toasts: [] } as never);
});

afterEach(() => {
  cleanup();
  registerAppNavigate(null);
  clearPluginSlots('docs-like');
  clearPluginSlots('tabbed');
  delete (window as unknown as { cc?: unknown }).cc;
  vi.useRealTimers();
});

describe('delivery and queueing', () => {
  it('delivers to a registered handler', () => {
    const handler = vi.fn();
    onPluginDeepLink('docs-like', 'join', handler);
    deliverDeepLink({ pluginId: 'docs-like', route: 'join', payload: 'p' });
    expect(handler).toHaveBeenCalledWith('p');
  });

  it('queues until a handler registers, then replays in order once', () => {
    deliverDeepLink({ pluginId: 'docs-like', route: 'join', payload: '1' });
    deliverDeepLink({ pluginId: 'docs-like', route: 'other', payload: 'x' });
    deliverDeepLink({ pluginId: 'docs-like', route: 'join', payload: null });
    const handler = vi.fn();
    const off = onPluginDeepLink('docs-like', 'join', handler);
    expect(handler.mock.calls).toEqual([['1'], [null]]);
    off();
    const again = vi.fn();
    onPluginDeepLink('docs-like', 'join', again);
    expect(again).not.toHaveBeenCalled();
  });

  it('scopes handlers by plugin and stops after unsubscribe', () => {
    const mine = vi.fn();
    const theirs = vi.fn();
    const off = onPluginDeepLink('docs-like', 'join', mine);
    onPluginDeepLink('tabbed', 'join', theirs);
    off();
    deliverDeepLink({ pluginId: 'docs-like', route: 'join', payload: null });
    expect(mine).not.toHaveBeenCalled();
    expect(theirs).not.toHaveBeenCalled();
  });

  it('bounds the queue and expires old links', () => {
    for (let i = 0; i < DEEP_LINK_QUEUE_LIMIT + 4; i++) deliverDeepLink({ pluginId: 'p', route: 'r', payload: String(i) }, 1000);
    const seen: Array<string | null> = [];
    onPluginDeepLink('p', 'r', (payload) => seen.push(payload), 1000);
    expect(seen).toHaveLength(DEEP_LINK_QUEUE_LIMIT);
    expect(seen[0]).toBe('4');
    deliverDeepLink({ pluginId: 'q', route: 'r', payload: 'old' }, 1000);
    const late = vi.fn();
    onPluginDeepLink('q', 'r', late, 1000 + DEEP_LINK_QUEUE_TTL_MS + 1);
    expect(late).not.toHaveBeenCalled();
  });

  it('keeps delivering when one handler throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const good = vi.fn();
    onPluginDeepLink('p', 'r', () => {
      throw new Error('boom');
    });
    onPluginDeepLink('p', 'r', good);
    deliverDeepLink({ pluginId: 'p', route: 'r', payload: null });
    expect(good).toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('routeDeepLink', () => {
  it('opens the plugin nav panel then delivers the payload', async () => {
    loadPlugin('docs-like', { navPanels: [navPanel('docs-like')] });
    const handler = vi.fn();
    onPluginDeepLink('docs-like', 'join', handler);
    await expect(routeDeepLink({ pluginId: 'docs-like', route: 'join', payload: 'abc' })).resolves.toBe('delivered');
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('docs-like'), undefined);
    expect(handler).toHaveBeenCalledWith('abc');
  });

  it('queues for a view that mounts after routing', async () => {
    loadPlugin('docs-like', { navPanels: [navPanel('docs-like')] });
    await routeDeepLink({ pluginId: 'docs-like', route: 'join', payload: 'late' });
    const handler = vi.fn();
    onPluginDeepLink('docs-like', 'join', handler);
    expect(handler).toHaveBeenCalledWith('late');
  });

  it('opens a project tab for the selected project when the plugin has no nav panel', async () => {
    const tab = { pluginId: 'tabbed', id: 'tab', title: 'Tab', icon: 'x', component: () => null };
    loadPlugin('tabbed', { projectTabs: [tab] });
    useUi.setState({ selectedProjectId: 'proj-1' } as never);
    await routeDeepLink({ pluginId: 'tabbed', route: 'join', payload: null });
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('proj-1'), undefined);
  });

  it('does not navigate when a tab-only plugin has no selected project, but still delivers', async () => {
    const tab = { pluginId: 'tabbed', id: 'tab', title: 'Tab', icon: 'x', component: () => null };
    loadPlugin('tabbed', { projectTabs: [tab] });
    useUi.setState({ selectedProjectId: null } as never);
    const handler = vi.fn();
    onPluginDeepLink('tabbed', 'join', handler);
    await routeDeepLink({ pluginId: 'tabbed', route: 'join', payload: 'z' });
    expect(navigate).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith('z');
  });

  it('toasts and does nothing for a plugin that never loads', async () => {
    const push = vi.fn();
    useUi.setState({ pushToast: push } as never);
    await expect(routeDeepLink({ pluginId: 'ghost', route: 'join', payload: null }, { pluginWaitMs: 5 })).resolves.toBe('unknown-plugin');
    expect(push).toHaveBeenCalledWith(expect.stringContaining('installed'), 'error');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('waits for a plugin that finishes loading shortly after the link', async () => {
    const pending = routeDeepLink({ pluginId: 'docs-like', route: 'join', payload: null }, { pluginWaitMs: 1000 });
    loadPlugin('docs-like', { navPanels: [navPanel('docs-like')] });
    await expect(pending).resolves.toBe('delivered');
  });

  it.each([null, 'x', { pluginId: 'A', route: 'r', payload: null }, { pluginId: 'a', route: '../x', payload: null }, { pluginId: 'a', route: 'r', payload: 5 }])(
    'ignores a malformed delivery %j',
    async (bad) => {
      await expect(routeDeepLink(bad)).resolves.toBe('invalid');
      expect(navigate).not.toHaveBeenCalled();
    }
  );
});

describe('bridge and runtime hook', () => {
  it('is a no-op outside the desktop app', async () => {
    expect(installDeepLinkBridge()()).toBeUndefined();
    expect(getDeepLinkBase()).toBeNull();
    await expect(openDeepLink('x://plugin/a/b')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('fetches the base, routes pushes from main, and unsubscribes', async () => {
    loadPlugin('docs-like', { navPanels: [navPanel('docs-like')] });
    let push: (d: unknown) => void = () => undefined;
    const off = vi.fn();
    installCc({
      config: async () => ({ base: 'test-scheme://', acceptSchemes: ['test-scheme'] }),
      open: async () => ({ ok: true, pluginId: 'a', route: 'b' }),
      onLink: (cb) => {
        push = cb as never;
        return off;
      }
    });
    const handler = vi.fn();
    onPluginDeepLink('docs-like', 'join', handler);
    const stop = installDeepLinkBridge();
    await vi.waitFor(() => expect(getDeepLinkBase()).toBe('test-scheme://'));
    push({ pluginId: 'docs-like', route: 'join', payload: 'v' });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith('v'));
    stop();
    expect(off).toHaveBeenCalled();
  });

  it('ignores a bad config and a failing config call', async () => {
    installCc({ config: async () => ({ base: 5 as never, acceptSchemes: [] }), open: async () => ({ ok: false, reason: 'unavailable' }), onLink: () => () => undefined });
    installDeepLinkBridge();
    await Promise.resolve();
    expect(getDeepLinkBase()).toBeNull();
    installCc({ config: async () => { throw new Error('x'); }, open: async () => ({ ok: false, reason: 'unavailable' }), onLink: () => () => undefined });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => installDeepLinkBridge()()).not.toThrow();
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith(expect.stringContaining('[deep-links] config load failed'), expect.any(Error)));
    warn.mockRestore();
  });

  it('open() goes through main and fails closed on error or bad input', async () => {
    installCc({ config: async () => ({ base: null, acceptSchemes: [] }), open: async () => ({ ok: true, pluginId: 'a', route: 'b' }), onLink: () => () => undefined });
    await expect(openDeepLink('x')).resolves.toEqual({ ok: true, pluginId: 'a', route: 'b' });
    await expect(openDeepLink(5 as never)).resolves.toEqual({ ok: false, reason: 'unavailable' });
    installCc({ config: async () => ({ base: null, acceptSchemes: [] }), open: async () => { throw new Error('ipc'); }, onLink: () => () => undefined });
    await expect(openDeepLink('x')).resolves.toEqual({ ok: false, reason: 'unavailable' });
  });

  it('deepLinksFor ignores invalid routes and handlers', () => {
    const links = deepLinksFor('docs-like');
    expect(links.on('../x', vi.fn())()).toBeUndefined();
    expect(links.on('ok', 'nope' as never)()).toBeUndefined();
    expect(links.base()).toBeNull();
  });

  it('exposes plugin-bound deep links through the runtime hook', () => {
    installPluginRuntime();
    const runtime = (globalThis as { __ZCC_PLUGIN_RUNTIME__?: PluginSdkApp }).__ZCC_PLUGIN_RUNTIME__!;
    const handler = vi.fn();
    let links: ZccDeepLinks | null = null;
    function Probe() {
      links = runtime.useZccDeepLinks!();
      return null;
    }
    render(
      <MemoryRouter>
        <PluginRuntimeContext.Provider value={{ pluginId: 'docs-like', generation: 0 }}>
          <Probe />
        </PluginRuntimeContext.Provider>
      </MemoryRouter>
    );
    links!.on('join', handler);
    deliverDeepLink({ pluginId: 'docs-like', route: 'join', payload: 'hook' });
    expect(handler).toHaveBeenCalledWith('hook');
  });
});
