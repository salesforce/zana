import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type {
  ComposerView,
  PluginComposerApi,
  PluginComposerScope
} from '@zana-ai/zcc-plugin-sdk/app';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import {
  listComposerCustomizations,
  subscribePluginSlots
} from './plugin-slots.js';
import {
  composerContributionKey,
  composerCustomizationApplies
} from './plugin-slot-resolvers.js';
import {
  clearLaunchPatches,
  ComposerViewContext,
  setActiveComposerApi,
  setActiveComposerView
} from './plugin-composer-api.js';
import { resolveIcon } from '../lib/resolveIcon.js';
import { CREATE_PLUGIN_PROMPT } from '../lib/create-resource-prompts.js';

export function PluginComposerChrome({
  scope,
  text,
  setText,
  focus,
  familyId,
  providerId,
  children
}: {
  scope: PluginComposerScope;
  text: string;
  setText: (next: string) => void;
  focus: () => void;
  familyId?: string;
  providerId?: string;
  children: ReactNode;
}) {
  const customizations = useSyncExternalStore(
    subscribePluginSlots,
    listComposerCustomizations,
    listComposerCustomizations
  );
  const matching = useMemo(
    () => customizations.filter((row) => composerCustomizationApplies(row, scope.kind)),
    [customizations, scope.kind]
  );
  const view: ComposerView = useMemo(() => ({
    scope,
    layout: 'expanded',
    draft: { text, isEmpty: !text, attachmentCount: 0 },
    run: { isRunning: false, isSubmitting: false },
    ...(familyId ? { familyId } : {}),
    ...(providerId ? { providerId } : {})
  }), [familyId, providerId, scope, text]);
  const api: PluginComposerApi = useMemo(() => ({
    scope,
    get text() {
      return text;
    },
    setText,
    updateText(updater) {
      setText(updater(text));
    },
    clear() {
      setText('');
    },
    setTextEffect() {},
    setInputLock() {},
    addQuote(quoted) {
      setText(text ? `${text}\n\n${quoted}` : quoted);
    },
    insertMention(mention) {
      setText(`${text}@${mention.label} `);
    },
    focus,
    experimental_setLaunchPatch() {}
  }), [focus, scope, setText, text]);

  // Set before children render so `useComposerView()` in meta chips sees
  // `familyId` on the first paint, not only after a later state update.
  setActiveComposerApi(api);
  setActiveComposerView(view);

  useEffect(() => {
    setActiveComposerApi(api);
    setActiveComposerView(view);
  }, [api, view]);

  useEffect(() => () => {
    setActiveComposerApi(null);
    setActiveComposerView(null);
    clearLaunchPatches();
  }, []);

  const pluginActions = matching.flatMap((row) =>
    (row.actions ?? []).map((action) => {
      const Action = action.component;
      return (
        <PluginSlotBoundary
          key={composerContributionKey(row.pluginId, row.generation, row.id, action.id)}
          pluginId={row.pluginId}
          generation={row.generation}
        >
          <Action />
        </PluginSlotBoundary>
      );
    })
  );
  const plusItems = matching.flatMap((row) =>
    (row.plusMenu ?? []).map((item) => {
      const Icon = item.icon ? resolveIcon(item.icon) : null;
      return (
        <button
          key={composerContributionKey(row.pluginId, row.generation, row.id, item.id)}
          type="button"
          className="plugin-composer-plus"
          disabled={typeof item.disabled === 'boolean' ? item.disabled : false}
          onClick={() => {
            void item.run({
              composer: api,
              view
            });
          }}
        >
          {Icon ? <Icon size={12} /> : null}
          {item.label}
        </button>
      );
    })
  );
  const showCreatePlugin = scope.kind === 'new-thread' || scope.kind === 'cli-agent';
  const hasActions = pluginActions.length > 0 || plusItems.length > 0 || showCreatePlugin;

  return (
    <ComposerViewContext.Provider value={view}>
    <div className="plugin-composer-chrome">
      {matching.flatMap((row) =>
        (row.banners ?? []).map((banner) => {
          const Banner = banner.component;
          return (
            <PluginSlotBoundary
              key={composerContributionKey(row.pluginId, row.generation, row.id, banner.id)}
              pluginId={row.pluginId}
              generation={row.generation}
            >
              <div className={`plugin-composer-banner is-${banner.chrome ?? 'card'}`}>
                <Banner />
              </div>
            </PluginSlotBoundary>
          );
        })
      )}
      {children}
      {hasActions ? (
        <div className="plugin-composer-actions">
          {pluginActions}
          {plusItems}
          {showCreatePlugin ? (
            <button
              type="button"
              className="plugin-composer-plus"
              data-testid="composer-create-plugin"
              onClick={() => {
                if (text.includes(CREATE_PLUGIN_PROMPT.trim())) {
                  focus();
                  return;
                }
                setText(text ? `${text}\n${CREATE_PLUGIN_PROMPT}` : CREATE_PLUGIN_PROMPT);
                focus();
              }}
            >
              Create plugin
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
    </ComposerViewContext.Provider>
  );
}
