import type { SettingsSearchEntry } from '../types';

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'about.app',
    section: 'about',
    anchor: 'about-app',
    label: 'About',
    help: 'App version and updates.',
    keywords: ['version', 'update', 'release notes', 'whats new'],
    kind: 'subsection'
  },
  {
    id: 'about.version',
    section: 'about',
    anchor: 'about-app',
    label: 'Version',
    keywords: ['build', 'app version', 'check for updates'],
    kind: 'setting'
  },
  {
    id: 'about.credits',
    section: 'about',
    anchor: 'about-credits',
    label: 'Architecture and product inspiration',
    help: 'Where Zana’s architecture and product ideas come from.',
    keywords: ['credits', 'bb', 'cursor', 'codex', 'claude code', 'acknowledgements'],
    kind: 'setting'
  },
  {
    id: 'about.developer',
    section: 'about',
    anchor: 'about-developer',
    label: 'Developer',
    help: 'Diagnostics for testing the update flow. Off by default; intended for QA and development.',
    keywords: ['qa', 'diagnostics'],
    kind: 'subsection'
  },
  {
    id: 'about.update-simulation',
    section: 'about',
    anchor: 'about-developer',
    label: 'Enable update simulation (dev/QA)',
    help: 'Reveals a “Simulate update” button that walks the full available → downloading → downloaded flow WITHOUT contacting the release feed or downloading anything. Nothing is actually installed — the “Restart now” button is a no-op while simulating. Off by default.',
    keywords: ['fake update', 'simulate update', 'testing'],
    kind: 'setting',
    value: (s) => (s.config.enableUpdateSimulation ? 'On' : 'Off')
  }
];

export default entries;
