import { HostPreviewTunnel } from './preview-tunnel.js';
import { randomUUID } from 'node:crypto';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEventBatchMessageSchema,
  type HostEventEnvelope
} from '@zana-ai/zcc-contracts/host-rpc';
import { createEventSink, type EventSink } from './event-sink.js';
import { createEventDelivery } from './event-delivery.js';
import { PluginHostManager } from './plugin-host-manager.js';
import { hostFsWatcher } from './workspace-fs-watch.js';
import { createCommandRuntime, type CommandRuntime } from './command-dispatch.js';
import { handleHostRpcRequest } from './command-router.js';
import { loadHostAppConfig, resolveZccDataDir } from './host-config.js';
import { createRuntimeManager, type ThreadRuntimeAdapter } from './runtime-manager.js';
import { createEnrolledPty, type EnrolledPty } from './enrolled-pty.js';
import { createInteractiveRequestHttpClient } from './interactive-request-client.js';
import { createPluginToolCallHttpClient } from './plugin-tool-call-client.js';
import { createPluginHostArtifactHttpClient } from './plugin-host-artifact-client.js';
import {
  InteractiveRequestRegistry,
  InteractiveRequestRegistryError
} from './interactive-request-registry.js';
import { createHostServerSocket } from './server-socket.js';
import { connectHostFetch } from './connect-access.js';
import {
  startDesktopBrowserBroker,
  type DesktopBrowserBroker
} from './desktop-browser-broker.js';

// Pairing URLs keep `/t/<session>` via joinServerWsUrl (not a leading-slash new URL).

export interface EnrolledHostConnection {
  runtime: CommandRuntime;
  sink: EventSink;
  /** Resolves after plugin reconciliation and the server readiness acknowledgement. */
  ready: Promise<void>;
  close(): Promise<void>;
}

export function startEnrolledHostConnection(options: {
  serverUrl: string;
  connectCredential?: string;
  hostId: string;
  hostKey: string;
  instanceId?: string;
  runtime?: CommandRuntime;
  dataDir?: string;
  keepRetryingStartup?: boolean;
  onSocketClose?: (code: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}): EnrolledHostConnection {
  const instanceId = options.instanceId ?? randomUUID();
  const fetchFn = connectHostFetch(options.serverUrl, options.connectCredential);

  let socket: ReturnType<typeof createHostServerSocket> | undefined;
  let closed = false;
  let stopTask: Promise<void> | undefined;
  const delivery = createEventDelivery({
    onTimeout: () => socket?.reconnect('event-ack-timeout'),
    onRejected: reasons => console.error('[host-events] Server rejected events:', reasons.join(', '))
  });

  let adapter: ThreadRuntimeAdapter | null = null;
  let enrolledPty: EnrolledPty | null = null;
  let desktopBrowserBroker: DesktopBrowserBroker | null = null;
  const sink: EventSink = createEventSink({
    isSessionOpen: () => socket?.connected === true,
    onPressure: paused => enrolledPty?.setOutputPaused(paused),
    onTerminalOverflow: id => enrolledPty?.stopOverflowedTerminal(id),
    onOverflow: (error) => {
      console.error('[host-events]', error.message);
      void stopConnection().catch(() => undefined);
    },
    postEvents: async (events, batchId) => {
      const current = socket;
      if (!current?.connected) throw new Error('host session is not open');
      return delivery.send(batchId, events.length, () => {
        if (!current.send(JSON.stringify(HostEventBatchMessageSchema.parse({
          type: 'host.event',
          protocolVersion: HOST_RPC_PROTOCOL_VERSION,
          hostId: options.hostId,
          instanceId,
          batchId,
          events
        })))) throw new Error('host session is not open');
      });
    }
  });

  const interactiveClient = createInteractiveRequestHttpClient({
    fetchFn,
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    sessionId: instanceId
  });
  const pluginToolCalls = createPluginToolCallHttpClient({
    fetchFn,
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    sessionId: instanceId
  });
  const pluginHostArtifacts = createPluginHostArtifactHttpClient({
    fetchFn,
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey
  });
  const pluginHosts = new PluginHostManager({
    dataDir: options.dataDir ?? resolveZccDataDir(),
    fetchArtifact: args => pluginHostArtifacts.fetch(args),
    logger: { debug() {}, info(meta, message) { console.info(message, meta); }, warn(meta, message) { console.warn(message, meta); } },
    hostWatcher: hostFsWatcher(),
    onWorkerExit: payload => sink.emit({ kind: 'plugin.host.worker-exited', payload }),
    onSignal: payload => sink.emit({ kind: 'plugin.host.signal', payload })
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
      loadConfig,
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
      fetchPluginHostArtifact: (args) => pluginHostArtifacts.fetch(args),
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
      emit: (event) => runtime.emit(event)
    });
    return createCommandRuntime({
      dataDir: options.dataDir,
      pluginHosts,
      emit: (event) => sink.emit(event),
      loadConfig,
      startWork: (input) => adapter!.startWork(input),
      submitTurn: (input) => adapter!.submitTurn(input),
      resumeWork: (input) => adapter!.resumeWork(input),
      resizeWork: (input) => adapter!.resizeWork(input),
      writeWork: (input) => adapter!.writeWork(input),
      stopWork: (input) => adapter!.stopWork(input),
      cancelPlan: async (input) => {
        const cancelled = await adapter!.cancelPlan?.(input) ?? false;
        await sink.flush();
        return cancelled;
      },
      stopBackgroundTask: async (input) => {
        const stopped = await adapter!.stopBackgroundTask?.(input) ?? false;
        await sink.flush();
        return stopped;
      },
      prepareRewind: (input) => adapter!.prepareRewind(input),
      discardRewind: (input) => adapter!.discardRewind(input),
      renameWork: (input) => adapter!.renameWork(input),
      archiveWork: (input) => adapter!.archiveWork(input),
      unarchiveWork: (input) => adapter!.unarchiveWork(input),
      clearGoal: (input) => adapter!.clearGoal(input),
      deliverInteractiveResolve: (input) => interactiveRequests.resolve(input),
      startTerminal: (input) => enrolledPty!.startTerminal(input),
      // Remote CLI Agents and multi-machine Teams are deferred. Leave the
      // optional CLI handler absent so even authenticated host RPC rejects it.
      writeTerminal: input => enrolledPty!.writeTerminal(input),
      resizeTerminal: input => enrolledPty!.resizeTerminal(input),
      stopTerminal: input => enrolledPty!.stopTerminal(input),
      listModels: (input) => adapter!.listModels(input),
      providerHealth: (input) => adapter!.providerHealth(input)
    });
  })();
  runtime.emit = (event: HostEventEnvelope) => {
    if (event.kind === 'terminal.exited' && event.terminalId) runtime.terminals.delete(event.terminalId);
    sink.emit(event);
  };

  const brokerTask = !options.runtime && options.dataDir
    ? startDesktopBrowserBroker({
      dataDir: options.dataDir,
      hostId: options.hostId,
      serverUrl: options.serverUrl,
      onChanged: (event) => {
        sink.emit({ kind: 'desktop.browser.changed', payload: event });
      }
    }).then((broker) => {
      if (closed) {
        return broker.close().then(() => null);
      }
      desktopBrowserBroker = broker;
      runtime.desktopBrowserBroker = broker;
      if (socket?.connected) broker.setConnected(true);
      return broker;
    }).catch(() => null)
    : Promise.resolve(null);

  const previewTunnel = new HostPreviewTunnel(options.serverUrl, options.connectCredential);
  runtime.previewTunnel = previewTunnel;
  socket = createHostServerSocket({
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    connectCredential: options.connectCredential,
    instanceId,
    keepRetryingStartup: options.keepRetryingStartup,
    getRuntimeSnapshot: () => adapter?.getRuntimeSnapshot?.() ?? { threads: [], loadedEnvironments: [] },
    onTerminated: () => { void stopConnection().catch(() => undefined); },
    onHello: hello => (runtime.pluginHosts ?? pluginHosts).reconcileGenerations(hello.pluginHostGenerations),
    onConnectionChange: connected => {
      if (!connected) delivery.cancel();
      desktopBrowserBroker?.setConnected(connected);
      previewTunnel.setConnected(connected);
      options.onConnectionChange?.(connected);
      if (connected) void sink.flush();
    },
    onSocketClose: options.onSocketClose,
    onMessage: (parsed, reply) => {
      if (delivery.accept(parsed)) return;
      if (!parsed || typeof parsed !== 'object' || (parsed as { type?: string }).type !== 'host-rpc.request') return;
      void handleHostRpcRequest(runtime, parsed).then(response => reply(JSON.stringify(response)));
    }
  });

  function stopConnection(): Promise<void> {
    return stopTask ??= disposeConnection();
  }

  async function disposeConnection(): Promise<void> {
    closed = true;
    delivery.cancel();
    options.onConnectionChange?.(false);
    socket?.close();
    previewTunnel.close();
    runtime.peerSsh?.close?.();
    await pluginHosts.shutdown();
    adapter?.dispose();
    enrolledPty?.dispose();
    await sink.dispose();
    const broker = desktopBrowserBroker ?? await brokerTask;
    desktopBrowserBroker = null;
    runtime.desktopBrowserBroker = undefined;
    await broker?.close();
  }

  return {
    runtime,
    sink,
    ready: socket.ready,
    close: () => stopConnection()
  };
}
