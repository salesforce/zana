import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

const h = vi.hoisted(() => ({ toggleSidebar: vi.fn(), setLauncherOpen: vi.fn() }));

vi.mock('../../store', () => ({
  useUi: (selector: (state: typeof h) => unknown) => selector(h)
}));

import { SidebarTriggerOverlay } from '../SidebarTriggerOverlay.js';

describe('SidebarTriggerOverlay', () => {
  it('provides the persistent shell control used to restore the sidebar', () => {
    const markup = renderToStaticMarkup(<SidebarTriggerOverlay />);

    expect(markup).toContain('class="sidebar-expand-control"');
    expect(markup).toContain('aria-label="Collapse sidebar"');
    expect(markup).toContain('title="Collapse sidebar"');
    expect(markup).toContain('aria-expanded="true"');
  });

  it('uses a root overlay beside history controls in Electron title-bar chrome', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('.sidebar-trigger-overlay {\n  position: fixed;');
    expect(css).toContain(".app-shell[data-traffic-lights='true']");
    expect(css).toContain('--shell-trigger-left: 84px;');
    expect(css).toContain('.sidebar--global .sidebar-history-controls,');
    expect(css).toContain('.sidebar--titlebar-controls .sidebar-history-controls {');
    expect(css).toContain('-webkit-app-region: no-drag;');
  });
});
