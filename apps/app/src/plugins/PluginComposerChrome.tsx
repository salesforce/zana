import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import type { PluginComposerApi, PluginComposerScope } from '@zana-ai/zcc-plugin-sdk/app';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import {
  listComposerCustomizations,
  subscribePluginSlots
} from './plugin-slots.js';
import {
  composerContributionKey,
  composerCustomizationApplies
} from './plugin-slot-resolvers.js';
import { setActiveComposerApi } from './plugin-composer-api.js';
import { resolveIcon } from '../lib/resolveIcon.js';

export function PluginComposerChrome({
  scope,
  text,
  setText,
  focus,
  children
}: {
  scope: PluginComposerScope;
  text: string;
  setText: (next: string) => void;
  focus: () => void;
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
    focus
  }), [focus, scope, setText, text]);

  useEffect(() => {
    setActiveComposerApi(api);
    return () => {
      setActiveComposerApi(null);
    };
  }, [api]);

  return (
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
      <div className="plugin-composer-actions">
        {matching.flatMap((row) =>
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
        )}
        {matching.flatMap((row) =>
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
                    view: {
                      scope,
                      layout: 'expanded',
                      draft: { text, isEmpty: !text, attachmentCount: 0 },
                      run: { isRunning: false, isSubmitting: false }
                    }
                  });
                }}
              >
                {Icon ? <Icon size={12} /> : null}
                {item.label}
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
