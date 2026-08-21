import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '../SettingsPanel.js';

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

  it('keeps Extensions as one settings destination without installed-module jump links', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../listpane/SettingsPane.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).toContain('data-testid={`settings-nav-${id}`}');
    expect(source).not.toContain('settings-subsection-list');
    expect(source).not.toContain('selectSettingsExtension');
  });

  it('lists the Plugins hub under Catalogues without the Claude Code plugin catalogue', () => {
    const plugins = SETTINGS_SECTIONS.find((section) => section.id === 'extensions');
    expect(plugins).toMatchObject({ label: 'Plugins', group: 'catalogues' });
    expect(SETTINGS_SECTIONS.some((section) => section.id === 'plugins')).toBe(false);
  });
});
