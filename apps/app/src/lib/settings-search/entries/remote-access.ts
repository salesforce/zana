import type { SettingsSearchEntry } from '../types';

// Remote access page (RemoteAccessView, desktop only). Connect codes, tokens
// and account sign-in state are never indexed; only the on/off switch is.

export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'remote-access.toggle',
    section: 'remote-access',
    label: 'Remote access',
    help: 'Publish this Zana instance at your-name.zana-ide.com, or open an existing instance below. Turning access off also disconnects paired phones until you enable it again.',
    keywords: ['publish', 'public url', 'gateway', 'browser access', 'tunnel', 'relay', 'enable remote access', 'open this computer from any browser'],
    kind: 'setting',
    value: (s) => (s.config.mobileGatewayEnabled === true ? 'On' : 'Off')
  },
  {
    id: 'remote-access.connect-code',
    section: 'remote-access',
    label: 'Get a connect code',
    help: 'Pairing gives this computer a private URL like your-name.zana-ide.com. Get a one-time connect code from your Zana account and paste it here — it connects automatically.',
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
    label: 'Manage account, add a phone or an execution machine',
    help: 'Shortcuts to your Zana account, the Mobile page and the Machines page.',
    keywords: ['manage account', 'add a phone', 'add an execution machine', 'disconnect this computer', 'unlink'],
    kind: 'action'
  },
  {
    id: 'remote-access.shared-previews',
    section: 'remote-access',
    label: 'Shared previews',
    help: 'Open a running web app on your phone or another computer. Each address requires your Connect account. Shares expire after eight hours; sharing again renews them. Machine: Zana computer. Port. Share preview.',
    keywords: ['share dev server', 'localhost port', 'preview link', 'share a port', 'stop sharing'],
    kind: 'setting'
  },
  {
    id: 'remote-access.shared-instance',
    section: 'remote-access',
    label: 'Open an existing Zana instead',
    help: 'Sign in to open an existing shared instance in this desktop app. Its projects, threads and machines stay together at the same address.',
    keywords: ['shared zana', 'sign in', 'refresh instances', 'open instance', 'shared client'],
    kind: 'action'
  }
];

export default entries;
