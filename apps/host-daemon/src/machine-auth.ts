import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface HostDaemonAuth {
  hostId: string;
  hostKey: string;
  hostName: string;
}

export function authPath(dataDir: string): string {
  return join(dataDir, 'auth.json');
}

export function readHostAuth(dataDir: string): HostDaemonAuth | null {
  try {
    const parsed = JSON.parse(readFileSync(authPath(dataDir), 'utf8')) as HostDaemonAuth;
    if (!parsed.hostId || !parsed.hostKey) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeHostAuth(dataDir: string, auth: HostDaemonAuth): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(authPath(dataDir), `${JSON.stringify(auth, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600
  });
}
