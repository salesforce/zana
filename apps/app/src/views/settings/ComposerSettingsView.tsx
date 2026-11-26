import { useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { SQUAD_TRANSPORT_LABELS } from '@zana-ai/zcc-domain/squad-transport';
import { RefreshCw } from 'lucide-react';
import { Section, Field, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { useBooleanPreference } from '@/lib/use-boolean-preference';
import { ComposerHarnessFields } from './ComposerHarnessFields';
import './composer-defaults.css';
import { DefaultThreadPermissionsField } from './DefaultThreadPermissionsField';
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
  const lastTransportLabel = config.composerLastTransportMode === 'agent' ? SQUAD_TRANSPORT_LABELS.CLI : SQUAD_TRANSPORT_LABELS.MODERN;

  const updateSurfaces = (patch: Partial<ComposerSurfaceFlags>) => {
    const next = normalizeComposerSurfaces({ ...surfaces, ...patch });
    void onUpdate(composerSurfacesToConfigPatch(next));
    const resolved = resolveAvailableLaunchMode(launchMode, next);
    if (resolved !== launchMode) setLaunchMode(resolved);
  };

  return (
    <div className="composer-defaults">
      <Section anchorId="composer" searchId="composer.composer-intro" title="New chat defaults">
        <ComposerHarnessFields value={config.defaultThreadProviderId} onChange={defaultThreadProviderId => onUpdate({ defaultThreadProviderId })} />
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
        {picklistValue === 'team' ? (
          <p className="settings-hint" data-testid="launch-mode-team-hint">
            Follow default launch mode ({lastTransportLabel}). A Squad has no launch mode of its own here, so Squads that follow the default use the last CLI Agent or Modern mode you picked.
          </p>
        ) : null}
        <DefaultThreadPermissionsField
          value={config.defaultThreadPermissionMode}
          onChange={(defaultThreadPermissionMode) => onUpdate({ defaultThreadPermissionMode })}
        />
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
      </Section>
      <Section title="Writing and navigation" anchorId="composer-editing" searchId="composer.editing">
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
      <Section
        anchorId="launch-surfaces"
        searchId="composer.launch-surfaces-intro"
        title="Launch surfaces"
        help="Choose which composers New Chat and New agent offer. At least Modern or CLI Agent must stay on."
      >
        <CheckboxField
          searchId="composer.cli-agent"
          label="CLI Agent"
          help="Start a coding agent in a terminal."
          checked={surfaces.showCliAgent}
          disabled={!canDisableComposerSurface('agent', surfaces)}
          onChange={(showCliAgent) => updateSurfaces({ showCliAgent })}
        />
        <CheckboxField
          searchId="composer.modern"
          label="Modern"
          help="Start a conversation in the chat view."
          checked={surfaces.showModern}
          disabled={!canDisableComposerSurface('thread', surfaces)}
          onChange={(showModern) => updateSurfaces({ showModern })}
        />
        <CheckboxField
          searchId="composer.squad"
          label="Squad"
          help="Launch a group of agents."
          checked={surfaces.showTeam}
          onChange={(showTeam) => updateSurfaces({ showTeam })}
        />
      </Section>

    </div>
  );
}

export { ComposerSettingsView as ComposerTab };
