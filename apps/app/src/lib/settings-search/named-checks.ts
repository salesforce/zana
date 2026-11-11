import type { SettingsSearchEntry } from './types';

/** Static controls only: named checks use a separate owner API, never index shell command values. */
export function namedChecksEntries(section: 'global' | 'project'): readonly SettingsSearchEntry[] {
  return [{
    id: `${section}.named-checks`, section, anchor: 'named-checks', label: 'Named checks', kind: 'subsection',
    help: `${section === 'project'
      ? 'Project commands override global checks with the same name. Remove an override to inherit again.'
      : 'Owner-managed shell commands. Plans and agents reference check:<name>; they cannot author commands.'} Commands run in the authorized checkout with your shell environment. Output is untrusted. Only add commands you trust. Use unique names (letters, numbers, dots, underscores or hyphens) and non-empty commands.`,
    keywords: ['Check name', 'Command', 'Add check', 'Save checks', 'Remove', 'Override', 'completion criteria', 'verification']
  }];
}
