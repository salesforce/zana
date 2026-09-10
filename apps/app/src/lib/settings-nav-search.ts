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

export interface SettingsNavSubsection {
  id: string;
  label: string;
}

export interface SettingsNavCatalog {
  groups: SettingsNavGroup[];
  sections: SettingsNavSection[];
  subsections: Record<string, SettingsNavSubsection[]>;
  keywords?: Record<string, readonly string[]>;
}

export interface FilteredSettingsSection {
  id: string;
  label: string;
  subsections: SettingsNavSubsection[];
}

export interface FilteredSettingsGroup {
  id: string;
  label: string;
  sections: FilteredSettingsSection[];
}

/** Extra search terms keyed by section id or `sectionId.subsectionId`. */
export const SETTINGS_SEARCH_KEYWORDS: Record<string, readonly string[]> = {
  global: ['theme', 'appearance', 'defaults'],
  'global.appearance': ['theme', 'dark', 'light', 'system'],
  composer: ['composer', 'prompt', 'markdown', 'send mode', 'launch mode'],
  'composer.launch-surfaces': [
    'launch mode',
    'default mode',
    'modern',
    'cli agent',
    'autonomous',
    'job team',
    'surfaces'
  ],
  'composer.composer': [
    'composer',
    'markdown',
    'send mode',
    'steer',
    'queue',
    'slash commands'
  ],
  'global.cli-skills': ['skills', 'claude', 'cursor'],
  'global.debug': ['provider', 'traffic', 'unhandled', 'diagnostic'],
  keyboard: ['shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'keybinding', 'remap', 'chords'],
  'keyboard.keyboard': ['shortcut', 'shortcuts', 'hotkey', 'hotkeys', 'keybinding', 'remap'],
  inbox: ['guidance', 'pdf', 'trust'],
  terminal: ['shell', 'tmux', 'font', 'appearance'],
  harness: ['claude', 'cursor', 'codex', 'pi', 'opencode', 'grok', 'modern', 'cli agent', 'update', 'install', 'machines'],
  editor: ['vscode', 'cursor', 'intellij', 'finder', 'open in'],
  agents: ['overseer', 'heartbeat', 'idle', 'follow-up', 'automation', 'worktree', 'guidance', 'skills'],
  'agents.agent-guidance': ['skills', 'introduction', 'RULES', 'bundled', 'guidance'],
  'agents.overseer': ['overseer'],
  'agents.auto-close-idle': ['idle', 'follow-up', 'followups'],
  'agents.legacy-agent': ['cli agent', 'ceiling', 'heap'],
  personas: ['profile', 'launch'],
  squads: ['team', 'autonomous'],
  experimental: ['labs', 'flags'],
  about: ['version', 'update', 'credits', 'release'],
  project: ['cwd', 'path', 'clone', 'persona', 'default']
};

export function appSettingsNavCatalog(args: {
  groups: SettingsNavGroup[];
  sections: SettingsNavSection[];
  subsections: Partial<Record<string, SettingsNavSubsection[]>>;
}): SettingsNavCatalog {
  const subsections: Record<string, SettingsNavSubsection[]> = {};
  for (const [id, rows] of Object.entries(args.subsections)) {
    if (rows && rows.length > 0) subsections[id] = rows;
  }
  return {
    groups: [...args.groups, { id: 'project', label: 'Project' }],
    sections: [
      ...args.sections,
      {
        id: 'project',
        label: 'Project settings',
        desc: 'Per-project defaults',
        group: 'project'
      }
    ],
    subsections,
    keywords: SETTINGS_SEARCH_KEYWORDS
  };
}

function haystackMatches(haystack: string, query: string): boolean {
  return haystack.toLowerCase().includes(query);
}

function sectionMatches(
  section: SettingsNavSection,
  query: string,
  keywords: Record<string, readonly string[]>
): boolean {
  const extra = keywords[section.id] ?? [];
  return [section.id, section.label, section.desc ?? '', ...extra].some((text) => haystackMatches(text, query));
}

function subsectionMatches(
  sectionId: string,
  subsection: SettingsNavSubsection,
  query: string,
  keywords: Record<string, readonly string[]>
): boolean {
  const extra = keywords[`${sectionId}.${subsection.id}`] ?? [];
  return [subsection.id, subsection.label, ...extra].some((text) => haystackMatches(text, query));
}

export function filterSettingsNav(
  query: string,
  catalog: SettingsNavCatalog
): FilteredSettingsGroup[] {
  const needle = query.trim().toLowerCase();
  const keywords = catalog.keywords ?? {};
  const groups: FilteredSettingsGroup[] = [];
  for (const group of catalog.groups) {
    const sections = catalog.sections.filter((section) => section.group === group.id);
    const filtered: FilteredSettingsSection[] = [];
    for (const section of sections) {
      const subs = catalog.subsections[section.id] ?? [];
      if (!needle) {
        filtered.push({ id: section.id, label: section.label, subsections: [] });
        continue;
      }
      const sectionHit = sectionMatches(section, needle, keywords);
      const matchingSubs = subs.filter((sub) => subsectionMatches(section.id, sub, needle, keywords));
      if (!sectionHit && matchingSubs.length === 0) continue;
      filtered.push({
        id: section.id,
        label: section.label,
        subsections: matchingSubs.length > 0 ? matchingSubs : subs
      });
    }
    if (filtered.length > 0) {
      groups.push({ id: group.id, label: group.label, sections: filtered });
    }
  }
  return groups;
}
