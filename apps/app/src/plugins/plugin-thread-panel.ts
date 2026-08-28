import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import {
  addClosableTab,
  loadSecondaryPanelState,
  persistSecondaryPanelState
} from '../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { listThreadPanelActions } from './plugin-slots.js';

export function openPluginThreadPanel(args: {
  pluginId: string;
  threadId: string | null;
  actionId: string;
  title?: string;
  params?: JsonValue | null;
}): boolean {
  const threadId = args.threadId;
  if (!threadId) return false;
  const action = listThreadPanelActions().find(
    (row) => row.pluginId === args.pluginId && row.id === args.actionId
  );
  if (!action) return false;
  const state = loadSecondaryPanelState(threadId);
  persistSecondaryPanelState(
    threadId,
    addClosableTab(state, {
      kind: 'plugin',
      title: args.title ?? action.title,
      moduleId: args.pluginId,
      pluginId: args.pluginId,
      actionId: args.actionId,
      params: args.params ?? null,
      layout: action.layout
    })
  );
  window.dispatchEvent(new CustomEvent('zcc:secondary-panel-changed', { detail: { threadId } }));
  return true;
}
