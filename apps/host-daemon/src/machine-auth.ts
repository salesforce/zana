import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export interface HostDaemonAuth {
  provenance?: 'tunnel' | 'non-tunnel';
  serverUrl?: string;
  enrollmentId?: string;
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
    if (parsed.provenance !== 'tunnel' && parsed.provenance !== 'non-tunnel') delete parsed.provenance;
    return parsed;
  } catch {
    return null;
  }
}

export function writeHostAuth(dataDir: string, auth: HostDaemonAuth): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = authPath(dataDir), temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(auth, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}
