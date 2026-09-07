import {
  findHostBySsh,
  getHost,
  getPrimaryHost,
  updateHostSshIdentity,
  type HostRow
} from '@zana-ai/zcc-db';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { sshPairingCommand } from '@zana-ai/zcc-domain/machine-pairing';
import { isLoopbackHttpHost } from '../../browser-bootstrap.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HostUnavailableError } from '../../http/host-hub.js';
import { resolvePublicAppUrl } from '../../http/public-app-url.js';
import { isRelaySessionId, pairingSessionServerUrl, relayJoinWindowOpen } from '../../http/pairing-session-url.js';
import { serverPortFromEnv } from '../../http/ports.js';
import { resolveHostArtifact } from './host-artifact.js';
import type { ProjectRecord } from '../../project-store.js';
import type { PeerDaemonStatusResult } from '@zana-ai/zcc-contracts/host-rpc';

const PEER_HOST_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Reuse the id already on the machine so a retry does not mint a conflicting host. */
export function reuseRemoteHostId(hostId: string | null | undefined): string | null {
  if (typeof hostId !== 'string') return null;
  const trimmed = hostId.trim();
  return PEER_HOST_ID_RE.test(trimmed) ? trimmed : null;
}

const PEER_RPC_TIMEOUT_MS = 4 * 60_000;
const CONNECT_WAIT_MS = 90_000;
const CONNECT_WAIT_TICK_MS = 15_000;
const DAEMON_UNRESPONSIVE_RE =
  /did not report connected|did not connect|service-managed daemon did not report connected/i;

export const PAIRING_DOOR_ERROR =
  'Could not reach the pairing door. Retry, or copy the SSH command.';

export const DAEMON_UNRESPONSIVE_ERROR =
  'The host daemon started but never connected back. Retry, or copy the SSH command.';

type HostBootstrapListener = (event: HostBootstrapEvent) => void;

function createEventSink(onEvent?: HostBootstrapListener) {
  const events: HostBootstrapEvent[] = [];
  const emit = (event: HostBootstrapEvent) => {
    events.push(event);
    onEvent?.(event);
  };
  const absorb = (extra: HostBootstrapEvent[]) => {
    events.push(...extra);
  };
  return { events, emit, absorb };
}

export function installFailureLogLines(message: string): string[] {
  return message
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+$/u, ''))
    .filter((line) => line.length > 0);
}

export function classifyInstallFailure(error: unknown): { code: string; message: string } {
  if (error instanceof HostBootstrapError) {
    return { code: error.code, message: error.message };
  }
  const message = error instanceof Error ? error.message : String(error);
  if (DAEMON_UNRESPONSIVE_RE.test(message)) {
    return { code: 'daemon_unresponsive', message: DAEMON_UNRESPONSIVE_ERROR };
  }
  return { code: 'install_failed', message };
}

export async function waitForPeerConnect(
  wait: (timeoutMs: number) => Promise<void>,
  emit: HostBootstrapListener,
  options?: { timeoutMs?: number; tickMs?: number; now?: () => number }
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? CONNECT_WAIT_MS;
  const tickMs = options?.tickMs ?? CONNECT_WAIT_TICK_MS;
  const now = options?.now ?? Date.now;
  emit({ type: 'log', text: 'Waiting for the remote daemon to connect…' });
  const started = now();
  for (;;) {
    const elapsed = now() - started;
    const remaining = timeoutMs - elapsed;
    if (remaining <= 0) {
      throw new HostUnavailableError('host did not connect');
    }
    try {
      await wait(Math.min(tickMs, remaining));
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!DAEMON_UNRESPONSIVE_RE.test(message)) throw error;
      const nextElapsed = now() - started;
      if (nextElapsed >= timeoutMs) throw error;
      emit({
        type: 'log',
        text: `Still waiting for the remote daemon… ${Math.round(nextElapsed / 1000)}s`
      });
    }
  }
}

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

export async function requirePublicAppUrl(ctx: ProductHttpContext): Promise<string> {
  const url = resolvePublicAppUrl({
    configUrl: ctx.config.getConfig().publicAppUrl
  });
  if (!url) {
    throw new HostBootstrapError(
      'public_url_required',
      'Set a public app URL before installing a remote host daemon.'
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
      'A loopback address cannot enroll another computer. Set a public app URL first.'
    );
  }
  if (ctx.pairingRelay?.state() === 'offline') {
    throw new HostBootstrapError('relay_offline', PAIRING_DOOR_ERROR);
  }
  if (ctx.pairingRelay?.state() === 'connected') {
    let snapshot = ctx.pairingRelay.snapshot();
    if (!isRelaySessionId(snapshot.sessionId) || !relayJoinWindowOpen(snapshot)) {
      try {
        snapshot = await ctx.pairingRelay.renewJoinWindow();
      } catch {
        snapshot = ctx.pairingRelay.snapshot();
      }
    }
    if (!isRelaySessionId(snapshot.sessionId)) {
      throw new HostBootstrapError('relay_offline', PAIRING_DOOR_ERROR);
    }
    return pairingSessionServerUrl(url, snapshot.sessionId);
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

export function sshFallbackPairingCommand(input: {
  sshHost: string;
  joinCode: string;
  hostId: string;
  listenPort: number;
}): string | undefined {
  return sshPairingCommand({
    sshHost: input.sshHost,
    localServerUrl: `http://127.0.0.1:${input.listenPort}`,
    joinCode: input.joinCode,
    hostId: input.hostId
  }) ?? undefined;
}

export function attachSshFallbackPairingCommand(
  error: HostBootstrapError,
  ctx: ProductHttpContext,
  remote: ProjectRemote | null,
  hostId?: string
): HostBootstrapError {
  if (error.code !== 'join_expired' && error.code !== 'relay_offline' && error.code !== 'daemon_unresponsive') {
    return error;
  }
  if (error.pairingCommand && error.code !== 'daemon_unresponsive') return error;
  if (!remote) return error;
  try {
    const issued = hostId ? ctx.joinCodes.mintForHost(hostId) : ctx.joinCodes.mint();
    const command = sshFallbackPairingCommand({
      sshHost: remote.host,
      joinCode: issued.joinCode,
      hostId: issued.hostId,
      listenPort: serverPortFromEnv()
    });
    if (!command) return error;
    return new HostBootstrapError(error.code, error.message, command);
  } catch {
    return error;
  }
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

function emitLogLines(emit: HostBootstrapListener, text: string): void {
  for (const line of installFailureLogLines(text)) {
    emit({ type: 'log', text: line });
  }
}

async function issueJoinCodeForRemote(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  serverUrl: string,
  emit: HostBootstrapListener
): Promise<{ joinCode: string; hostId: string }> {
  try {
    const serverHost = new URL(serverUrl).hostname;
    const primary = requirePrimaryHost(ctx);
    const status = await ctx.hostHub.callHostOnlineRpc<PeerDaemonStatusResult>({
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
    const reuse = reuseRemoteHostId(status.hostId);
    if (reuse) {
      emit({ type: 'log', text: 'Reusing the host id already on that machine…' });
      return ctx.joinCodes.mintForHost(reuse);
    }
  } catch {
    /* First install, or the identity probe failed — mint a new host id. */
  }
  return ctx.joinCodes.mint();
}

async function installPeer(
  ctx: ProductHttpContext,
  input: {
    remote: ProjectRemote;
    joinCode: string;
    hostId: string;
    serverUrl: string;
    emit: HostBootstrapListener;
  }
): Promise<void> {
  const primary = requirePrimaryHost(ctx);
  const artifact = resolveHostArtifact();
  input.emit({ type: 'log', text: 'Installing host daemon over SSH…' });
  try {
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
    if (result.log.trim()) emitLogLines(input.emit, result.log.trim());
    await waitForPeerConnect(
      (timeoutMs) => ctx.hostHub.waitUntilConnected(input.hostId, timeoutMs),
      input.emit
    );
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    emitLogLines(input.emit, raw);
    const classified = classifyInstallFailure(error);
    throw new HostBootstrapError(classified.code, classified.message);
  }
}

async function bindRemoteProject(
  ctx: ProductHttpContext,
  input: {
    projectId: string;
    remote: ProjectRemote;
    hostId: string;
    emit: HostBootstrapListener;
  }
): Promise<void> {
  const host = getHost(ctx.db, input.hostId);
  const path = executionPath(input.remote, host?.homeDir ?? null);
  await ctx.projects.bindToHost(input.projectId, { hostId: input.hostId, path });
  ctx.hub.emit('projects:changed', ctx.projects.list());
  ctx.hub.emit('hosts:changed', undefined);
  input.emit({ type: 'done', hostId: input.hostId });
}

function pairingCommandForFailure(code: string, command: string): string | undefined {
  return code === 'daemon_unresponsive' ? undefined : command;
}

function emitBootstrapError(
  emit: HostBootstrapListener,
  error: HostBootstrapError,
  ctx: ProductHttpContext,
  remote: ProjectRemote | null,
  hostId?: string
): void {
  const enriched = attachSshFallbackPairingCommand(error, ctx, remote, hostId);
  emit({
    type: 'error',
    code: enriched.code,
    message: enriched.message,
    ...(enriched.pairingCommand ? { pairingCommand: enriched.pairingCommand } : {})
  });
}

export async function bootstrapHostForProject(
  ctx: ProductHttpContext,
  projectId: string,
  onEvent?: HostBootstrapListener
): Promise<HostBootstrapEvent[]> {
  const { events, emit, absorb } = createEventSink(onEvent);
  let remote: ProjectRemote | null = null;
  try {
    const project = ctx.projects.list().find((row) => row.id === projectId);
    if (!project) throw new HostBootstrapError('unknown_project', 'Project not found.');
    remote = sshRemoteFromProject(project);
    if (!remote) throw new HostBootstrapError('not_remote_project', 'This project is not an SSH remote.');
    const existing = findHostBySsh(ctx.db, {
      host: remote.host,
      ...(remote.user ? { user: remote.user } : {})
    });
    const connected = Boolean(existing && ctx.hostHub.connectedHostIds().includes(existing.id));
    const plan = resolveHostBootstrapPlan({ existing, connected });
    if (plan.kind === 'bind') {
      emit({ type: 'log', text: 'Reusing the enrolled daemon for this SSH host…' });
      await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: plan.hostId, emit });
      return events;
    }
    if (plan.kind === 'repair') {
      absorb(await repairHost(ctx, plan.hostId, onEvent));
      if (events.some((event) => event.type === 'error')) return events;
      emit({ type: 'log', text: 'Binding this project to the enrolled machine…' });
      await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: plan.hostId, emit });
      return events;
    }
    const serverUrl = await requirePublicAppUrl(ctx);
    const issued = await issueJoinCodeForRemote(ctx, remote, serverUrl, emit);
    const command = pairingCommand(serverUrl, issued.joinCode, issued.hostId);
    try {
      await installPeer(ctx, {
        remote,
        joinCode: issued.joinCode,
        hostId: issued.hostId,
        serverUrl,
        emit
      });
    } catch (error) {
      const classified = classifyInstallFailure(error);
      throw new HostBootstrapError(
        classified.code,
        classified.message,
        pairingCommandForFailure(classified.code, command)
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
    await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: issued.hostId, emit });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      emitBootstrapError(emit, error, ctx, remote);
      return events;
    }
    throw error;
  }
}

export async function repairHost(
  ctx: ProductHttpContext,
  hostId: string,
  onEvent?: HostBootstrapListener
): Promise<HostBootstrapEvent[]> {
  const { events, emit } = createEventSink(onEvent);
  let remote: ProjectRemote | null = null;
  try {
    const host = getHost(ctx.db, hostId);
    if (!host || host.destroyedAt) throw new HostBootstrapError('unknown_host', 'Host not found.');
    if (host.isPrimary) throw new HostBootstrapError('primary_host', 'This machine is already the primary host.');
    remote = sshRemoteFromHost(host);
    if (!remote) {
      throw new HostBootstrapError(
        'ssh_identity_required',
        'Pick an SSH host so Zana can reconnect this machine.'
      );
    }
    const serverUrl = await requirePublicAppUrl(ctx);
    const serverHost = new URL(serverUrl).hostname;
    const primary = requirePrimaryHost(ctx);
    emit({ type: 'log', text: 'Checking the remote host daemon…' });
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
      emit({ type: 'log', text: 'Restarting the remote host daemon…' });
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
        if (restarted.log.trim()) emitLogLines(emit, restarted.log.trim());
        await waitForPeerConnect(
          (timeoutMs) => ctx.hostHub.waitUntilConnected(hostId, timeoutMs),
          emit
        );
        emit({ type: 'done', hostId });
        return events;
      } catch {
        emit({ type: 'log', text: 'Restart did not reconnect; reinstalling…' });
      }
    } else {
      emit({ type: 'log', text: 'Installing a fresh host-daemon artifact…' });
    }
    const issued = ctx.joinCodes.mintForHost(hostId);
    const command = pairingCommand(serverUrl, issued.joinCode, issued.hostId);
    try {
      await installPeer(ctx, {
        remote,
        joinCode: issued.joinCode,
        hostId: issued.hostId,
        serverUrl,
        emit
      });
    } catch (error) {
      const classified = classifyInstallFailure(error);
      throw new HostBootstrapError(
        classified.code,
        classified.message,
        pairingCommandForFailure(classified.code, command)
      );
    }
    updateHostSshIdentity(ctx.db, hostId, {
      host: remote.host,
      user: remote.user,
      proxyJump: remote.proxyJump
    });
    ctx.hub.emit('hosts:changed', undefined);
    emit({ type: 'done', hostId });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      emitBootstrapError(emit, error, ctx, remote, hostId);
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
