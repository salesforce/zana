import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrollDaemonHost } from './enroll.js';
import { detectHostName, persistHostId, resolveHostId } from './identity.js';
import { acquireDaemonLock } from './lock.js';
import { readHostAuth, writeHostAuth } from './machine-auth.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from './server-connection.js';
import { HostAuthenticationError, HOST_STARTUP_TIMEOUT_MS } from './server-socket.js';
import { disposeHostFsWatcher } from './workspace-fs-watch.js';
import { connectHostFetch, readConnectHostAccess } from './connect-access.js';

export interface EnrolledHostDaemon {
  hostId: string;
  instanceId: string;
  connection: EnrolledHostConnection;
  close(): Promise<void>;
}

async function waitForHello(connection: EnrolledHostConnection, timeoutMs: number): Promise<void> {
  let openTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      connection.ready,
      new Promise<never>((_, reject) => {
        openTimer = setTimeout(() => reject(new Error('host websocket did not open')), timeoutMs);
      })
    ]);
  } finally {
    if (openTimer) clearTimeout(openTimer);
  }
}

async function mintCredentials(options: {
  dataDir: string;
  serverUrl: string;
  token: string;
  hostId?: string;
  hostName?: string;
  instanceId: string;
  connectCredential?: string;
}): Promise<{ hostId: string; hostKey: string }> {
  const requestedHostId = options.hostId ?? resolveHostId(options.dataDir);
  const enrolled = await enrollDaemonHost({
    serverUrl: options.serverUrl,
    token: options.token,
    hostName: options.hostName ?? detectHostName(),
    instanceId: options.instanceId,
    hostId: requestedHostId,
    fetchFn: connectHostFetch(options.serverUrl, options.connectCredential)
  });
  persistHostId(options.dataDir, enrolled.hostId);
  writeHostAuth(options.dataDir, {
    hostId: enrolled.hostId,
    hostKey: enrolled.hostKey,
    ...(options.connectCredential ? { enrollmentId: createHash('sha256').update(options.token).digest('hex') } : {}),
    hostName: options.hostName ?? detectHostName(),
    serverUrl: options.serverUrl
  });
  return { hostId: enrolled.hostId, hostKey: enrolled.hostKey };
}

async function openSession(options: {
  dataDir: string;
  serverUrl: string;
  hostId: string;
  hostKey: string;
  instanceId: string;
  connectCredential?: string;
  keepRetryingStartup?: boolean;
  signal?: AbortSignal;
  onSocketClose?: (code: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}): Promise<EnrolledHostConnection> {
  options.signal?.throwIfAborted();
  const connection = startEnrolledHostConnection({
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    instanceId: options.instanceId,
    dataDir: options.dataDir,
    connectCredential: options.connectCredential,
    onConnectionChange: options.onConnectionChange,
    onSocketClose: options.onSocketClose,
    keepRetryingStartup: options.keepRetryingStartup
  });
  void connection.ready.catch(() => {
    /* close() may reject after a timeout wins the race */
  });
  const abort = () => { void connection.close().catch(() => undefined); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    if (options.keepRetryingStartup) await connection.ready;
    else await waitForHello(connection, HOST_STARTUP_TIMEOUT_MS);
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  } finally {
    options.signal?.removeEventListener('abort', abort);
  }
}

const trimUrl = (url: string): string => url.replace(/\/$/, '');

function loopbackHost(url: string): boolean {
  try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname.toLowerCase()); } catch { return false; }
}

/** A tunnel-forwarded owner is the same server on any loopback port: the port is chosen per tunnel. */
export function sameEnrolledServer(enrolled: string, requested: string): boolean {
  if (trimUrl(enrolled) === trimUrl(requested)) return true;
  return loopbackHost(enrolled) && loopbackHost(requested);
}

export async function startEnrolledHostDaemon(options: {
  dataDir: string;
  serverUrl: string;
  token?: string;
  connectCredential?: string;
  hostId?: string;
  hostName?: string;
  /** Desktop co-started daemon: replace another holder of this data dir. */
  stealLock?: boolean;
  keepRetryingStartup?: boolean;
  signal?: AbortSignal;
  onSocketClose?: (code: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}): Promise<EnrolledHostDaemon> {
  const releaseLock = acquireDaemonLock(options.dataDir, { steal: options.stealLock === true });
  try {
    const access = readConnectHostAccess(options.dataDir, options.serverUrl);
    if (access && options.hostId && access.hostId !== options.hostId) throw new Error('Machine access host mismatch');
    options = { ...options, connectCredential: options.connectCredential ?? access?.credential, hostId: options.hostId ?? access?.hostId };
    const instanceId = randomUUID();
    const existing = readHostAuth(options.dataDir);
    if (existing?.serverUrl && !sameEnrolledServer(existing.serverUrl, options.serverUrl)) throw new Error('Existing machine enrollment belongs to another server');
    // Matched only through the loopback-port relaxation: the listener may be a
    // different server, so a rejection must never re-enroll over this auth.
    const loopbackRelaxedMatch = existing?.serverUrl !== undefined && trimUrl(existing.serverUrl) !== trimUrl(options.serverUrl);
    const existingUsable =
      existing && (!options.hostId || existing.hostId === options.hostId) && !(options.connectCredential && options.token && existing.enrollmentId !== createHash('sha256').update(options.token).digest('hex'));
    let hostId: string;
    let connection: EnrolledHostConnection;
    if (existingUsable) {
      try {
        connection = await openSession({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          connectCredential: options.connectCredential,
          hostId: existing.hostId,
          hostKey: existing.hostKey,
          instanceId,
          onConnectionChange: options.onConnectionChange,
          onSocketClose: options.onSocketClose,
          keepRetryingStartup: options.keepRetryingStartup,
          signal: options.signal
        });
        hostId = existing.hostId;
        // The owner's forwarded port can change between tunnels; reconnects use the stored URL.
        if (existing.serverUrl !== options.serverUrl) writeHostAuth(options.dataDir, { ...existing, serverUrl: options.serverUrl });
      } catch (error) {
        // Transient connectivity must not consume a join code or rotate a
        // machine key. Only an explicit authentication rejection can re-enroll.
        if (!options.token || !(error instanceof HostAuthenticationError)) throw error;
        if (loopbackRelaxedMatch) throw new Error('Existing machine enrollment belongs to another server');
        const minted = await mintCredentials({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          token: options.token,
          connectCredential: options.connectCredential,
          hostId: options.hostId ?? existing.hostId,
          hostName: options.hostName,
          instanceId
        });
        hostId = minted.hostId;
        connection = await openSession({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          connectCredential: options.connectCredential,
          hostId: minted.hostId,
          hostKey: minted.hostKey,
          instanceId,
          onConnectionChange: options.onConnectionChange,
          onSocketClose: options.onSocketClose,
          keepRetryingStartup: options.keepRetryingStartup,
          signal: options.signal
        });
      }
    } else {
      if (!options.token) {
        throw new Error('host enroll token is missing and auth.json is absent');
      }
      const minted = await mintCredentials({
        dataDir: options.dataDir,
        serverUrl: options.serverUrl,
        token: options.token,
        connectCredential: options.connectCredential,
        hostId: options.hostId,
        hostName: options.hostName,
        instanceId
      });
      hostId = minted.hostId;
      connection = await openSession({
        dataDir: options.dataDir,
        serverUrl: options.serverUrl,
        connectCredential: options.connectCredential,
        hostId: minted.hostId,
        hostKey: minted.hostKey,
        instanceId,
        onConnectionChange: options.onConnectionChange,
        onSocketClose: options.onSocketClose,
        keepRetryingStartup: options.keepRetryingStartup,
        signal: options.signal
      });
    }
    let closeTask: Promise<void> | undefined;
    return {
      hostId,
      instanceId,
      connection,
      close() {
        return closeTask ??= (async () => {
          try {
            await disposeHostFsWatcher();
            await connection.close();
          } finally { releaseLock(); }
        })();
      }
    };
  } catch (error) {
    releaseLock();
    throw error;
  }
}

export function readEnrollToken(dataDir: string, env: NodeJS.ProcessEnv = process.env): string {
  if (env.ZCC_HOST_ENROLL_TOKEN && env.ZCC_HOST_ENROLL_TOKEN.length >= 16) {
    return env.ZCC_HOST_ENROLL_TOKEN;
  }
  try {
    return readFileSync(join(dataDir, 'host-enroll.token'), 'utf8').trim();
  } catch {
    throw new Error('host enroll token is missing (ZCC_HOST_ENROLL_TOKEN or dataDir/host-enroll.token)');
  }
}
