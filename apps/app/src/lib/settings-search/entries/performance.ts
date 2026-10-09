import type { SettingsSearchEntry } from '../types';

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'performance.machine',
    section: 'performance',
    label: 'Performance machine',
    options: ['No machines available'],
    keywords: ['machine', 'host', 'refresh', 'copy diagnostics'],
    kind: 'setting'
  },
  {
    id: 'performance.trends',
    section: 'performance',
    anchor: 'performance-trends',
    label: 'Trend sampling window',
    help: 'Samples every five seconds while this page is visible. Up to ten minutes are kept for the selected machine; gaps break the line.',
    keywords: ['cpu', 'memory', 'chart', 'history'],
    kind: 'setting'
  },
  {
    id: 'performance.server',
    section: 'performance',
    anchor: 'performance-server',
    label: 'Product server',
    help: 'The server handles application data and history. Its resource use is measured separately from the execution daemon.',
    keywords: ['cpu', 'memory', 'process age', 'resource use'],
    kind: 'subsection'
  }
];

export default entries;
