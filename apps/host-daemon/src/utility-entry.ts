import { installRuntimeLog } from '@zana-ai/zcc-process-utils';
import { shutdownPortableCommands } from '@zana-ai/zcc-agent-process-utils';
import { startHostDaemon } from './daemon.js';
import { createLocalPtyTerminalManager } from './local-pty-host.js';
import { startEnrolledHostDaemon, type EnrolledHostDaemon } from './enroll-runtime.js';
import { DesktopHostEnrollmentSchema, PluginCapabilitiesChangedMessageSchema, SERVER_RUNTIME_PROTOCOL_VERSION } from '@zana-ai/zcc-contracts/runtime';
import { rebuildPluginServers } from './mcp-config.js';
import { randomUUID } from 'node:crypto';

interface ParentPortLike {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const utilityParentPort = (process as unknown as { parentPort?: ParentPortLike }).parentPort;
if (!utilityParentPort) throw new Error('host utility entry requires an Electron utility process');
const parentPort: ParentPortLike = utilityParentPort;

let close: (() => Promise<void>) | null = null;
let enrolled: EnrolledHostDaemon | null = null;
let terminalManager: ReturnType<typeof createLocalPtyTerminalManager> | null = null;
// Electron can terminate a utility process while desktop teardown is still in
// flight. node-pty's macOS helper owns its own session, so reclaim PTYs on the
// synchronous process-exit path as a final backstop against orphaned terminals.
process.once('exit', () => terminalManager?.close());
// EventEmitter does not await async listeners. Serialize lifecycle transitions
// so retries/relaunch/stop cannot race the auth write or steal our own lock.
let lifecycle: Promise<void> = Promise.resolve();
let stopping = false;
let enrollmentAbort: AbortController | undefined;
parentPort.on('message', ({ data }) => {
  const message = data as { type?: string; protocolVersion?: number } | null;
  if (message?.type === 'stop' && message.protocolVersion === SERVER_RUNTIME_PROTOCOL_VERSION) {
    // Cancel detached probes and an in-flight handshake before queued cleanup.
    stopping = true;
    shutdownPortableCommands();
    enrollmentAbort?.abort();
  }
  if (!['start', 'enroll', 'relaunch', 'stop'].includes(message?.type ?? '')) return handleMessage(data);
  const next = lifecycle.then(() => handleMessage(data));
  lifecycle = next.catch(() => undefined);
  return next;
});
async function handleMessage(data: unknown): Promise<void> {
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
    provenance?: 'tunnel' | 'non-tunnel';
    replaceEnrollment?: boolean;
    desktopEnrollment?: unknown;
  };
  if (stopping && message.type !== 'stop') return;
  if (
    (message.type === 'start' || message.type === 'enroll' || message.type === 'relaunch' || message.type === 'stop')
    && message.protocolVersion !== SERVER_RUNTIME_PROTOCOL_VERSION
  ) {
    parentPort.postMessage({ type: 'error', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, message: 'incompatible host runtime protocol version' });
    return;
  }
  if (message.type === 'plugin-capabilities') {
    // Plugin-contributed MCP servers for sessions this daemon starts (Modern Claude and Codex).
    const capabilities = PluginCapabilitiesChangedMessageSchema.safeParse(message);
    if (capabilities.success && capabilities.data.protocolVersion === SERVER_RUNTIME_PROTOCOL_VERSION) {
      rebuildPluginServers(capabilities.data.contributors);
    }
    return;
  }
  if (typeof message.path === 'string' && message.path.length > 0) {
    process.env.PATH = message.path;
  }
  // No `path` means the PATH this process was forked with stays as it is. Never
  // probe the login shell from here: this process is a child of Electron main,
  // so its parent pid is never 1 and a Finder or Dock launch would be mistaken
  // for a terminal launch. Main owns the PATH repair (`ensureProcessPath()` in
  // its own bootstrap) and always sends the result in `path`.
  if (typeof message.ghBinary === 'string' && message.ghBinary.length > 0) {
    process.env.ZCC_GH_BINARY = message.ghBinary;
  }
  if (message.type === 'start' && message.token && message.signingKey && message.hostId && !close) {
    if (message.dataDir) installRuntimeLog(message.dataDir, 'host-daemon', import.meta.url);
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
  if (message.type === 'enroll' && enrolled) {
    parentPort.postMessage({ type: 'enrolled', protocolVersion: SERVER_RUNTIME_PROTOCOL_VERSION, hostId: enrolled.hostId });
    return;
  }
  if (message.type === 'enroll' && message.serverUrl && message.token && message.dataDir && !enrolled) {
    try {
      enrollmentAbort = new AbortController();
      enrolled = await startEnrolledHostDaemon({
        dataDir: message.dataDir,
        serverUrl: message.serverUrl,
        token: message.token,
        provenance: message.provenance === 'tunnel' ? 'tunnel' : 'non-tunnel',
        replaceEnrollment: message.replaceEnrollment === true,
        stealLock: true,
        signal: enrollmentAbort.signal,
        ...(message.desktopEnrollment === undefined ? {} : { desktopEnrollment: DesktopHostEnrollmentSchema.parse(message.desktopEnrollment) })
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
      enrollmentAbort = new AbortController();
      await enrolled?.close();
      enrolled = null;
      enrolled = await startEnrolledHostDaemon({
        dataDir: message.dataDir,
        serverUrl: message.serverUrl,
        token: message.token,
        stealLock: true,
        provenance: message.provenance === 'tunnel' ? 'tunnel' : 'non-tunnel',
        replaceEnrollment: message.replaceEnrollment === true,
        signal: enrollmentAbort.signal,
        ...(message.desktopEnrollment === undefined ? {} : { desktopEnrollment: DesktopHostEnrollmentSchema.parse(message.desktopEnrollment) })
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
}
