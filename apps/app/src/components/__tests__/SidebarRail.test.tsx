// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import type { HTMLAttributes, ReactElement } from 'react';

const h = vi.hoisted(() => ({
  state: { sidebarCollapsed: false },
  footer: [],
  splitPointer: vi.fn(),
  openInSplit: vi.fn(),
  consumeSplitClick: vi.fn(() => false)
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
  listSidebarFooterActions: () => h.footer
}));
vi.mock('../../lib/resolveIcon', () => ({
  resolveIcon: () => () => null
}));
vi.mock('../sidebar/useThreadRowSplitDrag.js', () => ({
  usePaneContentSplitDrag: () => ({
    onPointerDown: h.splitPointer,
    openInSplit: h.openInSplit,
    consumeClick: h.consumeSplitClick
  })
}));
vi.mock('../sidebar/paneContentSplitIndicator.js', () => ({
  usePaneContentSplitIndicator: () => ({ miniMap: null })
}));

import { SidebarRail, type SidebarRailItem } from '../SidebarRail.js';
import { MobileNavDrawer } from '../MobileShellChrome.js';

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

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SidebarRail', () => {
  it('uses touch navigation inside a mobile drawer without desktop drag or resize controls', () => {
    h.state.sidebarCollapsed = false;
    const markup = renderRail(
      <MobileNavDrawer enabled open onClose={() => {}}>
        <SidebarRail className="sidebar" navAriaLabel="Nav" storageKey="zcc.testSidebarNavOrder" pinnedIds={['inbox']} items={[...items, { ...items[0], kind: 'row', id: 'tool', label: 'Tool', icon: null, to: '/tool', testId: 'nav-tool', active: false, mobileGroup: 'tools' }]} />
      </MobileNavDrawer>
    );
    expect(markup).toContain('mobile-tools-grid');
    expect(markup).toContain('Search plugins and tools');
    expect(markup).toContain('data-testid="nav-tool"');
    expect(markup).toContain('aria-label="Close navigation"');
    expect(markup).not.toContain('data-sortable-nav-id');
    expect(markup).not.toContain('class="sidebar-resizer"');
    expect(markup).toContain('aria-label="Settings"');
  });
  it('keeps Settings accessible by name when a compact rail omits the visible label', () => {
    h.state.sidebarCollapsed = true;
    try {
      const markup = renderRail(<SidebarRail className="sidebar collapsed" navAriaLabel="Nav" storageKey="zcc.testSidebarNavOrder" pinnedIds={['inbox']} items={items} />);
      expect(markup).toContain('aria-label="Settings"');
      expect(markup).toContain('href="/settings"');
      expect(markup).not.toContain('>Settings<');
    } finally {
      h.state.sidebarCollapsed = false;
    }
  });

  it('renders shared chrome: sortable nav, utility dock, resizer', () => {
    h.state.sidebarCollapsed = false;
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
    expect(markup).not.toContain('class="sidebar-chrome"');
    expect(markup).not.toContain('aria-label="Go back"');
    expect(markup).toContain('data-testid="sidebar-navigation"');
    expect(markup).toContain('aria-label="Main navigation"');
    expect(markup).toContain('class="sidebar-nav sidebar-nav--sortable"');
    expect(markup).toContain('class="sidebar-utility-bar"');
    expect(markup).toContain('aria-label="Settings"');
    expect(markup).toContain('aria-label="Report a bug"');
    expect(markup).toContain('aria-label="Remote access"');
    expect(markup).toContain('href="/settings/remote-access"');
    expect(markup.indexOf('aria-label="Remote access"')).toBeGreaterThan(markup.indexOf('aria-label="Report a bug"'));
    expect(markup).toContain('href="/settings"');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('>Settings<');
  });

  it('uses an explicit Settings route when a scoped rail provides one', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar"
        navAriaLabel="Nav"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        items={items}
        settingsRoutePath="/projects/proj-1/settings"
      />
    );

    expect(markup).toContain('href="/projects/proj-1/settings"');
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

  it('renders trailing sections last and not sortable', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar"
        navAriaLabel="Nav"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        trailingIds={['sidebar-section:agents']}
        items={items}
      />
    );

    expect(markup).not.toContain('data-sortable-sidebar-section-id="sidebar-section:agents"');
    expect(markup).toContain('data-testid="agents-section"');
    expect(markup.indexOf('data-sortable-nav-id="feed"')).toBeLessThan(
      markup.indexOf('data-testid="agents-section"')
    );
  });

  it('renders a disabled row with aria-disabled and the disabled-reason tooltip', () => {
    const markup = renderRail(
      <SidebarRail
        className="sidebar"
        navAriaLabel="Nav"
        storageKey="zcc.testSidebarNavOrder"
        pinnedIds={['inbox']}
        items={[
          ...items,
          {
            kind: 'row',
            id: 'locked',
            label: 'Locked',
            icon: <span data-icon="locked" />,
            to: '/locked',
            testId: 'nav-locked',
            active: false,
            disabled: true,
            disabledReason: 'Plugin not configured'
          }
        ]}
      />
    );

    const anchorStart = markup.lastIndexOf('<a ', markup.indexOf('data-testid="nav-locked"'));
    const tag = markup.slice(anchorStart, markup.indexOf('</a>', anchorStart));
    expect(tag).toContain('nav-item--disabled');
    expect(tag).toContain('aria-disabled="true"');
    expect(tag).toContain('title="Plugin not configured"');
  });

  it('blocks disabled split navigation and pointer drags while keeping enabled split navigation', () => {
    const onDisabledClick = vi.fn();
    const onEnabledClick = vi.fn();
    const splitRows: SidebarRailItem[] = [
      { kind: 'row', id: 'locked', label: 'Locked', icon: null, to: '/locked', testId: 'locked', active: false,
        splitContent: { kind: 'agents' }, disabled: true, disabledReason: 'Unavailable', onClick: onDisabledClick },
      { kind: 'row', id: 'ready', label: 'Ready', icon: null, to: '/ready', testId: 'ready', active: false,
        splitContent: { kind: 'agents' }, onClick: onEnabledClick }
    ];
    render(<MemoryRouter><SidebarRail className="sidebar" navAriaLabel="Nav" storageKey="split-test"
      pinnedIds={['locked', 'ready']} items={splitRows} /></MemoryRouter>);

    const locked = screen.getByTestId('locked');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    expect(locked.getAttribute('title')).toBe('Unavailable');
    fireEvent.pointerDown(locked);
    fireEvent.click(locked, { metaKey: true });
    fireEvent.click(locked);
    expect(h.splitPointer).not.toHaveBeenCalled();
    expect(h.openInSplit).not.toHaveBeenCalled();
    expect(onDisabledClick).not.toHaveBeenCalled();

    const ready = screen.getByTestId('ready');
    fireEvent.pointerDown(ready);
    expect(h.splitPointer).toHaveBeenCalledOnce();
    fireEvent.click(ready, { metaKey: true });
    expect(h.openInSplit).toHaveBeenCalledOnce();
    expect(onEnabledClick).not.toHaveBeenCalled();
    fireEvent.click(ready);
    expect(onEnabledClick).toHaveBeenCalledOnce();
  });

  it('does not invoke a disabled ordinary destination or close mobile navigation', () => {
    const onClick = vi.fn();
    render(<MemoryRouter><SidebarRail className="sidebar" navAriaLabel="Nav" storageKey="ordinary-test"
      pinnedIds={['locked']} items={[{
        kind: 'row', id: 'locked', label: 'Locked', icon: null, to: '/locked', testId: 'ordinary-locked',
        active: false, disabled: true, onClick
      }]} /></MemoryRouter>);
    const locked = screen.getByTestId('ordinary-locked');
    expect(locked.getAttribute('aria-disabled')).toBe('true');
    fireEvent.pointerDown(locked);
    fireEvent.click(locked);
    expect(onClick).not.toHaveBeenCalled();
    expect(h.splitPointer).not.toHaveBeenCalled();
  });

  it('puts dnd-kit listeners on the Link itself and consumes post-drag clicks', () => {
    const source = readFileSync(new NodeURL('../SidebarRail.tsx', import.meta.url), 'utf8');

    expect(source).toContain('{...rest}');
    expect(source).toContain('consumeNavClick()');
    expect(source).toContain('sidebar-utility-bar');
    expect(source).toContain('openBugReport');
    expect(source).toContain('Report a bug');
    expect(source).toContain('toPluginPanel');
    expect(source).toContain('hrefForPluginNavPanel');
    expect(source).toContain('<DndContext');
    expect(source).toContain('onNavigate');
    expect(source).toContain('splitContent');
    expect(source).toContain('onSplitPointerDown');
    expect(source).toContain('event.metaKey || event.ctrlKey');
    expect(source).toContain('openInSplit()');
    expect(source).toContain('if (consumeClick())');
  });
});
