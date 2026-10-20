import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ModulePanelHost layout contract', () => {
  it('reserves shell-owned right-edge control space for every module panel', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('--shell-trailing-reserve: 36px;');
    expect(css).toContain('padding-right: var(--shell-trailing-reserve);');
  });

  it('gives the shared plugin host ownership of the right edge in every state', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');
    expect(css).toMatch(/\.plugin-panel-host-layout \{[^}]*--shell-trailing-reserve: 0px;/);
    expect(css).toMatch(/\.plugin-panel-host-launchers \{[^}]*flex: 0 0 36px;/);
    expect(css).toMatch(/\.plugin-panel-host-layout\.is-secondary-maximized > \.thread-secondary-panel \{[^}]*flex: 1 1 0;/);
  });
});
