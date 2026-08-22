import { randomUUID } from 'node:crypto';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEventBatchMessageSchema,
  HostHelloMessageSchema,
  type HostEventEnvelope
} from '@zana-ai/zcc-contracts/host-rpc';
import type { AppConfig } from '@zana-ai/zcc-domain/product';
import { createEventSink, type EventSink } from './event-sink.js';
import { createCommandRuntime, type CommandRuntime } from './command-dispatch.js';
import { handleHostRpcRequest } from './command-router.js';
import { createPtyThreadAdapter, type ThreadRuntimeAdapter } from './thread-runtime.js';

const BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000];
const HEARTBEAT_MS = 15_000;

export interface EnrolledHostConnection {
  runtime: CommandRuntime;
  sink: EventSink;
  close(): Promise<void>;
}

export function startEnrolledHostConnection(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  instanceId?: string;
  runtime?: CommandRuntime;
  dataDir?: string;
}): EnrolledHostConnection {
  const instanceId = options.instanceId ?? randomUUID();
  const wsUrl = new URL('/internal/hosts/ws', options.serverUrl.replace(/^http/, 'ws'));
  wsUrl.searchParams.set('hostId', options.hostId);
  wsUrl.searchParams.set('hostKey', options.hostKey);

  let socket: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  const sink: EventSink = createEventSink({
    isSessionOpen: () => socket?.readyState === WebSocket.OPEN,
    postEvents: async (events) => {
      if (!socket || socket.readyState !== WebSocket.OPEN) throw new Error('host session is not open');
      socket.send(JSON.stringify(HostEventBatchMessageSchema.parse({
        type: 'host.event',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostId: options.hostId,
        instanceId,
        events
      })));
    }
  });

  let adapter: ThreadRuntimeAdapter | null = null;
  const runtime = options.runtime ?? (() => {
    adapter = createPtyThreadAdapter({
      emit: (event) => sink.emit(event),
      loadConfig: () => ({
        version: 1,
        theme: 'dark',
        shell: '/bin/zsh',
        claudeBinary: 'claude',
        fontSize: 13,
        lastProjectId: null
      } as AppConfig)
    });
    return createCommandRuntime({
      dataDir: options.dataDir,
      emit: (event) => sink.emit(event),
      startWork: (input) => adapter!.startWork(input),
      submitTurn: (input) => adapter!.submitTurn(input),
      resizeWork: (input) => adapter!.resizeWork(input)
    });
  })();
  runtime.emit = (event: HostEventEnvelope) => sink.emit(event);

  function connect(): void {
    if (closed) return;
    const next = new WebSocket(wsUrl);
    socket = next;
    next.addEventListener('open', () => {
      attempt = 0;
      next.send(JSON.stringify(HostHelloMessageSchema.parse({
        type: 'host.hello',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        hostId: options.hostId,
        instanceId
      })));
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        if (next.readyState === WebSocket.OPEN) {
          next.send(JSON.stringify({ type: 'heartbeat' }));
        }
      }, HEARTBEAT_MS);
      void sink.flush();
    });
    next.addEventListener('message', (event) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object' || (parsed as { type?: string }).type !== 'host-rpc.request') {
        return;
      }
      void handleHostRpcRequest(runtime, parsed).then((response) => {
        if (next.readyState === WebSocket.OPEN) next.send(JSON.stringify(response));
      });
    });
    next.addEventListener('close', () => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (closed) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]!;
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
    next.addEventListener('error', () => {
      next.close();
    });
  }

  connect();

  return {
    runtime,
    sink,
    async close() {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      adapter?.dispose();
      await sink.dispose();
      socket?.close();
      socket = null;
    }
  };
}
