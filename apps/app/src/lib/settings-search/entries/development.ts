import type { SettingsSearchEntry } from '../types';

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'development.recovery', section: 'development', anchor: 'recovery', label: 'Recovery',
    help: 'Restore the host runtime and plugin code from Settings, even when an agent cannot launch.',
    keywords: ['repair', 'reset'], kind: 'subsection'
  },
  {
    id: 'development.restart-daemon', section: 'development', anchor: 'recovery', label: 'Restart host daemon',
    help: 'Restart the local service that runs agents and terminals. Running agents and terminals may be interrupted.',
    keywords: ['relaunch', 'harness', 'machine', 'host deamon'], kind: 'action'
  },
  {
    id: 'development.hard-plugin-reload', section: 'development', anchor: 'recovery', label: 'Hard Plugin reload',
    help: 'Fetch fresh plugin files and preserve settings, credentials, data and enabled states.',
    keywords: ['repair plugins', 'reset plugins', 'corrupted', 'marketplace', 'restore', 'agent provider'], kind: 'action'
  },
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
