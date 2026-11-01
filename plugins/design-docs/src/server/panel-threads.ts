import type { PluginAgentConfigureContext, ZccPluginApi } from '@zana-ai/zcc-plugin-sdk/server';
import { AGENT_FALLBACK_LABEL, type DesignDocStore } from './store.js';
import { TOOL_NAMES } from './tools.js';

/**
 * The doc a side-panel conversation was started beside. The host records the
 * page's view (`<docId>` or `<docId>/<path>`) in this plugin's namespace when
 * the user sends from the panel composer.
 */
export function panelDocId(pluginMetadata: PluginAgentConfigureContext['pluginMetadata']): string | null {
  const binding = pluginMetadata?.panelAgent;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)) return null;
  const view = (binding as { view?: unknown }).view;
  if (typeof view !== 'string') return null;
  const docId = view.split('/')[0]?.trim();
  return docId || null;
}

/**
 * Link side-panel conversations to the doc they were started beside, so they
 * show in its Agents list like the ones Ask agent spawns directly.
 */
export function registerPanelThreadLinks(
  zcc: Pick<ZccPluginApi, 'agents'>,
  store: DesignDocStore,
  changed: (docId: string) => void
): void {
  // configure() runs on every launch; link once so an Unlink sticks. A plugin
  // with a configure() keeps only the tools it names, so every thread is given
  // all the doc tools.
  const seen = new Set<string>();
  const tools = { tools: [...TOOL_NAMES] };
  zcc.agents.configure((ctx) => {
    const threadId = ctx.thread?.id ?? ctx.threadId;
    const docId = panelDocId(ctx.pluginMetadata);
    if (!threadId || !docId || seen.has(threadId)) return tools;
    seen.add(threadId);
    let id: string;
    try {
      id = store.summary(docId).id;
    } catch {
      // The view named no doc (the list page) or one since deleted.
      return tools;
    }
    store.linkThread(id, threadId, ctx.thread?.title?.trim() || AGENT_FALLBACK_LABEL, 'assistant');
    changed(id);
    return tools;
  });
}
