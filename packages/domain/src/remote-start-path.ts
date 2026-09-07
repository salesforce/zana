/**
 * Shared start-path ownership for SSH remotes:
 * per-project `remotePath` → matching Machine `defaultWorkspacePath` →
 * global Connectivity `remoteDefaultPath` → remote `$HOME`.
 *
 * Local projects (and the local-agent / remote-tools path) keep `project.path`.
 */

export type RemoteStartPathSource = 'project' | 'machine' | 'global' | 'home';

export interface RemoteStartPathHost {
  id: string;
  name: string;
  isPrimary: boolean;
  sshHost?: string | null;
  defaultWorkspacePath?: string | null;
  homeDir?: string | null;
}

export interface RemoteStartPathProject {
  path: string;
  hostId?: string;
  remote?: { host: string; remotePath?: string };
}

export interface RemoteStartPathResolution {
  path: string | null;
  source: RemoteStartPathSource;
  host: RemoteStartPathHost | null;
}

function trimmed(value: string | null | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/**
 * Match an enrolled Machine for an SSH project: bound `hostId` first, else
 * `Host.sshHost === project.remote.host`. Display name is never used.
 * The primary (this Mac) is not an SSH workspace default.
 */
export function matchHostForRemoteProject(
  project: RemoteStartPathProject,
  hosts: readonly RemoteStartPathHost[]
): RemoteStartPathHost | null {
  if (!project.remote) return null;
  if (project.hostId) {
    const byId = hosts.find((host) => host.id === project.hostId) ?? null;
    if (byId && !byId.isPrimary) return byId;
  }
  const sshHost = project.remote.host.trim();
  if (!sshHost) return null;
  return hosts.find((host) => !host.isPrimary && host.sshHost === sshHost) ?? null;
}

export function remoteStartPathSourceLabel(source: RemoteStartPathSource): string {
  if (source === 'project') return 'Project';
  if (source === 'machine') return 'Machine';
  if (source === 'global') return 'Global';
  return 'Home';
}

/**
 * Effective cwd for a new CLI session / Explorer root / Modern thread.
 * `null` means the caller should probe the remote `$HOME` (or leave the SSH
 * login directory alone).
 */
export function resolveRemoteStartPath(args: {
  project: RemoteStartPathProject;
  remoteToolProxy: boolean;
  hosts?: readonly RemoteStartPathHost[];
  remoteDefaultPath?: string;
}): RemoteStartPathResolution {
  if (args.remoteToolProxy || !args.project.remote) {
    return { path: args.project.path, source: 'project', host: null };
  }
  const host = matchHostForRemoteProject(args.project, args.hosts ?? []);
  const projectPath = trimmed(args.project.remote.remotePath);
  if (projectPath) return { path: projectPath, source: 'project', host };
  const machinePath = trimmed(host?.defaultWorkspacePath);
  if (machinePath) return { path: machinePath, source: 'machine', host };
  const globalPath = trimmed(args.remoteDefaultPath);
  if (globalPath) return { path: globalPath, source: 'global', host };
  const homeDir = trimmed(host?.homeDir);
  if (homeDir) return { path: homeDir, source: 'home', host };
  return { path: null, source: 'home', host };
}

/** Stamp the resolved start path onto a store-authorized SSH descriptor. */
export function stampRemoteStartPath<T extends { remotePath?: string }>(
  remote: T,
  resolvedPath: string | null
): T {
  if (!resolvedPath) {
    const next = { ...remote };
    delete next.remotePath;
    return next;
  }
  return { ...remote, remotePath: resolvedPath };
}
