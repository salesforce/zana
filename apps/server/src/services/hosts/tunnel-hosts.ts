import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getHost, getPrimaryHost, type HostRow } from '@zana-ai/zcc-db';
import type { PeerTunnelCloseResult, PeerTunnelOpenResult } from '@zana-ai/zcc-contracts/host-rpc';
import type { ProductHttpContext } from '../../http/product-context.js';
import type { HostBootstrapEvent } from './host-bootstrap.js';

/** One entry per enrolled machine; the host table caps how many there can be. */
const MAX_ENTRIES = 256;
const PORT_UNAVAILABLE_CODE = 'peer_tunnel_port_unavailable';

export interface TunnelHostEntry {
  hostId: string;
  remotePort: number;
}

export interface TunnelHostStore {
  get(hostId: string): TunnelHostEntry | null;
  list(): TunnelHostEntry[];
  record(hostId: string, remotePort: number): void;
  remove(hostId: string): void;
}

function validPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535;
}

export function tunnelHostsFile(dataDir: string): string {
  return join(dataDir, 'tunnel-hosts.json');
}

/**
 * Remote ports of machines that reach this server through a primary-owned SSH
 * tunnel. Every read-modify-write is synchronous, so writes in this process are
 * serialized; each write lands through a uniquely named temp file and rename.
 * Entries for removed machines are dropped whenever the file is read.
 */
export function createTunnelHostStore(
  filePath: string,
  isLiveHost: (hostId: string) => boolean
): TunnelHostStore {
  const read = (): Map<string, number> => {
    const entries = new Map<string, number>();
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    } catch {
      return entries;
    }
    const hosts = parsed && typeof parsed === 'object' ? (parsed as { hosts?: unknown }).hosts : undefined;
    if (!hosts || typeof hosts !== 'object') return entries;
    for (const [hostId, value] of Object.entries(hosts as Record<string, unknown>)) {
      const remotePort = value && typeof value === 'object' ? (value as { remotePort?: unknown }).remotePort : undefined;
      if (entries.size >= MAX_ENTRIES) break;
      if (validPort(remotePort) && isLiveHost(hostId)) entries.set(hostId, remotePort);
    }
    return entries;
  };
  const write = (entries: Map<string, number>): void => {
    const hosts: Record<string, { remotePort: number }> = {};
    for (const [hostId, remotePort] of entries) hosts[hostId] = { remotePort };
    mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
    const temp = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, `${JSON.stringify({ version: 1, hosts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
      renameSync(temp, filePath);
    } catch (error) {
      try { unlinkSync(temp); } catch { /* never created, or already renamed */ }
      throw error;
    }
  };
  const update = (change: (entries: Map<string, number>) => void): void => {
    const entries = read();
    change(entries);
    write(entries);
  };
  return {
    get(hostId) {
      const remotePort = read().get(hostId);
      return remotePort === undefined ? null : { hostId, remotePort };
    },
    list() {
      return [...read()].map(([hostId, remotePort]) => ({ hostId, remotePort }));
    },
    record(hostId, remotePort) {
      if (!validPort(remotePort)) throw new Error('Invalid tunnel port');
      update((entries) => {
        entries.delete(hostId);
        if (entries.size < MAX_ENTRIES) entries.set(hostId, remotePort);
      });
    },
    remove(hostId) {
      update((entries) => { entries.delete(hostId); });
    }
  };
}

export function createDbTunnelHostStore(ctx: Pick<ProductHttpContext, 'db' | 'dataDir'>): TunnelHostStore {
  return createTunnelHostStore(tunnelHostsFile(ctx.dataDir), (hostId) => {
    const host = getHost(ctx.db, hostId);
    return Boolean(host && !host.destroyedAt && !host.isPrimary);
  });
}

function sshRemote(host: HostRow): { host: string; user?: string; proxyJump?: string } | null {
  if (!host.sshHost) return null;
  return {
    host: host.sshHost,
    ...(host.sshUser ? { user: host.sshUser } : {}),
    ...(host.sshProxyJump ? { proxyJump: host.sshProxyJump } : {})
  };
}

function errorCode(error: unknown): string | undefined {
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : undefined;
}

const CLOSE_TIMEOUT_MS = 5_000;

/**
 * Stop the primary's SSH tunnel for a machine being removed, then forget it.
 * Best effort: an offline primary drops every tunnel when it shuts down, and
 * the removed machine's key is already revoked.
 */
export async function closeTunnelHost(
  ctx: Pick<ProductHttpContext, 'db' | 'hostHub' | 'tunnelHosts'>,
  host: HostRow,
  log?: (text: string) => void
): Promise<void> {
  const store = ctx.tunnelHosts;
  if (!store) return;
  const entry = (() => { try { return store.get(host.id); } catch { return null; } })();
  const remote = sshRemote(host);
  const primary = getPrimaryHost(ctx.db);
  if (entry && remote && primary && primary.id !== host.id) {
    try {
      await ctx.hostHub.callHostOnlineRpc<PeerTunnelCloseResult>({
        hostId: primary.id,
        command: { type: 'peer_tunnel.close', remote },
        timeoutMs: CLOSE_TIMEOUT_MS
      });
    } catch {
      log?.(`SSH tunnel for ${host.name} did not close; it stops when this app's machine restarts`);
    }
  }
  try { store.remove(host.id); } catch { /* pruned on the next read */ }
}

export interface TunnelReopenDeps {
  store: TunnelHostStore;
  localPort: () => number;
  /** Full reinstall: picks a fresh remote port and rewrites the machine's server URL. */
  repair: (hostId: string) => Promise<HostBootstrapEvent[]>;
  log?: (text: string) => void;
}

/**
 * Reopen every stored tunnel through the primary with the server's current
 * local port. A remote port that is now taken falls back to a reinstall.
 */
export async function reopenTunnelHosts(
  ctx: Pick<ProductHttpContext, 'db' | 'hostHub'>,
  deps: TunnelReopenDeps,
  isCancelled: () => boolean = () => false
): Promise<void> {
  const primary = getPrimaryHost(ctx.db);
  if (!primary) return;
  for (const entry of deps.store.list()) {
    if (isCancelled()) return;
    const host = getHost(ctx.db, entry.hostId);
    const remote = host ? sshRemote(host) : null;
    if (!host || !remote) {
      deps.store.remove(entry.hostId);
      continue;
    }
    try {
      await ctx.hostHub.callHostOnlineRpc<PeerTunnelOpenResult>({
        hostId: primary.id,
        command: { type: 'peer_tunnel.open', remote, localPort: deps.localPort(), remotePort: entry.remotePort }
      });
    } catch (error) {
      if (isCancelled()) return;
      if (errorCode(error) !== PORT_UNAVAILABLE_CODE) {
        deps.log?.(`SSH tunnel for ${host.name} did not reopen; it will retry when the primary reconnects`);
        continue;
      }
      deps.log?.(`Remote port for ${host.name} is taken; reinstalling over a new SSH tunnel`);
      const events = await deps.repair(entry.hostId).catch(() => [{ type: 'error' } as HostBootstrapEvent]);
      const failed = events.some((event) => event.type === 'error');
      if (failed) deps.log?.(`Reinstalling ${host.name} over SSH failed`);
      // A reinstall that switched to another route leaves this port unused.
      else if (deps.store.get(entry.hostId)?.remotePort === entry.remotePort) deps.store.remove(entry.hostId);
    }
  }
}

export interface TunnelHostReopener {
  hostConnected(hostId: string): void;
  dispose(): void;
}

/**
 * Reacts to the primary's (re)connection. One pass runs at a time; a connect
 * during a pass schedules exactly one more so the newest local port wins.
 */
export function createTunnelHostReopener(
  ctx: () => Pick<ProductHttpContext, 'db' | 'hostHub'> | undefined,
  deps: TunnelReopenDeps
): TunnelHostReopener {
  let disposed = false;
  let running: Promise<void> | null = null;
  let again = false;
  const run = (): void => {
    const current = ctx();
    if (disposed || !current) return;
    running = reopenTunnelHosts(current, deps, () => disposed)
      .catch(() => { deps.log?.('Reopening SSH tunnels failed'); })
      .finally(() => {
        running = null;
        if (again && !disposed) { again = false; run(); }
      });
  };
  return {
    hostConnected(hostId) {
      const current = ctx();
      if (disposed || !current || getPrimaryHost(current.db)?.id !== hostId) return;
      if (running) { again = true; return; }
      run();
    },
    dispose() {
      disposed = true;
      again = false;
    }
  };
}
