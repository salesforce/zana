import type { SettingsTab } from '@/store';

/**
 * Settings-search guard configuration (design §3.5). Test-only: nothing in the
 * runtime bundle imports this file.
 *
 * Every `SETTINGS_SECTIONS` id plus `project` must have an `entries/<section>.ts`
 * file, every literal in that section's sources must be covered by its entries,
 * and every scanned source file must be mapped to a section (or allow-listed).
 */

export type SearchSection = SettingsTab | 'project';

/** Directories (relative to `apps/app/src`) scanned for settings UI literals. */
export const SETTINGS_SOURCE_DIRS = ['views/settings', 'components/settings'] as const;

/**
 * Source files (relative to `apps/app/src`) that render each section's rows.
 * A literal found in one of these files must appear in that section's entries.
 */
export const SECTION_SOURCES: Record<SearchSection, readonly string[]> = {
  global: ['views/settings/GlobalView.tsx', 'views/settings/CliSkillsSettings.tsx', 'components/settings/DoctorSection.tsx'],
  composer: ['views/settings/ComposerSettingsView.tsx'],
  keyboard: ['views/settings/KeyboardSettingsSection.tsx'],
  inbox: ['views/settings/InboxSettingsView.tsx'],
  browser: ['components/settings/BrowserSettingsSection.tsx', 'components/settings/BrowserImportDialog.tsx'],
  terminal: ['views/settings/TerminalSettingsView.tsx'],
  harness: ['views/settings/HarnessView.tsx', 'views/settings/ModelRefreshControl.tsx', 'views/settings/ProviderCliUpdateHint.tsx'],
  editor: ['views/settings/EditorView.tsx'],
  prompts: ['views/settings/PromptsView.tsx'],
  machines: [
    'views/settings/MachinesSettingsView.tsx',
    'views/settings/MachineCard.tsx',
    'views/settings/AddMachineDialog.tsx',
    'views/settings/ConnectCodePairing.tsx',
    'views/settings/PairingTerminal.tsx',
    'views/settings/RemoteMachineDefaultsList.tsx'
  ],
  connectivity: ['views/settings/ConnectivityView.tsx'],
  phone: ['views/settings/PhoneSettingsView.tsx', 'views/settings/PhoneAccountConnection.tsx'],
  'remote-access': ['views/settings/RemoteAccessView.tsx', 'views/settings/SharedPreviews.tsx'],
  agents: ['views/settings/AgentsSettingsView.tsx', 'views/settings/AgentGuidanceSettings.tsx', 'components/settings/OverseerRecentPane.tsx'],
  personas: ['views/settings/PersonasView.tsx'],
  squads: ['views/settings/SquadsView.tsx'],
  usage: ['views/settings/UsageView.tsx'],
  experimental: ['views/settings/ExperimentalView.tsx'],
  performance: ['views/settings/PerformanceSettingsView.tsx'],
  about: ['views/settings/AboutView.tsx'],
  project: ['views/settings/ProjectSettingsView.tsx', 'views/settings/ProjectSourcesSettings.tsx', 'components/settings/ScopeControl.tsx']
};
