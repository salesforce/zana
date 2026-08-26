import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Section, Field, CheckboxField } from '@/components/settings/FormFields';

interface InboxSettingsViewProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

/** Inbox guidance, tool trust, and PDF export — no longer parked on Global. */
export function InboxSettingsView({
  config,
  onConfigDraft,
  onUpdate
}: InboxSettingsViewProps) {
  return (
    <Section
      anchorId="inbox-general"
      title="Inbox"
      help="How the inbox presents itself, which tools agents may call without prompting, and where PDF downloads land."
    >
      <CheckboxField
        label="Show inbox guidance"
        help="Hint cards in the inbox view."
        checked={config.inboxGuidanceEnabled ?? true}
        onChange={(v) => onUpdate({ inboxGuidanceEnabled: v })}
      />
      <CheckboxField
        label="Trust all ZCC tools"
        help="Pre-authorize every zcc-inbox tool for terminal agents this app launches, so they’re never prompted to use them (messaging peers, pushing to your inbox, the library, follow-ups, and more). On by default, which also pre-approves privileged tools — remote shell exec and library delete — for ordinary sessions, not just autonomous team runs. Turn it off if you'd rather approve those the first time they're used. Applies to sessions started after you toggle it."
        checked={config.trustZccToolsEnabled ?? true}
        onChange={(v) => onUpdate({ trustZccToolsEnabled: v })}
      />
      <Field
        label="PDF download folder"
        help="Folder that inbox “Download as PDF” saves into. Leave blank for your Downloads folder. Must be an absolute path."
        mono
      >
        <input
          type="text"
          value={config.pdfExportDir ?? ''}
          placeholder="~/Downloads"
          onChange={(e) => onConfigDraft({ ...config, pdfExportDir: e.target.value })}
          onBlur={(e) => onUpdate({ pdfExportDir: e.target.value.trim() })}
          spellCheck={false}
        />
      </Field>
    </Section>
  );
}

export { InboxSettingsView as InboxSettingsTab };
