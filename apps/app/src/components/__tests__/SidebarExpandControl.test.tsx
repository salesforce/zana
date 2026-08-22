import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ toggleSidebar: vi.fn(), setLauncherOpen: vi.fn() }));

vi.mock('../../store', () => ({
  useUi: (selector: (state: typeof h) => unknown) => selector(h)
}));

import { SidebarTriggerOverlay } from '../SidebarTriggerOverlay.js';

function renderOverlay() {
  return renderToStaticMarkup(
    <MemoryRouter>
      <SidebarTriggerOverlay />
    </MemoryRouter>
  );
}

describe('SidebarTriggerOverlay', () => {
  it('provides the persistent shell control used to restore the sidebar', () => {
    const markup = renderOverlay();

    expect(markup).toContain('class="sidebar-expand-control"');
    expect(markup).toContain('aria-label="Collapse sidebar"');
    expect(markup).toContain('title="Collapse sidebar"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it('keeps back/forward in the same overlay so a collapsed rail cannot hide them', () => {
    const markup = renderOverlay();

    expect(markup).toContain('data-testid="sidebar-history-controls"');
    expect(markup).toContain('aria-label="Go back"');
    expect(markup).toContain('aria-label="Go forward"');
  });

  it('uses a root overlay beside history controls in Electron title-bar chrome', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('.sidebar-trigger-overlay {\n  position: fixed;');
    expect(css).toContain(".app-shell[data-traffic-lights='true']");
    expect(css).toContain('--shell-trigger-left: 84px;');
    expect(css).toContain('gap: 8px;');
    expect(css).toContain('.sidebar-history-controls {');
    expect(css).toContain('-webkit-app-region: no-drag;');
  });
});
