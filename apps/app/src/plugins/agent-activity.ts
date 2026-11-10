import type { PluginAgentActivity, PluginAgentActivitySnapshot } from '@zana-ai/zcc-plugin-sdk/app';
import type { AgentState, TerminalSession } from '@zana-ai/zcc-domain/product';
import { useData } from '../store.js';
import { useThreads, type ThreadListItem } from '../thread-store.js';
import { useAgentStatus } from '../stores/live.js';
import { isScopedWindow } from '../lib/windowScope.js';
import { isThreadViewSurface } from '../lib/threadViewSurface.js';
import { getPluginViewTarget } from '../lib/pluginViewSurface.js';

/** Bounded projection of existing authoritative stores; never starts another poller. */
export function projectAgentActivity(threads: readonly ThreadListItem[], sessions: readonly TerminalSession[], states: Record<string, AgentState>): PluginAgentActivity[] {
  const agents: PluginAgentActivity[] = [];
  for (const thread of threads) {
    if (thread.archivedAt != null || thread.visibility === 'hidden') continue;
    const status = thread.runtime?.displayStatus ?? thread.status;
    const state = ['error', 'stopping', 'host-reconnecting'].includes(status) ? 'unknown'
      : thread.hasPendingInteraction ? 'needs-you'
        : ['starting', 'provisioning', 'active'].includes(status) || (thread.activity?.activeBackgroundCommandCount ?? 0) > 0 ? 'working'
          : status === 'idle' ? 'idle' : 'unknown';
    agents.push({ id: thread.id, kind: 'thread', state });
    if (agents.length === 1000) return agents;
  }
  for (const session of sessions) {
    if (session.profile === 'shell' || session.headless || session.scheduled || session.status === 'exited') continue;
    const state = states[session.id];
    agents.push({ id: session.id, kind: 'cli', state: state === 'blocked' ? 'needs-you' : state === 'working' ? 'working'
      : state === 'idle' || state === 'done' ? 'idle' : 'unknown' });
    if (agents.length === 1000) break;
  }
  return agents;
}

export function observeAgentActivity(listener: (snapshot: PluginAgentActivitySnapshot) => void): () => void {
  if (isScopedWindow() || isThreadViewSurface() || getPluginViewTarget()) {
    listener({ ready: false, agents: [] });
    return () => undefined;
  }
  let previous = '';
  let hydrated = false;
  const emit = () => {
    const data = useData.getState(), threads = useThreads.getState();
    // A roster refresh keeps its live rows and reconciles concurrent pushes.
    // Loading after hydration is not a loss of the authoritative baseline.
    if (!threads.loading) hydrated = true;
    const snapshot = { ready: data.configLoaded && hydrated,
      agents: projectAgentActivity(threads.threads, Object.values(data.terminals).flat(), useAgentStatus.getState().byId) };
    const key = JSON.stringify(snapshot);
    if (key === previous) return;
    previous = key;
    listener(snapshot);
  };
  const off = [useData.subscribe(emit), useThreads.subscribe(emit), useAgentStatus.subscribe(emit)];
  try { emit(); } catch (error) { off.forEach(dispose => dispose()); throw error; }
  return () => off.forEach(dispose => dispose());
}
