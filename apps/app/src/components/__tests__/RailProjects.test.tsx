// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  data: {
    projects: [
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' }
    ],
    terminals: { p1: [{ id: 't1' }], p2: [] } as Record<string, Array<{ id: string }>>
  },
  ui: {
    unread: { t1: true } as Record<string, boolean>,
    focusedProjectId: 'p2' as string | null,
    enterProjectFocus: vi.fn()
  }
}));

vi.mock('../../store.js', () => ({
  useData: (s: (st: typeof h.data) => unknown) => s(h.data),
  useUi: (s: (st: typeof h.ui) => unknown) => s(h.ui),
  listedTerminals: (list: Array<{ id: string }> | undefined) => list ?? []
}));
vi.mock('../listpane/ProjectDot.js', () => ({ ProjectDot: () => <i /> }));
vi.mock('../composer-project-default.js', () => ({
  composerProjectLabel: (p: { name: string }) => p.name
}));

import { RailProjects } from '../sidebar/RailProjects.js';

describe('RailProjects', () => {
  it('renders one labelled button per project with unread cue and active state', () => {
    const html = renderToStaticMarkup(<RailProjects />);
    expect(html).toContain('aria-label="Open Alpha — new activity"');
    expect(html).toContain('aria-label="Open Beta"');
    expect(html).toContain('data-testid="rail-project-p1"');
    expect(html).toMatch(/rail-project active[^>]*aria-label="Open Beta"/);
    expect(html).not.toMatch(/rail-project active[^>]*aria-label="Open Alpha/);
  });

  it('enters project focus on click', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    await act(async () => root.render(<RailProjects />));
    host.querySelector<HTMLButtonElement>('[data-testid="rail-project-p1"]')!.click();
    expect(h.ui.enterProjectFocus).toHaveBeenCalledWith('p1');
    await act(async () => root.unmount());
  });
});
