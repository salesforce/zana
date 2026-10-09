import type { SettingsSearchEntry } from '../types';

const onOff = (value: boolean | undefined, fallback: boolean) => ((value ?? fallback) ? 'On' : 'Off');
const THEMES: Record<string, string> = { system: 'System', dark: 'Dark', light: 'Light' };

/** Settings > Preferences (section id `global`). */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'global.theme',
    section: 'global',
    anchor: 'appearance',
    label: 'Theme',
    help: 'Choose how Zana looks on this device.',
    options: ['System', 'Dark', 'Light'],
    keywords: ['dark mode', 'light mode', 'appearance', 'color scheme', 'colour scheme', 'night'],
    kind: 'setting',
    value: (s) => THEMES[s.config.theme as string] ?? undefined
  },
  {
    id: 'global.cli-skills-intro',
    section: 'global',
    anchor: 'cli-skills',
    label: 'CLI skills',
    help: 'Give agents outside Zana the zcc-cli skill. Each machine stores a copy in ~/.agents/skills and ~/.claude/skills.',
    keywords: ['zcc-cli', 'install skill', 'machines', 'agents skills'],
    kind: 'subsection'
  },
  {
    id: 'global.debug-intro',
    section: 'global',
    anchor: 'debug',
    label: 'Debug',
    help: 'Diagnostics for agent timelines and provider wires. Off by default.',
    keywords: ['diagnostics', 'troubleshooting'],
    kind: 'subsection'
  },
  {
    id: 'global.show-diagnostic-events',
    section: 'global',
    anchor: 'debug',
    label: 'Show diagnostic events',
    help: 'Surface provider/unhandled timeline rows and routine environment-provisioning noise. Development builds also force unhandled provider rows on.',
    keywords: ['debug', 'unhandled provider events', 'timeline', 'noise'],
    kind: 'setting',
    value: (s) => onOff(s.config.showDiagnosticEvents ?? s.config.showUnhandledProviderEvents, false)
  },
  {
    id: 'global.record-provider-traffic',
    section: 'global',
    anchor: 'debug',
    label: 'Record provider traffic',
    help: 'Write raw provider/ACP lines as NDJSON under the app data directory (provider-recordings/raw). Can include prompts and paths. New agent turns pick this up; already-running sessions keep their current setting.',
    keywords: ['recording', 'ndjson', 'acp', 'log', 'capture', 'wire'],
    kind: 'setting',
    value: (s) => onOff(s.config.providerBridgeRecordingEnabled, false)
  },
  {
    id: 'global.help-intro',
    section: 'global',
    label: 'Help',
    help: 'Replay the walkthrough or check that your CLIs are set up.',
    keywords: ['support', 'getting started'],
    kind: 'setting'
  },
  {
    id: 'global.replay-walkthrough',
    section: 'global',
    label: 'Replay walkthrough',
    help: 'For new users: starting a conversation, the CLI Agent composer, adding a project, and creating a schedule. Replay',
    keywords: ['onboarding', 'tutorial', 'tour', 'getting started', 'help'],
    kind: 'action'
  },
  {
    id: 'global.check-setup',
    section: 'global',
    label: 'Check setup',
    help: 'Verify agent and Salesforce CLIs are installed. Check',
    keywords: ['dependencies', 'cli installed', 'sf', 'salesforce cli', 'help'],
    kind: 'action'
  },
  {
    id: 'global.call-doctor',
    section: 'global',
    label: 'Call Doctor Agent',
    help: 'Verifies ~/.zcc, runtime extensions, and consent — then fixes what it safely can. It won’t add features or change behaviour. Call Doctor',
    keywords: ['repair', 'fix', 'troubleshoot', 'broken', 'heal', 'diagnose'],
    kind: 'action'
  }
];
