import { describe, it, expect, vi, afterEach } from 'vitest';
import pluginApp, { resolveTarget } from './app.js';

function el(tag, attrs = {}, parent = null) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    parentElement: parent,
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    }
  };
  return node;
}

describe('resolveTarget', () => {
  it('walks nested nodes to the nearest testid and actionable role', () => {
    const button = el('button', { 'data-testid': 'agent-delete-quick', role: 'button' });
    const icon = el('span', {}, button);
    expect(resolveTarget(icon)).toEqual({ testid: 'agent-delete-quick', role: 'button' });
  });

  it('returns empty fields for a non-element target', () => {
    expect(resolveTarget({ nodeType: 3, parentElement: null })).toEqual({
      testid: null,
      role: null
    });
  });

  it('maps actionable tags and ARIA roles', () => {
    expect(resolveTarget(el('a', { href: '#' })).role).toBe('a');
    expect(resolveTarget(el('div', { role: 'tab' })).role).toBe('tab');
    expect(resolveTarget(el('div', { role: 'menuitem' })).role).toBe('menuitem');
  });

  it('maps actionable input types', () => {
    expect(resolveTarget(el('input', { type: 'submit' })).role).toBe('input:submit');
    expect(resolveTarget(el('input', { type: 'checkbox' })).role).toBe('input:checkbox');
    expect(resolveTarget(el('input', { type: 'text' }))).toEqual({ testid: null, role: null });
  });

  it('ignores unidentified clicks', () => {
    expect(resolveTarget(el('div', { class: 'card' }))).toEqual({ testid: null, role: null });
  });
});

describe('ui-click content script', () => {
  afterEach(() => {
    delete globalThis.document;
    delete globalThis.__ZCC_PLUGIN_HOST__;
  });

  function mountTracker({ callRpc, signal } = {}) {
    const listeners = [];
    const doc = {
      addEventListener: vi.fn((type, fn, opts) => {
        listeners.push({ type, fn, opts });
      }),
      removeEventListener: vi.fn()
    };
    globalThis.document = doc;
    globalThis.__ZCC_PLUGIN_HOST__ = {
      callRpc: callRpc ?? vi.fn(() => Promise.resolve({ ok: true }))
    };

    let dispose;
    pluginApp.setup({
      contentScripts: {
        register({ id, mount }) {
          // This describe block only exercises the ui-click tracker; the
          // page-view tracker (registered separately) has its own describe
          // block below and would otherwise clobber `dispose` here.
          if (id !== 'ui-click-tracker') return;
          dispose = mount({ pluginId: 'posthog-analytics', signal });
        }
      }
    });
    return { doc, listeners, dispose, host: globalThis.__ZCC_PLUGIN_HOST__ };
  }

  it('reports testid and role over RPC and ignores unidentified clicks', () => {
    const { listeners, host } = mountTracker();
    expect(listeners).toHaveLength(1);
    expect(listeners[0].opts).toEqual({ capture: true });

    const button = el('button', { 'data-testid': 'agent-delete-quick' });
    listeners[0].fn({ target: button });
    expect(host.callRpc).toHaveBeenCalledWith('posthog-analytics', 'trackUiClick', {
      testid: 'agent-delete-quick',
      role: 'button'
    });

    host.callRpc.mockClear();
    listeners[0].fn({ target: el('div') });
    expect(host.callRpc).not.toHaveBeenCalled();
  });

  it('disposes the capture listener on return and abort', () => {
    const ac = new AbortController();
    const { doc, dispose } = mountTracker({ signal: ac.signal });
    dispose();
    expect(doc.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function), {
      capture: true
    });

    doc.removeEventListener.mockClear();
    const second = mountTracker({ signal: ac.signal });
    ac.abort();
    expect(second.doc.removeEventListener).toHaveBeenCalledWith('click', expect.any(Function), {
      capture: true
    });
  });

  it('swallows synchronous RPC failures', () => {
    const { listeners } = mountTracker({
      callRpc: () => {
        throw new Error('sync rpc down');
      }
    });
    expect(() => listeners[0].fn({ target: el('button', { 'data-testid': 'x' }) })).not.toThrow();
  });

  it('swallows asynchronous RPC failures', async () => {
    const { listeners } = mountTracker({
      callRpc: () => Promise.reject(new Error('async rpc down'))
    });
    expect(() => listeners[0].fn({ target: el('button', { 'data-testid': 'x' }) })).not.toThrow();
    await Promise.resolve();
  });
});

describe('page-view content script', () => {
  let originalLocation;
  let originalHistory;
  let originalAdd;
  let originalRemove;

  afterEach(() => {
    delete globalThis.__ZCC_PLUGIN_HOST__;
    if (originalLocation !== undefined) {
      Object.defineProperty(globalThis, 'location', { value: originalLocation, configurable: true });
    }
    if (originalHistory !== undefined) {
      Object.defineProperty(globalThis, 'history', { value: originalHistory, configurable: true });
    }
    if (originalAdd !== undefined) globalThis.addEventListener = originalAdd;
    if (originalRemove !== undefined) globalThis.removeEventListener = originalRemove;
  });

  function mountPageViewTracker({ callRpc, path = '/inbox' } = {}) {
    const listeners = [];
    const win = {
      location: { pathname: path },
      history: { pushState: () => {}, replaceState: () => {} },
      addEventListener: vi.fn((type, fn) => listeners.push({ type, fn })),
      removeEventListener: vi.fn()
    };
    globalThis.__ZCC_PLUGIN_HOST__ = {
      callRpc: callRpc ?? vi.fn(() => Promise.resolve({ ok: true }))
    };

    originalLocation = globalThis.location;
    originalHistory = globalThis.history;
    originalAdd = globalThis.addEventListener;
    originalRemove = globalThis.removeEventListener;
    // The content script reads globalThis.location/history directly, so this
    // test swaps them out for the fake `win` for the duration of this test.
    Object.defineProperty(globalThis, 'location', { value: win.location, configurable: true });
    Object.defineProperty(globalThis, 'history', { value: win.history, configurable: true });
    globalThis.addEventListener = win.addEventListener;
    globalThis.removeEventListener = win.removeEventListener;

    let dispose;
    pluginApp.setup({
      contentScripts: {
        register({ id, mount }) {
          if (id !== 'page-view-tracker') return;
          dispose = mount({ pluginId: 'posthog-analytics' });
        }
      }
    });
    return { win, listeners, dispose, host: globalThis.__ZCC_PLUGIN_HOST__ };
  }

  it('reports a from/to/durationMs payload on a pushState navigation', () => {
    const { win, host } = mountPageViewTracker({ path: '/inbox' });
    win.location.pathname = '/agents';
    win.history.pushState('', '', '/agents');
    expect(host.callRpc).toHaveBeenCalledWith(
      'posthog-analytics',
      'trackPageView',
      expect.objectContaining({ from: 'inbox', to: 'agents' })
    );
  });

  it('does not report a transition to the same section', () => {
    const { win, host } = mountPageViewTracker({ path: '/inbox' });
    win.history.pushState('', '', '/inbox');
    expect(host.callRpc).not.toHaveBeenCalled();
  });

  it('swallows synchronous RPC failures', () => {
    const { win } = mountPageViewTracker({
      path: '/inbox',
      callRpc: () => {
        throw new Error('sync rpc down');
      }
    });
    win.location.pathname = '/agents';
    expect(() => win.history.pushState('', '', '/agents')).not.toThrow();
  });
});
