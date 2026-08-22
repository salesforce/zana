import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../../store.js', () => ({
  applySidebarWidth: vi.fn(),
  SIDEBAR_MIN: 256,
  SIDEBAR_MAX: 480
}));

import { SidebarResizer } from '../SidebarResizer.js';

describe('SidebarResizer', () => {
  it('renders a vertical separator on the nav column edge', () => {
    const markup = renderToStaticMarkup(<SidebarResizer />);

    expect(markup).toContain('class="sidebar-resizer"');
    expect(markup).toContain('role="separator"');
    expect(markup).toContain('aria-orientation="vertical"');
    expect(markup).toContain('aria-valuemin="256"');
    expect(markup).toContain('aria-valuemax="480"');
    expect(markup).toContain('Drag to resize · double-click to reset');
  });

  it('drags against the window left edge and persists the live --col-nav width', () => {
    const source = readFileSync(new URL('../SidebarResizer.tsx', import.meta.url), 'utf8');

    expect(source).toContain('applySidebarWidth(ev.clientX)');
    expect(source).toContain("product.config.set({ sidebarWidth: Math.round(w) })");
    expect(source).toContain('applySidebarWidth(SIDEBAR_MIN)');
    expect(source).toContain("product.config.set({ sidebarWidth: SIDEBAR_MIN })");
    expect(source).not.toContain('localStorage');
  });

  it('is mounted in every rail that occupies --col-nav', () => {
    const files = [
      readFileSync(new URL('../SidebarRail.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('../listpane/SettingsPane.tsx', import.meta.url), 'utf8'),
      readFileSync(new URL('../listpane/ExtensionsPane.tsx', import.meta.url), 'utf8')
    ];
    for (const source of files) {
      expect(source).toContain('<SidebarResizer />');
    }
  });

  it('keeps the current 256px nav column as the default and the drag minimum', () => {
    const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');
    const store = readFileSync(new URL('../../store.ts', import.meta.url), 'utf8');

    expect(css).toContain('  --col-nav: 256px;');
    expect(css).toContain('.sidebar-resizer {');
    expect(css).toContain('cursor: col-resize;');
    expect(store).toContain('export const SIDEBAR_MIN = 256;');
    expect(store).toContain('export const SIDEBAR_MAX = 480;');
    expect(store).toContain("document.documentElement.style.setProperty('--col-nav', `${clamped}px`)");
    expect(store).toContain('if (typeof config.sidebarWidth === \'number\')');
    expect(store).toContain('if (typeof next.sidebarWidth === \'number\')');
  });
});
