import type { SettingsSearchEntry } from '../types';
import { squadDefaultTransportLabel } from '@zana-ai/zcc-domain/squad-transport';

// The squad list has no settings rows (squad names and descriptions come from providers/catalogues.ts);
// the settings on this page are the human-blocker reminder window and unit checkpoints (both under Advanced).
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'squads.default-launch-mode',
    section: 'squads',
    anchor: 'squad-default-launch-mode',
    label: 'All Squads launch mode',
    help: "What a Squad set to Use default runs as. A Squad's own launch mode and the launch picker override this. Squads that already pin CLI Agent or Modern are not affected.",
    keywords: ['squad', 'launch', 'mode', 'transport', 'cli agent', 'modern', 'caller', 'default', 'follow'],
    kind: 'setting',
    value: (s) => squadDefaultTransportLabel(s.config.squadDefaultTransport)
  },
  {
    id: 'squads.blocker-reminder.minutes',
    section: 'squads',
    anchor: 'squad-blocker-reminder',
    label: 'Squad question reminders',
    help: 'Remind me after this many minutes of waiting for your answer: one Inbox row and a desktop notification. Blank is 30, 0 is off, range 1–1440. Applies to runs in progress.',
    keywords: ['squad', 'blocker', 'question', 'reminder', 'notification', 'waiting', 'answer', 'minutes', 'off'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => {
      const ms = s.config.executionBlockerReminderMs;
      if (ms === undefined) return 'Default (30 minutes)';
      return ms <= 0 ? 'Off' : `${Math.round(ms / 60_000)} minutes`;
    }
  },
  {
    id: 'squads.unit-checkpoints',
    section: 'squads',
    anchor: 'squad-unit-checkpoints',
    label: 'Checkpoint each unit',
    help: "Record what each Squad unit changes in its checkout, including shell commands, and undo a failed unit's own edits when it is safe. Files another unit also touched are left alone.",
    keywords: ['squad', 'checkpoint', 'restore', 'undo', 'unit', 'git', 'shell', 'failed'],
    kind: 'setting',
    reveal: 'advanced',
    value: (s) => (s.config.squadUnitCheckpointsEnabled === false ? 'Off' : 'On')
  }
];

export default entries;
