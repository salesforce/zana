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
});
