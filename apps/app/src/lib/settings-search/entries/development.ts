import type { SettingsSearchEntry } from '../types';

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'development.bundled-plugins',
    section: 'development',
    anchor: 'bundled-plugins',
    label: 'Bundled plugins',
    help: 'Develop and test bundled plugins on this instance.',
    keywords: ['developer', 'local source', 'hot reload'],
    kind: 'subsection'
  },
  {
    id: 'development.plugin-development',
    section: 'development',
    anchor: 'bundled-plugins',
    label: 'Bundled plugin development',
    help: 'Allow local source folders to override bundled plugins and automatically rebuild bundled plugins when their sources change. Applies immediately. Turning this off stops source watching and blocks further overrides; currently loaded plugins keep running.',
    keywords: ['developer mode', 'hot reload', 'local override', 'reserved plugin', 'source watching'],
    kind: 'setting',
    value: s => s.config.pluginDevelopmentEnabled ? 'On' : 'Off'
  }
];

export default entries;
