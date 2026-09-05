import { useState } from 'react';
import { product } from '../../lib/product-client.js';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { Play, ClipboardCheck, RefreshCw } from 'lucide-react';
import { useUi } from '@/store';
import { reloadComposerCommandCatalog } from '@/lib/composer-commands-reload';
import { Section, Field, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { PluginThemePicker, PluginThreadListPicker } from '@/plugins/PluginAppearanceSettings';
import { DoctorSection } from '@/components/settings/DoctorSection';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { useBooleanPreference } from '@/lib/use-boolean-preference';
import {
  MARKDOWN_IN_PROMPT_DEFAULT,
  MARKDOWN_IN_PROMPT_KEY,
  NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT,
  NAVIGATE_TO_THREAD_ON_CREATE_KEY
} from '@/lib/thread-composer-preferences';
import {
  REWRITE_LOCALHOST_LINKS_DEFAULT,
  REWRITE_LOCALHOST_LINKS_STORAGE_KEY
} from '@/lib/localhost-link-rewrite-preference';
import {
  OPEN_LINKS_IN_APP_BROWSER_DEFAULT,
  OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY
} from '@/lib/in-app-browser-link-preference';
import { hasDesktopBridge } from '@/lib/app-surface';
import { CliSkillsSettings } from './CliSkillsSettings';

interface GlobalTabProps {
  config: AppConfig;
  onConfigDraft: (config: AppConfig) => void;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

export function GlobalView({
  config,
  onConfigDraft,
  onUpdate
}: GlobalTabProps) {
  const [navigateOnCreate, setNavigateOnCreate] = useBooleanPreference(
    NAVIGATE_TO_THREAD_ON_CREATE_KEY,
    NAVIGATE_TO_THREAD_ON_CREATE_DEFAULT
  );
  const [markdownInPrompt, setMarkdownInPrompt] = useBooleanPreference(
    MARKDOWN_IN_PROMPT_KEY,
    MARKDOWN_IN_PROMPT_DEFAULT
  );
  const [rewriteLocalhost, setRewriteLocalhost] = useBooleanPreference(
    REWRITE_LOCALHOST_LINKS_STORAGE_KEY,
    REWRITE_LOCALHOST_LINKS_DEFAULT
  );
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] = useBooleanPreference(
    OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
    OPEN_LINKS_IN_APP_BROWSER_DEFAULT
  );
  const [commandsReloadBusy, setCommandsReloadBusy] = useState(false);
  const [commandsReloadNote, setCommandsReloadNote] = useState<string | null>(null);
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

      <Section
        anchorId="threads"
        title="Composer"
        help="Composer and markdown behavior for new and running agents."
      >
        <CheckboxField
          label="Navigate to agents on creation"
          help="Open a new agent as soon as you send the first message. Off keeps you on the current page."
          checked={navigateOnCreate}
          onChange={setNavigateOnCreate}
        />
        <CheckboxField
          label="Markdown in the prompt box"
          help="Allow headings, lists, and emphasis in the composer. Mentions still work either way."
          checked={markdownInPrompt}
          onChange={setMarkdownInPrompt}
        />
        <Field
          label="Send mode"
          help="Auto starts a new turn. Steer uses Enter to interrupt a running turn (Cmd/Ctrl+Enter queues). Queue holds the next message until the current turn finishes. Default is Auto."
        >
          <PopoverPicklist
            ariaLabel="Send mode"
            value={
              config.composerSendMode
              ?? (config.steerActiveThreadOnEnter ? 'steer' : 'auto')
            }
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'steer', label: 'Steer' },
              { value: 'queue-if-active', label: 'Queue' }
            ]}
            searchable={false}
            onChange={(value) => {
              void onUpdate({
                composerSendMode: value as 'auto' | 'steer' | 'queue-if-active',
                steerActiveThreadOnEnter: value === 'steer'
              });
            }}
          />
        </Field>
        <CheckboxField
          label="Rewrite localhost links"
          help="Replace localhost and 127.0.0.1 in agent markdown links with this window’s hostname so a remote viewer reaches the machine they’re looking at."
          checked={rewriteLocalhost}
          onChange={setRewriteLocalhost}
        />
        {hasDesktopBridge() ? (
          <CheckboxField
            label="Open web links in the side-panel browser"
            help="http(s) links in agents open in the in-app browser instead of your OS browser. Turn off to keep the previous external-open behavior."
            checked={openLinksInAppBrowser}
            onChange={setOpenLinksInAppBrowser}
          />
        ) : null}
        <SettingsActionRow
          label="Reload slash commands"
          help="Refresh the / menu from installed plugin skills. On desktop this also re-deploys bundled skills and project MCP configs."
        >
          <button
            type="button"
            className="settings-btn"
            data-testid="reload-composer-commands"
            disabled={commandsReloadBusy}
            onClick={() => {
              setCommandsReloadBusy(true);
              setCommandsReloadNote(null);
              void reloadComposerCommandCatalog()
                .then((result) => setCommandsReloadNote(result.message))
                .finally(() => setCommandsReloadBusy(false));
            }}
          >
            <RefreshCw size={14} className={commandsReloadBusy ? 'ext-spin' : undefined} />
            {commandsReloadBusy ? 'Reloading…' : 'Reload'}
          </button>
        </SettingsActionRow>
        {commandsReloadNote ? <p className="settings-help">{commandsReloadNote}</p> : null}
      </Section>

      <CliSkillsSettings />

      <Section
        anchorId="debug"
        title="Debug"
        help="Diagnostics for agent timelines and provider wires. Off by default."
      >
        <CheckboxField
          label="Show unhandled provider events"
          help="Surface provider/unhandled timeline rows. Development builds also force this on."
          checked={config.showUnhandledProviderEvents ?? false}
          onChange={(v) => onUpdate({ showUnhandledProviderEvents: v })}
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
