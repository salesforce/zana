/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { interpretPluginApp, clearPluginSlots } from './plugin-slots.js';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { openPluginThreadPanel } from './plugin-thread-panel.js';

afterEach(() => {
  clearPluginSlots('tasks');
});

describe('openPluginThreadPanel', () => {
  it('returns false when there is no thread', () => {
    expect(
      openPluginThreadPanel({ pluginId: 'tasks', threadId: null, actionId: 'board' })
    ).toBe(false);
  });

  it('returns false when the action is not registered', () => {
    expect(
      openPluginThreadPanel({ pluginId: 'tasks', threadId: 'thr_1', actionId: 'board' })
    ).toBe(false);
  });

  it('opens a registered thread panel and notifies listeners', () => {
    interpretPluginApp(
      'tasks',
      definePluginApp((app) => {
        app.slots.threadPanelAction({
          id: 'board',
          title: 'Tasks',
          component: () => null
        });
      })
    );
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    expect(
      openPluginThreadPanel({ pluginId: 'tasks', threadId: 'thr_1', actionId: 'board' })
    ).toBe(true);
    expect(dispatch).toHaveBeenCalled();
    dispatch.mockRestore();
  });

  it('opens a plugin page\'s own tool only in that page\'s panel', () => {
    interpretPluginApp(
      'tasks',
      definePluginApp((app) => {
        app.slots.threadPanelAction({ id: 'graph', title: 'Graph', scopes: ['plugin-page'], component: () => null });
        app.slots.threadPanelAction({ id: 'cli', title: 'CLI', scopes: ['agent-session'], component: () => null });
      })
    );
    expect(openPluginThreadPanel({ pluginId: 'tasks', threadId: 'thr_1', actionId: 'graph' })).toBe(false);
    expect(openPluginThreadPanel({ pluginId: 'tasks', threadId: 'plugin-panel:tasks:board@p1', actionId: 'graph' })).toBe(true);
    expect(openPluginThreadPanel({ pluginId: 'tasks', threadId: 'cli_1', actionId: 'cli' })).toBe(true);
  });
});
