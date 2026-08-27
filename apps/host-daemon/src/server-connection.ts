import { randomUUID } from 'node:crypto';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEventBatchMessageSchema,
  HostHelloMessageSchema,
  type HostEventEnvelope
} from '@zana-ai/zcc-contracts/host-rpc';
import { createEventSink, type EventSink } from './event-sink.js';
import { createCommandRuntime, type CommandRuntime } from './command-dispatch.js';
import { handleHostRpcRequest } from './command-router.js';
import { loadHostAppConfig } from './host-config.js';
import { createRuntimeManager, type ThreadRuntimeAdapter } from './runtime-manager.js';
import { createEnrolledPty, type EnrolledPty } from './enrolled-pty.js';
import { createInteractiveRequestHttpClient } from './interactive-request-client.js';
import { createPluginToolCallHttpClient } from './plugin-tool-call-client.js';
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError
} from './interactive-request-registry.js';

const BACKOFF_MS = [250, 500, 1_000, 2_000, 5_000];
const HEARTBEAT_MS = 15_000;

export interface EnrolledHostConnection {
  runtime: CommandRuntime;
  sink: EventSink;
  /** Resolves after the host websocket opens and `host.hello` is sent. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export function startEnrolledHostConnection(options: {
  serverUrl: string;
  hostId: string;
  hostKey: string;
  instanceId?: string;
  runtime?: CommandRuntime;
  dataDir?: string;
  onSocketClose?: (code: number) => void;
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
  let settleReady: ((error?: Error) => void) | null = null;
  let readySettled = false;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = (error) => {
      if (error) reject(error);
      else resolve();
    };
  });

  function markReady(): void {
    if (readySettled) return;
    readySettled = true;
    settleReady?.();
  }

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
  let enrolledPty: EnrolledPty | null = null;
  const interactiveClient = createInteractiveRequestHttpClient({
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    sessionId: instanceId
  });
  const pluginToolCalls = createPluginToolCallHttpClient({
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    sessionId: instanceId
  });
  const interactiveRequests = new InteractiveRequestRegistry({
    registerRequest: (request) => interactiveClient.registerRequest(request),
    onRegistrationFailure: ({ error, request }) => {
      void interactiveClient.interruptRequests({
        providerId: request.providerId,
        threadIds: [request.threadId],
        reason: `Failed to register interactive request while provider was waiting: ${error.message}`
      });
    }
  });
  const runtime = options.runtime ?? (() => {
    const loadConfig = () => loadHostAppConfig(options.dataDir);
    adapter = createRuntimeManager({
      emit: (event) => sink.emit(event),
      dataDir: options.dataDir,
      getRemoteDefaultPath: () => loadConfig().remoteDefaultPath,
      onInteractiveRequest: async (request) => {
        try {
          return await interactiveRequests.registerAndWait(request);
        } catch (error) {
          if (
            error instanceof InteractiveRequestRegistryError
            && error.code === 'interactive_request_rejected'
          ) {
            throw error;
          }
          throw error;
        }
      },
      onPluginToolCall: (request) => pluginToolCalls.invoke(request),
      onProcessExit: (info) => {
        const threadIds = info.threads.map((thread) => thread.threadId);
        if (threadIds.length === 0) return;
        const reason = `Provider "${info.providerId}" exited while awaiting user interaction`;
        interactiveRequests.interruptThreads({
          providerId: info.providerId,
          threadIds,
          reason
        });
        void interactiveClient.interruptRequests({
          providerId: info.providerId,
          threadIds,
          reason
        });
      }
    });
    enrolledPty = createEnrolledPty({
      emit: (event) => sink.emit(event)
    });
    return createCommandRuntime({
      dataDir: options.dataDir,
      emit: (event) => sink.emit(event),
      loadConfig,
      startWork: (input) => adapter!.startWork(input),
      submitTurn: (input) => adapter!.submitTurn(input),
      resumeWork: (input) => adapter!.resumeWork(input),
      resizeWork: (input) => adapter!.resizeWork(input),
      writeWork: (input) => adapter!.writeWork(input),
      stopWork: (input) => adapter!.stopWork(input),
      deliverInteractiveResolve: (input) => interactiveRequests.resolve(input),
      startTerminal: (input) => enrolledPty!.startTerminal(input),
      writeTerminal: (input) => enrolledPty!.writeTerminal(input),
      resizeTerminal: (input) => enrolledPty!.resizeTerminal(input),
      stopTerminal: (input) => enrolledPty!.stopTerminal(input),
      listModels: (input) => adapter!.listModels(input)
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
      markReady();
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
    next.addEventListener('close', (event) => {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      options.onSocketClose?.(event.code);
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
    ready,
    async close() {
      closed = true;
      if (!readySettled) {
        readySettled = true;
        settleReady?.(new Error('host connection closed before hello'));
      }
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      adapter?.dispose();
      enrolledPty?.dispose();
      await sink.dispose();
      socket?.close();
      socket = null;
    }
  };
}
