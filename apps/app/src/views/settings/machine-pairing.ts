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
