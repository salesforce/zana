import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import {
  HOST_RPC_PROTOCOL_VERSION,
  HostEventAckMessageSchema,
  HostEventBatchMessageSchema,
  HostHelloMessageSchema,
  HostRpcCommandSchema,
  HostRpcRequestMessageSchema,
  HostRpcResponseMessageSchema,
  parseHostRpcResult,
  type HostEventEnvelope,
  type HostRpcCommand,
  type HostRpcCommandType,
  type HostRpcResponseMessage
} from '@zana-ai/zcc-contracts/host-rpc';
import {
  appendThreadEvent,
  closeHostSession,
  disconnectLiveThreadsForHost,
  getHost,
  getThread,
  openHostSession,
  updateThreadStatus,
  type ZccDatabase
} from '@zana-ai/zcc-db';
import type { ProductHub } from './product-hub.js';

export class HostUnavailableError extends Error {
  readonly code = 'host-unavailable';
  constructor(message = 'host session is not connected') {
    super(message);
    this.name = 'HostUnavailableError';
  }
}

export class AmbiguousHostError extends Error {
  readonly code = 'ambiguous-host';
  constructor(message = 'hostId is required when more than one host is connected') {
    super(message);
    this.name = 'AmbiguousHostError';
  }
}

export function hashHostKey(hostKey: string): string {
  return createHash('sha256').update(hostKey).digest('hex');
}

export function generateHostKey(): string {
  return randomBytes(32).toString('hex');
}

export function hostKeyMatches(hostKey: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashHostKey(hostKey), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

interface PendingRpc {
  commandType: HostRpcCommandType;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface ConnectedHostSession {
  hostId: string;
  instanceId: string;
  socket: WebSocket;
}

const DEFAULT_RPC_TIMEOUT_MS = 30_000;

export function createHostHub(db: ZccDatabase, hub: ProductHub) {
  const sessions = new Map<string, ConnectedHostSession>();
  const pending = new Map<string, PendingRpc>();

  function connectedHostIds(): string[] {
    return [...sessions.keys()];
  }

  function getSession(hostId: string): ConnectedHostSession | undefined {
    return sessions.get(hostId);
  }

  function ensureHostSessionReady(hostId: string): ConnectedHostSession {
    const session = sessions.get(hostId);
    if (!session || session.socket.readyState !== session.socket.OPEN) {
      throw new HostUnavailableError(`host ${hostId} is not connected`);
    }
    return session;
  }

  function resolveHostId(explicit?: string): string {
    if (explicit) {
      ensureHostSessionReady(explicit);
      return explicit;
    }
    const ids = connectedHostIds();
    if (ids.length === 0) throw new HostUnavailableError();
    if (ids.length > 1) throw new AmbiguousHostError();
    return ids[0]!;
  }

  function detach(hostId: string, reason: string): void {
    const session = sessions.get(hostId);
    if (!session) return;
    sessions.delete(hostId);
    closeHostSession(db, hostId, reason);
    for (const [requestId, waiter] of pending) {
      if (requestId.startsWith(`${hostId}:`)) {
        clearTimeout(waiter.timer);
        pending.delete(requestId);
        waiter.reject(new HostUnavailableError(`host ${hostId} disconnected`));
      }
    }
  }

  function attach(socket: WebSocket, hostId: string, instanceId: string): void {
    const previous = sessions.get(hostId);
    if (previous && previous.instanceId !== instanceId) {
      disconnectLiveThreadsForHost(db, hostId);
      previous.socket.close();
    }
    openHostSession(db, { hostId, instanceId, hostName: getHost(db, hostId)?.name ?? 'host' });
    sessions.set(hostId, { hostId, instanceId, socket });
    socket.on('close', () => {
      const current = sessions.get(hostId);
      if (current?.socket === socket) detach(hostId, 'socket-closed');
    });
    socket.on('message', (raw) => {
      void handleInbound(hostId, raw.toString());
    });
  }

  async function handleInbound(hostId: string, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const session = sessions.get(hostId);
    if (!session) return;

    const response = HostRpcResponseMessageSchema.safeParse(parsed);
    if (response.success) {
      settleRpc(hostId, response.data);
      return;
    }
    const batch = HostEventBatchMessageSchema.safeParse(parsed);
    if (batch.success) {
      ingestEvents(session, batch.data);
    }
  }

  function settleRpc(hostId: string, message: HostRpcResponseMessage): void {
    const waiter = pending.get(`${hostId}:${message.requestId}`);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    pending.delete(`${hostId}:${message.requestId}`);
    if (!message.ok) {
      waiter.reject(Object.assign(new Error(message.error.message), { code: message.error.code }));
      return;
    }
    try {
      waiter.resolve(parseHostRpcResult(message.commandType, message.result));
    } catch (error) {
      waiter.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  function ingestEvents(
    session: ConnectedHostSession,
    batch: { hostId: string; instanceId: string; events: HostEventEnvelope[] }
  ): void {
    if (batch.hostId !== session.hostId || batch.instanceId !== session.instanceId) {
      const ack = HostEventAckMessageSchema.parse({
        type: 'host.event-ack',
        protocolVersion: HOST_RPC_PROTOCOL_VERSION,
        accepted: 0,
        rejected: batch.events.map((_, index) => ({ index, reason: 'stale_instance' }))
      });
      if (session.socket.readyState === session.socket.OPEN) {
        session.socket.send(JSON.stringify(ack));
      }
      return;
    }

    const rejected: Array<{ index: number; reason: string }> = [];
    let accepted = 0;
    db.transaction(() => {
      batch.events.forEach((event, index) => {
        if (event.kind === 'project.clone.progress') {
          accepted += 1;
          hub.emit('projects:cloneProgress', event.payload);
          return;
        }
        if (!event.threadId) {
          rejected.push({ index, reason: 'unknown_thread' });
          return;
        }
        const thread = getThread(db, event.threadId);
        if (!thread || thread.hostId !== session.hostId) {
          rejected.push({ index, reason: 'unknown_thread' });
          return;
        }
        const stored = appendThreadEvent(db, {
          threadId: event.threadId,
          kind: event.kind,
          payload: event.payload
        });
        accepted += 1;
        if (event.kind === 'thread.started') updateThreadStatus(db, event.threadId, 'running');
        if (event.kind === 'turn.failed') updateThreadStatus(db, event.threadId, 'failed');
        hub.emit('threads:event', {
          threadId: event.threadId,
          sequence: stored.sequence,
          kind: event.kind,
          payload: event.payload
        });
      });
    });
    const ack = HostEventAckMessageSchema.parse({
      type: 'host.event-ack',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      accepted,
      rejected
    });
    if (session.socket.readyState === session.socket.OPEN) {
      session.socket.send(JSON.stringify(ack));
    }
    if (accepted > 0) {
      const statusChanged = batch.events.some((event, index) => (
        event.kind !== 'terminal.output'
        && event.kind !== 'project.clone.progress'
        && !rejected.some((row) => row.index === index)
      ));
      if (statusChanged) hub.emit('threads:updated', { hostId: session.hostId });
    }
  }

  async function callHostOnlineRpc<T = unknown>(input: {
    hostId: string;
    command: HostRpcCommand;
    timeoutMs?: number;
  }): Promise<T> {
    const session = ensureHostSessionReady(input.hostId);
    const command = HostRpcCommandSchema.parse(input.command);
    const requestId = randomUUID();
    const message = HostRpcRequestMessageSchema.parse({
      type: 'host-rpc.request',
      protocolVersion: HOST_RPC_PROTOCOL_VERSION,
      requestId,
      command
    });
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(`${input.hostId}:${requestId}`);
        reject(new HostUnavailableError(`host rpc timed out: ${command.type}`));
      }, input.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS);
      pending.set(`${input.hostId}:${requestId}`, {
        commandType: command.type,
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });
      try {
        session.socket.send(JSON.stringify(message));
      } catch (error) {
        clearTimeout(timer);
        pending.delete(`${input.hostId}:${requestId}`);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  function acceptHello(socket: WebSocket, hostId: string, raw: unknown): boolean {
    const hello = HostHelloMessageSchema.safeParse(raw);
    if (!hello.success) return false;
    if (hello.data.hostId !== hostId) return false;
    if (hello.data.protocolVersion !== HOST_RPC_PROTOCOL_VERSION) return false;
    attach(socket, hostId, hello.data.instanceId);
    return true;
  }

  function close(): void {
    for (const session of sessions.values()) {
      session.socket.close();
    }
    sessions.clear();
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new HostUnavailableError('host hub closed'));
    }
    pending.clear();
  }

  return {
    connectedHostIds,
    getSession,
    ensureHostSessionReady,
    resolveHostId,
    callHostOnlineRpc,
    acceptHello,
    detach,
    close
  };
}

export type HostHub = ReturnType<typeof createHostHub>;
