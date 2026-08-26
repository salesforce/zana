import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '@/views/settings/SettingsView';

describe('Settings subsection navigation', () => {
  it('lists Install status, then Thread and Legacy Agent', () => {
    expect(SETTINGS_SUBSECTIONS.harness?.slice(0, 3)).toEqual([
      { id: 'harness-status', label: 'Install status' },
      { id: 'harness-thread', label: 'Thread' },
      { id: 'harness-legacy', label: 'Legacy Agent' }
    ]);
  });

  it('lists Threads, CLI skills, and Debug under Global', () => {
    expect(SETTINGS_SUBSECTIONS.global).toEqual(expect.arrayContaining([
      { id: 'threads', label: 'Threads' },
      { id: 'cli-skills', label: 'CLI skills' },
      { id: 'debug', label: 'Debug' }
    ]));
  });

  it('lists Git worktrees under global Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'git-worktrees',
      label: 'Git worktrees'
    });
  });

  it('includes Personas, Squads, and Usage in focused Settings navigation', () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual(
      expect.arrayContaining(['personas', 'squads', 'usage', 'machines'])
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

  it('mounts plugin settings sections on the Global tab, not as a competing nav destination', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../views/settings/GlobalView.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).toContain('PluginSettingsSections');
    expect(SETTINGS_SECTIONS.map((section) => section.id)).not.toContain('plugins');
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
