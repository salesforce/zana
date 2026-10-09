import { describe, expect, it } from 'vitest';
import { PROJECT_NAV_SECTION, settingsNavGroups } from './settings-nav-search';

const groups = [
  { id: 'config', label: 'Configuration' },
  { id: 'labs', label: 'Labs' },
  { id: 'app', label: 'App' }
];
const sections = [
  { id: 'global', label: 'Preferences', desc: 'Appearance', group: 'config' },
  { id: 'terminal', label: 'Terminal', group: 'config' },
  { id: 'about', label: 'About', group: 'app' }
];

describe('settingsNavGroups', () => {
  it('lists sections under their group, in registry order', () => {
    expect(settingsNavGroups(groups, sections).slice(0, 2)).toEqual([
      { id: 'config', label: 'Configuration', sections: [{ id: 'global', label: 'Preferences' }, { id: 'terminal', label: 'Terminal' }] },
      { id: 'app', label: 'App', sections: [{ id: 'about', label: 'About' }] }
    ]);
  });

  it('appends Project settings as its own trailing group', () => {
    const rail = settingsNavGroups(groups, sections);
    expect(rail.at(-1)).toEqual({ id: 'project', label: 'Project', sections: [{ id: 'project', label: PROJECT_NAV_SECTION.label }] });
  });

  it('drops groups that have no sections', () => {
    expect(settingsNavGroups(groups, sections).map((g) => g.id)).not.toContain('labs');
  });
});
