import type { SettingsSearchEntry } from '../types';

// Machines page (MachinesSettingsView + MachineCard + RemoteMachineDefaultsList).
// Per-machine rows repeat for every host; the target is the first card.
// Pairing codes, SSH identities and tokens are never indexed.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'machines.pairing',
    section: 'machines',
    anchor: 'machines',
    label: 'Pair another computer',
    help: 'Pair another computer so projects and agents can run there. SSH remotes stay a separate path — they use this machine’s daemon to ssh in. Connected machines follow the server version automatically; Codex, Claude Code, and the other harness CLIs update from the rows below (npm installs can take a few minutes).',
    keywords: ['host daemon', 'remote machine', 'enrolled machines', 'pairing', 'execution machine', 'harness cli versions', 'update harness clis'],
    kind: 'subsection'
  },
  {
    id: 'machines.public-app-url',
    section: 'machines',
    anchor: 'machines',
    label: 'Public app URL',
    help: 'Origin remotes use to enroll. Official builds bake this. For local and dev builds, point it at an address the remote machine can reach.',
    keywords: ['origin', 'enroll url', 'server address', 'tunnel', 'domain'],
    kind: 'setting',
    value: (s) => s.config.publicAppUrl || undefined
  },
  {
    id: 'machines.add-machine',
    section: 'machines',
    anchor: 'machines',
    label: 'Add a machine',
    help: 'Pair a new remote computer with a connect command, or re-pair an existing one.',
    keywords: ['pair', 'enroll', 'connect machine', 'new machine', 'remote host', 'ssh', 'install daemon'],
    kind: 'action'
  },
  {
    id: 'machines.permission-ceiling',
    section: 'machines',
    anchor: 'machines',
    label: 'Permission ceiling',
    help: 'The highest permission mode agents on this machine can use.',
    options: ['Accept edits', 'Auto', 'Full'],
    keywords: ['max permission', 'machine permissions', 'agent permissions', 'autonomy', 'sandbox'],
    kind: 'setting'
  },
  {
    id: 'machines.default-workspace-path',
    section: 'machines',
    anchor: 'machines',
    label: 'Default workspace path',
    help: 'Start path for SSH projects on this machine that do not set their own. Leave blank to fall through to Connectivity’s global default, then the remote home directory.',
    keywords: ['start path', 'remote path', 'workspace root', 'per machine'],
    kind: 'setting'
  },
  {
    id: 'machines.machine-actions',
    section: 'machines',
    anchor: 'machines',
    label: 'Rename, reconnect, relaunch or remove a machine',
    help: 'Per-machine actions: rename, reconnect, pair again, relaunch the local harness, retry an update, or remove a machine.',
    keywords: ['rename machine', 'reconnect', 'pair again', 'relaunch harness', 'retry update', 'remove machine', 'forget machine', 'repair pairing'],
    kind: 'action'
  },
  {
    id: 'machines.remote-defaults',
    section: 'agents',
    anchor: 'legacy-agent-remote-defaults',
    label: 'Remote defaults',
    help: 'Each enrolled machine has its own start path for SSH projects that do not set a per-project Remote start path. Edit the path on Machines.',
    keywords: ['remote workspace path', 'per box workspace', 'enrolled machine paths', 'ssh start path'],
    kind: 'subsection'
  }
];

export default entries;
