import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  sidebarMode: 'expanded' as 'expanded' | 'rail' | 'hidden',
  sidebarCollapseBehavior: 'three-state' as 'two-state' | 'three-state',
  setSidebarMode: vi.fn(),
  cycleSidebarMode: vi.fn(),
  setLauncherOpen: vi.fn(),
  setPaletteOpen: vi.fn()
}));

vi.mock('../../store', () => ({
  useUi: (selector: (state: typeof h) => unknown) => selector(h)
}));

vi.mock('../../hooks/useEnsureThreads', () => ({
  useEnsureThreads: () => undefined
}));

vi.mock('../CollapsedUnreadThreads', () => ({
  CollapsedUnreadThreads: () => <div data-testid="collapsed-unread-threads" />
}));

import { SidebarTriggerOverlay } from '../SidebarTriggerOverlay.js';
import { readSourceText } from '../../__tests__/helpers/source-text.js';

function renderOverlay() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SidebarTriggerOverlay />
    </MemoryRouter>
  );
}

describe('SidebarTriggerOverlay', () => {
  beforeEach(() => {
    h.sidebarMode = 'expanded';
    vi.stubGlobal('navigator', { platform: 'Linux' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('provides the persistent shell control used to restore the sidebar', () => {
    const markup = renderOverlay();

    expect(markup).toContain('class="sidebar-expand-control"');
    expect(markup).toContain('aria-label="Collapse sidebar"');
    expect(markup).toContain('title="Collapse sidebar (Ctrl + Shift + B)"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain('data-testid="sidebar-trigger-collapsed-actions"');
  });

  it('reads "Hide sidebar" (next state) with aria-expanded=false in rail, without the hidden-only actions', () => {
    h.sidebarMode = 'rail';
    const markup = renderOverlay();

    expect(markup).toContain('aria-label="Hide sidebar"');
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).not.toContain('data-testid="sidebar-trigger-collapsed-actions"');
  });

  it('keeps back/forward in the same overlay so a collapsed rail cannot hide them', () => {
    const markup = renderOverlay();

    expect(markup).toContain('data-testid="sidebar-history-controls"');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain('aria-label="Go forward"');
  });

  it('adds unread, search, and new-chat actions only while the rail is collapsed', () => {
    h.sidebarMode = 'hidden';
    const markup = renderOverlay();

    expect(markup).toContain('aria-label="Expand sidebar"');
    expect(markup).toContain('data-testid="sidebar-trigger-collapsed-actions"');
    expect(markup).toContain('data-testid="collapsed-unread-threads"');
    expect(markup).toContain('data-testid="sidebar-collapsed-search"');
    expect(markup).toContain('data-testid="sidebar-collapsed-new-chat"');
    expect(markup).toContain('aria-label="Search"');
    expect(markup).toContain('aria-label="New Chat"');
    const source = readSourceText(new URL('../SidebarTriggerOverlay.tsx', import.meta.url));
    expect(source).toContain('setPaletteOpen(true)');
    expect(source).toContain('getNewThreadRoutePath(projectId)');
    expect(source).toContain('getRootRoutePath()');
    expect(source).toContain('useEnsureThreads()');
  });

  it('uses a root overlay beside history controls in Electron title-bar chrome', () => {
    const css = readSourceText(new URL('../../styles/global.css', import.meta.url));

    expect(css).toContain('.sidebar-trigger-overlay {\n  position: fixed;');
    expect(css).toContain(".app-shell[data-traffic-lights='true']");
    expect(css).toContain('--shell-trigger-left: 84px;');
    expect(css).toContain('gap: 8px;');
    expect(css).toContain('.sidebar-history-controls {');
    expect(css).toContain('-webkit-app-region: no-drag;');
    expect(css).toContain('.app-shell.sidebar-is-collapsed {\n  --col-nav: 0px;\n  --shell-leading-reserve: 202px;');
    expect(css).toContain(".app-shell.sidebar-is-collapsed[data-traffic-lights='true'] {\n  --shell-leading-reserve: 274px;");
    expect(css).toContain('.collapsed-unread-menu {');
  });
});
