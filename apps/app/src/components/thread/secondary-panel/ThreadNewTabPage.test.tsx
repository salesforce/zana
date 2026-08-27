import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('../../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => false
}));
vi.mock('../../../lib/product-client.js', () => ({
  product: { fs: {} }
}));
vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
}));
vi.mock('../../../plugins/plugin-slots.js', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listThreadPanelActions: () => [
    { pluginId: 'tasks', id: 'board', title: 'Tasks', layout: 'padded' }
  ],
  listNewThreadPanelActions: () => []
}));

import { ThreadNewTabPage, ThreadNewTabView } from './ThreadNewTabPage.js';

describe('ThreadNewTabPage', () => {
  it('shows Start terminal and hides Open browser without a desktop bridge', () => {
    const html = renderToStaticMarkup(
      <ThreadNewTabPage
        projectId={null}
        cwd={null}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(html).toContain('data-testid="thread-new-tab-page"');
    expect(html).toContain('data-testid="thread-new-tab-terminal"');
    expect(html).toContain('Start terminal');
    expect(html).not.toContain('data-testid="thread-new-tab-browser"');
    expect(html).not.toContain('data-testid="thread-new-tab-explorer"');
    expect(html).toContain('Tasks');

    const withProject = renderToStaticMarkup(
      <ThreadNewTabPage
        projectId="p1"
        cwd={null}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onOpenExplorer={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(withProject).toContain('data-testid="thread-new-tab-explorer"');
    expect(withProject).toContain('Open Explorer');
  });

  it('lists matching files and an empty search state', () => {
    const files = renderToStaticMarkup(
      <ThreadNewTabView
        query="readme"
        onQueryChange={() => undefined}
        matches={[{ path: '/tmp/README.md', rel: 'README.md' }]}
        desktop
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(files).toContain('README.md');
    expect(files).toContain('data-testid="thread-new-tab-page"');
    const empty = renderToStaticMarkup(
      <ThreadNewTabView
        query="zzz"
        onQueryChange={() => undefined}
        matches={[]}
        desktop={false}
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(empty).toContain('No matching files');
    const desktop = renderToStaticMarkup(
      <ThreadNewTabView
        query=""
        onQueryChange={() => undefined}
        matches={[]}
        desktop
        actions={[{ pluginId: 'tasks', id: 'board', title: 'Tasks' }]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(desktop).toContain('data-testid="thread-new-tab-browser"');
    expect(desktop).toContain('data-testid="thread-new-tab-explorer"');
    expect(desktop).toContain('Tasks');
    const noSidecar = renderToStaticMarkup(
      <ThreadNewTabView
        query=""
        onQueryChange={() => undefined}
        matches={[]}
        desktop={false}
        actions={[]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onOpenPlugin={() => undefined}
        allowSidecarTerminal={false}
        allowExplorer={false}
      />
    );
    expect(noSidecar).not.toContain('data-testid="thread-new-tab-terminal"');
    expect(noSidecar).not.toContain('Start terminal');
    expect(noSidecar).not.toContain('data-testid="thread-new-tab-explorer"');
  });
});
