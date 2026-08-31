import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  state: {
    extensionsTab: 'marketplace' as const,
    setExtensionsTab: vi.fn(),
    sidebarCollapsed: false,
    toggleSidebar: vi.fn(),
    setNav: vi.fn()
  }
}));

vi.mock('../../store', () => ({
  useUi: Object.assign((selector: (state: typeof h.state) => unknown) => selector(h.state), {
    getState: () => h.state
  }),
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));

import { ExtensionsPane } from './ExtensionsPane.js';
import { definePluginApp } from '@zana-ai/zcc-plugin-sdk';
import { clearPluginSlots, interpretPluginApp } from '../../plugins/plugin-slots.js';

describe('ExtensionsPane', () => {
  afterEach(() => {
    clearPluginSlots('guide');
  });
  it('replaces the global rail with plugin, skill, and MCP destinations', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ExtensionsPane />
      </MemoryRouter>
    );

    expect(markup).toContain('sidebar--titlebar-controls');
    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('Back to app');
    expect(markup).not.toContain('aria-label="Extensions navigation history"');
    expect(markup).toContain('>Plugins</h2>');
    expect(markup).toContain('>Skills</h2>');
    expect(markup).toContain('>MCP</h2>');
    expect(markup).toContain('>Browse plugins<');
    expect(markup).toContain('>Installed plugins<');
    expect(markup).toContain('>Skills<');
    expect(markup).toContain('>MCP<');
    expect(markup).toContain('href="/extensions/plugins/browse"');
    expect(markup).toContain('href="/extensions/plugins"');
    expect(markup).toContain('href="/extensions/skills"');
    expect(markup).toContain('href="/extensions/mcp"');
    expect(markup).not.toContain('>Browse skills<');
    expect(markup).not.toContain('>My skills<');
    expect(markup).toContain('data-testid="extensions-nav-marketplace"');
    expect(markup).toContain('data-testid="extensions-nav-skills"');
    expect(markup).toContain('data-testid="extensions-nav-mcp"');
    expect(markup).toContain('extensions-picker-item active');
  });

  it('lists hub pages under Plugins', () => {
    interpretPluginApp(
      'guide',
      definePluginApp((app) => {
        app.slots.navPanel({
          id: 'guide',
          title: 'Plugin Guide',
          icon: 'Puzzle',
          path: 'guide',
          placement: 'extensions',
          component: () => null
        });
      })
    );
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ExtensionsPane />
      </MemoryRouter>
    );
    expect(markup).toContain('data-testid="extensions-nav-page-guide-guide"');
    expect(markup).toContain('href="/extensions/pages/guide/guide"');
    expect(markup).toContain('>Plugin Guide<');
  });

  it('leaves sidebar restoration to the persistent shell overlay when collapsed', () => {
    h.state.sidebarCollapsed = true;
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ExtensionsPane />
      </MemoryRouter>
    );

    expect(markup).not.toContain('Expand extensions navigation');
    expect(markup).toContain('Back to app');
    expect(markup).toContain('extensions-nav-marketplace');
    h.state.sidebarCollapsed = false;
  });
});
