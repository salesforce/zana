import { useEffect, useState } from 'react';
import type { Project } from '@zana-ai/zcc-domain/product';
import {
  matchHostForRemoteProject,
  remoteStartPathSourceLabel,
  resolveRemoteStartPath,
  type RemoteStartPathHost,
  type RemoteStartPathSource
} from '@zana-ai/zcc-domain/project';
import { product } from './product-client.js';
import { useHosts } from '../hooks/useHosts.js';

export interface RemoteStartPathInspection {
  machineName: string | null;
  source: RemoteStartPathSource;
  sourceLabel: string;
  path: string | null;
}

function toHint(host: RemoteStartPathHost): RemoteStartPathHost {
  return {
    id: host.id,
    name: host.name,
    isPrimary: host.isPrimary,
    sshHost: host.sshHost ?? null,
    defaultWorkspacePath: host.defaultWorkspacePath ?? null,
    homeDir: host.homeDir ?? null
  };
}

export function inspectRemoteStartPath(
  project: Pick<Project, 'path' | 'hostId' | 'remote'>,
  hosts: readonly RemoteStartPathHost[],
  remoteDefaultPath?: string
): RemoteStartPathInspection | null {
  if (!project.remote) return null;
  const hints = hosts.map(toHint);
  const resolved = resolveRemoteStartPath({
    project,
    remoteToolProxy: false,
    hosts: hints,
    remoteDefaultPath
  });
  const host = matchHostForRemoteProject(project, hints);
  return {
    machineName: host?.name ?? null,
    source: resolved.source,
    sourceLabel: remoteStartPathSourceLabel(resolved.source),
    path: resolved.path
  };
}

export function useRemoteStartPathInspection(
  project: Pick<Project, 'path' | 'hostId' | 'remote'> | undefined
): RemoteStartPathInspection | null {
  const hosts = useHosts();
  const [remoteDefaultPath, setRemoteDefaultPath] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    void product.config.get().then((config) => {
      if (!cancelled) setRemoteDefaultPath(config.remoteDefaultPath);
    }).catch(() => undefined);
    const unsub = product.config.onChanged((config) => {
      setRemoteDefaultPath(config.remoteDefaultPath);
    });
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);
  if (!project?.remote) return null;
  return inspectRemoteStartPath(project, hosts, remoteDefaultPath);
}
