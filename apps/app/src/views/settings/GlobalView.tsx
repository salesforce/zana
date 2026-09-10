import { product } from '../../lib/product-client.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Play, ClipboardCheck } from 'lucide-react';
import { useUi } from '@/store';
import { Section, Field, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { PluginThemePicker, PluginThreadListPicker } from '@/plugins/PluginAppearanceSettings';
import { DoctorSection } from '@/components/settings/DoctorSection';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { CliSkillsSettings } from './CliSkillsSettings';

interface GlobalTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

export function GlobalView({
  config,
  onUpdate
}: GlobalTabProps) {
  return (
    <>
      <Section anchorId="appearance" title="Appearance">
        <Field label="Theme">
          <PopoverPicklist
            value={config.theme}
            ariaLabel="Theme"
            searchable={false}
            onChange={(theme) => onUpdate({ theme: theme as AppConfig['theme'] })}
            options={[
              { value: 'system', label: 'System' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
          />
        </Field>
        <PluginThemePicker />
        <PluginThreadListPicker />
      </Section>

      <CliSkillsSettings />

      <Section
        anchorId="debug"
        title="Debug"
        help="Diagnostics for agent timelines and provider wires. Off by default."
      >
        <CheckboxField
          label="Show diagnostic events"
          help="Surface provider/unhandled timeline rows and routine environment-provisioning noise. Development builds also force unhandled provider rows on."
          checked={(config.showDiagnosticEvents ?? config.showUnhandledProviderEvents) ?? false}
          onChange={(v) => onUpdate({ showDiagnosticEvents: v, showUnhandledProviderEvents: v })}
        />
        <CheckboxField
          label="Record provider traffic"
          help="Write raw provider/ACP lines as NDJSON under the app data directory (provider-recordings/raw). Can include prompts and paths. New agent turns pick this up; already-running sessions keep their current setting."
          checked={config.providerBridgeRecordingEnabled ?? false}
          onChange={(v) => onUpdate({ providerBridgeRecordingEnabled: v })}
        />
      </Section>

      <Section title="Help">
        <SettingsActionRow
          label="Replay walkthrough"
          help="For new users: starting a conversation, the CLI Agent composer, adding a project, and creating a schedule."
        >
          <button
            type="button"
            className="settings-btn"
            onClick={() => useUi.getState().setWalkthroughOpen(true)}
          >
            <Play size={14} />
            Replay
          </button>
        </SettingsActionRow>
        <SettingsActionRow
          label="Check setup"
          help="Verify agent and Salesforce CLIs are installed."
        >
          <button
            type="button"
            className="settings-btn"
            onClick={() => {
              void product.deps.check();
              useUi.getState().setSetupOpen(true);
            }}
          >
            <ClipboardCheck size={14} />
            Check
          </button>
        </SettingsActionRow>
      </Section>

      <DoctorSection />
    </>
  );
}

export { GlobalView as GlobalTab };
