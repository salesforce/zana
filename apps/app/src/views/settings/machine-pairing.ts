export function pairingCommand(input: {
  publicAppUrl?: string | null;
  joinCode: string;
  hostId: string;
}): string | null {
  const server = input.publicAppUrl?.replace(/\/$/, '');
  if (!server || isLoopbackOrigin(server)) return null;
  return `curl -fL ${server}/install.sh | sh -s -- --join-code ${input.joinCode} --host-id ${input.hostId} --server ${server}`;
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
