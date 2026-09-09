import { describe, expect, it } from 'vitest';
import {
  appSettingsNavCatalog,
  filterSettingsNav,
  type SettingsNavCatalog
} from './settings-nav-search.js';

const catalog: SettingsNavCatalog = appSettingsNavCatalog({
  groups: [
    { id: 'config', label: 'Configuration' },
    { id: 'agents', label: 'Agents & Automation' }
  ],
  sections: [
    { id: 'global', label: 'Global', desc: 'App-wide defaults', group: 'config' },
    { id: 'composer', label: 'Composer', desc: 'Launch surfaces', group: 'config' },
    { id: 'agents', label: 'Agents', desc: 'Attention, automation, heartbeat & Overseer', group: 'agents' }
  ],
  subsections: {
    global: [
      { id: 'appearance', label: 'Appearance' },
      { id: 'keyboard', label: 'Keyboard' }
    ],
    composer: [
      { id: 'launch-surfaces', label: 'Launch surfaces' },
      { id: 'composer', label: 'Composer' }
    ],
    agents: [
      { id: 'agent-guidance', label: 'Agent guidance' },
      { id: 'overseer', label: 'Overseer' },
      { id: 'auto-close-idle', label: 'Idle handling & follow-ups' }
    ]
  }
});

describe('filterSettingsNav', () => {
  it('returns every section with no subsections when the query is empty', () => {
    const groups = filterSettingsNav('  ', catalog);
    expect(groups.map((group) => group.id)).toEqual(['config', 'agents', 'project']);
    expect(groups.flatMap((group) => group.sections.map((section) => section.id))).toEqual([
      'global',
      'composer',
      'agents',
      'project'
    ]);
    expect(groups.every((group) => group.sections.every((section) => section.subsections.length === 0))).toBe(true);
  });

  it('matches a section name and lists its subsections', () => {
    const groups = filterSettingsNav('Global', catalog);
    expect(groups).toEqual([
      {
        id: 'config',
        label: 'Configuration',
        sections: [
          {
            id: 'global',
            label: 'Global',
            subsections: [
              { id: 'appearance', label: 'Appearance' },
              { id: 'keyboard', label: 'Keyboard' }
            ]
          }
        ]
      }
    ]);
  });

  it('matches a subsection and keeps only that jump link', () => {
    const groups = filterSettingsNav('overseer', catalog);
    expect(groups).toEqual([
      {
        id: 'agents',
        label: 'Agents & Automation',
        sections: [
          {
            id: 'agents',
            label: 'Agents',
            subsections: [{ id: 'overseer', label: 'Overseer' }]
          }
        ]
      }
    ]);
  });

  it('matches field keywords such as theme and launch mode', () => {
    const theme = filterSettingsNav('theme', catalog);
    expect(theme[0]?.sections[0]).toEqual({
      id: 'global',
      label: 'Global',
      subsections: [{ id: 'appearance', label: 'Appearance' }]
    });
    const launch = filterSettingsNav('launch mode', catalog);
    expect(launch[0]?.sections[0]?.id).toBe('composer');
    expect(launch[0]?.sections[0]?.subsections.map((row) => row.id)).toEqual(['launch-surfaces']);
    const guidance = filterSettingsNav('RULES', catalog);
    expect(guidance[0]?.sections[0]).toEqual({
      id: 'agents',
      label: 'Agents',
      subsections: [{ id: 'agent-guidance', label: 'Agent guidance' }]
    });
  });

  it('matches Project settings', () => {
    const groups = filterSettingsNav('project', catalog);
    expect(groups.some((group) => group.sections.some((section) => section.id === 'project'))).toBe(true);
  });

  it('returns no groups when nothing matches', () => {
    expect(filterSettingsNav('zzzz-no-such-setting', catalog)).toEqual([]);
  });
});
