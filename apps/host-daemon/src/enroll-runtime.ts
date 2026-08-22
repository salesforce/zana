import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { enrollDaemonHost } from './enroll.js';
import { detectHostName, persistHostId, resolveHostId } from './identity.js';
import { acquireDaemonLock } from './lock.js';
import { startEnrolledHostConnection, type EnrolledHostConnection } from './server-connection.js';

export interface EnrolledHostDaemon {
  hostId: string;
  instanceId: string;
  connection: EnrolledHostConnection;
  close(): Promise<void>;
}

export async function startEnrolledHostDaemon(options: {
  dataDir: string;
  serverUrl: string;
  token: string;
  hostName?: string;
}): Promise<EnrolledHostDaemon> {
  const releaseLock = acquireDaemonLock(options.dataDir);
  try {
    const instanceId = randomUUID();
    const requestedHostId = resolveHostId(options.dataDir);
    const enrolled = await enrollDaemonHost({
      serverUrl: options.serverUrl,
      token: options.token,
      hostName: options.hostName ?? detectHostName(),
      instanceId,
      hostId: requestedHostId
    });
    persistHostId(options.dataDir, enrolled.hostId);
    const connection = startEnrolledHostConnection({
      serverUrl: options.serverUrl,
      hostId: enrolled.hostId,
      hostKey: enrolled.hostKey,
      instanceId,
      dataDir: options.dataDir
    });
    void connection.ready.catch(() => {
      /* close() may reject after a timeout wins the race */
    });
    let openTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        connection.ready,
        new Promise<never>((_, reject) => {
          openTimer = setTimeout(() => reject(new Error('host websocket did not open')), 10_000);
        })
      ]);
      // Hello is processed on the server in another process; wait one local RTT
      // so hostHub.sessions is populated before the first thread.create.
      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      await connection.close();
      throw error;
    } finally {
      if (openTimer) clearTimeout(openTimer);
    }
    return {
      hostId: enrolled.hostId,
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
