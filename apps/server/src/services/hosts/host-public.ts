import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import { listHosts, type HostRow, type ZccDatabase } from '@zana-ai/zcc-db';
import { updateHostRequestSchema } from '@zana-ai/zcc-server-contract';
import type { HostHub } from '../../http/host-hub.js';

export function toPublicHost(row: HostRow, connectedHostIds: ReadonlySet<string>): Host {
  return {
    id: row.id,
    name: row.name,
    type: row.type === 'persistent' ? 'persistent' : 'persistent',
    status: connectedHostIds.has(row.id) ? 'connected' : 'disconnected',
    maxPermissionMode: row.maxPermissionMode,
    lastSeenAt: row.lastSeenAt,
    lastRejectedProtocolVersion: row.lastRejectedProtocolVersion,
    isPrimary: row.isPrimary,
    canRepairViaSsh: Boolean(row.sshHost),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function listPublicHosts(db: ZccDatabase, hub: HostHub): Host[] {
  const connected = new Set(hub.connectedHostIds());
  return listHosts(db).map((row) => toPublicHost(row, connected));
}

export function parseHostRename(body: unknown): string | null {
  const parsed = updateHostRequestSchema.safeParse(body);
  return parsed.success ? parsed.data.name : null;
}
