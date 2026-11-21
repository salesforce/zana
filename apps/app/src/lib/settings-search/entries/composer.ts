import type { SettingsSearchEntry } from '../types';

const onOff = (value: boolean | undefined, fallback: boolean) => ((value ?? fallback) ? 'On' : 'Off');
const SEND_MODES: Record<string, string> = { auto: 'Auto', steer: 'Steer', 'queue-if-active': 'Queue' };
const PERMISSIONS: Record<string, string> = { 'accept-edits': 'Accept Edits', auto: 'Approve for me', full: 'Full Access' };

/** Settings > Composer. */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'composer.launch-surfaces-intro',
    section: 'composer',
    anchor: 'launch-surfaces',
    label: 'Launch surfaces',
    help: 'Choose which composers New Chat and New agent offer. At least Modern or CLI Agent must stay on.',
    keywords: ['new chat', 'new agent', 'switcher'],
    kind: 'subsection'
  },
  {
    id: 'composer.cli-agent',
    section: 'composer',
    anchor: 'launch-surfaces',
    label: 'CLI Agent',
    help: 'Start a coding agent in a terminal.',
    keywords: ['pty', 'terminal agent', 'launch switcher'],
    kind: 'setting',
    value: (s) => onOff(s.config.composerShowCliAgent, true)
  },
  {
    id: 'composer.modern',
    section: 'composer',
    anchor: 'launch-surfaces',
    label: 'Modern',
    help: 'Start a conversation in the chat view.',
    keywords: ['thread', 'timeline', 'chat', 'launch switcher'],
    kind: 'setting',
    value: (s) => onOff(s.config.composerShowModern, true)
  },
  {
    id: 'composer.squad',
    section: 'composer',
    anchor: 'launch-surfaces',
    label: 'Squad',
    help: 'Launch a group of agents.',
    keywords: ['team', 'multi-agent', 'launch switcher'],
    kind: 'setting',
    value: (s) => onOff(s.config.composerShowAutonomousTeam, true)
  },
  {
    id: 'composer.composer-intro',
    section: 'composer',
    anchor: 'composer',
    label: 'New chat defaults',
    help: 'Choose a harness, model, permissions and send behavior.',
    keywords: ['prompt box'],
    kind: 'subsection'
  },
  {
    id: 'composer.thread-harness', section: 'composer', anchor: 'composer', label: 'Default for threads',
    help: 'Used for new threads unless a project chooses another harness.', keywords: ['provider', 'agent', 'harness'], kind: 'setting'
  },
  {
    id: 'composer.model', section: 'composer', anchor: 'composer', label: 'Model',
    help: 'Remembered for this harness on this device.', keywords: ['default model'], kind: 'setting'
  },
  {
    id: 'composer.effort', section: 'composer', anchor: 'composer', label: 'Thinking effort',
    keywords: ['reasoning', 'model'], kind: 'setting'
  },
  {
    id: 'composer.default-permissions',
    section: 'composer',
    anchor: 'composer',
    label: 'Default permissions',
    help: 'Used by Modern and CLI composers and direct thread actions such as Reply in thread. Explicit launch and harness choices take priority. Existing threads keep their permissions.',
    options: ['Keep existing defaults', 'Accept Edits', 'Approve for me', 'Full Access'],
    keywords: ['yolo', 'permissions', 'sandbox', 'approval', 'skip permissions', 'accept edits', 'full access by default', 'reply in thread'],
    kind: 'setting',
    value: (s) => PERMISSIONS[s.config.defaultThreadPermissionMode ?? ''] ?? 'Keep existing defaults'
  },
  {
    id: 'composer.editing', section: 'composer', anchor: 'composer-editing', label: 'Writing and navigation', kind: 'subsection'
  },
  {
    id: 'composer.navigate-on-create',
    section: 'composer',
    anchor: 'composer-editing',
    label: 'Navigate to agents on creation',
    help: 'Open a new agent as soon as you send the first message. Off keeps you on the current page.',
    keywords: ['open agent', 'jump', 'redirect'],
    kind: 'setting'
  },
  {
    id: 'composer.markdown-in-prompt',
    section: 'composer',
    anchor: 'composer-editing',
    label: 'Markdown in the prompt box',
    help: 'Allow headings, lists, and emphasis in the composer. Mentions still work either way.',
    keywords: ['formatting', 'bold', 'italic', 'mentions'],
    kind: 'setting'
  },
  {
    id: 'composer.default-launch-mode',
    section: 'composer',
    anchor: 'composer',
    label: 'Default launch mode',
    help: 'New Chat and New agent open on this surface. Switching the segmented control also updates this default.',
    options: ['Modern', 'CLI Agent', 'Team'],
    keywords: ['default surface', 'new chat'],
    kind: 'setting'
  },
  {
    id: 'composer.send-mode',
    section: 'composer',
    anchor: 'composer',
    label: 'Send mode',
    help: 'Auto sends immediately when idle and queues while running (Cmd/Ctrl+Enter steers). Steer uses Enter to steer a running turn (Cmd/Ctrl+Enter queues). Queue always waits for the current turn to finish. Default is Auto.',
    options: ['Auto', 'Steer', 'Queue'],
    keywords: ['enter key', 'queue messages', 'steering', 'interrupt'],
    kind: 'setting',
    value: (s) => SEND_MODES[(s.config.composerSendMode ?? (s.config.steerActiveThreadOnEnter ? 'steer' : 'auto')) as string]
  },
  {
    id: 'composer.rewrite-localhost',
    section: 'composer',
    anchor: 'composer-editing',
    label: 'Rewrite localhost links',
    help: 'Replace localhost and 127.0.0.1 in agent markdown links with this window’s hostname so a remote viewer reaches the machine they’re looking at.',
    keywords: ['127.0.0.1', 'remote viewer', 'links', 'hostname'],
    kind: 'setting'
  },
  {
    id: 'composer.reload-slash-commands',
    section: 'composer',
    anchor: 'composer-editing',
    label: 'Reload slash commands',
    help: 'Refresh the / menu from installed plugin skills. On desktop this also re-deploys bundled skills and project MCP configs. Reload',
    keywords: ['refresh', 'skills', 'mcp', 'commands menu'],
    kind: 'action'
  }
];
