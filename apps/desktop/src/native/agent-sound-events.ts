import { WebSocket } from 'ws';
import type { AgentState } from '@zana-ai/zcc-domain/product';
import type { AgentSounds } from './agent-sounds.js';

/** Project the trusted product stream without treating failures as questions. */
export function threadSoundState(payload: unknown): { id: string; state: AgentState | null } | null {
  if (!payload || typeof payload !== 'object') return null;
  const thread = payload as Record<string, unknown>;
  if (typeof thread.id !== 'string' || !thread.id || thread.id.length > 256) return null;
  let state: AgentState | null = null;
  if (thread.visibility === 'visible' && thread.archivedAt === null) {
    const activity = thread.activity as { activeBackgroundCommandCount?: number } | undefined;
    if (thread.status === 'error' || thread.status === 'stopping' || thread.status === 'host-reconnecting') state = 'unknown';
    else if (thread.hasPendingInteraction === true) state = 'blocked';
    else if (['starting', 'provisioning', 'active'].includes(String(thread.status)) || (activity?.activeBackgroundCommandCount ?? 0) > 0) state = 'working';
    else if (thread.status === 'idle') state = 'idle';
  }
  return { id: thread.id, state };
}

/** Once at app init, in both dev and packaged builds. No renderer owns agent state. */
export function startAgentSoundEvents(serverUrl: string, sounds: Pick<AgentSounds, 'observe' | 'remove' | 'resetThreads'>): () => void {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  let stopped = false;
  let socket: WebSocket;
  let retry: ReturnType<typeof setTimeout> | undefined;
  function connect() {
    socket = new WebSocket(url, { origin: new URL(serverUrl).origin, handshakeTimeout: 3_000, maxPayload: 8 * 1024 * 1024 });
    socket.on('message', data => {
      if (stopped) return;
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'product:reset') { sounds.resetThreads(); return; }
        if (event.type !== 'threads:updated') return;
        const update = threadSoundState(event.payload);
        if (!update) return;
        const id = `thread:${update.id}`;
        if (update.state === null) sounds.remove(id);
        else sounds.observe(id, update.state);
      } catch { /* A malformed event must never interrupt agents or audio. */ }
    });
    socket.on('error', () => { /* close schedules a bounded reconnect */ });
    socket.on('close', () => {
      sounds.resetThreads();
      if (!stopped) retry = setTimeout(connect, 2_000);
    });
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket.terminate();
    sounds.resetThreads();
  };
}
