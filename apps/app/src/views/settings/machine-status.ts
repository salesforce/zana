import type { Host } from '@zana-ai/zcc-domain/thread-runtime';

export function permissionLabel(mode: Host['maxPermissionMode']): string {
  if (mode === 'accept-edits') return 'Accept edits';
  if (mode === 'auto') return 'Auto';
  return 'Full';
}

export function machineConnectionCopy(
  host: Host,
  now: number
): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (host.lastRejectedProtocolVersion) {
    return { label: 'Needs update', tone: 'warn' };
  }
  if (host.status === 'connected') {
    return { label: 'Online', tone: 'ok' };
  }
  if (host.lastSeenAt) {
    const ago = Math.max(0, Math.round((now - host.lastSeenAt) / 60_000));
    return {
      label: ago < 1 ? 'Offline · just now' : `Offline · last seen ${ago}m ago`,
      tone: 'muted'
    };
  }
  return { label: 'Offline', tone: 'muted' };
}
