/**
 * Where a card or button that wants "this agent's Preview / Tests / Graph ..." goes.
 *
 * A Studio (project tab or window) registers a target for its project. A click that
 * happened inside that Studio, or in the Assistant rail beside it (same host page layout),
 * is handled by the Studio itself. Otherwise a Zana thread gets the `agent` side panel,
 * and anything else falls back to the Studio window, then the project tab.
 */
import type { ZccNavigate } from '@zana-ai/zcc-plugin-sdk/app';
import { queueAgentScriptOpen } from '../agent-script-open.js';
import { AGENTFORCE_AGENT_ACTION, AGENTFORCE_PREVIEW_ACTION, agentforceAgentParams, type AgentforceAgentView } from '../agentforce-panel-params.js';
import { openInStudioWindow, STUDIO_TAB_ID } from '../studio-window-route.js';

export type StudioIntent =
  | { kind: 'agent'; path: string; line?: number }
  | { kind: 'preview'; path?: string; runId?: string; turn?: number }
  | { kind: 'tests'; path?: string; sub?: 'local' | 'org' | 'simulations' | 'rehearse'; name?: string; runId?: string; batchId?: string }
  | { kind: 'graph'; path?: string; node?: string }
  | { kind: 'org-preview'; path?: string }
  | { kind: 'actions'; path?: string }
  | { kind: 'comments'; path?: string };

export interface StudioIntentTarget { projectId: string; root: HTMLElement; handle(intent: StudioIntent): boolean }

export type StudioIntentRoute = 'studio' | 'thread' | 'studio-window' | 'project-tab' | false;

/** The host layout that holds a Studio page and its side-panel rail. */
export const HOST_LAYOUT_SELECTOR = '[data-testid="plugin-panel-host-layout"]';

const targets = new Set<StudioIntentTarget>();

/** A Studio announces it can take intents; returns the unregister. */
export function registerStudioIntentTarget(target: StudioIntentTarget): () => void {
  targets.add(target);
  return () => { targets.delete(target); };
}

/** The Studio a click at `from` belongs to: its root contains `from`, or both sit in the same host page layout. */
export function findStudioIntentTarget(projectId: string | null, from: Element | null): StudioIntentTarget | null {
  if (!projectId || !from) return null;
  const mine = [...targets].filter(target => target.projectId === projectId);
  const inside = mine.find(target => target.root.contains(from));
  if (inside) return inside;
  const layout = from.closest(HOST_LAYOUT_SELECTOR);
  return layout ? mine.find(target => layout.contains(target.root)) ?? null : null;
}

const VIEW_FOR: Partial<Record<StudioIntent['kind'], AgentforceAgentView>> = {
  agent: 'file', preview: 'preview', tests: 'tests', graph: 'graph', actions: 'actions', comments: 'comments'
};

const agentName = (path: string) => path.split('/').pop()?.replace(/\.(agent|afscript)$/i, '') || 'Agent';

type ThreadOpen = { actionId: string; title: string; params: Record<string, string> };

/** The thread side-panel open for an intent, or null when it has no thread view (org preview, an agent-less tab). */
function threadOpen(intent: StudioIntent, projectId: string | null): ThreadOpen | null {
  const view = VIEW_FOR[intent.kind];
  if (!view) return null;
  const path = 'path' in intent ? intent.path : undefined;
  if (!path) {
    // A preview run without a known agent still opens in the thread's Preview panel.
    if (intent.kind !== 'preview' || !intent.runId) return null;
    return { actionId: AGENTFORCE_PREVIEW_ACTION, title: 'Preview', params: { runId: intent.runId, ...(intent.turn ? { turn: String(intent.turn) } : {}) } };
  }
  const params = agentforceAgentParams({
    path,
    view,
    ...(projectId ? { projectId } : {}),
    ...(intent.kind === 'agent' ? { line: intent.line } : {}),
    ...(intent.kind === 'preview' ? { runId: intent.runId, turn: intent.turn } : {}),
    ...(intent.kind === 'tests' ? { runId: intent.runId, sub: intent.sub, batchId: intent.batchId } : {}),
    ...(intent.kind === 'graph' ? { node: intent.node } : {})
  });
  return params ? { actionId: AGENTFORCE_AGENT_ACTION, title: agentName(path), params } : null;
}

/** Studio beside the click -> its tab; a Zana thread (or agent session) -> the Agent side panel; otherwise the Studio (window when open, else the project tab). */
export async function routeStudioIntent(input: {
  pluginId: string; projectId: string | null; threadId: string | null; intent: StudioIntent; from: Element | null; navigate: ZccNavigate;
}): Promise<StudioIntentRoute> {
  const { pluginId, projectId, threadId, intent, from, navigate } = input;
  const target = findStudioIntentTarget(projectId, from);
  if (target) {
    try { if (target.handle(intent)) return 'studio'; } catch { /* fall through to the other routes */ }
  }
  // The host resolves the panel owner (thread or agent session) and refuses when there is none.
  const open = threadOpen(intent, projectId);
  if (open && navigate.openThreadPanel({ ...open, ...(threadId ? { threadId } : {}) })) return 'thread';
  if (!projectId) return false;
  const path = 'path' in intent ? intent.path : undefined;
  if (path) {
    const line = intent.kind === 'agent' ? intent.line : undefined;
    if (await openInStudioWindow({ pluginId, projectId, path, ...(line ? { line } : {}), navigate })) return 'studio-window';
    queueAgentScriptOpen(projectId, path);
  }
  navigate.toProject(projectId, { tabId: STUDIO_TAB_ID });
  return 'project-tab';
}
