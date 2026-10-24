import {
  findHostBySsh,
  getHost,
  getPrimaryHost,
  listExecutionHosts,
  updateHostSshIdentity,
  type HostRow
} from '@zana-ai/zcc-db';
import type { ProjectRemote } from '@zana-ai/zcc-domain/product';
import { sshPairingCommand } from '@zana-ai/zcc-domain/machine-pairing';
import type { ProductHttpContext } from '../../http/product-context.js';
import { HostUnavailableError } from '../../http/host-hub.js';
import { isDockerDesktopGatewayHost, resolvePublicAppUrl } from '../../http/public-app-url.js';
import { resolveHostArtifact } from './host-artifact.js';
import type { ProjectRecord } from '../../project-store.js';
import type { PeerDaemonStatusResult } from '@zana-ai/zcc-contracts/host-rpc';
import { connectInstallCommand, issueConnectHostCode, usesConnect } from './connect-enrollment.js';
import { ConnectRequestError } from '../../mobile/connect-account.js';
import { randomInt } from 'node:crypto';

const PEER_RPC_TIMEOUT_MS = 4 * 60_000;
const CONNECT_WAIT_MS = 90_000;
/** The primary's per-command SSH limit (host-daemon peer-daemon). */
const SSH_TIMEOUT_MS = 180_000;
/** How long the primary waits for its tunnel SSH to confirm forwarding (host-daemon peer-tunnels). */
const TUNNEL_OPEN_TIMEOUT_MS = 30_000;
/** Slack for RPC dispatch before the primary starts its tunnel timer. */
const TUNNEL_CONFIRM_GRACE_MS = 5_000;
const TUNNEL_PORT_MIN = 20_000;
const TUNNEL_PORT_MAX = 60_000;
const TUNNEL_PORT_ATTEMPTS = 5;
/** Host RPC error code the primary reports when SSH could not bind the remote forward port. */
const TUNNEL_FORWARD_FAILED_CODE = 'peer_tunnel_port_unavailable';
const CONNECT_WAIT_TICK_MS = 15_000;
const DAEMON_UNRESPONSIVE_RE =
  /did not report connected|did not connect|service-managed daemon did not report connected/i;

/** Only transport failures warrant changing the route; enrollment refusals do not. */
export function isPeerNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /curl: \((?:5|6|7|28|35|52|56|60)\)|fetch failed|ECONNREFUSED|ECONNRESET|ENETUNREACH|ETIMEDOUT|ERR_ACCESS_DENIED|packet length too long/i.test(message);
}

export const PAIRING_DOOR_ERROR =
  'Could not reach the pairing door. Retry, or copy the SSH command.';

export const DAEMON_UNRESPONSIVE_ERROR =
  'The host daemon started but never connected back. Retry, or copy the SSH command.';

export const DOCKER_JOIN_ORIGIN_ERROR =
  'A Docker Desktop address cannot enroll another computer. Set a public app URL, or copy the SSH command.';

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

export type HostBootstrapStage = 'ssh' | 'tunnel' | 'install' | 'wait' | 'register' | 'connected';

export type HostBootstrapEvent =
  | { type: 'log'; text: string }
  | { type: 'stage'; stage: HostBootstrapStage; status: 'running' | 'passed' | 'failed'; reason?: string; limitMs?: number }
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

function isDockerJoinOrigin(raw: string | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    return isDockerDesktopGatewayHost(new URL(raw.trim()).hostname);
  } catch {
    return false;
  }
}

export const NO_CONNECT_TUNNEL_LOG = 'Zana Connect is not set up; connecting through SSH…';

/**
 * A Docker Desktop gateway can never enroll another computer. Without Zana
 * Connect, every remote joins through an SSH reverse tunnel to this server.
 */
export function assertJoinOrigin(ctx: ProductHttpContext): void {
  const configUrl = ctx.config.getConfig().publicAppUrl;
  const url = resolvePublicAppUrl({ configUrl });
  // The resolver already drops Docker addresses; a Settings value that was dropped is reported.
  if (!url && isDockerJoinOrigin(configUrl)) {
    throw new HostBootstrapError('join_origin_invalid', DOCKER_JOIN_ORIGIN_ERROR);
  }
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
  if (
    error.code !== 'join_expired'
    && error.code !== 'daemon_unresponsive'
    && error.code !== 'join_origin_invalid'
    && error.code !== 'register_failed'
  ) {
    return error;
  }
  if (error.pairingCommand && error.code !== 'daemon_unresponsive') return error;
  if (!remote) return error;
  // No pairing forwarder: never hand out a command that would expose the full product API.
  const listenPort = tunnelLocalPort(ctx);
  if (listenPort === null) return error;
  try {
    const issued = hostId ? ctx.joinCodes.mintForHost(hostId) : ctx.joinCodes.mint();
    const command = sshFallbackPairingCommand({
      sshHost: remote.host,
      joinCode: issued.joinCode,
      hostId: issued.hostId,
      listenPort
    });
    if (!command) return error;
    return new HostBootstrapError(error.code, error.message, command);
  } catch {
    return error;
  }
}

export const PAIRING_FORWARDER_UNAVAILABLE_ERROR =
  'The SSH pairing listener is not running. Restart Zana, or use Connect.';

/**
 * The primary port an SSH tunnel forwards to: only the pairing allowlist
 * listener. Null when it is not running; never the full product API port.
 */
export function tunnelLocalPort(ctx: ProductHttpContext): number | null {
  return ctx.origins?.pairingPort ?? null;
}

function requireTunnelLocalPort(ctx: ProductHttpContext): number {
  const port = tunnelLocalPort(ctx);
  if (!port) throw new HostBootstrapError('pairing_forwarder_unavailable', PAIRING_FORWARDER_UNAVAILABLE_ERROR);
  return port;
}

/** The last resort once the automatic tunnel failed: a command the user runs over their own SSH. */
function withManualSshCommand(
  error: HostBootstrapError,
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  hostId: string
): HostBootstrapError {
  if (error.pairingCommand) return error;
  const listenPort = tunnelLocalPort(ctx);
  if (listenPort === null) return error;
  try {
    const issued = ctx.joinCodes.mintForHost(hostId);
    const command = sshFallbackPairingCommand({
      sshHost: remote.host,
      joinCode: issued.joinCode,
      hostId: issued.hostId,
      listenPort
    });
    return command ? new HostBootstrapError(error.code, error.message, command) : error;
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

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function rpcErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function oneLine(text: string): string {
  const line = installFailureLogLines(text)[0]?.trim() ?? '';
  return (line || 'Failed').slice(0, 200);
}

export type HostBootstrapStageTracker = ReturnType<typeof createStageTracker>;

/** Emits each stage transition once, so retries and fallbacks never duplicate a state. */
export function createStageTracker(emit: HostBootstrapListener) {
  const status = new Map<HostBootstrapStage, 'running' | 'passed' | 'failed'>();
  const send = (stage: HostBootstrapStage, next: 'running' | 'passed' | 'failed', extra: { reason?: string; limitMs?: number }) => {
    status.set(stage, next);
    emit({ type: 'stage', stage, status: next, ...extra });
  };
  return {
    start(stage: HostBootstrapStage, limitMs?: number): void {
      if (status.get(stage) !== 'running') send(stage, 'running', limitMs ? { limitMs } : {});
    },
    pass(stage: HostBootstrapStage): void {
      if (status.get(stage) === 'running') send(stage, 'passed', {});
    },
    fail(stage: HostBootstrapStage, reason: string): void {
      if (status.get(stage) !== 'failed') send(stage, 'failed', { reason: oneLine(reason) });
    },
    failRunning(reason: string): void {
      for (const [stage, current] of [...status]) {
        if (current === 'running') send(stage, 'failed', { reason: oneLine(reason) });
      }
    }
  };
}

/** Map the installer's stable stderr markers to a short reason for the install stage. */
export function installStageReason(text: string): string | null {
  const artifact = /zcc-install: artifact-unavailable status=(\S+)/.exec(text);
  if (artifact) return `Artifact download failed (HTTP ${artifact[1]})`;
  if (/zcc-install: script-unavailable/.test(text)) return 'Installer download failed';
  const step = /zcc-install: failed step=(\S+) rc=(\d+)/.exec(text);
  if (step) return `Install step ${step[1]} failed (exit ${step[2]})`;
  return null;
}

const SSH_CLIENT_FAILURE_RE =
  /^(?:ssh: .+|.*Permission denied \(.+|Host key verification failed\.?|.*Could not resolve hostname.+|kex_exchange_identification: .+)$/m;

function sshFailureReason(text: string): string | null {
  return SSH_CLIENT_FAILURE_RE.exec(text)?.[0].trim() ?? null;
}

/**
 * Why a machine that started its daemon still failed to register. Only lines
 * after this host's last join attempt count, so an older failure is ignored.
 * Display-only: never used to pick a transport.
 */
export function registerFailureFromLog(log: string, hostId: string): string | null {
  const lines = log.split(/\r?\n/u);
  let start = -1;
  lines.forEach((line, index) => {
    const marker = /zcc-join: attempt \S+ host=(\S+)/.exec(line);
    if (marker?.[1] === hostId) start = index;
  });
  if (start < 0) return null;
  let status: string | null = null;
  for (const line of lines.slice(start + 1)) {
    // A later attempt (any host) starts a new run; its failures are not this one's.
    if (/zcc-join: attempt /.test(line)) break;
    const match = /Failed to enroll daemon host: (\d{3})\b/.exec(line);
    if (match) status = match[1]!;
  }
  return status ? `Machine could not register (HTTP ${status})` : null;
}

function peerWaitFailure(
  error: unknown,
  log: string,
  hostId: string,
  stages: HostBootstrapStageTracker
): HostBootstrapError {
  const register = registerFailureFromLog(log, hostId);
  if (register) {
    stages.pass('wait');
    stages.start('register');
    stages.fail('register', register);
    return new HostBootstrapError('register_failed', register);
  }
  const classified = classifyInstallFailure(error);
  stages.fail('wait', classified.code === 'daemon_unresponsive' ? 'Machine did not connect back in time' : classified.message);
  return new HostBootstrapError(classified.code, classified.message);
}

async function awaitPeerRegistration(
  ctx: ProductHttpContext,
  input: {
    hostId: string;
    emit: HostBootstrapListener;
    stages: HostBootstrapStageTracker;
    dumpLogs?: () => Promise<string>;
  }
): Promise<void> {
  const { stages } = input;
  stages.start('wait', CONNECT_WAIT_MS);
  try {
    await waitForPeerConnect(
      (timeoutMs) => ctx.hostHub.waitUntilConnected(input.hostId, timeoutMs),
      input.emit
    );
  } catch (error) {
    const log = input.dumpLogs ? await input.dumpLogs() : '';
    emitLogLines(input.emit, errorText(error));
    throw peerWaitFailure(error, log, input.hostId, stages);
  }
  stages.pass('wait');
  stages.start('register');
  stages.pass('register');
  stages.start('connected');
  stages.pass('connected');
}

async function dumpPeerDaemonLogs(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  serverHost: string,
  emit: HostBootstrapListener
): Promise<string> {
  try {
    const primary = getPrimaryHost(ctx.db);
    if (!primary) return '';
    ctx.hostHub.ensureHostSessionReady(primary.id);
    const dumped = await ctx.hostHub.callHostOnlineRpc<{ log: string }>({
      hostId: primary.id,
      command: {
        type: 'peer_daemon.logs',
        remote: {
          host: remote.host,
          ...(remote.user ? { user: remote.user } : {}),
          ...(remote.proxyJump ? { proxyJump: remote.proxyJump } : {})
        },
        serverHost
      }
    });
    const log = dumped.log.trim();
    if (log) emitLogLines(emit, log);
    return log;
  } catch {
    /* Best-effort: a missing primary or old daemon must not hide the wait error. */
    return '';
  }
}

/** Mark the stage the install RPC failed in, from the primary's error code and output. */
function installRpcFailure(
  error: unknown,
  input: { hostId: string; stages: HostBootstrapStageTracker }
): HostBootstrapError {
  const raw = errorText(error);
  const { stages } = input;
  const classified = classifyInstallFailure(error);
  if (classified.code === 'daemon_unresponsive') {
    stages.pass('ssh');
    stages.pass('tunnel');
    stages.pass('install');
    stages.start('wait');
    return peerWaitFailure(error, raw, input.hostId, stages);
  }
  if (rpcErrorCode(error) === 'peer_tunnel_failed') {
    stages.fail('ssh', raw);
    stages.failRunning(raw);
  } else {
    const sshFailure = sshFailureReason(raw);
    if (sshFailure) {
      stages.fail('ssh', sshFailure);
    } else {
      stages.pass('ssh');
      stages.pass('tunnel');
    }
    stages.fail('install', installStageReason(raw) ?? classified.message);
    stages.failRunning(classified.message);
  }
  return new HostBootstrapError(classified.code, classified.message);
}

async function installPeer(
  ctx: ProductHttpContext,
  input: {
    remote: ProjectRemote;
    joinCode: string;
    hostId: string;
    serverUrl: string;
    /** The remote data directory name the install writes its log under. */
    serverHost: string;
    emit: HostBootstrapListener;
    stages: HostBootstrapStageTracker;
    sshTunnel?: { localPort: number; remotePort: number };
    /** Repair only: the user asked to reconnect this known host, so its old enrollment may be replaced. */
    replaceEnrollment?: boolean;
  }
): Promise<void> {
  const primary = requirePrimaryHost(ctx);
  const artifact = await resolveHostArtifact();
  const { stages, emit } = input;
  emit({ type: 'log', text: 'Installing host daemon over SSH…' });
  stages.start('ssh', SSH_TIMEOUT_MS);
  if (input.sshTunnel) stages.start('tunnel', TUNNEL_OPEN_TIMEOUT_MS + TUNNEL_CONFIRM_GRACE_MS);
  stages.start('install', PEER_RPC_TIMEOUT_MS);
  // The primary opens the tunnel before installing and fails the RPC when the tunnel
  // does not open in time, so an install still running past that limit has its tunnel.
  const tunnelConfirmed = input.sshTunnel
    ? setTimeout(() => { stages.pass('ssh'); stages.pass('tunnel'); }, TUNNEL_OPEN_TIMEOUT_MS + TUNNEL_CONFIRM_GRACE_MS / 2)
    : undefined;
  let result: { ok: true; log: string };
  try {
    result = await ctx.hostHub.callHostOnlineRpc<{ ok: true; log: string }>({
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
        artifactPath: artifact.tarballPath,
        ...(input.sshTunnel ? { sshTunnel: input.sshTunnel } : {}),
        ...(input.replaceEnrollment ? { replaceEnrollment: true } : {})
      }
    });
  } catch (error) {
    if (input.sshTunnel && isTunnelForwardFailure(error)) {
      stages.pass('ssh');
      throw error;
    }
    emitLogLines(emit, errorText(error));
    throw installRpcFailure(error, input);
  } finally {
    clearTimeout(tunnelConfirmed);
  }
  if (result.log.trim()) emitLogLines(emit, result.log.trim());
  stages.pass('ssh');
  stages.pass('tunnel');
  stages.pass('install');
  await awaitPeerRegistration(ctx, {
    hostId: input.hostId,
    emit,
    stages,
    dumpLogs: () => dumpPeerDaemonLogs(ctx, input.remote, input.serverHost, emit)
  });
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

/**
 * A remote project and a machine are one thing to the user: any unbound remote
 * project whose SSH identity matches an enrolled machine is bound to it, no
 * matter which was added first. Idempotent and SSH-free, so it is safe on every
 * project listing. A project whose path cannot be resolved stays unbound and
 * the composer's own connect action still binds it.
 */
export async function reconcileRemoteProjectBindings(ctx: ProductHttpContext): Promise<number> {
  const projects = ctx.projects.list();
  if (!projects.some((project) => project.remote)) return 0;
  const connectedIds = new Set(ctx.hostHub.connectedHostIds());
  // Plugin peer links are never execution machines, so they never take a project binding.
  const peers = listExecutionHosts(ctx.db).filter((host) => !host.isPrimary && !host.destroyedAt);
  let bound = 0;
  for (const project of projects) {
    const remote = sshRemoteFromProject(project);
    if (!remote) continue;
    const current = project.hostId ? peers.find((host) => host.id === project.hostId) : undefined;
    // A live binding stays; a removed or offline machine may be superseded by a connected twin.
    if (current && connectedIds.has(current.id)) continue;
    const matches = peers.filter((host) =>
      host.sshHost === remote.host && (!remote.user || !host.sshUser || host.sshUser === remote.user));
    const target = matches.find((host) => connectedIds.has(host.id)) ?? (current ? undefined : matches[0]);
    if (!target || target.id === project.hostId) continue;
    try {
      await ctx.projects.bindToHost(project.id, { hostId: target.id, path: executionPath(remote, target.homeDir ?? null) });
      bound += 1;
    } catch (error) {
      // Left as is; see above. Message only: never tokens or session ids.
      console.warn(`[zcc] Could not bind remote project to its machine: ${errorText(error)}`);
    }
  }
  if (bound > 0) ctx.hub.emit('projects:changed', ctx.projects.list());
  return bound;
}

/** The primary's own tunnel SSH reported that the remote port is already bound. */
export function isTunnelForwardFailure(error: unknown): boolean {
  return rpcErrorCode(error) === TUNNEL_FORWARD_FAILED_CODE;
}

/**
 * Try random remote ports until the primary's SSH can bind one. Only a
 * forwarding failure reported by the primary is retried; any other error ends
 * the attempt immediately.
 */
export async function openTunnelWithAutoPort<T>(
  attempt: (remotePort: number) => Promise<T>,
  options: { pickPort?: () => number; onRetry?: (busyPort: number) => void } = {}
): Promise<{ result: T; remotePort: number }> {
  const pick = options.pickPort ?? (() => randomInt(TUNNEL_PORT_MIN, TUNNEL_PORT_MAX));
  const tried = new Set<number>();
  for (let index = 0; index < TUNNEL_PORT_ATTEMPTS; index++) {
    let remotePort = pick();
    for (let guard = 0; tried.has(remotePort) && guard < 16; guard++) remotePort = pick();
    tried.add(remotePort);
    try {
      return { result: await attempt(remotePort), remotePort };
    } catch (error) {
      if (!isTunnelForwardFailure(error)) throw error;
      options.onRetry?.(remotePort);
    }
  }
  throw new HostBootstrapError('tunnel_port_unavailable', 'No free port on the remote machine');
}

/**
 * Keep the stored tunnel port in step with how the machine was last installed,
 * so the primary reopens only forwards a daemon still uses. A failed write must
 * not fail an install that already connected.
 */
function rememberTunnelRoute(ctx: ProductHttpContext, hostId: string, remotePort: number | null): void {
  try {
    if (remotePort === null) ctx.tunnelHosts?.remove(hostId);
    else ctx.tunnelHosts?.record(hostId, remotePort);
  } catch (error) {
    // The next tunnel install or primary reconnect rewrites the file.
    console.warn(`[zcc] Could not save the SSH tunnel route: ${errorText(error)}`);
  }
}

export interface TunnelPeerInstall {
  hostId: string;
  /** The loopback port the remote daemon reaches this server through. */
  remotePort: number;
}

/** The primary owns the SSH connection. The forwarded port is loopback-only on
 * both ends; the normal one-time host enrollment and host-key authentication
 * still gate the product connection, so no account credential is involved. */
async function installTunnelPeer(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  emit: HostBootstrapListener,
  stages: HostBootstrapStageTracker,
  localCode: { hostId: string; joinCode: string },
  options: { replaceEnrollment?: boolean } = {}
): Promise<TunnelPeerInstall> {
  const { hostId } = localCode;
  try {
    const localPort = requireTunnelLocalPort(ctx);
    const { remotePort } = await openTunnelWithAutoPort(
      (port) => installPeer(ctx, {
        remote, hostId, joinCode: localCode.joinCode,
        serverUrl: `http://127.0.0.1:${port}`, serverHost: `ssh-${hostId}`, emit, stages,
        sshTunnel: { localPort, remotePort: port },
        ...(options.replaceEnrollment ? { replaceEnrollment: true } : {})
      }),
      { onRetry: (port) => emit({ type: 'log', text: `Port ${port} is busy on the remote machine; trying another…` }) }
    );
    updateHostSshIdentity(ctx.db, hostId, { host: remote.host, user: remote.user, proxyJump: remote.proxyJump });
    rememberTunnelRoute(ctx, hostId, remotePort);
    ctx.hub.emit('hosts:changed', undefined);
    return { hostId, remotePort };
  } catch (error) {
    let failure: HostBootstrapError;
    if (error instanceof HostBootstrapError) {
      failure = error;
    } else {
      const classified = classifyInstallFailure(error);
      failure = new HostBootstrapError(classified.code, classified.message);
    }
    if (failure.code === 'tunnel_port_unavailable') stages.fail('tunnel', failure.message);
    stages.failRunning(failure.message);
    throw withManualSshCommand(failure, ctx, remote, hostId);
  }
}

/** A refused or unreachable account must not strand a machine this server can reach over SSH. */
function isConnectAccountUnavailable(error: unknown): boolean {
  return (error instanceof ConnectRequestError && [401, 403].includes(error.status)) || isPeerNetworkFailure(error) ||
    (error instanceof Error && error.name === 'TimeoutError');
}

async function installConnectPeer(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  emit: HostBootstrapListener,
  stages: HostBootstrapStageTracker,
  hostId?: string,
  options: { replaceEnrollment?: boolean } = {}
): Promise<string> {
  const primary = requirePrimaryHost(ctx);
  let issued: Awaited<ReturnType<typeof issueConnectHostCode>>;
  try {
    issued = await issueConnectHostCode(ctx, { name: remote.host.slice(0, 80), ...(hostId ? { hostId } : {}) });
  } catch (error) {
    if (!isConnectAccountUnavailable(error)) throw error;
    emit({ type: 'log', text: `Zana Connect is unavailable (${errorText(error)}); connecting through SSH…` });
    const code = hostId ? ctx.joinCodes.mintForHost(hostId) : ctx.joinCodes.mint();
    return (await installTunnelPeer(ctx, remote, emit, stages, code, options)).hostId;
  }
  emit({ type: 'log', text: 'Installing the machine through Zana Connect…' });
  stages.start('ssh', SSH_TIMEOUT_MS);
  stages.start('install', PEER_RPC_TIMEOUT_MS);
  let result: { ok: true; log: string };
  try {
    result = await ctx.hostHub.callHostOnlineRpc<{ ok: true; log: string }>({
      hostId: primary.id,
      timeoutMs: PEER_RPC_TIMEOUT_MS,
      command: {
        type: 'peer_daemon.install',
        remote: { host: remote.host, ...(remote.user ? { user: remote.user } : {}), ...(remote.proxyJump ? { proxyJump: remote.proxyJump } : {}) },
        connect: { accountUrl: issued.accountUrl, serverId: issued.serverId, code: issued.code }
      }
    });
  } catch (error) {
    // The primary already redacted the enrollment code from this output.
    emitLogLines(emit, errorText(error));
    if (isPeerNetworkFailure(error)) {
      emit({ type: 'log', text: 'Public HTTPS is unavailable on this machine; connecting through SSH…' });
      return (await installTunnelPeer(ctx, remote, emit, stages, ctx.joinCodes.mintForHost(issued.hostId), options)).hostId;
    }
    const failure = installRpcFailure(error, { hostId: issued.hostId, stages });
    throw new HostBootstrapError(failure.code, failure.message, connectInstallCommand(issued));
  }
  if (result.log.trim()) emitLogLines(emit, result.log.trim());
  stages.pass('ssh');
  stages.pass('install');
  try {
    await awaitPeerRegistration(ctx, { hostId: issued.hostId, emit, stages });
  } catch (error) {
    const failure = error as HostBootstrapError;
    throw new HostBootstrapError(failure.code, failure.message, connectInstallCommand(issued));
  }
  updateHostSshIdentity(ctx.db, issued.hostId, { host: remote.host, user: remote.user, proxyJump: remote.proxyJump });
  rememberTunnelRoute(ctx, issued.hostId, null);
  ctx.hub.emit('hosts:changed', undefined);
  return issued.hostId;
}

function emitBootstrapError(
  emit: HostBootstrapListener,
  error: HostBootstrapError,
  ctx: ProductHttpContext,
  remote: ProjectRemote | null,
  stages: HostBootstrapStageTracker,
  hostId?: string
): void {
  stages.failRunning(error.message);
  const enriched = attachSshFallbackPairingCommand(error, ctx, remote, hostId);
  emit({
    type: 'error',
    code: enriched.code,
    message: enriched.message,
    ...(enriched.pairingCommand ? { pairingCommand: enriched.pairingCommand } : {})
  });
}

/** Install a machine that has no usable enrollment yet, over the best route this server has. */
async function installNewRemote(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  emit: HostBootstrapListener,
  stages: HostBootstrapStageTracker
): Promise<string> {
  if (usesConnect(ctx)) return installConnectPeer(ctx, remote, emit, stages);
  assertJoinOrigin(ctx);
  emit({ type: 'log', text: NO_CONNECT_TUNNEL_LOG });
  return (await installTunnelPeer(ctx, remote, emit, stages, ctx.joinCodes.mint())).hostId;
}

/**
 * One host row per SSH identity: reuse a connected host, repair a known one,
 * and install only when nothing is enrolled for that identity yet. Returns
 * null when a repair already reported its error.
 */
async function ensureRemoteHost(
  ctx: ProductHttpContext,
  remote: ProjectRemote,
  sink: ReturnType<typeof createEventSink>,
  stages: HostBootstrapStageTracker,
  onEvent?: HostBootstrapListener
): Promise<{ hostId: string; kind: HostBootstrapPlan['kind'] } | null> {
  const existing = findHostBySsh(ctx.db, {
    host: remote.host,
    ...(remote.user ? { user: remote.user } : {})
  });
  const connected = Boolean(existing && ctx.hostHub.connectedHostIds().includes(existing.id));
  const plan = resolveHostBootstrapPlan({ existing, connected });
  if (plan.kind === 'bind') return { hostId: plan.hostId, kind: 'bind' };
  if (plan.kind === 'repair') {
    sink.absorb(await repairHost(ctx, plan.hostId, onEvent));
    if (sink.events.some((event) => event.type === 'error')) return null;
    return { hostId: plan.hostId, kind: 'repair' };
  }
  return { hostId: await installNewRemote(ctx, remote, sink.emit, stages), kind: 'install' };
}

export async function bootstrapHostForProject(
  ctx: ProductHttpContext,
  projectId: string,
  onEvent?: HostBootstrapListener
): Promise<HostBootstrapEvent[]> {
  const sink = createEventSink(onEvent);
  const { events, emit } = sink;
  const stages = createStageTracker(emit);
  let remote: ProjectRemote | null = null;
  try {
    const project = ctx.projects.list().find((row) => row.id === projectId);
    if (!project) throw new HostBootstrapError('unknown_project', 'Project not found.');
    remote = sshRemoteFromProject(project);
    if (!remote) throw new HostBootstrapError('not_remote_project', 'This project is not an SSH remote.');
    const host = await ensureRemoteHost(ctx, remote, sink, stages, onEvent);
    if (!host) return events;
    if (host.kind === 'bind') emit({ type: 'log', text: 'Reusing the enrolled daemon for this SSH host…' });
    if (host.kind === 'repair') emit({ type: 'log', text: 'Binding this project to the enrolled machine…' });
    await bindRemoteProject(ctx, { projectId: project.id, remote, hostId: host.hostId, emit });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      emitBootstrapError(emit, error, ctx, remote, stages);
      return events;
    }
    throw error;
  }
}

/**
 * Install or reconnect a machine by SSH identity alone, with no project. It
 * shares the project flow's host row, so a later project on the same identity
 * binds to this machine instead of installing again.
 */
export async function bootstrapHostBySsh(
  ctx: ProductHttpContext,
  ssh: { host: string; user?: string },
  onEvent?: HostBootstrapListener
): Promise<HostBootstrapEvent[]> {
  const sink = createEventSink(onEvent);
  const { events, emit } = sink;
  const stages = createStageTracker(emit);
  let remote: ProjectRemote | null = null;
  try {
    const parsed = parseSshIdentity({ host: ssh.host, ...(ssh.user ? { user: ssh.user } : {}) });
    remote = { host: parsed.host, ...(parsed.user ? { user: parsed.user } : {}) };
    const host = await ensureRemoteHost(ctx, remote, sink, stages, onEvent);
    if (!host) return events;
    await reconcileRemoteProjectBindings(ctx);
    if (host.kind === 'repair') return events;
    if (host.kind === 'bind') emit({ type: 'log', text: 'This machine is already connected.' });
    ctx.hub.emit('hosts:changed', undefined);
    emit({ type: 'done', hostId: host.hostId });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      emitBootstrapError(emit, error, ctx, remote, stages);
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
  const stages = createStageTracker(emit);
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
    if (usesConnect(ctx)) {
      await installConnectPeer(ctx, remote, emit, stages, hostId, { replaceEnrollment: true });
      emit({ type: 'done', hostId });
      return events;
    }
    assertJoinOrigin(ctx);
    emit({ type: 'log', text: NO_CONNECT_TUNNEL_LOG });
    await installTunnelPeer(ctx, remote, emit, stages, ctx.joinCodes.mintForHost(hostId), { replaceEnrollment: true });
    emit({ type: 'done', hostId });
    return events;
  } catch (error) {
    if (error instanceof HostBootstrapError) {
      emitBootstrapError(emit, error, ctx, remote, stages, hostId);
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
