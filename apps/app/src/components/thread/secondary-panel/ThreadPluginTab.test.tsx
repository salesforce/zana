import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const projects = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name?: string; path?: string }>
}));

vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string }> }) => unknown) => selector({ projects: projects.current })
}));
vi.mock('../../../views/project/ProjectExtensionTab.js', () => ({
  ProjectExtensionTab: () => <div>plugin</div>
}));

vi.mock('../../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listThreadPanelActions: () => [],
  listNewThreadPanelActions: () => []
}));

import { ThreadPluginTab } from './ThreadPluginTab.js';

describe('ThreadPluginTab', () => {
  it('shows a placeholder when the project is missing', () => {
    projects.current = [];
    const html = renderToStaticMarkup(
      <ThreadPluginTab moduleId="docs" projectId="missing" />
    );
    expect(html).toContain('Project is unavailable');
  });

  it('mounts the project extension tab when the project exists', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    const html = renderToStaticMarkup(
      <ThreadPluginTab moduleId="docs" projectId="p1" />
    );
    expect(html).toContain('data-testid="thread-plugin-tab"');
    expect(html).toContain('plugin');
    projects.current = [];
  });
});
