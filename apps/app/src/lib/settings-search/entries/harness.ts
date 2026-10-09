import { providerUiSchema } from '@zana-ai/zcc-domain/launch-provider';
import type { SettingsSearchEntry } from '../types';

// AI Harness page. Per-family rows (name, enable switch, binary, launch
// defaults) and the Modern provider list come from `providers/harness.ts`.

const CODEX_UI = providerUiSchema('codex');
const PI_THINKING = ['Default', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'];
const text = (config: { [k: string]: unknown }, key: string): string | undefined => {
  const v = config[key];
  return typeof v === 'string' && v ? v : undefined;
};

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'harness.installed-harnesses',
    section: 'harness',
    anchor: 'harness-status',
    label: 'Installed harnesses',
    help: 'Choose which coding agents appear when you start a session. Each harness uses its own account and sign-in. Check status refreshes installation, sign-in, and model availability.',
    keywords: ['coding agents', 'install', 'sign in', 'login', 'claude code', 'cursor', 'codex', 'check status', 'update all'],
    kind: 'subsection'
  },
  {
    id: 'harness.model-lists',
    section: 'harness',
    anchor: 'harness-models',
    label: 'Model lists',
    help: 'Signed in or changed providers? Refresh model choices for Modern and CLI Agent sessions.',
    keywords: ['recalculate models', 'refresh models', 'reload models'],
    kind: 'subsection'
  },
  {
    id: 'harness.session-settings',
    section: 'harness',
    anchor: 'harness-session',
    label: 'Session settings',
    help: 'Browse models for Thread conversations. Choose a model in the conversation composer; open a harness here to search its models or refresh availability. Set defaults for agents running in a terminal. Project, Persona, and Agent settings can override these defaults. Default Provider: choose the provider to use for new CLI agents and the models shown below. Default Model Level: choose a model for new CLI agents. Levels in brackets match Persona and Agent model settings. Default Execution State: choose how new CLI agents plan, edit files, and ask for approval. Launch defaults, Connection, Project agents.',
    keywords: ['modern', 'cli agent', 'terminal', 'launch defaults', 'priority', 'global', 'project', 'persona'],
    kind: 'subsection'
  },
  {
    id: 'harness.default-harness',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Default harness',
    help: 'Used when a new CLI agent has no explicit harness or pinned Persona.',
    keywords: ['default agent', 'cli agent', 'harness'],
    kind: 'setting',
    value: (s) => text(s.config as never, 'defaultHarness') ?? 'claude'
  },
  {
    id: 'harness.opencode.discover-agents',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Discover project agents',
    help: 'Show additional OpenCode agents in Modern and CLI Agent pickers. Build and Plan stay available when off. Discover additional native agents.',
    keywords: ['opencode', 'native agents', 'roles'],
    kind: 'setting',
    value: (s) => (s.config.nativeAgentDiscoveryEnabled !== false ? 'On' : 'Off')
  },
  {
    id: 'harness.claude.append-system-prompt',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Append system prompt',
    help: 'Add guidance for every Claude Code CLI agent. Additive: this text is appended first. Project, Persona, and Agent prompt text is appended after it.',
    keywords: ['claude code', 'instructions', 'system prompt', 'guidance'],
    kind: 'setting'
  },
  {
    id: 'harness.claude.extra-args',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Extra args',
    help: 'Command arguments. Applied first. If a later Project, Persona, or Agent setting uses the same option, the later setting takes priority.',
    keywords: ['claude code', 'flags', 'command line', 'arguments', 'plugin dir'],
    // No value: free-form CLI args are where people paste --api-key or header JSON.
    kind: 'setting'
  },
  {
    id: 'harness.claude.add-dirs',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Add dirs',
    help: 'Tools & access. Directories and tool rules combine with your Project, Persona, and Agent settings. Combined: directories from Global, Project, Persona, and Agent settings are all included.',
    keywords: ['claude code', 'directories', 'folders', 'access'],
    kind: 'setting',
    value: (s) => s.config.claudeAddDirs
  },
  {
    id: 'harness.claude.allowed-tools',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Allowed tools',
    help: 'Combined and deduplicated across Global, Project, Persona, and Agent settings.',
    keywords: ['claude code', 'allow', 'permissions', 'bash'],
    kind: 'setting',
    value: (s) => s.config.claudeAllowedTools
  },
  {
    id: 'harness.claude.denied-tools',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Denied tools',
    help: 'Combined and deduplicated across every level. A denial remains in effect when later levels add more settings.',
    keywords: ['claude code', 'deny', 'block', 'permissions'],
    kind: 'setting',
    value: (s) => s.config.claudeDeniedTools
  },
  {
    id: 'harness.pi.provider',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Pi default provider',
    help: 'Provider name, such as anthropic or openai. Leave blank to use Pi’s own default. Provider & reasoning.',
    keywords: ['pi', 'provider'],
    kind: 'setting',
    value: (s) => s.config.piProvider || undefined
  },
  {
    id: 'harness.pi.model',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Pi default model',
    help: 'A model ID or name pattern, such as openai/gpt-5 or sonnet. Leave blank to use the provider’s default. Default model.',
    keywords: ['pi', 'model'],
    kind: 'setting',
    value: (s) => s.config.piModel || undefined
  },
  {
    id: 'harness.pi.thinking',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Pi default thinking level',
    help: 'Choose how much reasoning Pi uses. Default lets Pi decide. Default thinking level.',
    options: PI_THINKING,
    keywords: ['pi', 'reasoning', 'effort'],
    kind: 'setting',
    value: (s) => {
      const level = s.config.piThinking ?? 'default';
      return PI_THINKING.find((o) => o.toLowerCase() === level) ?? level;
    }
  },
  {
    id: 'harness.codex.sandbox',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Default Sandbox Policy',
    help: 'Permissions & isolation. Choose which files and commands Codex can access.',
    options: ['Use harness default', ...CODEX_UI.sandboxes.map((o) => o.label)],
    keywords: ['codex', 'sandbox', 'permissions', 'isolation'],
    kind: 'setting',
    value: (s) => CODEX_UI.sandboxes.find((o) => o.id === s.config.defaultCodexSandbox)?.label
  },
  {
    id: 'harness.codex.approval',
    section: 'harness',
    anchor: 'harness-legacy',
    label: 'Default Approval Policy',
    help: 'Choose when Codex asks before taking an action.',
    options: ['Use harness default', ...CODEX_UI.approvals.map((o) => o.label)],
    keywords: ['codex', 'approval', 'permissions', 'ask'],
    kind: 'setting',
    value: (s) => CODEX_UI.approvals.find((o) => o.id === s.config.defaultCodexApproval)?.label
  }
];

export default entries;
