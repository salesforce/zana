export const PAIRING_TUNNEL_PORT = 18782;

const SSH_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function pairingCommand(input: {
  publicAppUrl?: string | null;
  joinCode: string;
  hostId: string;
}): string | null {
  const server = resolvePairingServerUrl(input.publicAppUrl);
  if (!server) return null;
  return (
    `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${server}/install.sh` +
    ` | sh -s -- --join-code ${input.joinCode} --host-id ${input.hostId} --server ${server}`
  );
}

export const RELAY_SESSION_ID_RE = /^zcrs_[A-Za-z0-9_-]{16,64}$/;

export function pairingSessionServerUrl(origin: string, sessionId: string): string {
  return `${origin.replace(/\/$/u, '')}/t/${sessionId}`;
}

export type RelayStatus = {
  state: 'connected' | 'offline' | 'unconfigured';
  sessionId?: string;
  joinUntil?: number;
};

/** Prefer `/t/<sessionId>` when the Heroku relay is connected; Tailscale stays bare. */
export function resolveRelayPairingServerUrl(input: {
  publicAppUrl?: string | null;
  relay?: RelayStatus | null;
  now?: number;
}): { url: string | null; error?: 'join_expired' | 'relay_offline' } {
  const base = resolvePairingServerUrl(input.publicAppUrl);
  if (!base) return { url: null };
  const relay = input.relay;
  if (!relay || relay.state === 'unconfigured') return { url: base };
  if (relay.state === 'offline') return { url: base, error: 'relay_offline' };
  if (!relay.sessionId || !RELAY_SESSION_ID_RE.test(relay.sessionId)) {
    return { url: base, error: 'join_expired' };
  }
  const prefixed = pairingSessionServerUrl(base, relay.sessionId);
  const now = input.now ?? Date.now();
  if (typeof relay.joinUntil === 'number' && relay.joinUntil <= now) {
    return { url: prefixed, error: 'join_expired' };
  }
  return { url: prefixed };
}

export function joinCountdownMs(
  joinCodeExpiresAt: number,
  joinUntil: number | undefined,
  now: number
): number {
  const end = typeof joinUntil === 'number' ? Math.min(joinCodeExpiresAt, joinUntil) : joinCodeExpiresAt;
  return end - now;
}

/**
 * Laptop-side one-liner for SSH remotes (Salesforce workspaces, no Tailscale).
 * Reverse-forwards product HTTP to the remote loopback so the copied installer
 * can enroll without a public app URL.
 */
export function sshPairingCommand(input: {
  sshHost: string;
  localServerUrl: string;
  joinCode: string;
  hostId: string;
  remoteTunnelPort?: number;
}): string | null {
  const host = sanitizeSshHost(input.sshHost);
  const localPort = localListenPort(input.localServerUrl);
  if (!host || localPort === null) return null;
  const remotePort = input.remoteTunnelPort ?? PAIRING_TUNNEL_PORT;
  const remoteServer = `http://127.0.0.1:${remotePort}`;
  const remote =
    `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${remoteServer}/install.sh` +
    ` | sh -s -- --join-code ${input.joinCode} --host-id ${input.hostId} --server ${remoteServer}` +
    ` && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity`;
  return `ssh -o ExitOnForwardFailure=yes -R ${remotePort}:127.0.0.1:${localPort} ${host} '${remote}'`;
}

export function sanitizeSshHost(raw: string | null | undefined): string | null {
  const host = raw?.trim() ?? '';
  if (!host || host.startsWith('-')) return null;
  if (!SSH_HOST_RE.test(host)) return null;
  return host;
}

export type PairingSshHostGroup = 'project' | 'ssh-config';

export interface PairingSshHostOption {
  host: string;
  label: string;
  group: PairingSshHostGroup;
  /** Secondary line — SSH alias, hostname, or user. */
  detail?: string;
}

export function sshHostOptionsFromProjects(
  projects: Array<{
    name?: string;
    lastActiveAt?: number;
    remote?: { host?: string } | null;
  }>
): PairingSshHostOption[] {
  const byHost = new Map<string, PairingSshHostOption & { lastActiveAt: number }>();
  for (const project of projects) {
    const host = sanitizeSshHost(project.remote?.host);
    if (!host) continue;
    const lastActiveAt = project.lastActiveAt ?? 0;
    const existing = byHost.get(host);
    if (existing && existing.lastActiveAt >= lastActiveAt) continue;
    const name = project.name?.trim();
    const named = Boolean(name && name !== host);
    byHost.set(host, {
      host,
      label: named && name ? name : host,
      group: 'project',
      lastActiveAt,
      ...(named ? { detail: host } : {})
    });
  }
  return [...byHost.values()]
    .sort((left, right) => right.lastActiveAt - left.lastActiveAt || left.host.localeCompare(right.host))
    .map(({ lastActiveAt: _lastActiveAt, ...option }) => option);
}

export function sshHostsFromProjects(
  projects: Array<{ remote?: { host?: string } | null }>
): string[] {
  return sshHostOptionsFromProjects(projects).map((option) => option.host);
}

export type PairingSshConfigHost = string | {
  alias: string;
  hostname?: string;
  user?: string;
};

function sshConfigDetail(entry: { hostname?: string; user?: string }): string | undefined {
  const hostname = entry.hostname?.trim();
  const user = entry.user?.trim();
  const parts = [hostname, user ? `@${user}` : ''].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : undefined;
}

function sshConfigAlias(entry: PairingSshConfigHost): string {
  return typeof entry === 'string' ? entry : entry.alias;
}

export function mergePairingSshHosts(
  projectOptions: PairingSshHostOption[],
  sshConfigHosts: PairingSshConfigHost[]
): PairingSshHostOption[] {
  const seen = new Set(projectOptions.map((option) => option.host));
  const extra: PairingSshHostOption[] = [];
  for (const raw of sshConfigHosts) {
    const host = sanitizeSshHost(sshConfigAlias(raw));
    if (!host || seen.has(host)) continue;
    seen.add(host);
    const detail = typeof raw === 'string' ? undefined : sshConfigDetail(raw);
    extra.push({
      host,
      label: host,
      group: 'ssh-config',
      ...(detail ? { detail } : {})
    });
  }
  extra.sort((left, right) => left.host.localeCompare(right.host));
  return [...projectOptions, ...extra];
}

export function defaultSshHost(
  projects: Array<{ id?: string; remote?: { host?: string } | null }>,
  lastProjectId?: string | null
): string {
  const last = lastProjectId ? projects.find((project) => project.id === lastProjectId) : undefined;
  const fromLast = sanitizeSshHost(last?.remote?.host);
  if (fromLast) return fromLast;
  return sshHostOptionsFromProjects(projects)[0]?.host ?? '';
}

export function localListenPort(serverUrl: string | null | undefined): number | null {
  if (!serverUrl) return null;
  try {
    const url = new URL(serverUrl);
    if (url.port) {
      const port = Number(url.port);
      return Number.isInteger(port) && port > 0 ? port : null;
    }
    if (url.protocol === 'http:') return 80;
    if (url.protocol === 'https:') return 443;
    return null;
  } catch {
    return null;
  }
}

/** Prefer a reachable public origin; otherwise the local product server, like BB. */
export function resolvePairingServerUrl(publicAppUrl?: string | null): string | null {
  const trimmed = publicAppUrl?.trim().replace(/\/$/, '') || undefined;
  if (trimmed && !isLoopbackOrigin(trimmed)) return trimmed;
  return localProductOrigin() ?? trimmed ?? null;
}

export function localProductOrigin(): string | null {
  const devPort =
    typeof __ZCC_DEV_WS_PORT__ === 'number' && Number.isFinite(__ZCC_DEV_WS_PORT__)
      ? __ZCC_DEV_WS_PORT__
      : undefined;
  if (devPort) return `http://127.0.0.1:${devPort}`;
  if (typeof window !== 'undefined' && window.location?.origin && window.location.protocol !== 'file:') {
    return window.location.origin;
  }
  return null;
}

export function isLoopbackOrigin(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return true;
  }
}

export function formatJoinCountdown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const TAILSCALE_SERVE_HINT =
  'tailscale serve --bg --https=443 http://127.0.0.1:<zcc-port>';
