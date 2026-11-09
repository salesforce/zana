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
  // Only live root turns observed on this connection can signal completion.
  // A thread becoming idle alone never confirms a completed turn.
  const threads = new Map<string, { state?: AgentState | null; turnId?: string; completed?: boolean }>();
  function entryFor(id: string) {
    if (!threads.has(id)) {
      if (threads.size >= 1000) threads.delete(threads.keys().next().value!);
      threads.set(id, {});
    }
    return threads.get(id)!;
  }
  function settled(id: string) {
    const entry = threads.get(id)!;
    if (entry.completed && entry.state === 'idle') {
      entry.completed = false;
      sounds.observe(`thread:${id}`, 'done');
    }
  }
  function connect() {
    socket = new WebSocket(url, { origin: new URL(serverUrl).origin, handshakeTimeout: 3_000, maxPayload: 8 * 1024 * 1024 });
    socket.on('message', data => {
      if (stopped) return;
      try {
        const event = JSON.parse(data.toString());
        if (event.type === 'product:reset') { threads.clear(); sounds.resetThreads(); return; }
        if (event.type === 'threads:event') {
          const row = event.payload;
          if (typeof row?.threadId !== 'string' || !row.threadId || row.threadId.length > 256) return;
          const record = row.payload?.event ?? row.payload;
          // The host transports turn/completed as kind/type "turn.completed";
          // its protocol payload retains the canonical slash-separated type.
          const type = record?.type ?? row.type;
          const scope = record?.scope;
          if (scope?.kind !== 'turn' || typeof scope.turnId !== 'string' || !scope.turnId || scope.turnId.length > 256
            || (typeof record.parentToolCallId === 'string' && record.parentToolCallId.trim())) return;
          const entry = entryFor(row.threadId);
          if (entry.state === null) return;
          if (type === 'turn/started') { entry.turnId = scope.turnId; entry.completed = false; }
          else if (type === 'turn/completed' && entry.turnId === scope.turnId) {
            entry.turnId = undefined;
            entry.completed = record.status === 'completed';
            settled(row.threadId);
          }
          return;
        }
        if (event.type !== 'threads:updated') return;
        const update = threadSoundState(event.payload);
        if (!update) return;
        const id = `thread:${update.id}`;
        if (update.state === null) {
          const entry = entryFor(update.id);
          entry.state = null; entry.turnId = undefined; entry.completed = false;
          sounds.remove(id);
        }
        else {
          const entry = entryFor(update.id);
          entry.state = update.state;
          if (update.state === 'unknown') { entry.completed = false; entry.turnId = undefined; }
          else if (update.state === 'blocked') entry.completed = false;
          sounds.observe(id, update.state);
          settled(update.id);
        }
      } catch { /* A malformed event must never interrupt agents or audio. */ }
    });
    socket.on('error', () => { /* close schedules a bounded reconnect */ });
    socket.on('close', () => {
      sounds.resetThreads();
      threads.clear();
      if (!stopped) retry = setTimeout(connect, 2_000);
    });
  }
  connect();
  return () => {
    stopped = true;
    clearTimeout(retry);
    socket.terminate();
    sounds.resetThreads();
    threads.clear();
  };
}
