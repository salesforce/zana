/**
 * `navigate.openPanelAgent`: a plugin page asks the side panel it is mounted
 * in to show a conversation, or a composer prefilled with a draft so the user
 * picks the harness and sends it themselves. The page's `PluginPanelHostLayout`
 * answers; with no layout listening (no desktop side panel) the request
 * reports false.
 */
export const PLUGIN_PANEL_AGENT_EVENT = 'zcc:plugin-panel-agent-open';

/** Bounds what a page can push into the composer: a draft is a request, not a document. */
export const PANEL_AGENT_DRAFT_MAX_LENGTH = 20_000;

/** Matches the server's bound on a recorded view; main still validates it. */
export const PANEL_AGENT_VIEW_MAX_LENGTH = 500;

export type PanelAgentTarget =
  | { threadId: string; title?: string }
  | { draft: string; projectId?: string; view?: string; title?: string };

export interface PluginPanelAgentRequest {
  pluginId: string;
  target: PanelAgentTarget;
  /** The layout enclosing the asking page (its `PluginPagePanelProvider` value); only that one answers. */
  page?: object;
  /** Set by the layout that showed the conversation. */
  handled: boolean;
}

/** Plugin input is untrusted: keep only a well-formed thread id or draft. */
export function parsePanelAgentTarget(options: unknown): PanelAgentTarget | null {
  if (!options || typeof options !== 'object') return null;
  const raw = options as { threadId?: unknown; title?: unknown; draft?: unknown };
  const title = typeof raw.title === 'string' && raw.title.trim() ? { title: raw.title.trim() } : {};
  if (typeof raw.threadId === 'string' && raw.threadId) return { threadId: raw.threadId, ...title };
  const draft = raw.draft && typeof raw.draft === 'object'
    ? raw.draft as { prompt?: unknown; projectId?: unknown; view?: unknown }
    : null;
  const prompt = draft?.prompt;
  if (typeof prompt === 'string' && prompt.trim() && prompt.length <= PANEL_AGENT_DRAFT_MAX_LENGTH) {
    // Only a preselection: main still authorizes the project on create.
    const projectId = typeof draft?.projectId === 'string' && draft.projectId ? { projectId: draft.projectId } : {};
    const rawView = typeof draft?.view === 'string' ? draft.view.trim() : '';
    const view = rawView && rawView.length <= PANEL_AGENT_VIEW_MAX_LENGTH ? { view: rawView } : {};
    return { draft: prompt, ...projectId, ...view, ...title };
  }
  return null;
}

export function requestPluginPanelAgent(args: { pluginId: string } & Record<string, unknown>, page?: object): boolean {
  const { pluginId, ...options } = args;
  const target = parsePanelAgentTarget(options);
  if (!target) return false;
  const detail: PluginPanelAgentRequest = { pluginId, target, handled: false, ...(page ? { page } : {}) };
  window.dispatchEvent(new CustomEvent(PLUGIN_PANEL_AGENT_EVENT, { detail }));
  return detail.handled;
}

/** Subscribe a plugin page's layout; returns the unsubscribe. */
export function onPluginPanelAgentRequest(
  pluginId: string,
  show: (target: PanelAgentTarget) => void,
  page?: object
): () => void {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<PluginPanelAgentRequest>).detail;
    if (!detail || detail.handled || detail.pluginId !== pluginId) return;
    if (detail.page && detail.page !== page) return;
    detail.handled = true;
    show(detail.target);
  };
  window.addEventListener(PLUGIN_PANEL_AGENT_EVENT, listener);
  return () => window.removeEventListener(PLUGIN_PANEL_AGENT_EVENT, listener);
}
