import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';

export const HOST_ID_FILE_NAME = 'host.id';

export function readPersistedHostId(dataDir: string): string | null {
  try {
    const value = readFileSync(join(dataDir, HOST_ID_FILE_NAME), 'utf8').trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export function resolveHostId(dataDir: string, provided?: string): string {
  const existing = readPersistedHostId(dataDir);
  if (existing) {
    if (provided && provided !== existing) {
      throw new Error(`Configured host id ${provided} does not match persisted host id ${existing}`);
    }
    return existing;
  }
  return provided ?? randomUUID();
}

/** Call only after enroll succeeds. Writing first strands a failed enroll. */
export function persistHostId(dataDir: string, hostId: string): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const path = join(dataDir, HOST_ID_FILE_NAME);
  try {
    writeFileSync(path, `${hostId}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  const raced = readPersistedHostId(dataDir);
  if (!raced) throw new Error(`Failed to initialize host id at ${path}`);
  if (raced !== hostId) {
    throw new Error(`Persisted host id ${raced} does not match resolved host id ${hostId}`);
  }
}

export function detectHostName(): string {
  return hostname() || 'zcc-host';
}
