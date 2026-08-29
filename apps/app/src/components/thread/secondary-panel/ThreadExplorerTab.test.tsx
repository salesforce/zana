import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const projects = vi.hoisted(() => ({
  current: [] as Array<{ id: string; name?: string; path?: string }>
}));

vi.mock('../../../store.js', () => ({
  useData: (selector: (s: { projects: Array<{ id: string }> }) => unknown) => selector({ projects: projects.current })
}));

import { ThreadExplorerTab } from './ThreadExplorerTab.js';

describe('ThreadExplorerTab', () => {
  it('shows a placeholder when the project is missing', () => {
    projects.current = [];
    const html = renderToStaticMarkup(
      <ThreadExplorerTab projectId="missing" />
    );
    expect(html).toContain('Project is unavailable for Explorer');
    expect(html).not.toContain('data-testid="thread-explorer-tab"');
  });

  it('mounts the Explorer shell when the project exists', () => {
    projects.current = [{ id: 'p1', name: 'Alpha', path: '/tmp/alpha' }];
    const html = renderToStaticMarkup(
      <ThreadExplorerTab projectId="p1" />
    );
    expect(html).toContain('data-testid="thread-explorer-tab"');
    expect(html).toContain('aria-label="Loading Explorer"');
    expect(html).toContain('zcc-skeleton');
    projects.current = [];
  });
});
