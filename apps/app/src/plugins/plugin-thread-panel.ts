import type { JsonValue } from '@zana-ai/zcc-domain/thread-runtime';
import { threadPanelActionMatchesScope } from '@zana-ai/zcc-plugin-sdk';
import {
  addClosableTab,
  loadSecondaryPanelState,
  persistSecondaryPanelState
} from '../components/thread/secondary-panel/threadSecondaryPanelState.js';
import { listThreadPanelActions } from './plugin-slots.js';
import { PLUGIN_PAGE_PANEL_OWNER_PREFIX } from './plugin-page-panel.js';

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
  // A plugin page's own tool opens only in that page's panel (`navigate.openPanelTool`), not beside a conversation.
  const pagePanel = threadId.startsWith(PLUGIN_PAGE_PANEL_OWNER_PREFIX);
  if (!pagePanel && !threadPanelActionMatchesScope(action, 'thread') && !threadPanelActionMatchesScope(action, 'agent-session')) return false;
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
