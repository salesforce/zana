import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const view = readFileSync(new URL('./SkillsView.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../styles/global.css', import.meta.url), 'utf8');

describe('SkillsView catalogue', () => {
  it('discovers OpenCode user and project skill directories', () => {
    expect(view).toContain('~/.config/opencode/skills');
    expect(view).toContain('.opencode/skills');
  });

  it('offers a Refresh button that re-lists skills without replacing the page', () => {
    expect(view).toContain('aria-label="Refresh skills"');
    expect(view).toContain('void refresh()');
    expect(view).toContain("className={refreshing ? 'ext-spin' : undefined}");
    expect(view).not.toContain('setLoading(true);\n    try {\n      await reload()');
    expect(css).toContain('.skills-toolbar-row {\n  display: flex;');
  });
});
