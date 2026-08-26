import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./ExtensionsView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('ExtensionsView aurora background', () => {
  it('hosts AuroraGrid the same way Home does', () => {
    expect(view).toContain("className=\"settings-panel extensions-panel aurora-host\"");
    expect(view).toContain('<AuroraGrid />');
    expect(view.indexOf('<AuroraGrid />')).toBeLessThan(view.indexOf('className={`settings-inner'));
  });

  it('pins the grid to the panel and lifts hub content above it', () => {
    const panelStart = css.indexOf('.extensions-panel {\n  display: flex;');
    expect(panelStart).toBeGreaterThan(-1);
    const panel = css.slice(panelStart, css.indexOf('}', panelStart));
    expect(panel).toContain('display: flex;');
    expect(panel).toContain('flex-direction: column;');
    expect(panel).toContain('height: 100%;');
    expect(panel).toContain('overflow: hidden;');

    const innerStart = css.indexOf('.extensions-panel .settings-inner {');
    expect(innerStart).toBeGreaterThan(-1);
    const inner = css.slice(innerStart, css.indexOf('}', innerStart));
    expect(inner).toContain('position: relative;');
    expect(inner).toContain('z-index: 1;');
    expect(inner).toContain('flex: 1 1 auto;');
    expect(inner).toContain('min-height: 0;');
    expect(inner).toContain('overflow-y: auto;');
    expect(inner).toContain('width: 100%;');
    expect(inner).toContain('scrollbar-width: none;');

    expect(css).toContain('.extensions-panel .settings-inner::-webkit-scrollbar {');
    expect(css).toContain('.ext-market::-webkit-scrollbar {');
    expect(css).toContain('.ext-installed::-webkit-scrollbar {');
    expect(css).toContain('.ext-market-search-refresh {');

    expect(css).toContain('.extensions-panel .ext-market.settings-section {');
    expect(css).toContain('.extensions-panel .ext-market-item {\n  background: var(--bg-panel);');
  });
});
