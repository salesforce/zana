import type { SettingsSearchEntry } from '../types';

// Mobile page (PhoneSettingsView): guidance only, no stored settings.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'phone.mobile',
    section: 'phone',
    anchor: 'phone',
    label: 'Use Zana from your phone',
    help: 'Use your projects and agents from your phone’s browser.',
    keywords: ['mobile', 'phone', 'smartphone', 'ios', 'android', 'browser access'],
    kind: 'subsection'
  },
  {
    id: 'phone.app-notice',
    section: 'phone',
    anchor: 'phone',
    label: 'Zana mobile app',
    help: 'Coming soon. In the meantime, use Zana in your mobile browser. No app installation is needed.',
    keywords: ['native app', 'app store', 'testflight', 'coming soon'],
    kind: 'setting'
  },
  {
    id: 'phone.browser-guide',
    section: 'phone',
    anchor: 'phone',
    label: 'Use Zana in your mobile browser',
    help: 'Set up your domain in Remote access, open it in Safari or Chrome on your phone, then sign in with the same GitHub account and choose Open Zana. Keep this computer awake, Zana running, and Remote access enabled. Your phone can connect over Wi-Fi or cellular internet.',
    keywords: ['set up my domain', 'safari', 'chrome', 'github sign in', 'bookmark', 'wi-fi', 'cellular', 'connect code'],
    kind: 'setting'
  }
];

export default entries;
