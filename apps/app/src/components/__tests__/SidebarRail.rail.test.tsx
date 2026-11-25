// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

const h = vi.hoisted(() => ({ state: { sidebarCollapsed: false } }));

vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  useData: (selector: (state: { companionEnabled: boolean }) => unknown) => selector({ companionEnabled: false }),
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));
vi.mock('../../plugins/plugin-slots', () => ({
  subscribePluginSlots: (listener: () => void) => {
    listener();
    return () => undefined;
  },
  listSidebarFooterActions: () => []
}));
vi.mock('../../lib/resolveIcon', () => ({ resolveIcon: () => () => null }));
vi.mock('../sidebar/RailProjects.js', () => ({ RailProjects: () => <div data-testid="rail-projects-stub" /> }));

import { SidebarRail, type SidebarRailItem } from '../SidebarRail.js';
import { PROJECTS_SECTION_SORT_ID, PROJECT_SESSIONS_SECTION_SORT_ID } from '../sidebarNavOrder.js';

const items: SidebarRailItem[] = [
  { kind: 'row', id: 'inbox', label: 'Inbox', icon: <span />, to: '/inbox', testId: 'nav-inbox', active: true },
  { kind: 'section', id: PROJECTS_SECTION_SORT_ID, node: <div data-testid="full-projects" /> },
  { kind: 'section', id: PROJECT_SESSIONS_SECTION_SORT_ID, node: <div data-testid="sessions-tree" /> }
];

const render = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
const rail = (variant?: 'expanded' | 'rail') =>
  render(
    <SidebarRail
      className="sidebar"
      navAriaLabel="Main navigation"
      storageKey="test-rail-order"
      pinnedIds={[]}
      items={items}
      railVariant={variant}
    />
  );

describe('SidebarRail rail variant', () => {
  it('adds sidebar--rail, labels rows, swaps Projects for the icon switcher and omits Sessions', () => {
    const markup = rail('rail');
    expect(markup).toContain('sidebar--rail');
    expect(markup).toContain('aria-label="Inbox"');
    expect(markup).toContain('rail-projects-stub');
    expect(markup).not.toContain('full-projects');
    expect(markup).not.toContain('sessions-tree');
    expect(markup).not.toContain('class="sidebar-resizer"');
    expect(markup).not.toContain('<span>Settings</span>');
    expect(markup).toContain('aria-label="More"');
  });

  it('leaves the expanded rendering unchanged', () => {
    const markup = rail();
    expect(markup).not.toContain('sidebar--rail');
    expect(markup).toContain('full-projects');
    expect(markup).toContain('sessions-tree');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('<span>Settings</span>');
  });
});
