/**
 * @vitest-environment happy-dom
 */
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectTestPluginApp } from '@zana-ai/zcc-plugin-sdk/testing/app';

vi.mock('./app/styles.css', () => ({ default: '.prm-panel{color:red}' }));
vi.mock('@zana-ai/zcc-ui/kanban.css', () => ({ default: '.zcc-kanban{}' }));
vi.mock('./app/PrMonitorPanel.js', () => ({
  default: function MockPanel() {
    return <div data-testid="prm-panel-mock">panel</div>;
  }
}));

import app, { injectStyles } from '../app.tsx';

describe('pr-monitor app slots', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.getElementById('prm-plugin-styles')?.remove();
  });

  it('injects CSS, mounts the nav panel, and shows a nav badge count', async () => {
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', {
      callRpc: async (_pluginId: string, method: string) => {
        if (method === 'badge') return { count: 3 };
        if (method === 'listProjects') return [];
        return {};
      }
    });
    const set = collectTestPluginApp(app, 'pr-monitor');
    const Panel = set.navPanels[0]?.component;
    const Badge = set.navPanels[0]?.experimental_sidebarAccessory;
    expect(Panel).toBeTypeOf('function');
    expect(Badge).toBeTypeOf('function');
    render(<Panel pluginId="pr-monitor" subPath="" />);
    expect(screen.getByTestId('prm-panel-mock')).toBeTruthy();
    expect(document.getElementById('prm-plugin-styles')?.textContent).toContain('.prm-panel');
    const { container, unmount } = render(<Badge />);
    await waitFor(() => {
      expect(container.querySelector('.nav-badge')?.textContent).toBe('3');
    });
    const tag = document.getElementById('prm-plugin-styles') as HTMLStyleElement;
    tag.textContent = '.stale{}';
    injectStyles();
    expect(tag.textContent).toContain('.prm-panel');
    document.getElementById('prm-plugin-styles')?.remove();
    injectStyles();
    expect(document.getElementById('prm-plugin-styles')?.textContent).toContain('.prm-panel');
    unmount();
  });

  it('hides the badge when the count is empty', async () => {
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', {
      callRpc: async () => {
        throw new Error('offline');
      }
    });
    const set = collectTestPluginApp(app, 'pr-monitor');
    const Badge = set.navPanels[0]?.experimental_sidebarAccessory;
    const { container, unmount } = render(<Badge />);
    await waitFor(() => {
      expect(container.querySelector('.nav-badge')).toBeNull();
    });
    unmount();
  });

  it('hides a zero badge count', async () => {
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', {
      callRpc: async () => ({ count: 0 })
    });
    const set = collectTestPluginApp(app, 'pr-monitor');
    const Badge = set.navPanels[0]?.experimental_sidebarAccessory;
    const { container, unmount } = render(<Badge />);
    await waitFor(() => {
      expect(container.querySelector('.nav-badge')).toBeNull();
    });
    unmount();
  });

  it('refreshes badge and delivers in-app toast from server poll signal without a timer', async () => {
    let onRealtime: ((payload: unknown) => void) | undefined;
    const callRpc = vi.fn(async (_pluginId: string, method: string) => {
      if (method === 'badge') return { count: callRpc.mock.calls.filter(([, name]) => name === 'badge').length };
      return {};
    });
    const toast = vi.fn();
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', { callRpc });
    vi.stubGlobal('__ZCC_PLUGIN_RUNTIME__', {
      useRealtime: (_channel: string, handler: (payload: unknown) => void) => {
        onRealtime = handler;
      },
      toast
    });
    const set = collectTestPluginApp(app, 'pr-monitor');
    const Badge = set.navPanels[0]?.experimental_sidebarAccessory;
    const { container, unmount } = render(<Badge />);
    await waitFor(() => expect(container.querySelector('.nav-badge')?.textContent).toBe('1'));
    onRealtime?.({
      inAppDeltas: [{
        url: 'https://github.com/acme/app/pull/1', oldStatus: 'yellow', newStatus: 'green', pr: {
          url: 'https://github.com/acme/app/pull/1', repo: 'acme/app', number: 1, title: 'Fix', status: 'green',
          addedAt: 1, lastChecked: 1, lastStatusChange: 1, baseRefName: 'main', mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN', checks: []
        }
      }]
    });
    await waitFor(() => expect(container.querySelector('.nav-badge')?.textContent).toBe('2'));
    expect(toast).toHaveBeenCalledWith('acme/app#1: Merge blocked -> All checks passing', 'info');
    unmount();
  });

  it('keeps newest badge response when refreshes resolve out of order', async () => {
    let resolveFirst: ((value: unknown) => void) | undefined;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    let onRealtime: ((payload: unknown) => void) | undefined;
    const callRpc = vi.fn(async (_pluginId: string, method: string) => {
      if (method !== 'badge') return {};
      if (callRpc.mock.calls.filter(([, name]) => name === 'badge').length === 1) return first;
      return { count: 2 };
    });
    vi.stubGlobal('__ZCC_PLUGIN_HOST__', { callRpc });
    vi.stubGlobal('__ZCC_PLUGIN_RUNTIME__', {
      useRealtime: (_channel: string, handler: (payload: unknown) => void) => {
        onRealtime = handler;
      }
    });
    const Badge = collectTestPluginApp(app, 'pr-monitor').navPanels[0]?.experimental_sidebarAccessory;
    const { container, unmount } = render(<Badge />);
    onRealtime?.({});
    await waitFor(() => expect(container.querySelector('.nav-badge')?.textContent).toBe('2'));
    resolveFirst?.({ count: 1 });
    await Promise.resolve();
    expect(container.querySelector('.nav-badge')?.textContent).toBe('2');
    unmount();
  });
});
