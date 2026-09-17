import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PluginThreadPanelActionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { renderToStaticMarkup } from 'react-dom/server';

const projects = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name?: string; path?: string }>,
  actions: [] as PluginThreadPanelActionRegistration[]
}));

vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string }> }) => unknown) => selector({ projects: projects.current })
}));
vi.mock('../../../views/project/ProjectExtensionTab.js', () => ({
  ProjectExtensionTab: () => <div>plugin</div>
}));
vi.mock('../../../plugins/PluginSlotBoundary.js', () => ({
  PluginSlotBoundary: ({ children }: { children: React.ReactNode }) => children
}));

vi.mock('../../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listThreadPanelActions: () => projects.actions,
  listNewThreadPanelActions: () => []
}));

import { ThreadPluginTab } from './ThreadPluginTab.js';

describe('ThreadPluginTab', () => {
  beforeEach(() => { projects.current = []; projects.actions = []; });

  it.each(['thread-id', 'cli-session-id'])('passes the owning project to native panels for %s', (threadId) => {
    projects.actions = [{
      pluginId: 'example', id: 'inspect', title: 'Inspect', generation: 1,
      component: (props) => <output>{JSON.stringify(props)}</output>
    }];
    const html = renderToStaticMarkup(<ThreadPluginTab moduleId="example" actionId="inspect" projectId="owner-project" threadId={threadId} params={{ record: '123' }} />);
    expect(html).toContain('owner-project');
    expect(html).toContain(threadId);
    expect(html).toContain('123');
    expect(html).not.toContain('Project is unavailable');
  });

  it('keeps unavailable project context optional for native panels', () => {
    projects.actions = [{
      pluginId: 'example', id: 'inspect', title: 'Inspect', generation: 1,
      component: ({ projectId }) => <output>{projectId === undefined ? 'no owner' : projectId}</output>
    }];
    expect(renderToStaticMarkup(<ThreadPluginTab moduleId="example" actionId="inspect" projectId={null} />)).toContain('no owner');
  });

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
