import { randomUUID } from 'node:crypto';
import {
  HOST_RPC_PROTOCOL_VERSION, HostRpcRequestMessageSchema,
  type HostRpcResponseMessage
} from '@zana-ai/zcc-contracts/host-rpc';
import { parseJoinArgv } from './join-argv.js';
import { enrollDaemonHost } from './enroll.js';
import { detectHostName } from './identity.js';
import { readHostAuth, writeHostAuth } from './machine-auth.js';
import { startLocalStatusServer } from './local-status.js';
import { createHostServerSocket } from './server-socket.js';
import { resolveZccDataDir } from './host-config.js';
import { createStoredLocalPeerAppResolver, PeerForwarder } from './peer-forward.js';
import { PeerControlForwarder } from './peer-control.js';
import { HostCommandError } from './host-command-error.js';

export const PROTOCOL_VERSION = HOST_RPC_PROTOCOL_VERSION;

/** Minimal joined host: only peer transport, never an execution-runtime substitute. */
export async function runJoinStandalone(argv = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env) {
  const options = parseJoinArgv(argv, env);
  if (!options.dataDir) throw new Error('ZCC_DATA_DIR is required for an isolated machine install');
  const instanceId = randomUUID();
  let connected = false;
  let hostId = options.hostId ?? null;
  const status = startLocalStatusServer(options.hostDaemonPort, () => ({
    hostId, serverUrl: options.serverUrl, connected, protocolVersion: PROTOCOL_VERSION,
    autoUpdate: false // This helper does not implement the installed daemon's updater.
  }));
  let socket: ReturnType<typeof createHostServerSocket> | undefined;
  let peer: PeerForwarder | undefined;
  let control: PeerControlForwarder | undefined;
  let closeTask: Promise<void> | undefined;
  const close = () => closeTask ??= (async () => {
    connected = false;
    peer?.close();
    control?.close();
    socket?.close();
    await new Promise<void>(resolve => status.close(() => resolve()));
  })();
  try {
    let auth = readHostAuth(options.dataDir);
    if (auth && ((options.hostId && auth.hostId !== options.hostId)
      || (auth.serverUrl && auth.serverUrl.replace(/\/$/, '') !== options.serverUrl))) {
      throw new Error('Existing machine enrollment belongs to another server or host');
    }
    if (!auth) {
      if (!options.joinCode) throw new Error('host enroll token is missing and auth.json is absent');
      const hostName = detectHostName();
      auth = { ...await enrollDaemonHost({ serverUrl: options.serverUrl, token: options.joinCode,
        hostName, instanceId, hostId: options.hostId }), hostName, serverUrl: options.serverUrl };
      writeHostAuth(options.dataDir, auth);
    }
    hostId = auth.hostId;
    // Selected by the local operator, not by the enrollment server or RPC packet.
    const localAppDataDir = env.ZCC_LOCAL_PEER_APP_DATA_DIR?.trim() || resolveZccDataDir(env);
    peer = new PeerForwarder({ resolveLocalPeerApp: createStoredLocalPeerAppResolver(localAppDataDir) });
    control = new PeerControlForwarder({ localAppDataDir, hostId, hostKey: auth.hostKey });
    let capability: 'execution' | 'peer.forward' = 'peer.forward';
    let authenticatedHello = false;
    socket = createHostServerSocket({
      serverUrl: options.serverUrl, hostId, hostKey: auth.hostKey, instanceId,
      onHello: async hello => {
        const nextCapability = hello.enrollmentCapability ?? 'peer.forward';
        capability = authenticatedHello && capability === 'peer.forward' ? 'peer.forward' : nextCapability;
        authenticatedHello = true;
        await control!.hello(hello.productInstanceId, capability);
      },
      onConnectionChange: value => {
        connected = value;
        if (!value) { peer!.cancelAll(); control!.cancelAll(); }
      },
      onMessage: (raw, reply) => {
        if (!raw || typeof raw !== 'object' || (raw as { type?: string }).type !== 'host-rpc.request') return;
        const requestId = typeof (raw as { requestId?: unknown }).requestId === 'string'
          && (raw as { requestId: string }).requestId.length > 0
          && (raw as { requestId: string }).requestId.length <= 128 ? (raw as { requestId: string }).requestId : 'unknown';
        const fail = (code: string, message: string) => reply(JSON.stringify({
          type: 'host-rpc.response', protocolVersion: PROTOCOL_VERSION, requestId, ok: false,
          error: { code, message }
        } satisfies HostRpcResponseMessage));
        if ((raw as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) {
          fail('protocol_mismatch', 'incompatible host-rpc protocol version');
          return;
        }
        if (capability !== 'execution' && (raw as { command?: { type?: string } }).command?.type !== 'peer.forward'
          && (raw as { command?: { type?: string } }).command?.type !== 'peer.control') {
          fail('capability_denied', 'host enrollment does not authorize command');
          return;
        }
        const request = HostRpcRequestMessageSchema.safeParse(raw);
        if (!request.success) { fail('invalid_request', 'unknown or invalid host-rpc request'); return; }
        const command = request.data.command;
        if (command.type !== 'peer.forward' && command.type !== 'peer.control') {
          fail('unsupported_command', 'standalone host does not implement command');
          return;
        }
        const operation = command.type === 'peer.forward' ? peer!.forward(command) : control!.forward(command);
        void operation.then(result => reply(JSON.stringify({
          type: 'host-rpc.response', protocolVersion: PROTOCOL_VERSION, requestId: request.data.requestId,
          commandType: command.type, ok: true, result
        } satisfies HostRpcResponseMessage)), error => fail(
          error instanceof HostCommandError ? error.code : 'peer_forward_failed',
          error instanceof HostCommandError ? error.message : 'peer forwarding failed'
        ));
      }
    });
    await socket.ready;
    process.stdout.write(`zcc-host-daemon joined hostId=${auth.hostId}\n`);
    return { hostId: auth.hostId, close };
  } catch (error) {
    await close();
    throw error;
  }
}
