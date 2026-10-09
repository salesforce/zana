import type { SettingsSearchEntry } from '../types';

// Connectivity page (ConnectivityView): the unpaired SSH fallback.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'connectivity.remote-ssh',
    section: 'connectivity',
    anchor: 'connectivity-remote',
    label: 'Remote SSH defaults',
    help: 'Defaults for remote (SSH) projects. Enrolled machines live under Settings → Machines.',
    keywords: ['ssh', 'remote projects', 'unpaired ssh', 'fallback'],
    kind: 'subsection'
  },
  {
    id: 'connectivity.default-remote-path',
    section: 'connectivity',
    anchor: 'connectivity-remote',
    label: 'Default remote path',
    help: 'Fallback start path for SSH remotes that are not paired to a Machine and do not set their own project path. Enrolled machines have their own default under Settings → Machines. A per-project Remote start path still wins. Leave blank to start in the remote home directory.',
    keywords: ['ssh start path', 'remote home', 'workspace path', 'cwd'],
    kind: 'setting',
    value: (s) => s.config.remoteDefaultPath || undefined
  },
  {
    id: 'connectivity.remote-mcp',
    section: 'connectivity',
    anchor: 'connectivity-remote',
    label: 'Give remote agents the inbox (MCP over the tunnel)',
    help: 'Forward the zcc-inbox MCP server to remote (SSH) agents over the same reverse tunnel already used for live status. When on, a remote Claude agent can push to your inbox, ask questions, search the inbox, coordinate with peers, and read/write the project library — the same tools a local agent has. Off by default: without it, remote agents can only report status via fire-and-forget hooks. The reverse tunnel is a prerequisite, so this has no effect on shell/scheduled remote sessions.',
    keywords: ['inbox', 'mcp', 'reverse tunnel', 'remote agents', 'ssh agents', 'library'],
    kind: 'setting',
    value: (s) => (s.config.remoteMcpEnabled ? 'On' : 'Off')
  }
];

export default entries;
