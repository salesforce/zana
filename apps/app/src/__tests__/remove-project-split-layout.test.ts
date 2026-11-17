// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useData, useUi } from '../store.js';
import { useSplitWorkspace } from '../lib/split-layout/store.js';
import { projectSplitScopeKey } from '../lib/split-layout/scope.js';
import type { SplitLayout } from '../lib/split-layout/types.js';

const remove = vi.fn();
const setConfig = vi.fn(async () => ({}));

vi.mock('../lib/product-client.js', () => ({
  product: {
    projects: { remove: (...args: unknown[]) => remove(...args) },
    config: { set: (...args: unknown[]) => setConfig(...args) }
  }
}));

const layout = {
  root: {
    kind: 'split',
    id: 'root',
    dir: 'row',
    sizes: [0.5, 0.5],
    children: [
      { kind: 'pane', paneId: 'a', content: { kind: 'route', path: '/inbox' } },
      { kind: 'pane', paneId: 'b', content: { kind: 'route', path: '/' } }
    ]
  },
  focusedPaneId: 'a'
} as unknown as SplitLayout;

beforeEach(() => {
  remove.mockReset();
  setConfig.mockClear();
  useData.setState({
    projects: [{ id: 'project-1', name: 'P', path: '/tmp/p', createdAt: 1, lastActiveAt: 1 }],
    terminals: {}
  });
  useSplitWorkspace.setState({
    scopes: { [projectSplitScopeKey('project-1')]: { layout, maximizedPaneId: null } }
  });
});

describe('useData.removeProject forgets the project split layout', () => {
  it('drops the saved layout once the project is removed', async () => {
    remove.mockResolvedValue(undefined);

    await useData.getState().removeProject('project-1');

    expect(useSplitWorkspace.getState().scopes[projectSplitScopeKey('project-1')]).toBeUndefined();
  });

  it('keeps the layout when removing the project fails', async () => {
    remove.mockRejectedValue(new Error('busy'));

    await useData.getState().removeProject('project-1');

    expect(useSplitWorkspace.getState().scopes[projectSplitScopeKey('project-1')]?.layout).toBe(layout);
  });

  it('drops and persists projectExpanded entries (including machine-scoped keys) for the removed project', async () => {
    vi.useFakeTimers();
    try {
      remove.mockResolvedValue(undefined);
      useUi.setState({
        projectExpanded: {
          'project-1': false,
          'local:project-1': false,
          'remote-1:project-1': true,
          'project-2': false
        }
      });

      await useData.getState().removeProject('project-1');
      expect(useUi.getState().projectExpanded).toEqual({ 'project-2': false });

      vi.advanceTimersByTime(200);
      expect(setConfig).toHaveBeenCalledWith({ projectExpanded: { 'project-2': false } });
    } finally {
      vi.useRealTimers();
    }
  });
});
