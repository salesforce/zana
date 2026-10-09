import type { SettingsSearchEntry } from '../types';

const onOff = (value: boolean | undefined, fallback: boolean) => ((value ?? fallback) ? 'On' : 'Off');

/** Settings > Inbox. */
export const entries: readonly SettingsSearchEntry[] = [
  {
    id: 'inbox.inbox-intro',
    section: 'inbox',
    anchor: 'inbox-general',
    label: 'Inbox',
    help: 'How the inbox presents itself, which tools agents may call without prompting, and where PDF downloads land.',
    kind: 'subsection'
  },
  {
    id: 'inbox.show-guidance',
    section: 'inbox',
    anchor: 'inbox-general',
    label: 'Show inbox guidance',
    help: 'Hint cards in the inbox view.',
    keywords: ['hints', 'tips', 'cards', 'onboarding'],
    kind: 'setting',
    value: (s) => onOff(s.config.inboxGuidanceEnabled, true)
  },
  {
    id: 'inbox.trust-zcc-tools',
    section: 'inbox',
    anchor: 'inbox-general',
    label: 'Trust all ZCC tools',
    help: 'Pre-authorize every zcc-inbox tool for terminal agents this app launches, so they’re never prompted to use them (messaging peers, pushing to your inbox, the library, follow-ups, and more). On by default, which also pre-approves privileged tools — remote shell exec and library delete — for ordinary sessions, not just autonomous team runs. Turn it off if you\'d rather approve those the first time they\'re used. Applies to sessions started after you toggle it.',
    keywords: ['permissions', 'approve tools', 'pre-approve', 'prompts', 'zcc-inbox', 'allow tools'],
    kind: 'setting',
    value: (s) => onOff(s.config.trustZccToolsEnabled, true)
  },
  {
    id: 'inbox.pdf-download-folder',
    section: 'inbox',
    anchor: 'inbox-general',
    label: 'PDF download folder',
    help: 'Folder that inbox “Download as PDF” saves into. Leave blank for your Downloads folder. Must be an absolute path.',
    keywords: ['export pdf', 'downloads', 'save location', 'directory'],
    kind: 'setting',
    value: (s) => s.config.pdfExportDir || undefined
  }
];
