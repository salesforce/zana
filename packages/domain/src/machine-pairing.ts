export const PAIRING_TUNNEL_PORT = 18782;

const SSH_HOST_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const JOIN_CODE_RE = /^zcde_[A-Za-z0-9_-]{1,128}$/;
const HOST_ID_TOKEN_RE = /^[A-Za-z0-9._-]{1,64}$/;
const HOST_ID_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function sanitizeSshHost(raw: string | null | undefined): string | null {
  const host = raw?.trim() ?? '';
  if (!host || host.startsWith('-')) return null;
  if (!SSH_HOST_RE.test(host)) return null;
  return host;
}

export function isPairingJoinCode(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && JOIN_CODE_RE.test(raw);
}

/** Token safe to interpolate into the remote installer argv (UUID or test ids). */
export function isPairingHostIdToken(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && HOST_ID_TOKEN_RE.test(raw);
}

export function isPairingHostUuid(raw: string | null | undefined): boolean {
  return typeof raw === 'string' && HOST_ID_UUID_RE.test(raw);
}

export function isLoopbackOrigin(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return true;
  }
}

/** http(s) origin (optional `/t/<session>` path) safe to interpolate into the installer. */
export function sanitizePairingServerUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (!/^\/(?:t\/[A-Za-z0-9_-]+)?$/.test(url.pathname)) return null;
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}`.replace(/\/$/, '');
  } catch {
    return null;
  }
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

export interface SshPairingArgv {
  command: 'ssh';
  args: string[];
}

export function sshPairingRemoteScript(input: {
  joinCode: string;
  hostId: string;
  remoteTunnelPort?: number;
}): string | null {
  if (!isPairingJoinCode(input.joinCode) || !isPairingHostIdToken(input.hostId)) return null;
  const remotePort = input.remoteTunnelPort ?? PAIRING_TUNNEL_PORT;
  if (!Number.isInteger(remotePort) || remotePort < 1 || remotePort > 65535) return null;
  const remoteServer = `http://127.0.0.1:${remotePort}`;
  return (
    `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${remoteServer}/install.sh` +
    ` | sh -s -- --join-code ${input.joinCode} --host-id ${input.hostId} --server ${remoteServer}` +
    ` && echo Host daemon installed. Leave this SSH session open to keep the tunnel. && sleep infinity`
  );
}

export function pairingInstallScript(input: {
  serverUrl: string;
  joinCode: string;
  hostId: string;
}): string | null {
  const server = sanitizePairingServerUrl(input.serverUrl);
  if (!server || !isPairingJoinCode(input.joinCode) || !isPairingHostIdToken(input.hostId)) return null;
  return (
    `curl -fL --progress-meter --connect-timeout 10 --max-time 60 --retry 2 ${server}/install.sh` +
    ` | sh -s -- --join-code ${input.joinCode} --host-id ${input.hostId} --server ${server}`
  );
}

export function sshPublicPairingArgv(input: {
  sshHost: string;
  serverUrl: string;
  joinCode: string;
  hostId: string;
}): SshPairingArgv | null {
  const host = sanitizeSshHost(input.sshHost);
  const remote = pairingInstallScript(input);
  if (!host || !remote) return null;
  return { command: 'ssh', args: [host, remote] };
}

export function sshPairingArgv(input: {
  sshHost: string;
  localListenPort: number;
  joinCode: string;
  hostId: string;
  remoteTunnelPort?: number;
}): SshPairingArgv | null {
  const host = sanitizeSshHost(input.sshHost);
  const localPort = input.localListenPort;
  if (!host || !Number.isInteger(localPort) || localPort < 1 || localPort > 65535) return null;
  const remote = sshPairingRemoteScript(input);
  if (!remote) return null;
  const remotePort = input.remoteTunnelPort ?? PAIRING_TUNNEL_PORT;
  return {
    command: 'ssh',
    args: [
      '-o',
      'ExitOnForwardFailure=yes',
      '-R',
      `${remotePort}:127.0.0.1:${localPort}`,
      host,
      remote
    ]
  };
}

function posixSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function formatSshPairingCommand(argv: SshPairingArgv): string {
  const head = argv.args.slice(0, -1).join(' ');
  const remote = argv.args[argv.args.length - 1] ?? '';
  return `${argv.command} ${head} ${posixSingleQuote(remote)}`;
}

export function sshPairingCommand(input: {
  sshHost: string;
  localServerUrl: string;
  joinCode: string;
  hostId: string;
  remoteTunnelPort?: number;
}): string | null {
  const localPort = localListenPort(input.localServerUrl);
  if (localPort === null) return null;
  const argv = sshPairingArgv({
    sshHost: input.sshHost,
    localListenPort: localPort,
    joinCode: input.joinCode,
    hostId: input.hostId,
    remoteTunnelPort: input.remoteTunnelPort
  });
  return argv ? formatSshPairingCommand(argv) : null;
}
