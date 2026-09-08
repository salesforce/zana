import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SETTINGS_GROUPS, SETTINGS_SECTIONS, SETTINGS_SUBSECTIONS } from '@/views/settings/SettingsView';

describe('Settings subsection navigation', () => {
  it('lists Install status, then Modern and CLI Agent', () => {
    expect(SETTINGS_SUBSECTIONS.harness?.slice(0, 3)).toEqual([
      { id: 'harness-status', label: 'Install status' },
      { id: 'harness-thread', label: 'Modern' },
      { id: 'harness-legacy', label: 'CLI Agent' }
    ]);
  });

  it('lists CLI skills and Debug under Global, not Composer', () => {
    expect(SETTINGS_SUBSECTIONS.global).toEqual(expect.arrayContaining([
      { id: 'cli-skills', label: 'CLI skills' },
      { id: 'debug', label: 'Debug' }
    ]));
    expect(SETTINGS_SUBSECTIONS.global?.map((section) => section.id)).not.toContain('keyboard');
    expect(SETTINGS_SUBSECTIONS.global?.map((section) => section.id)).not.toContain('threads');
  });

  it('lists Composer as its own Settings section, after Global and before Shortcuts', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(ids).toContain('composer');
    expect(ids.indexOf('global')).toBeLessThan(ids.indexOf('composer'));
    expect(ids.indexOf('composer')).toBeLessThan(ids.indexOf('keyboard'));
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'composer')).toMatchObject({
      label: 'Composer',
      group: 'config'
    });
    expect(SETTINGS_SUBSECTIONS.composer).toEqual([
      { id: 'launch-surfaces', label: 'Launch surfaces' },
      { id: 'composer', label: 'Composer' }
    ]);
    const panel = readFileSync(
      fileURLToPath(new URL('../../views/settings/SettingsView.tsx', import.meta.url)),
      'utf8'
    );
    expect(panel).toContain("import { ComposerSettingsView } from '@/views/settings/ComposerSettingsView'");
    expect(panel).toContain("tab === 'composer'");
    expect(panel).toContain('<ComposerSettingsView');
    const agents = readFileSync(
      fileURLToPath(new URL('../../views/settings/AgentsSettingsView.tsx', import.meta.url)),
      'utf8'
    );
    expect(agents).not.toContain('label="Team jobs"');
  });

  it('lists Shortcuts as its own Settings section, after Global', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(ids).toContain('keyboard');
    expect(ids.indexOf('global')).toBeLessThan(ids.indexOf('keyboard'));
    expect(ids.indexOf('keyboard')).toBeLessThan(ids.indexOf('inbox'));
    expect(SETTINGS_SECTIONS.find((section) => section.id === 'keyboard')).toMatchObject({
      label: 'Shortcuts',
      group: 'config'
    });
    expect(SETTINGS_SUBSECTIONS.keyboard).toEqual([
      { id: 'keyboard', label: 'Shortcuts' }
    ]);
    const panel = readFileSync(
      fileURLToPath(new URL('../../views/settings/SettingsView.tsx', import.meta.url)),
      'utf8'
    );
    expect(panel).toContain("import { KeyboardSettingsSection } from '@/views/settings/KeyboardSettingsSection'");
    expect(panel).toContain("tab === 'keyboard'");
    expect(panel).toContain('<KeyboardSettingsSection />');
  });

  it('does not expose Authorizations, Files, or Projects clone-root on Global', () => {
    const ids = SETTINGS_SUBSECTIONS.global?.map((section) => section.id) ?? [];
    expect(ids).not.toContain('authorizations');
    expect(ids).not.toContain('files');
    expect(ids).not.toContain('projects');
    expect(ids).not.toContain('connectivity');
    expect(ids).not.toContain('inbox');
    expect(ids).not.toContain('performance');
    expect(ids).not.toContain('keyboard');
    const source = readFileSync(
      fileURLToPath(new URL('../../views/settings/GlobalView.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).not.toContain('AuthorizationsSection');
    expect(source).not.toContain('PluginFileOpenerSettings');
    expect(source).not.toContain('Clone root');
    expect(source).not.toContain('~/.claude/settings.json');
    expect(source).not.toContain('Quick open');
    expect(source).not.toContain('remoteDefaultPath');
    expect(source).not.toContain('inboxGuidanceEnabled');
    expect(source).not.toContain('pdfExportDir');
    expect(source).not.toContain('maxLiveSessions');
  });

  it('lists CLI Agent resource ceilings under Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'legacy-agent',
      label: 'CLI Agent'
    });
    expect(SETTINGS_SUBSECTIONS.global?.map((section) => section.id)).not.toContain('performance');
  });

  it('lists Inbox as its own Settings section, after Global', () => {
    const ids = SETTINGS_SECTIONS.map((section) => section.id);
    expect(ids).toContain('inbox');
    expect(ids.indexOf('global')).toBeLessThan(ids.indexOf('inbox'));
    expect(SETTINGS_SUBSECTIONS.inbox).toEqual([
      { id: 'inbox-general', label: 'Inbox' }
    ]);
  });

  it('groups Machines and Connectivity under Remote', () => {
    expect(SETTINGS_GROUPS.map((group) => group.id)).toEqual([
      'config',
      'remote',
      'agents',
      'catalogues',
      'labs',
      'app'
    ]);
    const machines = SETTINGS_SECTIONS.find((section) => section.id === 'machines');
    const connectivity = SETTINGS_SECTIONS.find((section) => section.id === 'connectivity');
    expect(machines?.group).toBe('remote');
    expect(connectivity?.group).toBe('remote');
    const remoteIds = SETTINGS_SECTIONS.filter((section) => section.group === 'remote').map((section) => section.id);
    expect(remoteIds).toEqual(['machines', 'connectivity']);
    expect(SETTINGS_SUBSECTIONS.connectivity).toEqual([
      { id: 'connectivity-remote', label: 'Remote SSH' }
    ]);
  });

  it('lists Scheduled under Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'scheduled',
      label: 'Scheduled'
    });
    const ids = SETTINGS_SUBSECTIONS.agents?.map((section) => section.id) ?? [];
    expect(ids.indexOf('agent-attention')).toBeLessThan(ids.indexOf('scheduled'));
    expect(ids.indexOf('scheduled')).toBeLessThan(ids.indexOf('agent-automation'));
  });

  it('lists Git worktrees under global Agent settings', () => {
    expect(SETTINGS_SUBSECTIONS.agents).toContainEqual({
      id: 'git-worktrees',
      label: 'Git worktrees'
    });
  });

  it('puts the CLI Agent cluster last on Agent settings, with Auto mode last', () => {
    const ids = SETTINGS_SUBSECTIONS.agents?.map((section) => section.id) ?? [];
    expect(ids).toEqual([
      'git-worktrees',
      'agent-tabs',
      'agent-attention',
      'scheduled',
      'agent-automation',
      'agent-heartbeat',
      'auto-close-idle',
      'legacy-agent',
      'overseer',
      'auto-mode'
    ]);
  });

  it('lists Credits under About', () => {
    expect(SETTINGS_SUBSECTIONS.about).toEqual([
      { id: 'about-credits', label: 'Credits' }
    ]);
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
    expect(source).toContain('data-testid={`settings-nav-${section.id}`}');
    expect(source).toContain('settings-search');
    expect(source).toContain('filterSettingsNav');
    expect(source).toContain('settings-subsection-list');
    expect(source).toContain('setSettingsAnchor(sub.id)');
    expect(source).not.toContain('selectSettingsExtension');
  });

  it('mounts plugin settings sections on the plugin detail page, not Global', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../views/settings/GlobalView.tsx', import.meta.url)),
      'utf8'
    );
    expect(source).not.toContain('PluginSettingsSections');
    expect(source).toContain("import { CliSkillsSettings } from './CliSkillsSettings'");
    expect(source).not.toContain("import { KeyboardSettingsSection } from './KeyboardSettingsSection'");
    expect(source).not.toContain('<KeyboardSettingsSection');
    expect(source).not.toContain('reloadComposerCommandCatalog');
    expect(source).not.toContain('Reload slash commands');
    expect(source).not.toContain('Default launch mode');
    expect(source).not.toContain('LAUNCH_MODE_PICKLIST_OPTIONS');
    expect(source).toContain('Record provider traffic');
    expect(source).toContain('providerBridgeRecordingEnabled');
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
