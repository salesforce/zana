import type { SettingsSearchEntry } from '../types';

/** Settings > Browsers (cookie import into the in-app browser). Source rows are runtime data, not indexed. */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'browser.import-intro',
    section: 'browser',
    anchor: 'browsers',
    label: 'Browsers',
    help: 'Bring signed-in sessions from a browser on this machine into the in-app browser, so previews and agent tabs open already logged in. Cookie values never leave the desktop main process.',
    keywords: ['import cookies', 'chrome', 'safari', 'firefox', 'edge', 'brave', 'logged in', 'sessions', 'in-app browser', 'refresh', 'rescan', 'detect browsers'],
    kind: 'subsection'
  }
];
