import type { Project } from '@zana-ai/zcc-domain/product';

export const REMOTE_HOST_DAEMON_REQUIRED = 'host-daemon-required';
export const REMOTE_HOST_DAEMON_REQUIRED_MESSAGE =
  'Install a host daemon on this SSH remote before starting a thread.';

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

/** Placeholder on this machine; the enrolled host uses the resolved remote path. */
export function remoteWorkspacePath(project: Project, remoteToolProxy: boolean): string {
  if (!remoteToolProxy && project.remote?.remotePath) return project.remote.remotePath;
  return project.path;
}

export function threadLaunchRemote(project: Project): {
  host: string;
  user?: string;
  remotePath?: string;
  proxyJump?: string;
} | undefined {
  if (!project.remote) return undefined;
  return {
    host: project.remote.host,
    ...(project.remote.user ? { user: project.remote.user } : {}),
    ...(project.remote.remotePath ? { remotePath: project.remote.remotePath } : {}),
    ...(project.remote.proxyJump ? { proxyJump: project.remote.proxyJump } : {})
  };
}

/** Bound daemon for an SSH project, or null when the caller should use input.hostId. */
export function boundRemoteHostId(project: Project): string | null | undefined {
  if (!project.remote) return undefined;
  return project.hostId ?? null;
}
