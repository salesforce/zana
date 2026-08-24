import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const projectTabModules = vi.hoisted(() => ({
  current: [] as Array<{ id: string; title: string; projectTab?: { label?: string } }>
}));

vi.mock('../../../lib/app-surface.js', () => ({
  hasDesktopBridge: () => false
}));
vi.mock('../../../lib/product-client.js', () => ({
  product: { fs: {} }
}));
vi.mock('../../../modules/index.js', () => ({
  useProjectTabModules: () => projectTabModules.current
}));
vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: unknown[] }) => unknown) => selector({ projects: [] })
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
  });

  it('lists project-tab modules as plugin actions', () => {
    projectTabModules.current = [{ id: 'docs', title: 'Docs', projectTab: { label: 'Library' } }];
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
    expect(html).toContain('Library');
    projectTabModules.current = [];
  });

  it('lists matching files and an empty search state', () => {
    const files = renderToStaticMarkup(
      <ThreadNewTabView
        query="readme"
        onQueryChange={() => undefined}
        matches={[{ path: '/tmp/README.md', rel: 'README.md' }]}
        desktop
        modules={[]}
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
        modules={[]}
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
        modules={[{ id: 'docs', title: 'Docs', projectTab: { label: 'Library' } }]}
        onOpenFile={() => undefined}
        onOpenBrowser={() => undefined}
        onStartTerminal={() => undefined}
        onOpenPlugin={() => undefined}
      />
    );
    expect(desktop).toContain('data-testid="thread-new-tab-browser"');
    expect(desktop).toContain('Library');
  });
});
