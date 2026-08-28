import type { Project } from '@zana-ai/zcc-domain/product';

/**
 * SSH remotes default to this machine + remote tools. Selecting the enrolled
 * host daemon turns the proxy off so the thread runs on that box over RPC.
 */
export function isRemoteToolProxyActive(
  project: Project,
  executionHostId?: string | null
): boolean {
  if (!project.remote) return false;
  if (project.hostId && executionHostId === project.hostId) return false;
  return true;
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
