import type { SettingsSearchEntry } from '../types';
import { notificationSoundsEnabled } from '@zana-ai/zcc-domain/product';
const onOff = (on: boolean): string => on ? 'On' : 'Off';
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'agents.agent-sounds.intro', section: 'notifications', anchor: 'builtin-chimes',
    label: 'Sounds by event', kind: 'subsection', href: '/settings/notifications?provider=builtin#builtin-chimes',
    help: 'Use the built-in chimes or choose your own audio. No plugin needed.',
    keywords: ['audio', 'sound', 'chime', 'notification', 'mp3', 'wav', 'ogg', 'custom', 'import', 'upload', 'Default chime', 'Choose audio file…', 'Chimes & custom audio'],
    options: ['Default chime', 'Choose audio file…', 'Chimes & custom audio'],
  },
  ...([
    ['done', 'Agent finishes a turn', 'agentSoundDone'],
    ['needs-you', 'Agent needs you', 'agentSoundNeedsYou'],
    ['idle', 'Agent becomes idle', 'agentSoundIdle'],
  ] as const).map(([id, label, key]): SettingsSearchEntry => ({
    id: `agents.sound-${id}`, section: 'notifications', anchor: 'builtin-chimes', label,
    help: id === 'idle' ? 'After five seconds at rest. Idle does not confirm a completed turn.' : id === 'done'
      ? 'When the agent reports a completed turn. This does not verify the result.' : 'When an agent requests your input or approval.',
    kind: 'setting', href: `/settings/notifications?provider=builtin#agents.sound-${id}`, keywords: ['audio', 'sound', 'chime', 'notification', id],
    value: (s) => onOff(s.config[key] === true),
  })),
  {
    id: 'agents.sound-volume', section: 'notifications', anchor: 'builtin-chimes',
    label: 'Volume', kind: 'setting', href: '/settings/notifications?provider=builtin#agents.sound-volume', help: 'Relative to system volume. Zero mutes notification audio.',
    keywords: ['audio', 'sound', 'chime', 'volume'],
    value: (s) => `${s.config.agentSoundVolume ?? 50}%`,
  },
  {
    id: 'agents.sound-spacing', section: 'notifications', anchor: 'builtin-chimes', label: 'Quiet spacing', kind: 'setting',
    href: '/settings/notifications?provider=builtin#agents.sound-spacing', help: 'Keep a busy fleet quiet. Input requests take priority.',
    keywords: ['sound', 'audio', 'cooldown', 'spacing', 'overlap'], value: s => `${s.config.agentSoundSpacingSeconds ?? 2} seconds`,
  },
  {
    id: 'agents.sound-preview', section: 'notifications', anchor: 'builtin-chimes',
    label: 'Preview sounds', kind: 'action', href: '/settings/notifications?provider=builtin#agents.sound-preview',
    help: 'Try either chime without enabling notifications. Sound playback is available in the Zana desktop app.',
    keywords: ['audio', 'sound', 'chime', 'preview'],
  },

  { id: 'notifications.sounds-enabled', section: 'notifications', anchor: 'agent-sounds', label: 'Play notification sounds', kind: 'setting', keywords: ['sound', 'audio', 'mute'], value: s => onOff(notificationSoundsEnabled(s.config)) },
  { id: 'notifications.sound-provider', section: 'notifications', anchor: 'agent-sounds', label: 'Sound provider', kind: 'setting', help: 'One provider plays at a time. Switching providers turns playback off. Chimes and your own audio work out of the box. Plugins can add other sound experiences.', keywords: ['sound', 'audio', 'plugin', 'chime'], options: ['Unavailable provider'] }
];
