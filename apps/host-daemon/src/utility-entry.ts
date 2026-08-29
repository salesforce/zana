import { startHostDaemon } from './daemon.js';
import { createLocalPtyTerminalManager } from './local-pty-host.js';
import { startEnrolledHostDaemon, type EnrolledHostDaemon } from './enroll-runtime.js';
import { ensureProcessPath } from './env.js';
import { SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { randomUUID } from 'node:crypto';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!parentPort) throw new Error('host utility entry requires an Electron utility process');

let close: (() => Promise<void>) | null = null;
let enrolled: EnrolledHostDaemon | null = null;
let terminalManager: ReturnType<typeof createLocalPtyTerminalManager> | null = null;
// Electron can terminate a utility process while desktop teardown is still in
// flight. node-pty's macOS helper owns its own session, so reclaim PTYs on the
// synchronous process-exit path as a final backstop against orphaned terminals.
process.once('exit', () => terminalManager?.close());
parentPort.on('message', async ({ data }) => {
  if (!data || typeof data !== 'object') return;
  const message = data as {
    type?: string;
    protocolVersion?: number;
    token?: string;
    signingKey?: string;
    hostId?: string;
    serverUrl?: string;
    dataDir?: string;
    path?: string;
    ghBinary?: string;
  };
  if (
    (message.type === 'start' || message.type === 'enroll' || message.type === 'relaunch' || message.type === 'stop')
    && message.protocolVersion !== SERVER_RUNTIME_PROTOCOL_VERSION
  ) {
    parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, message: 'incompatible host runtime protocol version' });
    return;
  }
  if (typeof message.path === 'string' && message.path.length > 0) {
    process.env.PATH = message.path;
  } else if (message.type === 'start') {
    ensureProcessPath();
  }
  if (typeof message.ghBinary === 'string' && message.ghBinary.length > 0) {
    process.env.ZCC_GH_BINARY = message.ghBinary;
  }
  if (message.type === 'start' && message.token && message.signingKey && message.hostId && !close) {
    try {
      const instanceId = randomUUID();
      terminalManager = createLocalPtyTerminalManager((event) => parentPort.postMessage({
        type: 'terminal-event', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, event
      }));
      const host = await startHostDaemon({
        token: message.token,
        signingKey: message.signingKey,
        hostId: message.hostId,
        instanceId,
        // Parent transport is authenticated by Electron's utility-process
        // channel. The desktop supervisor validates and forwards only typed
        // events; renderer code never sees this control channel.
        terminalManager
      });
      close = host.close;
      parentPort.postMessage({
        type: 'ready', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, url: host.url,
        hostId: message.hostId, instanceId
      });
    } catch (error) {
      parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, message: error instanceof Error ? error.message : String(error) });
    }
  }
  if (message.type === 'enroll' && message.serverUrl && message.token && message.dataDir && !enrolled) {
    try {
      enrolled = await startEnrolledHostDaemon({
        dataDir: message.dataDir,
        serverUrl: message.serverUrl,
        token: message.token,
        stealLock: true
      });
      parentPort.postMessage({
        type: 'enrolled',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        hostId: enrolled.hostId
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (message.type === 'relaunch' && message.serverUrl && message.token && message.dataDir) {
    try {
      await enrolled?.close();
      enrolled = null;
      enrolled = await startEnrolledHostDaemon({
        dataDir: message.dataDir,
        serverUrl: message.serverUrl,
        token: message.token,
        stealLock: true
      });
      parentPort.postMessage({
        type: 'enrolled',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        hostId: enrolled.hostId
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'error',
        protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
  if (message.type === 'stop' && message.protocolVersion === SERVER_RUNTIME_PROTOCOL_VERSION) {
    await enrolled?.close();
    enrolled = null;
    await close?.();
    parentPort.postMessage({ type: 'stopped', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION });
    process.exit(0);
  }
});
