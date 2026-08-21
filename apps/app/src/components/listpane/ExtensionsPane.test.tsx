import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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
  })
}));

import { ExtensionsPane } from './ExtensionsPane.js';

describe('ExtensionsPane', () => {
  it('replaces the global rail with plugin, skill, and MCP destinations', () => {
    const markup = renderToStaticMarkup(<ExtensionsPane />);

    expect(markup).toContain('sidebar--titlebar-controls');
    expect(markup).toContain('Back to app');
    expect(markup).toContain('aria-label="Extensions navigation history"');
    expect(markup).toContain('>Extensions</h2>');
    expect(markup).toContain('>Skills</h2>');
    expect(markup).toContain('>MCP</h2>');
    expect(markup).toContain('>Browse extensions<');
    expect(markup).toContain('>Installed extensions<');
    expect(markup).toContain('>Skills<');
    expect(markup).toContain('>MCP<');
    expect(markup).not.toContain('>Browse skills<');
    expect(markup).not.toContain('>My skills<');
    expect(markup).toContain('data-testid="extensions-nav-marketplace"');
    expect(markup).toContain('data-testid="extensions-nav-skills"');
    expect(markup).toContain('data-testid="extensions-nav-mcp"');
    expect(markup).toContain('extensions-picker-item active');
  });

  it('leaves sidebar restoration to the persistent shell overlay when collapsed', () => {
    h.state.sidebarCollapsed = true;
    const markup = renderToStaticMarkup(<ExtensionsPane />);

    expect(markup).not.toContain('Expand extensions navigation');
    expect(markup).toContain('Back to app');
    expect(markup).toContain('extensions-nav-marketplace');
    h.state.sidebarCollapsed = false;
  });
});
