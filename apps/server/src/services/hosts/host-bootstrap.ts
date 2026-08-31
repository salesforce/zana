import {
  findHostBySsh,
  getHost,
  getPrimaryHost,
  updateHostSshIdentity,
  type HostRow
} from '@zana-ai/zcc-db';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { isLoopbackHttpHost } from '../../browser-bootstrap.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HostUnavailableError } from '../../http/host-hub.js';
import { resolvePublicAppUrl } from '../../http/public-app-url.js';
import { pairingSessionServerUrl, relayJoinWindowOpen } from '../../http/pairing-session-url.js';
import { resolveHostArtifact } from './host-artifact.js';
import type { ProjectRecord } from '../../project-store.js';

const PEER_RPC_TIMEOUT_MS = 4 * 60_000;
const CONNECT_WAIT_MS = 90_000;

export type HostBootstrapEvent =
  | { type: 'log'; text: string }
  | { type: 'done'; hostId: string }
  | { type: 'error'; code: string; message: string; pairingCommand?: string };

export class HostBootstrapError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly pairingCommand?: string
  ) {
    super(message);
    this.name = 'HostBootstrapError';
  }
}

function sanitizeSshField(value: string | undefined, field: string, required = false): string | undefined {
  const trimmed = (value ?? '').trim();
  if (!trimmed) {
    if (required) throw new HostBootstrapError('invalid_ssh', `${field} is required`);
    return undefined;
  }
  if (trimmed.length > 256) throw new HostBootstrapError('invalid_ssh', `${field} is too long`);
  if (trimmed.startsWith('-')) throw new HostBootstrapError('invalid_ssh', `${field} cannot start with '-'`);
  for (const char of trimmed) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) throw new HostBootstrapError('invalid_ssh', `${field} contains control characters`);
  }
  return trimmed;
}

export function sshRemoteFromHost(row: HostRow): ProjectRemote | null {
  if (!row.sshHost) return null;
  const remote: ProjectRemote = { host: row.sshHost };
  if (row.sshUser) remote.user = row.sshUser;
  if (row.sshProxyJump) remote.proxyJump = row.sshProxyJump;
  return remote;
}

export function sshRemoteFromProject(project: ProjectRecord): ProjectRemote | null {
  const remote = project.remote;
  if (!remote || typeof remote !== 'object') return null;
  const rec = remote as Record<string, unknown>;
  if (typeof rec.host !== 'string' || rec.host.length === 0) return null;
  const parsed: ProjectRemote = { host: rec.host };
  if (typeof rec.user === 'string' && rec.user.length > 0) parsed.user = rec.user;
  if (typeof rec.proxyJump === 'string' && rec.proxyJump.length > 0) parsed.proxyJump = rec.proxyJump;
  if (typeof rec.remotePath === 'string' && rec.remotePath.length > 0) parsed.remotePath = rec.remotePath;
  return parsed;
}

export function requirePublicAppUrl(ctx: ProductHttpContext): string {
  const url = resolvePublicAppUrl();
  if (!url) {
    throw new HostBootstrapError(
      'public_url_required',
      'Set ZCC_APP_URL (or build the app with it) before installing a remote host daemon.'
    );
  }
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new HostBootstrapError('public_url_required', 'Public app URL is invalid.');
  }
  if (isLoopbackHttpHost(hostname)) {
    throw new HostBootstrapError(
      'public_url_required',
      'A loopback address cannot enroll another computer. Set ZCC_APP_URL to a public origin first.'
    );
  }
  if (ctx.pairingRelay?.state() === 'offline') {
    throw new HostBootstrapError(
      'relay_offline',
      'The pairing relay is offline. Keep Zana running so remotes can reach this machine.'
    );
  }
  if (ctx.pairingRelay?.state() === 'connected') {
    const snapshot = ctx.pairingRelay.snapshot();
    if (!relayJoinWindowOpen(snapshot)) {
      throw new HostBootstrapError(
        'join_expired',
        'The pairing join window has closed. Reopen Add a machine so this laptop can renew the window, then try again.'
      );
    }
    return pairingSessionServerUrl(url, snapshot.sessionId!);
  }
  return url;
}

function requirePrimaryHost(ctx: ProductHttpContext): HostRow {
  const primary = getPrimaryHost(ctx.db);
  if (!primary) throw new HostBootstrapError('primary_disconnected', 'This machine’s host daemon is not connected.');
  try {
    ctx.hostHub.ensureHostSessionReady(primary.id);
  } catch (error) {
    if (error instanceof HostUnavailableError) {
      throw new HostBootstrapError('primary_disconnected', 'This machine’s host daemon is not connected.');
    }
    throw error;
  }
  return primary;
}

function pairingCommand(server: string, joinCode: string, hostId: string): string {
  return (
    `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${server}/install.sh` +
    ` | sh -s -- --join-code ${joinCode} --host-id ${hostId} --server ${server}`
  );
}

export type HostBootstrapPlan =
  | { kind: 'install' }
  | { kind: 'bind'; hostId: string }
  | { kind: 'repair'; hostId: string };

export function resolveHostBootstrapPlan(input: {
  existing: { id: string; isPrimary: boolean } | null;
  connected: boolean;
}): HostBootstrapPlan {
  const existing = input.existing;
  if (!existing || existing.isPrimary) return { kind: 'install' };
  if (input.connected) return { kind: 'bind', hostId: existing.id };
  return { kind: 'repair', hostId: existing.id };
}

/**
 * A websocket-connected daemon can still be running a stale join.mjs.
 * Restart-only cannot replace that file, so Fix always reinstalls unless a
 * disconnected daemon comes back after a plain restart.
 */
export function resolveRepairPlan(
  state: 'connected' | 'disconnected' | 'not_installed'
): 'install' | 'restart' {
  return state === 'disconnected' ? 'restart' : 'install';
}

function executionPath(remote: ProjectRemote, homeDir: string | null): string {
  if (remote.remotePath && remote.remotePath.startsWith('/')) return remote.remotePath;
  if (homeDir && homeDir.startsWith('/')) return homeDir;
  throw new HostBootstrapError('path_unknown', 'Could not determine a path on the remote machine.');
}

async function installPeer(
  ctx: ProductHttpContext,
  input: {
    remote: ProjectRemote;
    joinCode: string;
    hostId: string;
    serverUrl: string;
    events: HostBootstrapEvent[];
  }
): Promise<void> {
  const primary = requirePrimaryHost(ctx);
  const artifact = resolveHostArtifact();
  input.events.push({ type: 'log', text: 'Installing host daemon over SSH…' });
  const result = await ctx.hostHub.callHostOnlineRpc<{ ok: true; log: string }>({
    hostId: primary.id,
    timeoutMs: PEER_RPC_TIMEOUT_MS,
    command: {
      type: 'peer_daemon.install',
      remote: {
        host: input.remote.host,
        ...(input.remote.user ? { user: input.remote.user } : {}),
        ...(input.remote.proxyJump ? { proxyJump: input.remote.proxyJump } : {})
      },
      joinCode: input.joinCode,
      hostId: input.hostId,
      serverUrl: input.serverUrl,
      artifactPath: artifact.tarballPath
    }
  });
  if (result.log.trim()) input.events.push({ type: 'log', text: result.log.trim() });
  input.events.push({ type: 'log', text: 'Waiting for the remote daemon to connect…' });
  await ctx.hostHub.waitUntilConnected(input.hostId, CONNECT_WAIT_MS);
}

async function bindRemoteProject(
  ctx: ProductHttpContext,
  input: {
    projectId: string;
    remote: ProjectRemote;
    hostId: string;
    events: HostBootstrapEvent[];
  }
): Promise<void> {
  const host = getHost(ctx.db, input.hostId);
  const path = executionPath(input.remote, host?.homeDir ?? null);
  await ctx.projects.bindToHost(input.projectId, { hostId: input.hostId, path });
  ctx.hub.emit('projects:changed', ctx.projects.list());
  ctx.hub.emit('hosts:changed', undefined);
  input.events.push({ type: 'done', hostId: input.hostId });
}

export async function bootstrapHostForProject(
  ctx: ProductHttpContext,
  projectId: string
): Promise<HostBootstrapEvent[]> {
  const events: HostBootstrapEvent[] = [];
  try {
    const project = ctx.projects.list().find((row) => row.id === projectId);
    if (!project) throw new HostBootstrapError('unknown_project', 'Project not found.');
    const remote = sshRemoteFromProject(project);
    if (!remote) throw new HostBootstrapError('not_remote_project', 'This project is not an SSH remote.');
    const existing = findHostBySsh(ctx.db, {
      host: remote.host,
      ...(remote.user ? { user: remote.user } : {})
    });
    const connected = Boolean(existing && ctx.hostHub.connectedHostIds().includes(existing.id));
    const plan = resolveHostBootstrapPlan({ existing, connected });
    if (plan.kind === 'bind') {
      events.push({ type: 'log', text: 'Reusing the enrolled daemon for this SSH host…' });
      await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: plan.hostId, events });
      return events;
    }
    if (plan.kind === 'repair') {
      const repaired = await repairHost(ctx, plan.hostId);
      events.push(...repaired);
      if (repaired.some((event) => event.type === 'error')) return events;
      events.push({ type: 'log', text: 'Binding this project to the enrolled machine…' });
      await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: plan.hostId, events });
      return events;
    }
    const serverUrl = requirePublicAppUrl(ctx);
    const issued = ctx.joinCodes.mint();
    const command = pairingCommand(serverUrl, issued.joinCode, issued.hostId);
    try {
      await installPeer(ctx, {
        remote,
        joinCode: issued.joinCode,
        hostId: issued.hostId,
        serverUrl,
        events
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HostBootstrapError(
        error instanceof HostBootstrapError ? error.code : 'install_failed',
        message,
        command
      );
    }
    const host = getHost(ctx.db, issued.hostId);
    if (host) {
      updateHostSshIdentity(ctx.db, host.id, {
        host: remote.host,
        user: remote.user,
        proxyJump: remote.proxyJump
      });
    }
    await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: issued.hostId, events });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      events.push({
        type: 'error',
        code: error.code,
        message: error.message,
        ...(error.pairingCommand ? { pairingCommand: error.pairingCommand } : {})
      });
      return events;
    }
    throw error;
  }
}

export async function repairHost(
  ctx: ProductHttpContext,
  hostId: string
): Promise<HostBootstrapEvent[]> {
  const events: HostBootstrapEvent[] = [];
  try {
    const host = getHost(ctx.db, hostId);
    if (!host || host.destroyedAt) throw new HostBootstrapError('unknown_host', 'Host not found.');
    if (host.isPrimary) throw new HostBootstrapError('primary_host', 'This machine is already the primary host.');
    const remote = sshRemoteFromHost(host);
    if (!remote) {
      throw new HostBootstrapError(
        'ssh_identity_required',
        'Pick an SSH host so Zana can reconnect this machine.'
      );
    }
    const serverUrl = requirePublicAppUrl(ctx);
    const serverHost = new URL(serverUrl).hostname;
    const primary = requirePrimaryHost(ctx);
    events.push({ type: 'log', text: 'Checking the remote host daemon…' });
    const status = await ctx.hostHub.callHostOnlineRpc<{
      state: 'connected' | 'disconnected' | 'not_installed';
      message?: string;
    }>({
      hostId: primary.id,
      command: {
        type: 'peer_daemon.status',
        remote: {
          host: remote.host,
          ...(remote.user ? { user: remote.user } : {}),
          ...(remote.proxyJump ? { proxyJump: remote.proxyJump } : {})
        },
        serverHost
      }
    });
    if (resolveRepairPlan(status.state) === 'restart') {
      events.push({ type: 'log', text: 'Restarting the remote host daemon…' });
      try {
        const restarted = await ctx.hostHub.callHostOnlineRpc<{ ok: true; log: string }>({
          hostId: primary.id,
          timeoutMs: PEER_RPC_TIMEOUT_MS,
          command: {
            type: 'peer_daemon.restart',
            remote: {
              host: remote.host,
              ...(remote.user ? { user: remote.user } : {}),
              ...(remote.proxyJump ? { proxyJump: remote.proxyJump } : {})
            },
            serverHost
          }
        });
        if (restarted.log.trim()) events.push({ type: 'log', text: restarted.log.trim() });
        await ctx.hostHub.waitUntilConnected(hostId, CONNECT_WAIT_MS);
        events.push({ type: 'done', hostId });
        return events;
      } catch {
        events.push({ type: 'log', text: 'Restart did not reconnect; reinstalling…' });
      }
    } else {
      events.push({ type: 'log', text: 'Installing a fresh host-daemon artifact…' });
    }
    const issued = ctx.joinCodes.mintForHost(hostId);
    const command = pairingCommand(serverUrl, issued.joinCode, issued.hostId);
    try {
      await installPeer(ctx, {
        remote,
        joinCode: issued.joinCode,
        hostId: issued.hostId,
        serverUrl,
        events
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HostBootstrapError(
        error instanceof HostBootstrapError ? error.code : 'install_failed',
        message,
        command
      );
    }
    updateHostSshIdentity(ctx.db, hostId, {
      host: remote.host,
      user: remote.user,
      proxyJump: remote.proxyJump
    });
    ctx.hub.emit('hosts:changed', undefined);
    events.push({ type: 'done', hostId });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      events.push({
        type: 'error',
        code: error.code,
        message: error.message,
        ...(error.pairingCommand ? { pairingCommand: error.pairingCommand } : {})
      });
      return events;
    }
    throw error;
  }
}

export function parseSshIdentity(body: unknown): { host: string; user?: string; proxyJump?: string } {
  if (!body || typeof body !== 'object') {
    throw new HostBootstrapError('invalid_ssh', 'SSH identity is required');
  }
  const rec = body as Record<string, unknown>;
  const host = sanitizeSshField(typeof rec.host === 'string' ? rec.host : undefined, 'host', true)!;
  const user = sanitizeSshField(typeof rec.user === 'string' ? rec.user : undefined, 'user');
  const proxyJump = sanitizeSshField(typeof rec.proxyJump === 'string' ? rec.proxyJump : undefined, 'proxyJump');
  return { host, ...(user ? { user } : {}), ...(proxyJump ? { proxyJump } : {}) };
}
