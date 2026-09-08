import { useState } from 'react';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { RefreshCw } from 'lucide-react';
import { Section, Field, CheckboxField, SettingsActionRow } from '@/components/settings/FormFields';
import { PopoverPicklist } from '@/components/ui/PopoverPicklist';
import { useBooleanPreference } from '@/lib/use-boolean-preference';
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
  OPEN_LINKS_IN_APP_BROWSER_DEFAULT,
  OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY
} from '@/lib/in-app-browser-link-preference';
import { hasDesktopBridge } from '@/lib/app-surface';
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
  const [openLinksInAppBrowser, setOpenLinksInAppBrowser] = useBooleanPreference(
    OPEN_LINKS_IN_APP_BROWSER_STORAGE_KEY,
    OPEN_LINKS_IN_APP_BROWSER_DEFAULT
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
        title="Launch surfaces"
        help="Choose which composers New Chat and New agent offer. At least Modern or CLI Agent must stay on."
      >
        <CheckboxField
          label="CLI Agent"
          help="PTY coding-CLI session. Shown first in the launch switcher."
          checked={surfaces.showCliAgent}
          disabled={!canDisableComposerSurface('agent', surfaces)}
          onChange={(showCliAgent) => updateSurfaces({ showCliAgent })}
        />
        <CheckboxField
          label="Modern"
          help="HTTP conversation timeline."
          checked={surfaces.showModern}
          disabled={!canDisableComposerSurface('thread', surfaces)}
          onChange={(showModern) => updateSurfaces({ showModern })}
        />
        <CheckboxField
          label="Autonomous Team"
          help="Show Autonomous Team when at least one team exists."
          checked={surfaces.showAutonomousTeam}
          onChange={(showAutonomousTeam) => updateSurfaces({ showAutonomousTeam })}
        />
        <CheckboxField
          label="Job Team"
          help="Show durable Job Team mode. Jobs stay on the Agents board after you close the launcher."
          checked={surfaces.showJobTeam}
          onChange={(showJobTeam) => updateSurfaces({ showJobTeam })}
        />
      </Section>

      <Section
        anchorId="composer"
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
          label="Default launch mode"
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
    </>
  );
}

export { ComposerSettingsView as ComposerTab };
