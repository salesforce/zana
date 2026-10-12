/**
 * `navigate.openPanelAgent`: a plugin page asks the side panel it is mounted
 * in to show a conversation. The page's `PluginPanelHostLayout` answers; with
 * no layout listening (no desktop side panel) the request reports false.
 */
export const PLUGIN_PANEL_AGENT_EVENT = 'zcc:plugin-panel-agent-open';

export interface PluginPanelAgentRequest {
  pluginId: string;
  threadId: string;
  title?: string;
  /** Set by the layout that showed the conversation. */
  handled: boolean;
}

export function requestPluginPanelAgent(args: { pluginId: string; threadId: string; title?: string }): boolean {
  if (!args.threadId) return false;
  const detail: PluginPanelAgentRequest = { ...args, handled: false };
  window.dispatchEvent(new CustomEvent(PLUGIN_PANEL_AGENT_EVENT, { detail }));
  return detail.handled;
}

/** Subscribe a plugin page's layout; returns the unsubscribe. */
export function onPluginPanelAgentRequest(
  pluginId: string,
  show: (request: { threadId: string; title?: string }) => void
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PluginPanelAgentRequest>).detail;
    if (!detail || detail.handled || detail.pluginId !== pluginId) return;
    detail.handled = true;
    show({ threadId: detail.threadId, ...(detail.title ? { title: detail.title } : {}) });
  };
  window.addEventListener(PLUGIN_PANEL_AGENT_EVENT, listener);
  return () => window.removeEventListener(PLUGIN_PANEL_AGENT_EVENT, listener);
}
