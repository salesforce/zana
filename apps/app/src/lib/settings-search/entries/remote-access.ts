import type { SettingsSearchEntry } from '../types';

// Remote access page (RemoteAccessView, desktop only). Connect codes, tokens
// and account sign-in state are never indexed; only availability is.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'phone.browser-guide',
    section: 'remote-access',
    label: 'Use Zana from your phone',
    help: 'Open the address in Remote access from your phone’s browser, then sign in with the same GitHub account. Keep this computer awake and Zana running. No app installation is needed.',
    keywords: ['mobile', 'phone', 'smartphone', 'ios', 'android', 'browser access', 'add a phone', 'set up my domain', 'safari', 'chrome', 'native app', 'wi-fi', 'cellular'],
    kind: 'action'
  },
  {
    id: 'remote-access.toggle',
    section: 'remote-access',
    label: 'Remote access',
    help: 'Use this computer’s Zana from your phone or another browser. Turning access off keeps this computer connected to your account.',
    keywords: ['publish', 'public url', 'gateway', 'browser access', 'tunnel', 'relay', 'enable remote access', 'open this computer from any browser'],
    kind: 'setting',
    value: (s) => (s.config.mobileGatewayEnabled === true ? 'On' : 'Off')
  },
  {
    id: 'remote-access.connect-code',
    section: 'remote-access',
    label: 'Set up remote access',
    help: 'Sign in with GitHub and approve this computer to get a private browser address. Have a connect code? Paste a one-time code from your account as an alternative.',
    keywords: ['pair computer', 'sign in', 'github', 'connect service', 'advanced connection settings', 'link account'],
    kind: 'action'
  },
  {
    id: 'remote-access.browser-address',
    section: 'remote-access',
    label: 'Your browser address',
    help: 'Open Zana, copy the address, or pick a permanent name on your account page.',
    keywords: ['domain', 'copy address', 'open zana', 'pick your address', 'choose your address', 'subdomain'],
    kind: 'setting'
  },
  {
    id: 'remote-access.account-links',
    section: 'remote-access',
    label: 'Manage account',
    help: 'Manage your account and browser address. Unlink this computer under Connection options to remove its saved account connection.',
    keywords: ['manage account', 'connection options', 'disconnect this computer', 'unlink'],
    kind: 'action'
  },
  {
    id: 'remote-access.shared-previews',
    section: 'remote-access',
    label: 'Share a web preview',
    help: 'Open a running web app on your phone or another computer. Each address requires your Connect account. Shares expire after eight hours; sharing again renews them. Machine: Zana computer. Port. Share preview.',
    keywords: ['share dev server', 'localhost port', 'preview link', 'share a port', 'stop sharing'],
    kind: 'setting'
  },
  {
    id: 'remote-access.shared-instance',
    section: 'remote-access',
    label: 'Open another Zana',
    help: 'Sign in to open an existing shared instance in this desktop app. Its projects, threads and machines stay together at the same address.',
    href: '/settings/remote-access#remote-access.shared-instance',
    keywords: ['open an existing zana', 'shared zana', 'sign in', 'refresh instances', 'open instance', 'shared client'],
    kind: 'action'
  }
];

export default entries;
