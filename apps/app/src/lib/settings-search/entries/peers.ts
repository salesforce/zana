import type { SettingsSearchEntry } from '../types';

// Peers page (PeersSettingsView): plugin links to other installs and the uses behind them.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'peers.links',
    section: 'peers',
    anchor: 'peers',
    label: 'Peers',
    help: 'Connections between computers; plugins ask to use them. A connection is only useful once you install a plugin that uses connections, and connections cannot run work on this machine.',
    keywords: ['peer', 'peers', 'link', 'plugin link', 'remove link', 'remove use', 'introduction'],
    kind: 'subsection'
  },
  {
    id: 'peers.empty',
    section: 'peers',
    anchor: 'peers',
    label: 'No connections yet',
    help: 'No connections yet. A connection is only useful once a plugin that uses connections is installed; they appear here when a plugin connects this install to another one.',
    keywords: ['peer', 'empty', 'no links'],
    kind: 'setting'
  },
  {
    id: 'peers.link-list',
    section: 'peers',
    anchor: 'peers',
    label: 'Peer links',
    help: 'Remove a plugin use, or remove the whole link and every use on it. Peer links never appear in Machines.',
    keywords: ['remove use', 'remove link', 'pause', 'resume', 'reconnect', 'plugin uses', 'connected', 'linked', 'unclaimed', 'failed'],
    kind: 'setting'
  }
];
