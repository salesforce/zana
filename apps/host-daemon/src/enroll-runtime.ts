import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrollDaemonHost } from './enroll.js';
import { detectHostName, persistHostId, resolveHostId } from './identity.js';
import { acquireDaemonLock } from './lock.js';
import { readHostAuth, writeHostAuth, type HostDaemonAuth } from './machine-auth.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from './server-connection.js';
import { HostAuthenticationError, HOST_STARTUP_TIMEOUT_MS } from './server-socket.js';
import { disposeHostFsWatcher } from './workspace-fs-watch.js';
import { connectHostFetch, readConnectHostAccess } from './connect-access.js';
import { resolveZccDataDir } from './host-config.js';

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
  provenance?: HostDaemonAuth['provenance'];
  signal?: AbortSignal;
}): Promise<HostDaemonAuth> {
  options.signal?.throwIfAborted();
  const requestedHostId = options.hostId ?? resolveHostId(options.dataDir);
  const enrolled = await enrollDaemonHost({
    serverUrl: options.serverUrl,
    token: options.token,
    hostName: options.hostName ?? detectHostName(),
    instanceId: options.instanceId,
    hostId: requestedHostId,
    fetchFn: connectHostFetch(options.serverUrl, options.connectCredential)
  });
  options.signal?.throwIfAborted();
  return {
    hostId: enrolled.hostId,
    hostKey: enrolled.hostKey,
    ...(options.connectCredential ? { enrollmentId: createHash('sha256').update(options.token).digest('hex') } : {}),
    hostName: options.hostName ?? detectHostName(),
    serverUrl: options.serverUrl,
    ...(options.provenance ? { provenance: options.provenance } : {})
  };
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
    localPeerAppDataDir: process.env.ZCC_LOCAL_PEER_APP_DATA_DIR?.trim() || resolveZccDataDir(),
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

/** Only a previously recorded tunnel may change its forwarded loopback port. */
export function sameEnrolledServer(enrolled: string, requested: string, provenance?: HostDaemonAuth['provenance']): boolean {
  if (trimUrl(enrolled) === trimUrl(requested)) return true;
  if (provenance !== 'tunnel' || !loopbackHost(enrolled) || !loopbackHost(requested)) return false;
  const left = new URL(enrolled), right = new URL(requested);
  return left.protocol === right.protocol && left.pathname === right.pathname && left.search === right.search &&
    left.hash === right.hash && !left.username && !left.password && !right.username && !right.password;
}

export function assertEnrollmentSafe(options: {
  dataDir: string; serverUrl: string; hostId?: string; replaceEnrollment?: boolean;
}): void {
  const access = readConnectHostAccess(options.dataDir, options.serverUrl);
  if (!options.replaceEnrollment && access && options.hostId && access.hostId !== options.hostId) {
    throw new Error('Machine access host mismatch');
  }
  const existing = readHostAuth(options.dataDir);
  if (!existing || options.replaceEnrollment) return;
  if (!existing.serverUrl || !sameEnrolledServer(existing.serverUrl, options.serverUrl, existing.provenance)) {
    throw new Error('Existing machine enrollment belongs to another server; use --replace-enrollment to re-pair');
  }
  const hostId = options.hostId ?? access?.hostId;
  if (hostId && existing.hostId !== hostId) {
    throw new Error('Existing machine enrollment identity changed; use --replace-enrollment to re-pair');
  }
}

export async function startEnrolledHostDaemon(options: {
  dataDir: string;
  serverUrl: string;
  token?: string;
  connectCredential?: string;
  hostId?: string;
  hostName?: string;
  provenance?: HostDaemonAuth['provenance'];
  replaceEnrollment?: boolean;
  /** Desktop co-started daemon: replace another holder of this data dir. */
  stealLock?: boolean;
  keepRetryingStartup?: boolean;
  signal?: AbortSignal;
  onSocketClose?: (code: number) => void;
  onConnectionChange?: (connected: boolean) => void;
}): Promise<EnrolledHostDaemon> {
  assertEnrollmentSafe(options);
  const releaseLock = acquireDaemonLock(options.dataDir, { steal: options.stealLock === true });
  try {
    // Explicit Repair replaces stale Connect access rather than inheriting its
    // host id or credential into the replacement enrollment.
    const access = options.replaceEnrollment ? undefined : readConnectHostAccess(options.dataDir, options.serverUrl);
    options = { ...options, connectCredential: options.connectCredential ?? access?.credential, hostId: options.hostId ?? access?.hostId };
    const instanceId = randomUUID();
    const existing = readHostAuth(options.dataDir);
    // Recheck under the daemon lock; a fresh token is not a changed identity.
    assertEnrollmentSafe(options);
    // Matched only through the loopback-port relaxation: the listener may be a
    // different server, so a rejection must never re-enroll over this auth.
    const loopbackRelaxedMatch = existing?.serverUrl !== undefined && trimUrl(existing.serverUrl) !== trimUrl(options.serverUrl);
    const existingUsable = existing && !options.replaceEnrollment;
    let pendingAuth: HostDaemonAuth | undefined;
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
          instanceId,
          provenance: existing.provenance,
          signal: options.signal
        });
        pendingAuth = minted;
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
        instanceId,
        provenance: options.provenance ?? 'non-tunnel',
        signal: options.signal
      });
      pendingAuth = minted;
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
    try {
      options.signal?.throwIfAborted();
      if (pendingAuth) {
        writeHostAuth(options.dataDir, pendingAuth);
        persistHostId(options.dataDir, pendingAuth.hostId);
      }
    } catch (error) { await connection.close(); throw error; }
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
