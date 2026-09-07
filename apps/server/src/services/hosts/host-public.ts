import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { RemoteStartPathHost } from '@zana-ai/zcc-domain/project';
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
    sshHost: row.sshHost,
    defaultWorkspacePath: row.defaultWorkspacePath,
    homeDir: row.homeDir,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

export function toRemoteStartPathHost(row: HostRow): RemoteStartPathHost {
  return {
    id: row.id,
    name: row.name,
    isPrimary: row.isPrimary,
    sshHost: row.sshHost,
    defaultWorkspacePath: row.defaultWorkspacePath,
    homeDir: row.homeDir
  };
}

export function listPublicHosts(db: ZccDatabase, hub: HostHub): Host[] {
  const connected = new Set(hub.connectedHostIds());
  return listHosts(db).map((row) => toPublicHost(row, connected));
}

export type HostUpdatePatch = {
  name?: string;
  defaultWorkspacePath?: string | null;
};

/**
 * Validate a per-machine workspace path. Empty/null clears it. Non-empty values
 * must be absolute POSIX paths (same length / control-char guard as remotePath).
 */
export function sanitizeDefaultWorkspacePath(value: string | null | undefined): string | null {
  const trimmed = (value ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > 256) throw new Error('defaultWorkspacePath too long (max 256)');
  for (let i = 0; i < trimmed.length; i++) {
    const code = trimmed.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      throw new Error('defaultWorkspacePath contains control characters');
    }
  }
  if (!trimmed.startsWith('/')) {
    throw new Error('defaultWorkspacePath must be an absolute path');
  }
  return trimmed;
}

export function parseHostUpdate(body: unknown): HostUpdatePatch | null {
  const parsed = updateHostRequestSchema.safeParse(body);
  if (!parsed.success) return null;
  const patch: HostUpdatePatch = {};
  if (parsed.data.name !== undefined) patch.name = parsed.data.name;
  if (parsed.data.defaultWorkspacePath !== undefined) {
    try {
      patch.defaultWorkspacePath = sanitizeDefaultWorkspacePath(parsed.data.defaultWorkspacePath);
    } catch {
      return null;
    }
  }
  return patch;
}

/** @deprecated use parseHostUpdate */
export function parseHostRename(body: unknown): string | null {
  return parseHostUpdate(body)?.name ?? null;
}
