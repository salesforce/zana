import type { Host } from '@zana-ai/zcc-domain/thread-runtime';
import type { Project, ProjectRemote } from '@zana-ai/zcc-domain/product';
import {
  resolveRemoteStartPath,
  stampRemoteStartPath,
  type RemoteStartPathHost
} from '@zana-ai/zcc-domain/project';

let hints: RemoteStartPathHost[] = [];

export function hostToStartPathHint(host: Pick<
  Host,
  'id' | 'name' | 'isPrimary' | 'sshHost' | 'defaultWorkspacePath' | 'homeDir'
>): RemoteStartPathHost {
  return {
    id: host.id,
    name: host.name,
    isPrimary: host.isPrimary,
    sshHost: host.sshHost ?? null,
    defaultWorkspacePath: host.defaultWorkspacePath ?? null,
    homeDir: host.homeDir ?? null
  };
}

export function setRemoteStartPathHosts(hosts: readonly RemoteStartPathHost[]): void {
  hints = [...hosts];
}

export function remoteStartPathHosts(): readonly RemoteStartPathHost[] {
  return hints;
}

export function stampedProjectRemote(
  project: Project,
  remoteDefaultPath?: string
): ProjectRemote | undefined {
  if (!project.remote) return undefined;
  const resolved = resolveRemoteStartPath({
    project,
    remoteToolProxy: false,
    hosts: hints,
    remoteDefaultPath
  });
  return stampRemoteStartPath(project.remote, resolved.path);
}

export async function refreshRemoteStartPathHosts(baseUrl: string): Promise<void> {
  try {
    const url = new URL('api/v1/hosts', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    const response = await fetch(url);
    if (!response.ok) return;
    const rows = await response.json() as unknown;
    if (!Array.isArray(rows)) return;
    setRemoteStartPathHosts(rows.map((row) => hostToStartPathHint(row as Host)));
  } catch {
    /* keep the last successful snapshot */
  }
}
