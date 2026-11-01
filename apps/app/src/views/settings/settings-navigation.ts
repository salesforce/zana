import {
  Settings2,
  Sparkles,
  FlaskConical,
  Bot,
  Drama,
  Users,
  BarChart3,
  Code2,
  Info,
  TerminalSquare,
  SquareArrowOutUpRight,
  Laptop,
  Network,
  Inbox,
  Keyboard,
  PenLine,
  Globe,
  Link2,
  type LucideIcon
} from 'lucide-react';
import type { SettingsTab } from '@/store';
import { fileManagerTitle } from '@/lib/file-manager';

/**
 * Settings sections. The section *picker* now lives in the list pane (column 2,
 * see `SettingsPane` in ListPane.tsx) — this map is the single source of truth
 * for each section's label + icon, shared by the picker and this panel's header.
 * Plugins / Skills / MCP live on the top-level Extensions workspace, not here.
 *
 * Section groups for the settings picker (column 2). Each section names its
 * `group`; the picker renders these headers in this order with the group's
 * sections beneath. Ordered most-used → most-specialised. `project` is not in
 * this list — Project settings is its own trailing group in the picker.
 */
export type SettingsGroup = 'config' | 'remote' | 'agents' | 'catalogues' | 'labs' | 'app';

export const SETTINGS_GROUPS: Array<{ id: SettingsGroup; label: string }> = [
  { id: 'config', label: 'Configuration' },
  { id: 'remote', label: 'Remote' },
  { id: 'agents', label: 'Agents & Automation' },
  { id: 'catalogues', label: 'Catalogues' },
  { id: 'labs', label: 'Labs' },
  // App maintenance, development, and version information.
  { id: 'app', label: 'App' }
];

export const SETTINGS_SECTIONS: Array<{
  id: SettingsTab;
  label: string;
  icon: LucideIcon;
  desc: string;
  group: SettingsGroup;
  /** Section can be scoped to a single project (shows the Global/Project toggle). */
  projectScoped?: boolean;
}> = [
  { id: 'global', label: 'Preferences', icon: Settings2, desc: 'Appearance, tools, and diagnostics.', group: 'config' },
  { id: 'composer', label: 'Composer', icon: PenLine, desc: 'Launch surfaces, send mode, and prompt box', group: 'config' },
  { id: 'keyboard', label: 'Shortcuts', icon: Keyboard, desc: 'Remap chords and view all shortcuts', group: 'config' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, desc: 'Guidance, tool trust, and PDF export', group: 'config' },
  { id: 'browser', label: 'Browsers', icon: Globe, desc: 'Import cookies into the in-app browser', group: 'config' },
  { id: 'terminal', label: 'Terminal', icon: TerminalSquare, desc: 'Appearance, shell & tmux', group: 'config' },
  { id: 'harness', label: 'AI Harness', icon: Bot, desc: 'Manage coding agents, model availability, and session defaults.', group: 'config' },
  { id: 'editor', label: 'Editor', icon: SquareArrowOutUpRight, desc: 'Open-in-editor & terminal buttons', group: 'config' },
  { id: 'prompts', label: 'Prompts', icon: Sparkles, desc: 'LLM micro-call prompts', group: 'config' },
  { id: 'machines', label: 'Machines', icon: Laptop, desc: 'Computers that run projects and agents for this Zana', group: 'remote' },
  { id: 'connectivity', label: 'Connectivity', icon: Network, desc: 'Unpaired SSH fallback', group: 'remote' },
  { id: 'peers', label: 'Peers', icon: Link2, desc: 'Peers are linked computers that can be used by Plugins to communicate between the computers. They are different from Machines which describe Computers where Agents can be run. Connections will not be used until a Plugin is configured to use the Connection.', group: 'remote' },
  { id: 'remote-access', label: 'Remote access', icon: Globe, desc: 'Open this computer from any browser', group: 'remote' },
  { id: 'agents', label: 'Agents', icon: Bot, desc: 'Attention, automation, heartbeat & Overseer', group: 'agents' },
  { id: 'personas', label: 'Personas', icon: Drama, desc: 'Reusable launch profiles', group: 'agents' },
  { id: 'squads', label: 'Squads', icon: Users, desc: 'Reusable multi-agent squads', group: 'agents' },
  { id: 'usage', label: 'Usage', icon: BarChart3, desc: 'Session activity rollup', group: 'catalogues' },
  { id: 'experimental', label: 'Experimental', icon: FlaskConical, desc: 'Opt-in features under evaluation', group: 'labs' },
  { id: 'performance', label: 'Performance', icon: BarChart3, desc: 'Host daemon resources, workload, and connection health', group: 'app' },
  { id: 'development', label: 'Development', icon: Code2, desc: 'Develop plugins and recover the runtime', group: 'app' },
  { id: 'about', label: 'About', icon: Info, desc: 'Version, updates, credits & release notes', group: 'app' }
];

/** The sections shown in the picker, minus any the current config/plugin set hides. */
export function visibleSettingsSections(hidden: ReadonlySet<string>): typeof SETTINGS_SECTIONS {
  return hidden.size === 0 ? SETTINGS_SECTIONS : SETTINGS_SECTIONS.filter((section) => !hidden.has(section.id));
}

/**
 * Anchor sub-sections per settings tab — the inner `<Section>` blocks the picker
 * exposes as clickable jump targets. `id` matches the `anchorId` passed to the
 * corresponding `<Section>` (which renders `id="settings-anchor-<id>"`); the
 * picker switches to `tab` then scrolls that element into view. Catalogue tabs
 * (Personas/Squads/Usage) are whole sub-components with no core `<Section>`
 * blocks to target.
 */
export const SETTINGS_SUBSECTIONS: Partial<Record<SettingsTab, Array<{ id: string; label: string }>>> = {
  development: [
    { id: 'recovery', label: 'Recovery' },
    { id: 'bundled-plugins', label: 'Bundled plugins' }
  ],
  performance: [
    { id: 'performance-trends', label: 'Daemon trends' },
    { id: 'performance-work', label: 'Current work' },
    { id: 'performance-connection', label: 'Connection & diagnostics' }
  ],
  agents: [
    { id: 'agent-guidance', label: 'Agent guidance' },
    { id: 'git-worktrees', label: 'Git worktrees' },
    { id: 'agent-tabs', label: 'Tabs' },
    { id: 'teams', label: 'Squads' },
    { id: 'agent-attention', label: 'Agent attention' },
    { id: 'scheduled', label: 'Scheduled' },
    { id: 'agent-automation', label: 'Agent automation' },
    { id: 'agent-heartbeat', label: 'Agent heartbeat' },
    { id: 'api-error-resume', label: 'Resume after API errors' },
    { id: 'auto-close-idle', label: 'Idle handling & follow-ups' },
    { id: 'legacy-agent', label: 'CLI Agent' },
    { id: 'overseer', label: 'Overseer' },
    { id: 'auto-mode', label: 'Auto mode' }
  ],
  global: [
    { id: 'appearance', label: 'Appearance' },
    { id: 'cli-skills', label: 'CLI skills' },
    { id: 'debug', label: 'Debug' }
  ],
  composer: [
    { id: 'launch-surfaces', label: 'Launch surfaces' },
    { id: 'composer', label: 'Composer' }
  ],
  keyboard: [
    { id: 'keyboard', label: 'Shortcuts' }
  ],
  terminal: [
    { id: 'terminal-appearance', label: 'Appearance' },
    { id: 'terminal-shell', label: 'Shell' },
    { id: 'terminal-tmux', label: 'tmux' }
  ],
  harness: [
    { id: 'harness-status', label: 'Installed harnesses' },
    { id: 'harness-models', label: 'Model lists' },
    { id: 'harness-thread', label: 'Modern' },
    { id: 'harness-legacy', label: 'CLI Agent' },
    { id: 'harness-claude', label: 'Claude Code' },
    { id: 'harness-cursor', label: 'Cursor' },
    { id: 'harness-codex', label: 'Codex' },
    { id: 'harness-pi', label: 'PI' },
    { id: 'harness-opencode', label: 'OpenCode' },
    { id: 'harness-grok', label: 'Grok Build' },
    { id: 'harness-mastracode', label: 'Mastra Code' }
  ],
  editor: [
    { id: 'editor-status', label: 'Installed editors' },
    { id: 'editor-cursor', label: 'Cursor' },
    { id: 'editor-code', label: 'VS Code' },
    { id: 'editor-intellij', label: 'IntelliJ IDEA' },
    { id: 'editor-finder', label: fileManagerTitle() },
    { id: 'editor-terminal', label: 'Terminal' }
  ],
  machines: [
    { id: 'machines', label: 'Paired machines' }
  ],
  connectivity: [
    { id: 'connectivity-remote', label: 'Remote SSH' }
  ],
  phone: [
  ],
  peers: [
    { id: 'peers', label: 'Peer links' }
  ],
  inbox: [
    { id: 'inbox-general', label: 'Inbox' }
  ],
  browser: [
    { id: 'browsers', label: 'Browsers' }
  ],
  about: [
    { id: 'about-credits', label: 'Credits' }
  ]
};
