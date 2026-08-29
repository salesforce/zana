import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrollDaemonHost } from './enroll.js';
import { detectHostName, persistHostId, resolveHostId } from './identity.js';
import { acquireDaemonLock } from './lock.js';
import { readHostAuth, writeHostAuth } from './machine-auth.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from './server-connection.js';

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
}): Promise<{ hostId: string; hostKey: string }> {
  const requestedHostId = options.hostId ?? resolveHostId(options.dataDir);
  const enrolled = await enrollDaemonHost({
    serverUrl: options.serverUrl,
    token: options.token,
    hostName: options.hostName ?? detectHostName(),
    instanceId: options.instanceId,
    hostId: requestedHostId
  });
  persistHostId(options.dataDir, enrolled.hostId);
  writeHostAuth(options.dataDir, {
    hostId: enrolled.hostId,
    hostKey: enrolled.hostKey,
    hostName: options.hostName ?? detectHostName()
  });
  return { hostId: enrolled.hostId, hostKey: enrolled.hostKey };
}

async function openSession(options: {
  dataDir: string;
  serverUrl: string;
  hostId: string;
  hostKey: string;
  instanceId: string;
  onSocketClose?: (code: number) => void;
}): Promise<EnrolledHostConnection> {
  const connection = startEnrolledHostConnection({
    serverUrl: options.serverUrl,
    hostId: options.hostId,
    hostKey: options.hostKey,
    instanceId: options.instanceId,
    dataDir: options.dataDir,
    onSocketClose: options.onSocketClose
  });
  void connection.ready.catch(() => {
    /* close() may reject after a timeout wins the race */
  });
  try {
    await waitForHello(connection, 10_000);
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

export async function startEnrolledHostDaemon(options: {
  dataDir: string;
  serverUrl: string;
  token?: string;
  hostId?: string;
  hostName?: string;
  /** Desktop co-started daemon: replace another holder of this data dir. */
  stealLock?: boolean;
  onSocketClose?: (code: number) => void;
}): Promise<EnrolledHostDaemon> {
  const releaseLock = acquireDaemonLock(options.dataDir, { steal: options.stealLock === true });
  try {
    const instanceId = randomUUID();
    const existing = readHostAuth(options.dataDir);
    let hostId: string;
    let connection: EnrolledHostConnection;
    if (existing) {
      try {
        connection = await openSession({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          hostId: existing.hostId,
          hostKey: existing.hostKey,
          instanceId,
          onSocketClose: options.onSocketClose
        });
        hostId = existing.hostId;
      } catch (error) {
        if (!options.token) throw error;
        const minted = await mintCredentials({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          token: options.token,
          hostId: options.hostId ?? existing.hostId,
          hostName: options.hostName,
          instanceId
        });
        hostId = minted.hostId;
        connection = await openSession({
          dataDir: options.dataDir,
          serverUrl: options.serverUrl,
          hostId: minted.hostId,
          hostKey: minted.hostKey,
          instanceId,
          onSocketClose: options.onSocketClose
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
        hostId: options.hostId,
        hostName: options.hostName,
        instanceId
      });
      hostId = minted.hostId;
      connection = await openSession({
        dataDir: options.dataDir,
        serverUrl: options.serverUrl,
        hostId: minted.hostId,
        hostKey: minted.hostKey,
        instanceId,
        onSocketClose: options.onSocketClose
      });
    }
    return {
      hostId,
      instanceId,
      connection,
      async close() {
        await connection.close();
        releaseLock();
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
