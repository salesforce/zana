import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '@/views/settings/SettingsView';

describe('Settings subsection navigation', () => {
  it('lists Git worktrees under global Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'git-worktrees',
      label: 'Git worktrees'
    });
  });

  it('includes Personas, Squads, and Usage in focused Settings navigation', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(
      expect.arrayContaining(['personas', 'squads', 'usage'])
    );
  });

  it('keeps Settings navigation without installed-module jump links', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../listpane/SettingsPane.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).toContain('data-testid={`settings-nav-${id}`}');
    expect(source).not.toContain('settings-subsection-list');
    expect(source).not.toContain('selectSettingsExtension');
  });

  it('keeps Plugins, Skills, and MCP off Settings — they live on the Extensions workspace', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(ids).not.toContain('extensions');
    expect(ids).not.toContain('skills');
    expect(ids).not.toContain('mcp');
    expect(ids).not.toContain('plugins');
    expect(ids).toContain('usage');
  });
});
