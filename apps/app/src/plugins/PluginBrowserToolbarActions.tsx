import { useMemo, useSyncExternalStore } from 'react';
import type { PluginBrowserToolbarActionRegistration } from '@zana-ai/zcc-plugin-sdk/app';
import { PluginSlotBoundary } from './PluginSlotBoundary.js';
import {
  listBrowserToolbarActions,
  subscribePluginSlots,
} from './plugin-slots.js';
import { getDesktopBrowserApi } from '../lib/desktop-browser.js';
import {
  addThreadContext,
  updateThreadContext,
  focusThreadComposer,
  onThreadSubmitted,
} from './thread-context-target.js';
function Action({
  action,
  threadId,
  tabId,
  url,
}: {
  action: PluginBrowserToolbarActionRegistration;
  threadId: string;
  tabId: string;
  url: string;
}) {
  const page = useMemo(() => {
    const api = getDesktopBrowserApi();
    if (!api?.evaluate || !api.onPageMessage) return null;
    let pending: Promise<unknown> = Promise.resolve();
    let queued = 0;
    return {
      evaluate: (
        expression: string,
        options?: { world?: 'main' | 'isolated' },
      ) => {
        if (queued >= 16)
          return Promise.reject(new Error('Too many pending page requests'));
        queued++;
        const result = pending
          .catch(() => undefined)
          .then(() =>
            api.evaluate!({ tabId, threadId, expression, ...options }),
          );
        pending = result.finally(() => {
          queued--;
        });
        // Keep an unobserved failed request from poisoning later requests.
        void pending.catch(() => undefined);
        return result;
      },
      onMessage: (listener: (data: unknown) => void) =>
        api.onPageMessage!((message) => {
          if (message.tabId === tabId && message.threadId === threadId)
            listener(message.data);
        }),
    };
  }, [tabId, threadId]);
  const composer = useMemo(
    () => ({
      insert: (reference: Parameters<typeof addThreadContext>[1]) =>
        reference.source?.kind === 'plugin' &&
        reference.source.pluginId === action.pluginId &&
        addThreadContext(threadId, reference),
      update: (
        id: string,
        reference: Parameters<typeof addThreadContext>[1] | null,
      ) =>
        (reference === null ||
          (reference.source?.kind === 'plugin' &&
            reference.source.pluginId === action.pluginId &&
            reference.source.resourceId === id)) &&
        updateThreadContext(threadId, action.pluginId, id, reference),
      onSubmitted: (listener: () => void) =>
        onThreadSubmitted(threadId, listener),
      focus: () => focusThreadComposer(threadId),
    }),
    [threadId, action.pluginId],
  );
  const Component = action.component;
  return (
    <Component
      pluginId={action.pluginId}
      threadId={threadId}
      tabId={tabId}
      url={url}
      page={page}
      composer={composer}
    />
  );
}
export function PluginBrowserToolbarActions(props: {
  threadId: string;
  tabId: string;
  url: string;
}) {
  const actions = useSyncExternalStore(
    subscribePluginSlots,
    listBrowserToolbarActions,
    listBrowserToolbarActions,
  );
  return (
    <>
      {actions.map((action) => (
        <PluginSlotBoundary
          key={`${action.pluginId}/${action.id}:${action.generation}`}
          pluginId={action.pluginId}
          generation={action.generation}
        >
          <Action {...props} action={action} />
        </PluginSlotBoundary>
      ))}
    </>
  );
}
