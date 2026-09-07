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

export const PAIRING_DOOR_ERROR =
  'Could not reach the pairing door. Retry, or copy the SSH command.';

export const DAEMON_UNRESPONSIVE_ERROR =
  'The host daemon started but never connected back. Retry, or copy the SSH command.';

export function composerBootstrapErrorMessage(outcome: {
  code: string;
  message: string;
}): string {
  if (outcome.code === 'join_expired' || outcome.code === 'relay_offline') {
    return PAIRING_DOOR_ERROR;
  }
  if (outcome.code === 'daemon_unresponsive') {
    return DAEMON_UNRESPONSIVE_ERROR;
  }
  return outcome.message;
}

/** First DNS label, keeping IPv4/IPv6 intact so FQDNs fit a compact chip. */
export function shortHostName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return name;
  if (trimmed.includes(':')) return trimmed;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(trimmed)) return trimmed;
  return trimmed.split('.')[0] || trimmed;
}

export function hostPickerLabel(host: Host, project?: Project): string {
  if (host.isPrimary) return 'This machine';
  if (project?.remote && project.hostId === host.id) return 'Remote machine';
  return shortHostName(host.name);
}

export function hostPickerDescription(host: Host, project?: Project): string {
  const status = host.status === 'connected' ? 'Online' : 'Offline';
  if (host.isPrimary) {
    const shortName = shortHostName(host.name);
    if (!shortName || shortName.toLowerCase() === 'this machine') return status;
    return `${shortName} · ${status}`;
  }
  if (project?.remote && project.hostId === host.id) {
    const shortName = shortHostName(host.name);
    return shortName ? `${shortName} · ${status}` : status;
  }
  return status;
}

export function composerHostActionChipLabel(action: ComposerHostAction): string | null {
  if (action.kind === 'ready') return null;
  if (action.kind === 'blocked' && action.needsPublicUrl) {
    return action.hostId ? 'Set URL' : null;
  }
  if (action.kind === 'blocked') return 'Unavailable';
  if (action.kind === 'install') return 'Install host daemon';
  return 'Fix connection';
}

/** SSH remotes only offer the bound daemon (never this machine). */
export function composerHostsForProject(hosts: Host[], project?: Project): Host[] {
  if (!project?.remote) return hosts;
  if (!project.hostId) return [];
  return hosts.filter((host) => host.id === project.hostId);
}

/** True when a local project is aimed at a machine that does not own its folder. */
export function isForeignExecutionHost(
  project: Project | undefined,
  hosts: Host[],
  selectedHostId?: string
): boolean {
  if (!project || !selectedHostId || project.remote) return false;
  const bound = project.hostId ?? hosts.find((host) => host.isPrimary)?.id;
  return Boolean(bound) && bound !== selectedHostId;
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

  const boundHost = input.project?.hostId
    ? input.hosts.find((host) => host.id === input.project!.hostId)
    : undefined;

  if (input.project?.remote && !boundHost) {
    if (!input.publicAppUrl || isLoopbackOrigin(input.publicAppUrl)) {
      return {
        kind: 'blocked',
        needsPublicUrl: true,
        reason: `Set a public app URL before installing a remote daemon. ${TAILSCALE_SERVE_HINT}`
      };
    }
    const remote = input.project.remote;
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
  const executionHost = input.project?.remote ? boundHost : (selected ?? boundHost);
  if (executionHost && executionHost.status !== 'connected' && !executionHost.isPrimary) {
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

  if (
    executionHost
    && input.project
    && !input.project.remote
    && !input.project.quickAgent
  ) {
    const projectHostId = input.project.hostId ?? primary.id;
    if (executionHost.id !== projectHostId) {
      const projectHost = input.hosts.find((host) => host.id === projectHostId);
      const here = projectHost?.isPrimary ? 'this machine' : (projectHost?.name ?? 'another machine');
      return {
        kind: 'blocked',
        reason: `This project lives on ${here}. Add a folder on ${executionHost.name} first.`
      };
    }
  }

  return { kind: 'ready' };
}

export function shouldBlockComposerSend(
  action: ComposerHostAction,
  _project?: Project
): boolean {
  return action.kind !== 'ready';
}

export function shouldShowHostPicker(
  hosts: Host[],
  project?: Project
): boolean {
  if (project?.remote) {
    return composerHostsForProject(hosts, project).length > 1;
  }
  const connected = hosts.filter((host) => host.status === 'connected');
  if (hosts.some((host) => host.status === 'disconnected' && !host.isPrimary)) return true;
  return connected.length > 1;
}

export type ComposerRemoteHostBadge = {
  status: 'online' | 'offline';
};

/** Connection status for an SSH remote. The project picker already names the host. */
export function composerRemoteHostBadge(input: {
  project?: Project;
  host?: Host | null;
}): ComposerRemoteHostBadge | null {
  const project = input.project;
  if (!project?.remote || !project.hostId) return null;
  if (input.host && input.host.id !== project.hostId) return null;
  if (!input.host) return null;
  return { status: input.host.status === 'connected' ? 'online' : 'offline' };
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
