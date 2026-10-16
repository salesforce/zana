/**
 * True when a request failed only because the target host daemon is offline.
 * Composer surfaces already show that state (Offline chip, Fix connection),
 * so callers suppress the raw error and reload once the host reconnects.
 */
export function isHostUnavailableError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'host-unavailable';
}
