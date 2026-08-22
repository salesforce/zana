import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { HTMLAttributes, ReactElement } from 'react';

const h = vi.hoisted(() => ({
  state: { sidebarCollapsed: false }
}));

vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
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
vi.mock('../../lib/resolveIcon', () => ({
  resolveIcon: () => () => null
}));

import { SidebarRail, type SidebarRailItem } from '../SidebarRail.js';

function AgentsSectionStub({ dragHandle }: { dragHandle?: HTMLAttributes<HTMLElement> }) {
  return (
    <div data-testid="agents-section" {...dragHandle}>
      Agents section
    </div>
  );
}

const items: SidebarRailItem[] = [
  {
    kind: 'row',
    id: 'inbox',
    label: 'Inbox',
    icon: <span data-icon="inbox" />,
    to: '/inbox',
    testId: 'nav-inbox',
    active: true
  },
  {
    kind: 'row',
    id: 'feed',
    label: 'Feed',
    icon: <span data-icon="feed" />,
    to: '/feed',
    testId: 'nav-feed',
    active: false
  },
  {
    kind: 'section',
    id: 'sidebar-section:agents',
    node: <AgentsSectionStub />
  }
];

function renderRail(node: ReactElement) {
  return renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);
}

describe('SidebarRail', () => {
  it('renders shared chrome: history, sortable nav, utility dock, resizer', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar sidebar--global"
        navAriaLabel="Main navigation"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        items={items}
      />
    );

    expect(markup).toContain('class="sidebar sidebar--global"');
    expect(markup).toContain('class="sidebar-chrome"');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain('aria-label="Go forward"');
    expect(markup).toContain('data-testid="sidebar-navigation"');
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain('class="sidebar-nav sidebar-nav--sortable"');
    expect(markup).toContain('class="sidebar-utility-bar"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('href="/settings"');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).not.toContain('>Settings<');
  });

  it('pins configured ids and leaves the rest sortable', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar"
        navAriaLabel="Nav"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        items={items}
      />
    );

    expect(markup).not.toContain('data-sortable-nav-id="inbox"');
    expect(markup).toContain('data-sortable-nav-id="feed"');
    expect(markup).toContain('data-sortable-sidebar-section-id="sidebar-section:agents"');
    expect(markup).toContain('data-testid="agents-section"');
    expect(markup.indexOf('data-testid="nav-inbox"')).toBeLessThan(
      markup.indexOf('data-sortable-nav-id="feed"')
    );
  });

  it('forwards dnd-kit listeners onto destination Links, not only section handles', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar"
        navAriaLabel="Nav"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        items={items}
      />
    );

    const feedStart = markup.indexOf('data-sortable-nav-id="feed"');
    const feedChunk = markup.slice(feedStart, feedStart + 900);
    expect(feedChunk).toContain('href="/feed"');
    expect(feedChunk).toContain('aria-roledescription="sortable"');
    expect(feedChunk).toContain('data-testid="nav-feed"');

    const inboxStart = markup.indexOf('data-testid="nav-inbox"');
    const inboxTag = markup.slice(inboxStart, markup.indexOf('</a>', inboxStart));
    expect(inboxTag).toContain('href="/inbox"');
    expect(inboxTag).not.toContain('aria-roledescription="sortable"');
  });

  it('puts dnd-kit listeners on the Link itself and consumes post-drag clicks', () => {
    const source = readFileSync(new URL('../SidebarRail.tsx', import.meta.url), 'utf8');

    expect(source).toContain('{...rest}');
    expect(source).toContain('consumeNavClick()');
    expect(source).toContain('sidebar-utility-bar');
    expect(source).toContain('<DndContext');
    expect(source).toContain('onNavigate');
  });
});
