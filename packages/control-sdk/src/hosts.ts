import type { ProductHttpClient } from './http.js';

export interface HostRecord {
  id: string;
  name?: string;
  status?: string;
  isPrimary?: boolean;
}

export function parseHostList(listed: unknown): HostRecord[] {
  const rows = Array.isArray(listed)
    ? listed
    : listed && typeof listed === 'object' && Array.isArray((listed as { hosts?: unknown[] }).hosts)
      ? (listed as { hosts: unknown[] }).hosts
      : [];
  const hosts: HostRecord[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const name = (row as { name?: unknown }).name;
    const status = (row as { status?: unknown }).status;
    const isPrimary = (row as { isPrimary?: unknown }).isPrimary;
    hosts.push({
      id,
      ...(typeof name === 'string' ? { name } : {}),
      ...(typeof status === 'string' ? { status } : {}),
      ...(typeof isPrimary === 'boolean' ? { isPrimary } : {})
    });
  }
  return hosts;
}

export function hostIsConnected(row: HostRecord): boolean {
  return row.status === 'connected' || row.status === 'online';
}

export async function listHosts(http: ProductHttpClient): Promise<HostRecord[]> {
  return parseHostList(await http.request<unknown>('GET', '/api/v1/hosts'));
}

export function pickConnectedHost(hosts: HostRecord[], hostId?: string): HostRecord | null {
  const connected = hosts.filter(hostIsConnected);
  if (hostId) return connected.find((row) => row.id === hostId) ?? null;
  return connected.find((row) => row.isPrimary) ?? connected[0] ?? null;
}
