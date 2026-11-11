import { describe, expect, it } from 'vitest';
import { entries as globalEntries } from '../entries/global';
import { entries as projectEntries } from '../entries/project';
import { SECTION_SOURCES } from '../guard-config';
import { searchSettings } from '../index';
import type { SettingsValueSnapshot } from '../types';

describe('named checks search entries', () => {
  it.each(['global', 'project'] as const)('maps named checks to %s and finds owner-facing controls', (section) => {
    expect(SECTION_SOURCES[section]).toContain('components/settings/NamedChecksSettings.tsx');
    const entries = (section === 'global' ? globalEntries : projectEntries).filter((entry) => entry.anchor === 'named-checks');
    expect(entries.map((entry) => entry.label)).toEqual(['Named checks']);
    for (const query of ['Named checks', 'Check name', 'Command', 'Add check', 'Save checks', 'Remove', 'Override']) {
      expect(searchSettings(query, { config: {} } as SettingsValueSnapshot, { entries, providers: [] }).map((hit) => hit.entry.section)).toContain(section);
    }
  });

  it('keeps command values out of search even when settings contain real command text', () => {
    const entries = [...globalEntries, ...projectEntries].filter((entry) => entry.anchor === 'named-checks');
    expect(entries).toHaveLength(2);
    const snapshot = {
      config: { namedChecks: [{ name: 'global-check', command: 'GLOBAL_COMMAND_SECRET' }] },
      project: { id: 'p1', settings: { namedChecks: [{ name: 'project-check', command: 'PROJECT_COMMAND_SECRET' }] } }
    } as unknown as SettingsValueSnapshot;
    expect(entries.every((entry) => entry.value === undefined)).toBe(true);
    for (const query of ['GLOBAL_COMMAND_SECRET', 'PROJECT_COMMAND_SECRET']) {
      expect(searchSettings(query, snapshot, { entries, providers: [] })).toEqual([]);
    }
  });
});
