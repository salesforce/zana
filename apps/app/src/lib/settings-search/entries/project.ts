import type { ProjectSettings } from '@zana-ai/zcc-domain/product';
import type { SettingsSearchEntry, SettingsValueSnapshot } from '../types';

// Project settings (ProjectSettingsView + ProjectSourcesSettings). These rows
// follow the selected project, so values read `snapshot.project.settings` only.
// Remote-only and local-only sections carry `scope`. Per-harness rows sit in
// collapsed harness cards and fall back to the AI harnesses anchor. Prompt
// text, extra args and env values are deliberately not indexed.

const setting = (s: SettingsValueSnapshot): ProjectSettings | undefined => s.project?.settings;
const list = (items: readonly string[] | undefined): readonly string[] | undefined => (items && items.length > 0 ? items : undefined);
const PI_THINKING = ['Default', 'Off', 'Minimal', 'Low', 'Medium', 'High', 'XHigh', 'Max'] as const;

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'project.landing',
    section: 'project',
    label: 'Project settings',
    help: 'Shown as “No project selected” until you choose a project in the sidebar to manage its CLI flags, MCP servers, and config files.',
    options: ['Select a project…'],
    keywords: ['project', 'per project', 'cwd', 'path', 'clone', 'default'],
    kind: 'section'
  },
  {
    id: 'project.remote-connection',
    section: 'project',
    anchor: 'project-remote',
    label: 'Remote connection',
    help: 'SSH host and user. Agents run on this machine and execute file and shell tools on the remote over SSH.',
    keywords: ['ssh', 'remote project', 'host', 'user'],
    kind: 'subsection',
    scope: 'remote'
  },
  {
    id: 'project.remote-start-path',
    section: 'project',
    anchor: 'project-remote',
    label: 'Remote start path',
    help: 'The directory this project\'s Explorer and remote tools open in on the remote host. Leave blank to use the global default remote path, then the remote $HOME.',
    keywords: ['remote path', 'ssh path', 'cwd', 'folder trust', 'explorer root', 'remote home'],
    kind: 'setting',
    scope: 'remote'
  },
  {
    id: 'project.checkouts',
    section: 'project',
    anchor: 'project-checkouts',
    label: 'Checkouts on your machines',
    help: 'Use this same project on different machines. Each machine keeps its own files and Git changes. Shared history and project settings stay with this Zana instance.',
    keywords: ['clone', 'sources', 'machines', 'multiple machines', 'shared metadata'],
    kind: 'subsection',
    scope: 'local'
  },
  {
    id: 'project.checkout-machine',
    section: 'project',
    anchor: 'project-checkouts',
    label: 'Machine',
    help: 'Pick the machine that holds another checkout of this project. Offline machines cannot be chosen.',
    options: ['Choose a machine', 'No other machines'],
    keywords: ['checkout machine', 'add checkout', 'host'],
    kind: 'setting',
    scope: 'local'
  },
  {
    id: 'project.checkout-folder',
    section: 'project',
    anchor: 'project-checkouts',
    label: 'Existing folder',
    help: 'Absolute path of the existing folder on that machine. Removing a checkout leaves its files and existing threads intact.',
    options: ['Existing folder'],
    keywords: ['checkout folder', 'checkout path', 'add checkout', 'remove checkout'],
    kind: 'setting',
    scope: 'local'
  },
  {
    id: 'project.harnesses',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'AI harnesses',
    help: 'Project settings apply after Global defaults and before Persona and Agent choices: Global → Project → Persona → Agent. Later choices take priority when a setting cannot be combined.',
    keywords: ['harness', 'claude code', 'codex', 'cursor', 'opencode', 'pi', 'precedence', 'overrides'],
    kind: 'subsection'
  },
  {
    id: 'project.default-harness',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default harness',
    options: ['Use global default'],
    keywords: ['default agent cli', 'launch default', 'provider', 'claude', 'codex', 'cursor'],
    kind: 'setting'
  },
  {
    id: 'project.default-provider',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Provider',
    help: 'Selects which provider’s models appear below. Combined provider/model harnesses encode this choice in the model id.',
    keywords: ['provider', 'model provider'],
    kind: 'setting'
  },
  {
    id: 'project.default-model-level',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Model Level',
    help: 'Native models with portable mappings. Choose low, medium, high or extra-high per harness.',
    keywords: ['model', 'model level', 'effort', 'reasoning'],
    kind: 'setting'
  },
  {
    id: 'project.default-execution-state',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Execution State',
    help: 'Native policies with portable mappings: plan, interactive, accept-edits or autonomous.',
    keywords: ['execution state', 'permission mode', 'autonomy', 'plan mode', 'accept edits'],
    kind: 'setting'
  },
  {
    id: 'project.append-system-prompt',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Append system prompt',
    help: 'Additive: appended after Global prompt text and before Persona and Agent prompt text.',
    keywords: ['system prompt', 'instructions', 'claude'],
    kind: 'setting'
  },
  {
    id: 'project.extra-args',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Extra args',
    help: 'Applied after Global args and before Persona and Agent args. Later settings take priority when the same option appears more than once.',
    keywords: ['cli flags', 'arguments', 'plugin dir', 'claude'],
    kind: 'setting'
  },
  {
    id: 'project.add-dirs',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Add dirs',
    help: 'Combined with directories from Global, Persona, and Agent settings.',
    keywords: ['add-dir', 'directories', 'context folders', 'claude'],
    kind: 'setting',
    value: (s) => list(setting(s)?.addDirs)
  },
  {
    id: 'project.allowed-tools',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Allowed tools',
    help: 'Combined and deduplicated with allowed tools from Global, Persona, and Agent settings.',
    keywords: ['allowedTools', 'tool permissions', 'whitelist', 'claude'],
    kind: 'setting',
    value: (s) => list(setting(s)?.allowedTools)
  },
  {
    id: 'project.denied-tools',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Denied tools',
    help: 'Combined and deduplicated across every level. Earlier denials remain in effect.',
    keywords: ['deniedTools', 'blocklist', 'tool permissions', 'claude'],
    kind: 'setting',
    value: (s) => list(setting(s)?.deniedTools)
  },
  {
    id: 'project.codex-sandbox-policy',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Sandbox Policy',
    help: 'Controls filesystem and command isolation for this project. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy.',
    options: ['Read-only', 'Workspace write', 'Danger full access'],
    keywords: ['codex', 'sandbox', 'isolation'],
    kind: 'setting',
    value: (s) => setting(s)?.codexSandbox
  },
  {
    id: 'project.codex-approval-policy',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Approval Policy',
    help: 'Controls when Codex asks before acting in this project. Bracketed text shows which portable Persona/Agent Execution State normally selects this policy.',
    options: ['Untrusted', 'On request', 'Never'],
    keywords: ['codex', 'approvals', 'ask before acting'],
    kind: 'setting',
    value: (s) => setting(s)?.codexApproval
  },
  {
    id: 'project.pi-provider',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Provider (Pi)',
    help: 'Passed to PI as --provider. Leave blank to inherit the Global PI provider.',
    keywords: ['pi', 'pi provider'],
    kind: 'setting',
    value: (s) => setting(s)?.piProvider
  },
  {
    id: 'project.pi-model',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Model (Pi)',
    help: 'Passed to PI as --model. Leave blank to inherit the Global PI model.',
    keywords: ['pi', 'pi model'],
    kind: 'setting',
    value: (s) => setting(s)?.piModel
  },
  {
    id: 'project.pi-thinking',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default Thinking Level',
    help: 'Passed to PI as --thinking. Leave Default selected to inherit PI\'s native behavior.',
    options: PI_THINKING,
    keywords: ['pi', 'reasoning', 'effort'],
    kind: 'setting',
    value: (s) => setting(s)?.piThinking
  },
  {
    id: 'project.codex-model',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Model (Codex project config)',
    help: 'Project `.codex/config.toml` model override. Models come from Codex\'s account-visible catalog.',
    options: ['Unset'],
    keywords: ['codex', 'config.toml', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.codex-approval',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Approval policy',
    help: 'Codex approval policy written to the project config.',
    options: ['Unset', 'Untrusted', 'On request', 'Never'],
    keywords: ['codex', 'config.toml', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.codex-sandbox-mode',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Sandbox mode',
    help: 'Codex sandbox mode written to the project config.',
    options: ['Unset', 'Read-only', 'Workspace write', 'Danger full access'],
    keywords: ['codex', 'config.toml', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.opencode-model',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Model (OpenCode project config)',
    help: 'Project `opencode.json` model override.',
    keywords: ['opencode', 'opencode.json', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.opencode-small-model',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Small model',
    help: 'Model for lightweight OpenCode tasks.',
    keywords: ['opencode', 'opencode.json', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.opencode-default-agent',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default agent',
    help: 'Primary agent used when no `--agent` is selected.',
    options: ['Unset'],
    keywords: ['opencode', 'role', 'native role'],
    kind: 'setting'
  },
  {
    id: 'project.claude-permission-mode',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Default permission mode',
    help: 'Project .claude/ settings: Claude Code permission mode. Reads .claude/settings.json (shared, committed) and .claude/settings.local.json (personal, gitignored).',
    options: ['Unset', 'Default', 'Accept Edits', 'Plan', 'Bypass Permissions'],
    keywords: ['claude', 'settings.json', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.claude-model',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Model (Claude project settings)',
    help: 'Top-level `model` override (e.g. opus, sonnet, haiku).',
    keywords: ['claude', 'settings.json', 'settings.local.json', 'harness settings'],
    kind: 'setting'
  },
  {
    id: 'project.claude-allow',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Allow',
    help: 'permissions.allow — pre-approved tool patterns. Examples: Bash(git:*), Edit, Read.',
    keywords: ['claude', 'permissions allow', 'tool patterns', 'settings.json'],
    kind: 'setting'
  },
  {
    id: 'project.claude-deny',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Deny',
    help: 'permissions.deny — blocked tool patterns. Examples: Bash(rm:*).',
    keywords: ['claude', 'permissions deny', 'tool patterns', 'settings.json'],
    kind: 'setting'
  },
  {
    id: 'project.claude-additional-dirs',
    section: 'project',
    anchor: 'project-harnesses',
    label: 'Additional directories',
    help: 'permissions.additionalDirectories — extra paths claude can read/write outside the project root.',
    keywords: ['claude', 'additional directories', 'extra paths', 'settings.json'],
    kind: 'setting'
  },
  {
    id: 'project.worktrees',
    section: 'project',
    anchor: 'project-worktrees',
    label: 'Git worktrees',
    help: 'Choose whether new agents for this project use separate branches and checkouts. This project setting overrides the global Agents default.',
    keywords: ['worktree', 'branches', 'isolation', 'git'],
    kind: 'subsection',
    scope: 'local'
  },
  {
    id: 'project.worktree-isolation',
    section: 'project',
    anchor: 'project-worktrees',
    label: 'Worktree isolation',
    help: 'Controls the initial Worktree choice for new agents in this project. Main still verifies the folder is a Git repository before creating a worktree.',
    options: ['Use global default', 'Always use worktrees', 'Never use worktrees'],
    keywords: ['worktree', 'git worktree', 'branch per agent', 'isolate agents'],
    kind: 'setting',
    scope: 'local',
    value: (s) => {
      const on = setting(s)?.worktreeIsolation;
      return on === undefined ? undefined : on ? 'Always use worktrees' : 'Never use worktrees';
    }
  },
  {
    id: 'project.processes',
    section: 'project',
    anchor: 'project-processes',
    label: 'Running processes',
    help: 'Processes whose current working directory is inside this project. Archiving a conversation does not stop leftover servers here; stop selected processes explicitly.',
    keywords: ['kill process', 'leftover servers', 'dev server', 'port', 'pid', 'refresh'],
    kind: 'subsection'
  },
  {
    id: 'project.execution-consent',
    section: 'project',
    anchor: 'project-execution-consent',
    label: 'Execution consent',
    help: 'Execution consent lets a matching harness use an approved execution mode in this project without asking again. It is not a reusable harness preference; revoking affects this project only.',
    keywords: ['revoke', 'approved execution mode', 'grants', 'ask again'],
    kind: 'subsection'
  }
];

export default entries;
