import type { Project } from '@zana-ai/zcc-domain/product';
import {
  resolveRemoteStartPath,
  stampRemoteStartPath,
  type RemoteStartPathHost,
  type RemoteStartPathResolution,
  type RemoteStartPathSource
} from '@zana-ai/zcc-domain/project';

export const REMOTE_HOST_DAEMON_REQUIRED = 'host-daemon-required';
export const REMOTE_HOST_DAEMON_REQUIRED_MESSAGE =
  'Install a host daemon on this SSH remote before starting a thread.';

export type { RemoteStartPathHost, RemoteStartPathResolution, RemoteStartPathSource };

/**
 * New Modern threads never use the local-agent / remote-tools path.
 * Existing in-flight sessions keep a persisted `remoteToolProxy` flag.
 */
export function isRemoteToolProxyActive(
  _project: Project,
  _executionHostId?: string | null
): boolean {
  return false;
}

export function resolveRemoteWorkspace(args: {
  project: Project;
  remoteToolProxy: boolean;
  remoteDefaultPath?: string;
  hosts?: readonly RemoteStartPathHost[];
}): RemoteStartPathResolution {
  return resolveRemoteStartPath(args);
}

/**
 * CLI-identical start path for an enrolled remote host:
 * per-project `remotePath` → Machine `defaultWorkspacePath` → global
 * `remoteDefaultPath` → `null` (caller probes `$HOME`).
 * Local-agent / remote-tools and non-SSH projects keep the local `project.path`.
 */
export function remoteWorkspacePath(
  project: Project,
  remoteToolProxy: boolean,
  remoteDefaultPath?: string,
  hosts?: readonly RemoteStartPathHost[]
): string | null {
  return resolveRemoteStartPath({
    project,
    remoteToolProxy,
    remoteDefaultPath,
    hosts
  }).path;
}

/** Resolve the harness workspace, probing the execution host's home when both remote paths are empty. */
export async function resolveHarnessWorkspacePath(args: {
  project: Project;
  remoteToolProxy: boolean;
  remoteDefaultPath?: string;
  hosts?: readonly RemoteStartPathHost[];
  probeHostHome: () => Promise<string>;
}): Promise<string> {
  const resolved = resolveRemoteStartPath(args);
  if (resolved.path) return resolved.path;
  return args.probeHostHome();
}

export function threadLaunchRemote(
  project: Project,
  resolvedPath?: string | null
): {
  host: string;
  user?: string;
  remotePath?: string;
  proxyJump?: string;
} | undefined {
  if (!project.remote) return undefined;
  const stamped = stampRemoteStartPath(
    project.remote,
    resolvedPath !== undefined ? resolvedPath : (project.remote.remotePath ?? null)
  );
  return {
    host: stamped.host,
    ...(stamped.user ? { user: stamped.user } : {}),
    ...(stamped.remotePath ? { remotePath: stamped.remotePath } : {}),
    ...(stamped.proxyJump ? { proxyJump: stamped.proxyJump } : {})
  };
}

/** Bound daemon for an SSH project, or null when the caller should use input.hostId. */
export function boundRemoteHostId(project: Project): string | null | undefined {
  if (!project.remote) return undefined;
  return project.hostId ?? null;
}
