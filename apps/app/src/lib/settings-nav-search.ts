/**
 * The Settings rail's page list (shown while the search box is empty):
 * registered groups and sections, plus the trailing Project settings entry.
 * Searching is the Settings search engine's job (`lib/settings-search`); this
 * module only lays out the navigation.
 */

export interface SettingsNavGroup {
  id: string;
  label: string;
}

export interface SettingsNavSection {
  id: string;
  label: string;
  desc?: string;
  group: string;
}

export interface SettingsNavRailGroup {
  id: string;
  label: string;
  sections: Array<{ id: string; label: string }>;
}

export const PROJECT_NAV_GROUP: SettingsNavGroup = { id: 'project', label: 'Project' };

export const PROJECT_NAV_SECTION: SettingsNavSection = {
  id: 'project',
  label: 'Project settings',
  desc: 'Per-project defaults',
  group: 'project'
};

/** Groups in registry order, each with its sections; Project trails; empty groups are dropped. */
export function settingsNavGroups(
  groups: readonly SettingsNavGroup[],
  sections: readonly SettingsNavSection[]
): SettingsNavRailGroup[] {
  const allSections = [...sections, PROJECT_NAV_SECTION];
  return [...groups, PROJECT_NAV_GROUP]
    .map((group) => ({
      id: group.id,
      label: group.label,
      sections: allSections.filter((section) => section.group === group.id).map(({ id, label }) => ({ id, label }))
    }))
    .filter((group) => group.sections.length > 0);
}
