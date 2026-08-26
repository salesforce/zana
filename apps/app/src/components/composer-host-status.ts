import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project } from '@zana-ai/zcc-domain/product';
import { isLoopbackOrigin, TAILSCALE_SERVE_HINT } from '../views/settings/machine-pairing.js';

export type ComposerHostAction =
  | { kind: 'ready' }
  | { kind: 'install'; label: 'Install'; reason: string }
  | { kind: 'fix'; hostId: string; label: 'Fix'; reason: string; needsSshPick?: boolean }
  | { kind: 'blocked'; reason: string; needsPublicUrl?: boolean; hostId?: string };

export type HostBootstrapOutcome =
  | { ok: true; hostId: string }
  | { ok: false; code: string; message: string; pairingCommand?: string };

export function hostPickerLabel(host: Host): string {
  return host.isPrimary ? `${host.name} (this machine)` : host.name;
}

export function hostPickerDescription(host: Host): string {
  return host.status === 'connected' ? 'Online' : 'Offline';
}

export function resolveComposerHostAction(input: {
  hosts: Host[];
  project?: Project;
  selectedHostId?: string;
  publicAppUrl?: string | null;
}): ComposerHostAction {
  const primary = input.hosts.find((host) => host.isPrimary) ?? input.hosts[0];
  if (!primary || primary.status !== 'connected') {
    return { kind: 'blocked', reason: 'This machine’s host daemon is not connected.' };
  }

  const sshProject = Boolean(input.project?.remote);
  const boundHost = input.project?.hostId
    ? input.hosts.find((host) => host.id === input.project!.hostId)
    : undefined;

  if (sshProject && !boundHost) {
    if (!input.publicAppUrl || isLoopbackOrigin(input.publicAppUrl)) {
      return {
        kind: 'blocked',
        needsPublicUrl: true,
        reason: `Set a public app URL before installing a remote daemon. ${TAILSCALE_SERVE_HINT}`
      };
    }
    const remote = input.project!.remote!;
    const target = remote.user ? `${remote.user}@${remote.host}` : remote.host;
    return {
      kind: 'install',
      label: 'Install',
      reason: `Install a host daemon on ${target}`
    };
  }

  const selected = input.selectedHostId
    ? input.hosts.find((host) => host.id === input.selectedHostId)
    : undefined;
  const executionHost = boundHost ?? selected;
  if (executionHost && executionHost.status !== 'connected' && !executionHost.isPrimary) {
    if (!input.publicAppUrl || isLoopbackOrigin(input.publicAppUrl)) {
      return {
        kind: 'blocked',
        needsPublicUrl: true,
        hostId: executionHost.id,
        reason: `Set a public app URL before reconnecting ${executionHost.name}. ${TAILSCALE_SERVE_HINT}`
      };
    }
    return {
      kind: 'fix',
      hostId: executionHost.id,
      label: 'Fix',
      needsSshPick: !executionHost.canRepairViaSsh,
      reason: executionHost.canRepairViaSsh
        ? `${executionHost.name} is offline`
        : `${executionHost.name} is offline. Pick an SSH host to reconnect it.`
    };
  }

  return { kind: 'ready' };
}

export function shouldBlockComposerSend(
  action: ComposerHostAction,
  project?: Project
): boolean {
  if (action.kind === 'blocked') return true;
  if (project?.remote) return false;
  return action.kind === 'fix';
}

export function shouldShowHostPicker(
  hosts: Host[],
  project?: Project
): boolean {
  if (project?.remote) return true;
  const connected = hosts.filter((host) => host.status === 'connected');
  if (hosts.some((host) => host.status === 'disconnected' && !host.isPrimary)) return true;
  return connected.length > 1;
}

export function bootstrapOutcome(
  events: Array<{ type: string; hostId?: string; code?: string; message?: string; pairingCommand?: string }>
): HostBootstrapOutcome {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.type === 'error') {
      return {
        ok: false,
        code: event.code ?? 'unknown',
        message: event.message ?? 'Host install did not complete',
        ...(event.pairingCommand ? { pairingCommand: event.pairingCommand } : {})
      };
    }
    if (event.type === 'done' && event.hostId) {
      return { ok: true, hostId: event.hostId };
    }
  }
  return { ok: false, code: 'unknown', message: 'Host install did not complete' };
}
