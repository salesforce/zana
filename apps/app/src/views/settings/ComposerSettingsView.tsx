import { useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { RefreshCw } from 'lucide-react';
import { Section, Field, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { useBooleanPreference } from '@/lib/use-boolean-preference';
import { FULL_ACCESS_BY_DEFAULT, FULL_ACCESS_BY_DEFAULT_KEY } from '@/lib/composer-permission-preference';
import { reloadComposerCommandCatalog } from '@/lib/composer-commands-reload';
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
  canDisableComposerSurface,
  composerSurfacesFromConfig,
  composerSurfacesToConfigPatch,
  launchModePicklistOptions,
  normalizeComposerSurfaces,
  resolveAvailableLaunchMode,
  type ComposerSurfaceFlags,
  type LaunchMode
} from '@/lib/launch-mode-preference';
import { useLaunchModePreference } from '@/lib/use-launch-mode-preference';

interface ComposerTabProps {
  config: AppConfig;
  onUpdate: (patch: Partial<AppConfig>) => Promise<void>;
}

export function ComposerSettingsView({ config, onUpdate }: ComposerTabProps) {
  const [fullAccessByDefault, setFullAccessByDefault] = useBooleanPreference(
    FULL_ACCESS_BY_DEFAULT_KEY,
    FULL_ACCESS_BY_DEFAULT
  );
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
  const [commandsReloadBusy, setCommandsReloadBusy] = useState(false);
  const [commandsReloadNote, setCommandsReloadNote] = useState<string | null>(null);
  const [launchMode, setLaunchMode] = useLaunchModePreference();
  const surfaces = composerSurfacesFromConfig(config);
  const picklistOptions = launchModePicklistOptions(surfaces);
  const picklistValue = resolveAvailableLaunchMode(launchMode, surfaces);

  const updateSurfaces = (patch: Partial<ComposerSurfaceFlags>) => {
    const next = normalizeComposerSurfaces({ ...surfaces, ...patch });
    void onUpdate(composerSurfacesToConfigPatch(next));
    const resolved = resolveAvailableLaunchMode(launchMode, next);
    if (resolved !== launchMode) setLaunchMode(resolved);
  };

  return (
    <>
      <Section
        anchorId="launch-surfaces"
        searchId="composer.launch-surfaces-intro"
        title="Launch surfaces"
        help="Choose which composers New Chat and New agent offer. At least Modern or CLI Agent must stay on."
      >
        <CheckboxField
          searchId="composer.cli-agent"
          label="CLI Agent"
          help="PTY coding-CLI session. Shown first in the launch switcher."
          checked={surfaces.showCliAgent}
          disabled={!canDisableComposerSurface('agent', surfaces)}
          onChange={(showCliAgent) => updateSurfaces({ showCliAgent })}
        />
        <CheckboxField
          searchId="composer.modern"
          label="Modern"
          help="HTTP conversation timeline."
          checked={surfaces.showModern}
          disabled={!canDisableComposerSurface('thread', surfaces)}
          onChange={(showModern) => updateSurfaces({ showModern })}
        />
        <CheckboxField
          searchId="composer.squad"
          label="Squad"
          help="Show durable Squad mode."
          checked={surfaces.showTeam}
          onChange={(showTeam) => updateSurfaces({ showTeam })}
        />
      </Section>

      <Section
        anchorId="composer"
        searchId="composer.composer-intro"
        title="Composer"
        help="Composer and markdown behavior for new and running agents."
      >
        <CheckboxField
          searchId="composer.full-access"
          label="Full access by default"
          help="Start new Modern and CLI agents in Full mode (YOLO): no sandbox or approval prompts. Off starts in Approve for me when available, otherwise Accept Edits. You can change permissions in the composer before launching."
          checked={fullAccessByDefault}
          onChange={setFullAccessByDefault}
        />
        <CheckboxField
          searchId="composer.navigate-on-create"
          label="Navigate to agents on creation"
          help="Open a new agent as soon as you send the first message. Off keeps you on the current page."
          checked={navigateOnCreate}
          onChange={setNavigateOnCreate}
        />
        <CheckboxField
          searchId="composer.markdown-in-prompt"
          label="Markdown in the prompt box"
          help="Allow headings, lists, and emphasis in the composer. Mentions still work either way."
          checked={markdownInPrompt}
          onChange={setMarkdownInPrompt}
        />
        <Field
          searchId="composer.default-launch-mode"
          label="Default launch mode"
          layout="row"
          help="New Chat and New agent open on this surface. Switching the segmented control also updates this default."
        >
          <PopoverPicklist
            ariaLabel="Default launch mode"
            value={picklistValue}
            options={picklistOptions}
            searchable={false}
            onChange={(value) => setLaunchMode(value as LaunchMode)}
          />
        </Field>
        <Field
          searchId="composer.send-mode"
          label="Send mode"
          layout="row"
          help="Auto sends immediately when idle and queues while running (Cmd/Ctrl+Enter steers). Steer uses Enter to steer a running turn (Cmd/Ctrl+Enter queues). Queue always waits for the current turn to finish. Default is Auto."
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
          searchId="composer.rewrite-localhost"
          label="Rewrite localhost links"
          help="Replace localhost and 127.0.0.1 in agent markdown links with this window’s hostname so a remote viewer reaches the machine they’re looking at."
          checked={rewriteLocalhost}
          onChange={setRewriteLocalhost}
        />
        <SettingsActionRow
          searchId="composer.reload-slash-commands"
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
    </>
  );
}

export { ComposerSettingsView as ComposerTab };
