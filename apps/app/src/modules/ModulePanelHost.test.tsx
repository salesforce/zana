import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ModulePanelHost layout contract', () => {
  it('reserves shell-owned right-edge control space for every module panel', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toContain('--shell-trailing-reserve: 36px;');
    expect(css).toContain('padding-right: var(--shell-trailing-reserve);');
  });

  it('drops the trailing reserve when a plugin pane has its secondary panel open', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8');

    expect(css).toMatch(
      /\.plugin-panel-host-layout\.is-secondary-open > \.split-plugin-main \.module-panel-slot \{\s*padding-right: 0;/
    );
  });
});
